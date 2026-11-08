import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import 'conversation.dart';
import 'event_stream.dart';
import 'protocol.dart';

/// What a message came to: a stream of events, a refusal, or the user's stop
/// before it started.
sealed class SendOutcome {
  const SendOutcome();
}

/// A started message's events. Reading them may end in an exception: the
/// connection breaking, or [http.RequestAbortedException] after a stop.
final class SendStarted extends SendOutcome {
  const SendStarted(this.events);

  final Stream<AssistantEvent> events;
}

final class SendRefused extends SendOutcome {
  const SendRefused(this.refusal);

  final MessageRefusal refusal;
}

final class SendAborted extends SendOutcome {
  const SendAborted();
}

/// Why adding a proposal failed.
enum CommitFailure { refused, signIn, failed }

sealed class CommitOutcome {
  const CommitOutcome();
}

/// The cards were written to [added]'s note.
final class Committed extends CommitOutcome {
  const Committed(this.added);

  final Added added;
}

final class CommitFailed extends CommitOutcome {
  const CommitFailed(this.failure);

  final CommitFailure failure;
}

/// What the chat asks of the assistant: a seam, so its tests stand a fake in
/// for the function.
abstract interface class AssistantClient {
  /// Sends [messages], oldest first, the last the user's; [abort] completing
  /// stops the message and the stream it started.
  Future<SendOutcome> send(
    List<Map<String, Object?>> messages, {
    required Future<void> abort,
  });

  /// Writes the cards of [proposal] that [checked] names under their group.
  Future<CommitOutcome> commit(
    Proposal proposal,
    Map<String, List<String>> checked,
  );

  /// The day's tokens, or null when they cannot be read, offline among other
  /// cases; a message's `usage` then brings them.
  Future<Allowance?> allowance();
}

/// How long a commit may take: a note made and up to 100 cards written.
const commitTimeout = Duration(seconds: 60);

/// Calls the deployed `assistant` function over HTTP with the signed-in
/// user's token.
final class HttpAssistantClient implements AssistantClient {
  HttpAssistantClient(
    this._http, {
    required this.functionUrl,
    required this.accessToken,
    required this.readAllowance,
  });

  final http.Client _http;

  /// The function's URL, `<supabase url>/functions/v1/assistant`.
  final Uri functionUrl;

  /// The current session's access token, or null when signed out.
  final Future<String?> Function() accessToken;

  /// Calls `public.assistant_allowance()` and resolves to its rows as
  /// PostgREST answers them.
  final Future<Object?> Function() readAllowance;

  @override
  Future<SendOutcome> send(
    List<Map<String, Object?>> messages, {
    required Future<void> abort,
  }) async {
    final token = await accessToken();
    if (token == null) return const SendRefused(SignInNeeded());
    final request = http.AbortableRequest(
      'POST',
      functionUrl,
      abortTrigger: abort,
    );
    request.headers['authorization'] = 'Bearer $token';
    request.headers['content-type'] = 'application/json';
    request.body = jsonEncode({'messages': messages});
    final http.StreamedResponse response;
    try {
      response = await _http.send(request);
    } on http.RequestAbortedException {
      return const SendAborted();
    } on http.ClientException {
      return const SendRefused(Unreachable());
    }
    if (response.statusCode == 200) {
      return SendStarted(_eventsOf(response.stream));
    }
    final String body;
    try {
      body = await response.stream.bytesToString();
    } on http.ClientException {
      return const SendRefused(Unreachable());
    }
    return SendRefused(parseRefusal(response.statusCode, body));
  }

  @override
  Future<CommitOutcome> commit(
    Proposal proposal,
    Map<String, List<String>> checked,
  ) async {
    final token = await accessToken();
    if (token == null) return const CommitFailed(CommitFailure.signIn);
    final http.Response response;
    try {
      response = await _http
          .post(
            Uri.parse('$functionUrl/commit'),
            headers: {
              'authorization': 'Bearer $token',
              'content-type': 'application/json',
            },
            body: jsonEncode({
              'proposal': proposal.toJson(),
              'checked': checked,
            }),
          )
          .timeout(commitTimeout);
    } on http.ClientException {
      return const CommitFailed(CommitFailure.failed);
    } on TimeoutException {
      return const CommitFailed(CommitFailure.failed);
    }
    return parseCommit(response.statusCode, response.body);
  }

  @override
  Future<Allowance?> allowance() async {
    final Object? rows;
    try {
      rows = await readAllowance();
    } on Exception {
      return null;
    }
    return switch (rows) {
      [final Map<String, Object?> row] => Allowance.parse(row),
      _ => null,
    };
  }
}

Stream<AssistantEvent> _eventsOf(Stream<List<int>> body) async* {
  await for (final raw in readEvents(body)) {
    if (parseEvent(raw.name, raw.data) case final event?) yield event;
  }
}

/// What a commit's [status] and [body] mean (`assistant.md` §Commit): the
/// note and the cards it wrote, or why not.
CommitOutcome parseCommit(int status, String body) {
  if (status == 401) return const CommitFailed(CommitFailure.signIn);
  if (status == 400 || status == 422) {
    return const CommitFailed(CommitFailure.refused);
  }
  if (status != 200) return const CommitFailed(CommitFailure.failed);
  final Object? decoded;
  try {
    decoded = jsonDecode(body);
  } on FormatException {
    return const CommitFailed(CommitFailure.failed);
  }
  if (decoded is! Map<String, Object?>) {
    return const CommitFailed(CommitFailure.failed);
  }
  if (decoded case {
    'deck': {'id': final String id, 'name': final String name},
  }) {
    final written = switch ((decoded['added'], decoded['updated'])) {
      (final List<Object?> list, _) => list.length,
      (_, final List<Object?> list) => list.length,
      _ => null,
    };
    if (written != null) {
      return Committed((deckId: id, deckName: name, count: written));
    }
  }
  return const CommitFailed(CommitFailure.failed);
}

/// The URL of `assistant` for the project whose PostgREST URL is [restUrl].
/// The Supabase client builds both as `<project url>/rest/v1` and
/// `<project url>/functions/v1`, so the suffix is swapped. Throws
/// [ArgumentError] for a URL without that suffix.
Uri assistantUrl(String restUrl) {
  const rest = '/rest/v1';
  if (!restUrl.endsWith(rest)) {
    throw ArgumentError.value(restUrl, 'restUrl', 'does not end in $rest');
  }
  final project = restUrl.substring(0, restUrl.length - rest.length);
  return Uri.parse('$project/functions/v1/assistant');
}
