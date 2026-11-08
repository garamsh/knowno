import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';

import 'assistant_client.dart';
import 'conversation.dart';
import 'protocol.dart';
import 'providers.dart';

/// Where the turns and the draft are kept in the app's preferences.
const assistantStorageKeys = {_turnsKey, _draftKey};
const _turnsKey = 'assistant.conversation';
const _draftKey = 'assistant.draft';

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

  bool get busy => status is ChatStreaming || status is ChatWaiting;

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

  @override
  ChatState build() {
    final storage = ref.watch(assistantStorageProvider);
    return ChatState(
      conversation: Conversation.parse(
        storage.getString(_turnsKey),
        draft: storage.getString(_draftKey) ?? '',
      ),
    );
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

  void setDraft(String draft) => _set(
    state.copyWith(conversation: state.conversation.copyWith(draft: draft)),
  );

  /// Sends [text] as the user's next message, and streams the reply in.
  void send(String text) {
    final message = text.trim();
    if (message.isEmpty || state.busy) return;
    _set(
      state.copyWith(
        conversation: Conversation(
          turns: [
            ...state.conversation.turns,
            UserTurn(id: const Uuid().v4(), text: message),
          ],
        ),
        commitFailure: () => null,
      ),
    );
    unawaited(_reply());
  }

  /// Sends the last message again, in place of the reply that failed after
  /// it.
  void retry() {
    final turns = state.conversation.turns;
    if (turns.isNotEmpty && turns.last is AssistantTurn) {
      _set(
        state.copyWith(
          conversation: state.conversation.copyWith(
            turns: turns.sublist(0, turns.length - 1),
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
    if (state.conversation.turns.lastOrNull is! UserTurn) return;
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
      if (abort.isCompleted) {
        _set(state.copyWith(status: const ChatIdle()), store: false);
        return;
      }
      outcome = await _client.send(messages, abort: abort.future);
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

  /// Draws [events] into a new reply of 말랑이's, and ends it as it ended.
  Future<void> _read(
    Stream<AssistantEvent> events,
    Completer<void> abort,
  ) async {
    final id = const Uuid().v4();
    _change(id, (turn) => turn, add: true);
    try {
      await for (final event in events) {
        if (event is UsageEvent) {
          state = state.copyWith(allowance: event.allowance);
        } else {
          _change(
            id,
            (turn) => turn.withEvent(event),
            store: event is! TextDelta,
          );
        }
      }
      _change(
        id,
        (turn) => turn.ending == null ? turn.copyWith(ending: Ending.ok) : turn,
      );
    } on Exception {
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
    _set(
      const ChatState(conversation: Conversation())
          .copyWith(allowance: state.allowance),
    );
  }

  /// Stops a reply still streaming, as the chat is left; the function
  /// records it as cancelled.
  void leave() => stop();
}
