import 'dart:async';
import 'dart:convert';

import 'package:supabase_flutter/supabase_flutter.dart';

import '../../account/account.dart';
import '../../database/database.dart';
import '../../deck/deck.dart';
import 'failure.dart';
import 'model.dart';
import 'server.dart';

/// The sharing tables and functions, reached through PostgREST with the
/// session the `account` domain signed in.
final class SupabaseSharingServer implements SharingServer {
  SupabaseSharingServer(
    this._client, {
    this.timeout = const Duration(seconds: 20),
    FunctionsClient? functions,
  }) : _functions = functions ?? _client.functions;

  final SupabaseClient _client;

  /// Where `publish-note` is called, the client's own unless a test names one.
  final FunctionsClient _functions;

  /// How long one request may take before it counts as offline.
  final Duration timeout;

  /// The most cards one request reads while copying a deck.
  static const _page = 1000;

  @override
  Future<List<PublicDeckSummary>> listDecks({
    required String search,
    required BrowseSort sort,
    required int limit,
  }) => _request(() async {
    final rows = await _client.rpc<List<dynamic>>(
      'list_public_decks',
      params: {
        'search': search,
        'sort': switch (sort) {
          BrowseSort.newest => 'newest',
          BrowseSort.mostCopied => 'copied',
        },
        'page_size': limit,
        'page_offset': 0,
      },
    );
    return [
      for (final row in rows)
        if (row case final Map<String, dynamic> row)
          _decodeSummary(_Fields(row))
        else
          throw const FormatException('a listed deck is not an object'),
    ];
  });

  @override
  Future<List<PublicCard>> listCards(DeckId deck, {int? limit}) =>
      _request(() async {
        final cards = <PublicCard>[];
        while (true) {
          final want = limit == null ? _page : limit - cards.length;
          final from = cards.length;
          final rows = await _client
              .from('cards')
              .select('front, back, template, template_version')
              .eq('deck_id', deck.value)
              .isFilter('deleted_at', null)
              .order('created_at', ascending: true)
              .order('id', ascending: true)
              .range(from, from + (want < _page ? want : _page) - 1);
          for (final row in rows) {
            cards.add(_decodeCard(_Fields(row)));
          }
          final full = limit != null && cards.length >= limit;
          if (rows.length < _page || full) return cards;
        }
      });

  @override
  Future<bool> recordCopy(DeckId deck) => _request(() async {
    final counted = await _client.rpc<Object?>(
      'record_deck_copy',
      params: {'deck_id': deck.value},
    );
    if (counted is! bool) {
      throw const FormatException('record_deck_copy returned no boolean');
    }
    return counted;
  });

  @override
  Future<ReportOutcome> report(DeckId deck, ReportReason reason) =>
      _request(() async {
        try {
          await _client.from('deck_reports').insert({
            'deck_id': deck.value,
            'reason': reason.name,
          });
          return ReportOutcome.reported;
        } on PostgrestException catch (error) {
          // A second report of the same deck by the same user.
          if (error.code == _uniqueViolation) {
            return ReportOutcome.alreadyReported;
          }
          rethrow;
        }
      });

  @override
  Future<void> block(UserId user) => _request(() async {
    try {
      await _client.from('user_blocks').insert({'blocked_id': user.value});
    } on PostgrestException catch (error) {
      // Already blocked: the block the user asked for holds.
      if (error.code != _uniqueViolation) rethrow;
    }
  });

  @override
  Future<DisplayName?> displayName() => _request(() async {
    final user = _client.auth.currentUser;
    if (user == null) throw const SharingRejected(_NoSession());
    final row = await _client
        .from('profiles')
        .select('display_name')
        .eq('user_id', user.id)
        .maybeSingle();
    return row == null
        ? null
        : DisplayName.stored(_Fields(row).string('display_name'));
  });

  @override
  Future<void> setDisplayName(DisplayName name) => _request(
    () => _client.from('profiles').upsert({
      'display_name': name.value,
    }, onConflict: 'user_id'),
  );

  @override
  Future<Screening> writeVisibility(
    Deck deck,
    DeckVisibility visibility, {
    String? description,
    required DateTime at,
  }) => _request<Screening>(() async {
    // user_id defaults to the caller, and deleted_at is left as the server
    // has it, so a deck deleted on another device stays deleted.
    final row = {
      'id': deck.id.value,
      'name': deck.name,
      'created_at': _time(deck.createdAt),
      'updated_at': _time(at),
    };
    switch (visibility) {
      case PrivateDeck():
        await _client.from('decks').upsert({
          ...row,
          'visibility': 'private',
          'published_at': null,
        });
        return const Screening(DeckPublication.private);
      case PublicDeck():
        // No client write makes a deck public, so the row is made as the
        // server defaults it (private) or left as it is, and `publish-note`
        // makes it public once its rules have read it.
        await _client.from('decks').upsert(row);
        return _publish(deck.id, description);
    }
  });

  /// Asks `publish-note` to publish [deck], which answers once it has
  /// screened the note, with where it has the note.
  Future<Screening> _publish(DeckId deck, String? description) async {
    final FunctionResponse response;
    try {
      response = await _functions.invoke(
        'publish-note',
        body: {'deck_id': deck.value, 'description': description},
      );
    } on FunctionException catch (error) {
      throw classifyPublishError(error);
    }
    return _decodeScreening(response.data);
  }

  /// Runs [request] within [timeout], mapping each expected failure to its
  /// [SharingFailure].
  Future<T> _request<T>(Future<T> Function() request) async {
    try {
      return await request().timeout(timeout);
    } on SharingFailure {
      rethrow;
    } on TimeoutException catch (cause) {
      throw SharingOffline(cause);
    } on PostgrestException catch (cause) {
      throw classifySharingError(cause);
    } on AuthException catch (cause) {
      throw SharingRejected(cause);
    } on FormatException catch (cause) {
      throw SharingFailed(cause);
    } on Exception catch (cause) {
      // The HTTP client's own failures: no connection, a dropped request.
      throw SharingOffline(cause);
    }
  }
}

const _uniqueViolation = '23505';

/// The failure a `publish-note` [error] means: a refused session, owner or
/// account is [SharingRejected], an unreachable function or gateway is
/// [SharingOffline], and anything else is [SharingFailed].
SharingFailure classifyPublishError(FunctionException error) =>
    switch (error.status) {
      401 || 403 => SharingRejected(error),
      0 || 500 || 502 || 503 || 504 => SharingOffline(error),
      _ => SharingFailed(error),
    };

/// The failure a PostgREST [error] means, read as sync reads it: a refused
/// privilege or session, an unreachable database or gateway, or anything
/// else the server refused.
SharingFailure classifySharingError(PostgrestException error) =>
    switch (error.code) {
      '42501' ||
      'PGRST301' ||
      'PGRST302' ||
      '401' ||
      '403' => SharingRejected(error),
      'PGRST000' ||
      'PGRST001' ||
      'PGRST002' ||
      '500' ||
      '502' ||
      '503' ||
      '504' => SharingOffline(error),
      _ => SharingFailed(error),
    };

/// No account is signed in on the client.
final class _NoSession implements Exception {
  const _NoSession();

  @override
  String toString() => 'no session';
}

/// The answer of `publish-note`; anything but a state a publish can end in,
/// or a finding of an unknown shape, is a [FormatException].
Screening _decodeScreening(Object? data) {
  if (data is! Map<String, dynamic>) {
    throw const FormatException('publish-note answered no object');
  }
  final fields = _Fields(data);
  final state = switch (fields.string('state')) {
    'checking' => DeckPublication.checking,
    'held' => DeckPublication.held,
    'refused' => DeckPublication.refused,
    'public' => DeckPublication.public,
    final other => throw FormatException('publish-note answered state $other'),
  };
  final findings = switch (data['findings']) {
    null => const <Object?>[],
    final List<dynamic> list => list,
    _ => throw const FormatException('findings is not a list'),
  };
  return Screening(
    state,
    refusal: fields.stringOrNull('refusal'),
    findings: [
      for (final finding in findings)
        if (finding case final Map<String, dynamic> finding)
          _decodeFinding(_Fields(finding))
        else
          throw const FormatException('a finding is not an object'),
    ],
  );
}

ScreeningFinding _decodeFinding(_Fields row) => ScreeningFinding(
  place: switch (row.string('where')) {
    'name' => FindingPlace.name,
    'description' => FindingPlace.description,
    'front' => FindingPlace.front,
    'back' => FindingPlace.back,
    final other => throw FormatException('a finding is at $other'),
  },
  category: FindingCategory.fromKey(row.string('category')),
  card: switch (row.stringOrNull('card_id')) {
    final id? => CardId(id),
    null => null,
  },
  block: row.integerOrNull('block'),
  start: row.integerOrNull('start'),
  end: row.integerOrNull('end'),
);

String _time(DateTime time) => storedTime(time).toIso8601String();

PublicDeckSummary _decodeSummary(_Fields row) => PublicDeckSummary(
  id: DeckId(row.string('id')),
  owner: UserId(row.string('user_id')),
  ownerName: DisplayName.stored(row.string('display_name')),
  name: row.string('name'),
  description: row.stringOrNull('description'),
  cardCount: row.integer('card_count'),
  copyCount: row.integer('copy_count'),
  publishedAt: DateTime.parse(row.string('published_at')),
);

PublicCard _decodeCard(_Fields row) {
  if (isFramed(
    row.stringOrNull('template'),
    row.integerOrNull('template_version'),
  )) {
    final cells = decodeCells(row.json('front'));
    final sides = sidesOf(cells);
    return PublicCard(front: sides.front, back: sides.back, cells: cells);
  }
  return PublicCard(
    front: decodeContent(row.json('front')),
    back: decodeContent(row.json('back')),
  );
}

/// A row PostgREST returned, read field by field; a field of the wrong type
/// throws [FormatException].
extension type _Fields(Map<String, dynamic> row) {
  T _read<T>(String key) => switch (row[key]) {
    final T value => value,
    final other => throw FormatException(
      'expected $key to be $T, found ${other.runtimeType}',
    ),
  };

  String string(String key) => _read<String>(key);

  String? stringOrNull(String key) => _read<String?>(key);

  int integer(String key) => _read<int>(key);

  int? integerOrNull(String key) => _read<int?>(key);

  /// A `jsonb` value, encoded as the local database stores it.
  String json(String key) => jsonEncode(_read<List<dynamic>>(key));
}
