import 'dart:async';

import 'package:knowno/account/account.dart';
import 'package:knowno/deck/deck.dart';
import 'package:knowno/sharing/sharing.dart';

/// Stands in for the device's network state, online unless given false;
/// [online] changes it.
class FakeReachability implements Reachability {
  FakeReachability([this._online = true]);

  bool _online;
  final _changes = StreamController<bool>.broadcast();

  bool get online => _online;
  set online(bool online) {
    _online = online;
    _changes.add(online);
  }

  @override
  Stream<bool> watchOnline() async* {
    yield _online;
    yield* _changes.stream;
  }
}

/// A visibility write the server received.
typedef VisibilityWrite = ({
  Deck deck,
  DeckVisibility visibility,
  String? description,
});

/// Stands in for the sharing tables at the network boundary, with the rules
/// the server enforces: the listing leaves out blocked users' decks, filters
/// by name and description ignoring case, and sorts; a copy counts only on a
/// deck still public; a second report changes nothing.
///
/// Set [failure] to fail every request with it.
class FakeSharingServer implements SharingServer {
  FakeSharingServer({this.decks = const [], this.cards = const {}, this.name});

  /// The public decks, as the listing would return them before filtering.
  List<PublicDeckSummary> decks;

  /// Each public deck's cards, oldest first.
  Map<DeckId, List<PublicCard>> cards;

  /// The user's display name.
  DisplayName? name;

  SharingFailure? failure;

  /// While set, a publish waits for it, as the screening takes seconds.
  Completer<void>? hold;

  /// What the screening answers to a publish.
  Screening screening = const Screening(DeckPublication.public);

  /// What an AI did to the user's deck; null while none hides it.
  AiHidden? hidden;

  /// Every appeal asked of the server.
  final appeals = <DeckId>[];

  final blocked = <UserId>{};
  final reports = <(DeckId, ReportReason)>[];
  final imports = <DeckId>[];
  final writes = <VisibilityWrite>[];

  /// Every listing request, as its search and sort.
  final listings = <(String, BrowseSort)>[];

  void _answer() {
    if (failure case final failure?) throw failure;
  }

  @override
  Future<List<PublicDeckSummary>> listDecks({
    required String search,
    required BrowseSort sort,
    required int limit,
  }) async {
    _answer();
    listings.add((search, sort));
    final query = search.toLowerCase();
    return [
      for (final deck in decks)
        if (!blocked.contains(deck.owner) &&
            (deck.name.toLowerCase().contains(query) ||
                (deck.description ?? '').toLowerCase().contains(query)))
          deck,
    ]..sort(
      (a, b) => switch (sort) {
        BrowseSort.newest => b.publishedAt.compareTo(a.publishedAt),
        BrowseSort.mostCopied => b.copyCount.compareTo(a.copyCount),
      },
    );
  }

  @override
  Future<List<PublicCard>> listCards(DeckId deck, {int? limit}) async {
    _answer();
    final all = cards[deck] ?? const [];
    return limit == null ? all : all.take(limit).toList();
  }

  @override
  Future<bool> recordCopy(DeckId deck) async {
    _answer();
    if (!decks.any((summary) => summary.id == deck)) return false;
    imports.add(deck);
    return true;
  }

  @override
  Future<ReportOutcome> report(DeckId deck, ReportReason reason) async {
    _answer();
    if (reports.any((report) => report.$1 == deck)) {
      return ReportOutcome.alreadyReported;
    }
    reports.add((deck, reason));
    return ReportOutcome.reported;
  }

  @override
  Future<AiHidden?> aiHidden(DeckId deck) async {
    _answer();
    return hidden;
  }

  @override
  Future<AppealOutcome> appeal(DeckId deck) async {
    _answer();
    appeals.add(deck);
    final standing = hidden;
    if (standing == null) return AppealOutcome.notHiddenByAi;
    if (standing.appeal != AppealState.open) return AppealOutcome.already;
    hidden = AiHidden(appeal: AppealState.pending, category: standing.category);
    return AppealOutcome.appealed;
  }

  @override
  Future<void> block(UserId user) async {
    _answer();
    blocked.add(user);
  }

  @override
  Future<DisplayName?> displayName() async {
    _answer();
    return name;
  }

  @override
  Future<void> setDisplayName(DisplayName name) async {
    _answer();
    this.name = name;
  }

  @override
  Future<Screening> writeVisibility(
    Deck deck,
    DeckVisibility visibility, {
    String? description,
    required DateTime at,
  }) async {
    _answer();
    writes.add((deck: deck, visibility: visibility, description: description));
    await hold?.future;
    return switch (visibility) {
      PublicDeck() => screening,
      PrivateDeck() => const Screening(DeckPublication.private),
      CheckingDeck() ||
      HeldDeck() ||
      RefusedDeck() => throw ArgumentError('a state is no request'),
    };
  }
}
