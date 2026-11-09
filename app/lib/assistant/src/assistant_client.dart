import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

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

/// What a photo job's poll came to.
sealed class JobPollOutcome {
  const JobPollOutcome();
}

final class JobPolled extends JobPollOutcome {
  const JobPolled(this.progress);

  final JobProgress progress;
}

/// The server holds no such job of the user's (`404`).
final class JobMissing extends JobPollOutcome {
  const JobMissing();
}

/// The poll did not get an answer; it is tried again.
final class JobPollFailed extends JobPollOutcome {
  const JobPollFailed();
}

/// What the chat asks of the assistant: a seam, so its tests stand a fake in
/// for the function.
abstract interface class AssistantClient {
  /// Sends [messages], oldest first, the last the user's, with the note
  /// [deckId] the chat was opened in; [abort] completing stops the message
  /// and the stream it started.
  Future<SendOutcome> send(
    List<Map<String, Object?>> messages, {
    String? deckId,
    required Future<void> abort,
  });

  /// Uploads the JPEG [bytes] of the photo [photoId] to the user's folder of
  /// `assistant-photos`; whether it was kept.
  Future<bool> uploadPhoto(String photoId, Uint8List bytes);

  /// Where the photo job [id] stands.
  Future<JobPollOutcome> pollJob(String id);

  /// Cancels the photo job [id]; whether the server did.
  Future<bool> cancelJob(String id);

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
    required this.storePhoto,
    required this.timeZone,
  });

  final http.Client _http;

  /// The function's URL, `<supabase url>/functions/v1/assistant`.
  final Uri functionUrl;

  /// The current session's access token, or null when signed out.
  final Future<String?> Function() accessToken;

  /// Calls `public.assistant_allowance()` and resolves to its rows as
  /// PostgREST answers them.
  final Future<Object?> Function() readAllowance;

  /// Stores [bytes] in `assistant-photos` at `{user id}/{photoId}` as a
  /// JPEG, as the signed-in user.
  final Future<void> Function(String photoId, Uint8List bytes) storePhoto;

  /// The device's IANA time zone name, or null where it is not known; a
  /// message names it so the study record counts the study day in it.
  final Future<String?> Function() timeZone;

  @override
  Future<SendOutcome> send(
    List<Map<String, Object?>> messages, {
    String? deckId,
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
    final zone = await timeZone();
    request.body = jsonEncode({
      'messages': messages,
      if (deckId != null || zone != null)
        'context': {'deck_id': ?deckId, 'time_zone': ?zone},
    });
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
  Future<bool> uploadPhoto(String photoId, Uint8List bytes) async {
    try {
      await storePhoto(photoId, bytes);
      return true;
    } on Exception {
      return false;
    }
  }

  @override
  Future<JobPollOutcome> pollJob(String id) async {
    final token = await accessToken();
    if (token == null) return const JobPollFailed();
    final http.Response response;
    try {
      response = await _http.get(
        Uri.parse('$functionUrl/jobs/$id'),
        headers: {'authorization': 'Bearer $token'},
      );
    } on http.ClientException {
      return const JobPollFailed();
    }
    return parsePoll(response.statusCode, response.body);
  }

  @override
  Future<bool> cancelJob(String id) async {
    final token = await accessToken();
    if (token == null) return false;
    try {
      final response = await _http.post(
        Uri.parse('$functionUrl/jobs/$id/cancel'),
        headers: {'authorization': 'Bearer $token'},
      );
      return response.statusCode == 200;
    } on http.ClientException {
      return false;
    }
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
      final fields = decoded;
      int left(String key) => switch (fields[key]) {
        final List<Object?> list => list.length,
        _ => 0,
      };
      return Committed(
        Added(
          deckId: id,
          deckName: name,
          count: written,
          skipped: left('skipped'),
          refused: left('refused'),
        ),
      );
    }
  }
  return const CommitFailed(CommitFailure.failed);
}

/// What a job poll's [status] and [body] mean (`assistant.md` §Photo jobs).
JobPollOutcome parsePoll(int status, String body) {
  if (status == 404) return const JobMissing();
  if (status != 200) return const JobPollFailed();
  final Object? decoded;
  try {
    decoded = jsonDecode(body);
  } on FormatException {
    return const JobPollFailed();
  }
  return switch (JobProgress.parsePoll(decoded)) {
    final progress? => JobPolled(progress),
    null => const JobPollFailed(),
  };
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
