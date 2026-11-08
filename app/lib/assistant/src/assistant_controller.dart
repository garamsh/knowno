import 'dart:async';
import 'dart:typed_data';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';

import 'assistant_client.dart';
import 'conversation.dart';
import 'protocol.dart';
import 'providers.dart';

/// Where the turns and the draft are kept in the app's preferences.
const assistantStorageKeys = {
  _turnsKey,
  _draftKey,
  edgeSideKey,
  edgeHintShownKey,
};
const _turnsKey = 'assistant.conversation';
const _draftKey = 'assistant.draft';

/// Which edge the character rests at, and whether its one-time hint has
/// shown, kept per device.
const edgeSideKey = 'assistant.edge';
const edgeHintShownKey = 'assistant.hintShown';

/// How often a running photo job is asked how far it has read.
const jobPollEvery = Duration(seconds: 3);

/// What the chat sends in the user's place when a photo job is done; the
/// thread draws a line of its own for it.
const jobDoneMessage = '사진 읽기가 끝났어요. 이어서 해 주세요.';

/// The note a chat was opened from, to which its messages are tied.
typedef ChatNote = ({String id, String name});

/// How long a message refused as `busy` waits before it is sent again, and
/// how many times it is.
const busyRetryDelay = Duration(seconds: 3);
const _busyRetries = 3;

/// What the chat is doing.
sealed class ChatStatus {
  const ChatStatus();
}

final class ChatIdle extends ChatStatus {
  const ChatIdle();
}

/// The message's photos are being uploaded.
final class ChatUploading extends ChatStatus {
  const ChatUploading();
}

/// A reply is streaming in.
final class ChatStreaming extends ChatStatus {
  const ChatStreaming();
}

/// A message refused as `busy` waits to be sent again.
final class ChatWaiting extends ChatStatus {
  const ChatWaiting();
}

/// The last message was refused for [refusal].
final class ChatRefused extends ChatStatus {
  const ChatRefused(this.refusal);

  final MessageRefusal refusal;
}

/// The chat as the screens draw it: the [conversation], what it is doing,
/// the day's tokens when known, and an adding of a proposal under way or
/// failed.
final class ChatState {
  const ChatState({
    required this.conversation,
    this.status = const ChatIdle(),
    this.allowance,
    this.committing = false,
    this.commitFailure,
  });

  final Conversation conversation;
  final ChatStatus status;
  final Allowance? allowance;
  final bool committing;
  final CommitFailure? commitFailure;

  bool get busy =>
      status is ChatStreaming ||
      status is ChatWaiting ||
      status is ChatUploading;

  ChatState copyWith({
    Conversation? conversation,
    ChatStatus? status,
    Allowance? allowance,
    bool? committing,
    CommitFailure? Function()? commitFailure,
  }) => ChatState(
    conversation: conversation ?? this.conversation,
    status: status ?? this.status,
    allowance: allowance ?? this.allowance,
    committing: committing ?? this.committing,
    commitFailure: commitFailure == null ? this.commitFailure : commitFailure(),
  );
}

/// The one conversation with 말랑이, kept on the device, its messages sent
/// and its replies read.
class AssistantController extends Notifier<ChatState> {
  Completer<void>? _abort;
  Timer? _poll;

  /// The note the chat is open from, whose id goes with each message.
  String? _context;

  @override
  ChatState build() {
    final storage = ref.watch(assistantStorageProvider);
    ref.onDispose(() => _poll?.cancel());
    final conversation = Conversation.parse(
      storage.getString(_turnsKey),
      draft: storage.getString(_draftKey) ?? '',
    );
    // A job still reading when the app closed goes on being asked about.
    if (conversation.runningJob != null) Future.microtask(_watchJob);
    return ChatState(conversation: conversation);
  }

  AssistantClient get _client => ref.read(assistantClientProvider)!;

  void _set(ChatState next, {bool store = true}) {
    final before = state.conversation;
    state = next;
    if (!store) return;
    final storage = ref.read(assistantStorageProvider);
    if (!identical(before.turns, next.conversation.turns)) {
      unawaited(storage.setString(_turnsKey, next.conversation.encode()));
    }
    if (before.draft != next.conversation.draft) {
      unawaited(
        next.conversation.draft.isEmpty
            ? storage.remove(_draftKey)
            : storage.setString(_draftKey, next.conversation.draft),
      );
    }
  }

  /// Reads the day's tokens, when the chat opens.
  Future<void> refreshAllowance() async {
    final read = await _client.allowance();
    if (read != null && ref.mounted) {
      state = state.copyWith(allowance: read);
    }
  }

  /// Opens the chat from [note], or from nowhere: its id goes with each
  /// message, and the thread names the note once, unless its last line
  /// already does.
  void enter(ChatNote? note) {
    _context = note?.id;
    if (note == null) return;
    final last = state.conversation.turns.lastOrNull;
    if (last is ContextTurn && last.deckId == note.id) return;
    _set(
      state.copyWith(
        conversation: state.conversation.copyWith(
          turns: [
            ...state.conversation.turns,
            ContextTurn(
              id: const Uuid().v4(),
              deckId: note.id,
              text: note.name,
            ),
          ],
        ),
      ),
    );
  }

  void setDraft(String draft) => _set(
    state.copyWith(conversation: state.conversation.copyWith(draft: draft)),
  );

  /// Sends [text] as the user's next message, with [photos] uploaded first,
  /// and streams the reply in. False when nothing was sent, a photo that did
  /// not upload included: the text and the photos are then still the user's.
  Future<bool> send(String text, {List<Uint8List> photos = const []}) async {
    final message = text.trim();
    if ((message.isEmpty && photos.isEmpty) || state.busy) return false;
    final ids = <String>[];
    if (photos.isNotEmpty) {
      _set(
        state.copyWith(
          status: const ChatUploading(),
          commitFailure: () => null,
        ),
        store: false,
      );
      for (final bytes in photos) {
        final id = const Uuid().v4();
        if (!await _client.uploadPhoto(id, bytes)) {
          _set(
            state.copyWith(status: const ChatRefused(PhotoUploadFailed())),
            store: false,
          );
          return false;
        }
        ids.add(id);
      }
    }
    _set(
      state.copyWith(
        conversation: Conversation(
          turns: [
            ...state.conversation.turns,
            UserTurn(id: const Uuid().v4(), text: message, photos: ids),
          ],
        ),
        commitFailure: () => null,
      ),
    );
    unawaited(_reply());
    return true;
  }

  /// Sends the last message again, in place of the reply that failed after
  /// it.
  void retry() {
    final last = state.conversation.lastTurn;
    if (last is AssistantTurn) {
      _set(
        state.copyWith(
          conversation: state.conversation.copyWith(
            turns: [
              for (final turn in state.conversation.turns)
                if (turn.id != last.id) turn,
            ],
          ),
        ),
      );
    }
    unawaited(_reply());
  }

  /// Sends the last message again after a refusal that left no reply.
  void retryRefused() => unawaited(_reply());

  /// Stops the reply streaming in.
  void stop() {
    if (_abort case final abort? when !abort.isCompleted) abort.complete();
  }

  Future<void> _reply() async {
    if (state.conversation.lastTurn is! UserTurn) return;
    final abort = Completer<void>();
    _abort = abort;
    final messages = state.conversation.requestTurns;
    SendOutcome outcome;
    // A message refused as busy waits for the one before it to end, then
    // goes again (ADR 0195).
    for (var attempt = 0; ; attempt++) {
      _set(
        state.copyWith(
          status: attempt == 0 ? const ChatStreaming() : const ChatWaiting(),
        ),
        store: false,
      );
      if (attempt > 0) {
        await Future.any([Future<void>.delayed(busyRetryDelay), abort.future]);
      }
      if (!ref.mounted) return;
      if (abort.isCompleted) {
        _set(state.copyWith(status: const ChatIdle()), store: false);
        return;
      }
      outcome = await _client.send(
        messages,
        deckId: _context,
        abort: abort.future,
      );
      if (!ref.mounted) return;
      if (outcome is! SendRefused ||
          outcome.refusal is! Busy ||
          attempt == _busyRetries) {
        break;
      }
    }
    switch (outcome) {
      case SendAborted():
        _set(state.copyWith(status: const ChatIdle()), store: false);
      case SendRefused(:final refusal):
        _set(
          state.copyWith(
            status: ChatRefused(refusal),
            allowance: switch (refusal) {
              RateLimited(:final allowance?) => allowance,
              _ => null,
            },
          ),
          store: false,
        );
      case SendStarted(:final events):
        await _read(events, abort);
    }
  }

  /// Asks after the running photo job every [jobPollEvery] until none runs.
  void _watchJob() {
    if (!ref.mounted ||
        _poll != null ||
        state.conversation.runningJob == null) {
      return;
    }
    _poll = Timer.periodic(jobPollEvery, (_) => unawaited(_askAfterJob()));
  }

  void _stopWatching() {
    _poll?.cancel();
    _poll = null;
  }

  Future<void> _askAfterJob() async {
    final reply = state.conversation.runningJob;
    if (reply == null) return _stopWatching();
    final job = reply.job!;
    final outcome = await _client.pollJob(job.id);
    if (!ref.mounted) return;
    // The reply may have been cleared or the job cancelled meanwhile.
    final now = state.conversation.runningJob;
    if (now == null || now.job?.id != job.id) return;
    switch (outcome) {
      case JobPollFailed():
        return;
      case JobMissing():
        _setJob(reply.id, job.copyWith(state: JobState.cancelled));
      case JobPolled(:final progress):
        // A job done while a reply still streams waits for the next ask.
        if (progress.state == JobState.done && state.busy) return;
        _setJob(reply.id, progress);
        if (progress.state == JobState.done &&
            state.conversation.lastTurn?.id == reply.id) {
          _set(
            state.copyWith(
              conversation: state.conversation.copyWith(
                turns: [
                  ...state.conversation.turns,
                  UserTurn(
                    id: const Uuid().v4(),
                    text: jobDoneMessage,
                    auto: true,
                  ),
                ],
              ),
            ),
          );
          unawaited(_reply());
        }
    }
    if (state.conversation.runningJob == null) _stopWatching();
  }

  void _setJob(String turnId, JobProgress job) =>
      _change(turnId, (turn) => turn.copyWith(job: job));

  /// Cancels the running photo job.
  Future<void> cancelJob() async {
    final reply = state.conversation.runningJob;
    final job = reply?.job;
    if (reply == null || job == null) return;
    if (!await _client.cancelJob(job.id) || !ref.mounted) return;
    _setJob(reply.id, job.copyWith(state: JobState.cancelled));
    if (state.conversation.runningJob == null) _stopWatching();
  }

  /// Draws [events] into a new reply of 말랑이's, and ends it as it ended.
  Future<void> _read(
    Stream<AssistantEvent> events,
    Completer<void> abort,
  ) async {
    final id = const Uuid().v4();
    _change(id, (turn) => turn, add: true);
    try {
      await for (final event in events) {
        if (!ref.mounted) return;
        if (event is UsageEvent) {
          state = state.copyWith(allowance: event.allowance);
        } else {
          _change(
            id,
            (turn) => turn.withEvent(event),
            store: event is! TextDelta,
          );
          if (event is JobEvent) _watchJob();
        }
      }
      if (!ref.mounted) return;
      _change(
        id,
        (turn) => turn.ending == null ? turn.copyWith(ending: Ending.ok) : turn,
      );
    } on Exception {
      if (!ref.mounted) return;
      _change(
        id,
        (turn) => turn.ending != null
            ? turn
            : turn.copyWith(
                ending: abort.isCompleted ? Ending.stopped : Ending.modelError,
              ),
      );
    }
    _set(state.copyWith(status: const ChatIdle()), store: false);
  }

  void _change(
    String id,
    AssistantTurn Function(AssistantTurn turn) edit, {
    bool add = false,
    bool store = true,
  }) {
    final turns = state.conversation.turns;
    _set(
      state.copyWith(
        conversation: state.conversation.copyWith(
          turns: add
              ? [...turns, AssistantTurn(id: id)]
              : [
                  for (final turn in turns)
                    if (turn.id == id && turn is AssistantTurn)
                      edit(turn)
                    else
                      turn,
                ],
        ),
      ),
      store: store,
    );
  }

  /// Sets the cards checked in [groupId] of the proposal [proposalId] shown
  /// by [turnId].
  void check(
    String turnId,
    String proposalId,
    String groupId,
    List<String> ids,
  ) => _editProposal(
    turnId,
    proposalId,
    (one) => one.copyWith(checked: {...one.checked, groupId: ids}),
  );

  void _editProposal(
    String turnId,
    String proposalId,
    ShownProposal Function(ShownProposal one) edit,
  ) {
    _set(
      state.copyWith(
        conversation: state.conversation.copyWith(
          turns: [
            for (final turn in state.conversation.turns)
              if (turn.id == turnId && turn is AssistantTurn)
                turn.copyWith(
                  proposals: [
                    for (final one in turn.proposals)
                      one.proposal.id == proposalId ? edit(one) : one,
                  ],
                )
              else
                turn,
          ],
        ),
      ),
    );
  }

  /// Adds the cards checked in the open proposal of [turnId]'s reply.
  Future<void> commit(String turnId, ShownProposal open) async {
    if (state.committing || open.checkedCount == 0) return;
    _set(
      state.copyWith(committing: true, commitFailure: () => null),
      store: false,
    );
    final outcome = await _client.commit(open.proposal, open.checked);
    if (!ref.mounted) return;
    switch (outcome) {
      case CommitFailed(:final failure):
        state = state.copyWith(committing: false, commitFailure: () => failure);
      case Committed(:final added):
        state = state.copyWith(committing: false);
        _editProposal(
          turnId,
          open.proposal.id,
          (one) => one.copyWith(added: added),
        );
    }
  }

  /// Clears the conversation, and what it was doing.
  void clear() {
    stop();
    _stopWatching();
    _set(
      const ChatState(conversation: Conversation())
          .copyWith(allowance: state.allowance),
    );
  }

  /// Stops a reply still streaming, as the chat is left; the function
  /// records it as cancelled.
  void leave() => stop();
}
