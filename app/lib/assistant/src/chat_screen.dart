import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../design/app_button.dart';
import '../../design/app_chip.dart';
import '../../design/app_menu.dart';
import '../../design/app_sheet.dart';
import '../../design/app_text_field.dart';
import '../../design/mascot.dart';
import '../../design/theme.dart';
import '../../design/word_break.dart';
import '../../l10n/app_localizations.dart';
import 'assistant_client.dart';
import 'assistant_controller.dart';
import 'conversation.dart';
import 'proposal_view.dart';
import 'protocol.dart';
import 'providers.dart';

/// Opens the note [deckId], over the chat, from [context]. `home/` supplies
/// it: a note is another domain's screen.
typedef OpenNote = Future<void> Function(BuildContext context, String deckId);

/// 말랑이's chat: one conversation kept on the device, its turns, 말랑이's
/// reply streaming in, a question's quick replies, its proposals with their
/// checks, and at the foot the open proposal's "n장 추가" over the message
/// field. A note it added opens through [openNote] over the chat, so back
/// returns to the same turns, scroll and draft.
class AssistantChatScreen extends ConsumerStatefulWidget {
  const AssistantChatScreen({super.key, required this.openNote});

  final OpenNote openNote;

  @override
  ConsumerState<AssistantChatScreen> createState() =>
      _AssistantChatScreenState();
}

class _AssistantChatScreenState extends ConsumerState<AssistantChatScreen> {
  late final _chat = ref.read(assistantProvider.notifier);
  late final _text = TextEditingController(
    text: ref.read(assistantProvider).conversation.draft,
  );

  @override
  void initState() {
    super.initState();
    unawaited(_chat.refreshAllowance());
  }

  @override
  void dispose() {
    _chat.leave();
    _text.dispose();
    super.dispose();
  }

  void _send(String text) {
    _chat.send(text);
    // A message that was not sent keeps its text in the field.
    if (ref.read(assistantProvider).conversation.draft.isEmpty) _text.clear();
  }

  Future<void> _clear() async {
    final l10n = AppLocalizations.of(context);
    final confirmed = await showAppConfirm(
      context,
      title: l10n.assistantClearTitle,
      consequence: l10n.assistantClearBody,
      confirmLabel: l10n.assistantClearConfirm,
    );
    if (!confirmed || !mounted) return;
    _chat.clear();
    _text.clear();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    final chat = ref.watch(assistantProvider);
    final turns = chat.conversation.turns;
    final last = turns.lastOrNull;
    final lastReply = turns.whereType<AssistantTurn>().lastOrNull;
    // The open proposal: the last one shown, not yet added, once its reply
    // has ended.
    final open = lastReply?.ending == null
        ? null
        : lastReply!.proposals.where((one) => one.added == null).lastOrNull;
    final items = <Widget>[
      if (turns.isEmpty)
        Padding(
          padding: const EdgeInsets.symmetric(vertical: AppSpace.s40),
          child: Text(
            l10n.assistantEmpty,
            textAlign: TextAlign.center,
            style: AppType.bodyStrong.copyWith(color: colors.ink),
          ),
        ),
      for (final turn in turns)
        switch (turn) {
          UserTurn() => _UserBubble(turn: turn),
          AssistantTurn() => _ReplyView(
            key: ValueKey(turn.id),
            turn: turn,
            isLast: identical(turn, last),
            busy: chat.busy,
            onSend: _send,
            onCheck: (proposalId, groupId, ids) =>
                _chat.check(turn.id, proposalId, groupId, ids),
            onOpenNote: (deckId) => widget.openNote(context, deckId),
            onRetry: _chat.retry,
          ),
        },
      if (chat.status is ChatWaiting)
        _Notice(text: l10n.assistantWaiting, status: true),
      if (chat.status case ChatRefused(:final refusal))
        _RefusalView(refusal: refusal, onRetry: _chat.retryRefused),
    ];
    final status = chat.status;
    final spent = status is ChatRefused && status.refusal is RateLimited;
    return Scaffold(
      backgroundColor: colors.ground,
      body: SafeArea(
        child: Column(
          children: [
            _Header(
              face: _faceOf(chat, last),
              share: chat.allowance?.leftShare,
              onClear: turns.isNotEmpty && !chat.busy ? _clear : null,
            ),
            Expanded(
              child: ListView.builder(
                reverse: true,
                padding: const EdgeInsets.symmetric(
                  horizontal: AppSpace.gutter,
                  vertical: AppSpace.s16,
                ),
                itemCount: items.length,
                itemBuilder: (context, index) => Padding(
                  padding: const EdgeInsets.only(top: AppSpace.s16),
                  child: items[items.length - 1 - index],
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(
                AppSpace.gutter,
                AppSpace.s8,
                AppSpace.gutter,
                AppSpace.s16,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                spacing: AppSpace.s8,
                children: [
                  if (open != null && !chat.busy) ...[
                    if (chat.commitFailure case final failure?)
                      Text(
                        switch (failure) {
                          CommitFailure.refused => l10n.assistantCommitRefused,
                          CommitFailure.signIn => l10n.assistantCommitSignIn,
                          CommitFailure.failed => l10n.assistantCommitFailed,
                        },
                        style: AppType.secondary.copyWith(
                          color: colors.dontKnowText,
                        ),
                      ),
                    AppButton(
                      label: open.proposal.kind == ProposalKind.changes
                          ? l10n.assistantChange(open.checkedCount)
                          : l10n.assistantAdd(open.checkedCount),
                      size: AppButtonSize.cta,
                      loading: chat.committing,
                      onPressed: open.checkedCount == 0
                          ? null
                          : () => unawaited(_chat.commit(lastReply!.id, open)),
                    ),
                  ],
                  if (!spent)
                    _MessageField(
                      controller: _text,
                      status: chat.status,
                      onChanged: _chat.setDraft,
                      onSend: () => _send(_text.text),
                      onStop: _chat.stop,
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// The mascot's face for what the chat shows: sleepy once the day is used,
/// sad on a failure, happy once cards were added.
MascotExpression _faceOf(ChatState chat, Turn? last) {
  if (chat.status case ChatRefused(:final refusal)) {
    return refusal is RateLimited
        ? MascotExpression.sleepy
        : MascotExpression.sad;
  }
  if (last is AssistantTurn) {
    if (last.ending == Ending.modelError) return MascotExpression.sad;
    if (last.proposals.any((one) => one.added != null)) {
      return MascotExpression.happy;
    }
  }
  return MascotExpression.thinking;
}

/// The bar of the way back, the mascot in [face] with "말랑이" and the day's
/// [share] left, and ⋯ with "대화 지우기" while [onClear] is given.
class _Header extends StatelessWidget {
  const _Header({required this.face, required this.share, this.onClear});

  final MascotExpression face;
  final int? share;
  final VoidCallback? onClear;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpace.s8,
        vertical: AppSpace.s8,
      ),
      child: Row(
        spacing: AppSpace.s8,
        children: [
          const BackButton(),
          Mascot(expression: face, size: 40),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Semantics(
                  header: true,
                  child: Text(
                    l10n.assistantName,
                    style: AppType.bodyStrong.copyWith(color: colors.ink),
                  ),
                ),
                if (share != null)
                  Text(
                    l10n.assistantShareLeft(share!),
                    style: AppType.secondary.copyWith(color: colors.muted),
                  ),
              ],
            ),
          ),
          AppMenu(
            items: [
              MenuItemButton(
                onPressed: onClear,
                child: Text(l10n.assistantClear),
              ),
            ],
            builder: (context, controller, _) => IconButton(
              tooltip: l10n.assistantMenu,
              icon: const Icon(LucideIcons.ellipsis),
              onPressed: () =>
                  controller.isOpen ? controller.close() : controller.open(),
              style: IconButton.styleFrom(
                minimumSize: const Size.square(AppSize.tapTarget),
                foregroundColor: colors.ink,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// The user's message, at the end of the line.
class _UserBubble extends StatelessWidget {
  const _UserBubble({required this.turn});

  final UserTurn turn;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    return Align(
      alignment: AlignmentDirectional.centerEnd,
      child: FractionallySizedBox(
        widthFactor: 0.85,
        alignment: AlignmentDirectional.centerEnd,
        child: Semantics(
          label: '${l10n.assistantMe}: ${turn.text}',
          excludeSemantics: true,
          child: DecoratedBox(
            decoration: BoxDecoration(
              color: colors.brandTint,
              borderRadius: BorderRadius.circular(AppRadius.row),
            ),
            child: Padding(
              padding: const EdgeInsets.symmetric(
                horizontal: AppSpace.s16,
                vertical: AppSpace.s12,
              ),
              child: Text(
                keepWords(turn.text),
                style: AppType.body.copyWith(color: colors.ink),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// 말랑이's turn: its text, sources, proposals, question and how it ended.
class _ReplyView extends StatelessWidget {
  const _ReplyView({
    super.key,
    required this.turn,
    required this.isLast,
    required this.busy,
    required this.onSend,
    required this.onCheck,
    required this.onOpenNote,
    required this.onRetry,
  });

  final AssistantTurn turn;
  final bool isLast;
  final bool busy;
  final ValueChanged<String> onSend;
  final void Function(String proposalId, String groupId, List<String> ids)
  onCheck;
  final ValueChanged<String> onOpenNote;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    final ending = turn.ending;
    final choice = turn.choice;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      spacing: AppSpace.s12,
      children: [
        if (turn.text.isNotEmpty)
          Text(
            keepWords(turn.text),
            semanticsLabel: '${l10n.assistantName}: ${turn.text}',
            style: AppType.body.copyWith(color: colors.ink),
          ),
        if (ending == null && turn.text.isEmpty)
          _Notice(text: l10n.assistantThinking, status: true),
        if (turn.citations.isNotEmpty)
          Semantics(
            container: true,
            label: l10n.assistantSources,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (final citation in turn.citations)
                  _CitationLink(citation: citation),
              ],
            ),
          ),
        for (final one in turn.proposals)
          ProposalView(
            key: ValueKey(one.proposal.id),
            shown: one,
            disabled: busy || ending == null,
            onCheck: (groupId, ids) => onCheck(one.proposal.id, groupId, ids),
            onRemake: (group, form) =>
                onSend(l10n.assistantRemake(group.title, formName(l10n, form))),
            onOpenNote: onOpenNote,
          ),
        if (choice != null)
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            spacing: AppSpace.s8,
            children: [
              Text(
                keepWords(choice.prompt),
                semanticsLabel: choice.prompt,
                style: AppType.bodyStrong.copyWith(color: colors.ink),
              ),
              if (isLast && !busy)
                Wrap(
                  spacing: AppSpace.s8,
                  runSpacing: AppSpace.s8,
                  children: [
                    for (final option in choice.options)
                      AppChip.action(
                        label: option,
                        onPressed: () => onSend(option),
                      ),
                  ],
                ),
            ],
          ),
        if (ending != null && ending != Ending.ok)
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _Notice(
                text: switch (ending) {
                  Ending.modelError => l10n.assistantModelError,
                  Ending.cut => l10n.assistantCut,
                  _ => l10n.assistantStopped,
                },
              ),
              if (ending == Ending.modelError && isLast && !busy)
                AppButton(
                  label: l10n.retry,
                  variant: AppButtonVariant.text,
                  size: AppButtonSize.header,
                  onPressed: onRetry,
                ),
            ],
          ),
      ],
    );
  }
}

/// A source a reply cites, opened outside the app when it is a web address.
class _CitationLink extends StatelessWidget {
  const _CitationLink({required this.citation});

  final Citation citation;

  @override
  Widget build(BuildContext context) {
    final uri = Uri.tryParse(citation.url);
    final web = uri != null && (uri.scheme == 'http' || uri.scheme == 'https');
    final label = citation.title.isEmpty ? citation.url : citation.title;
    if (!web) {
      return Text(
        label,
        style: AppType.secondary.copyWith(color: AppColors.of(context).muted),
      );
    }
    final messenger = ScaffoldMessenger.of(context);
    final notOpened = AppLocalizations.of(context).linkNotOpened;
    return AppButton(
      label: label,
      variant: AppButtonVariant.link,
      onPressed: () async {
        try {
          if (await launchUrl(uri, mode: LaunchMode.externalApplication)) {
            return;
          }
        } on PlatformException {
          // Said below, as a link that did not open.
        }
        messenger.showSnackBar(SnackBar(content: Text(notOpened)));
      },
    );
  }
}

/// A line of what is true under a reply, read as a status while [status].
class _Notice extends StatelessWidget {
  const _Notice({required this.text, this.status = false});

  final String text;
  final bool status;

  @override
  Widget build(BuildContext context) => Semantics(
    liveRegion: status,
    child: Text(
      keepWords(text),
      semanticsLabel: text,
      style: AppType.secondary.copyWith(color: AppColors.of(context).muted),
    ),
  );
}

/// Why the last message was not answered, with "다시 시도" where sending it
/// again can help.
class _RefusalView extends StatelessWidget {
  const _RefusalView({required this.refusal, required this.onRetry});

  final MessageRefusal refusal;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final (text, retry) = switch (refusal) {
      RateLimited() => (l10n.assistantRateLimited, false),
      Busy() => (l10n.assistantBusy, true),
      SignInNeeded() => (l10n.assistantSignIn, false),
      Suspended() => (l10n.assistantSuspended, false),
      TooLong() => (l10n.assistantTooLong, false),
      Unavailable() => (l10n.assistantUnavailable, true),
      Unreachable() => (l10n.assistantUnreachable, true),
    };
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Semantics(
          liveRegion: true,
          child: Text(
            keepWords(text),
            semanticsLabel: text,
            style: AppType.body.copyWith(color: AppColors.of(context).ink),
          ),
        ),
        if (retry)
          AppButton(
            label: l10n.retry,
            variant: AppButtonVariant.text,
            size: AppButtonSize.header,
            onPressed: onRetry,
          ),
      ],
    );
  }
}

/// The message field with its send button, which is "멈추기" while a reply
/// streams in.
class _MessageField extends StatelessWidget {
  const _MessageField({
    required this.controller,
    required this.status,
    required this.onChanged,
    required this.onSend,
    required this.onStop,
  });

  final TextEditingController controller;
  final ChatStatus status;
  final ValueChanged<String> onChanged;
  final VoidCallback onSend;
  final VoidCallback onStop;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    final streaming = status is ChatStreaming;
    final busy = streaming || status is ChatWaiting;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.end,
      spacing: AppSpace.s8,
      children: [
        Expanded(
          child: AppTextField(
            controller: controller,
            hint: l10n.assistantMessageHint,
            minLines: 1,
            maxLines: 5,
            inputFormatters: [
              LengthLimitingTextInputFormatter(maxMessageLength),
            ],
            onChanged: onChanged,
          ),
        ),
        ListenableBuilder(
          listenable: controller,
          builder: (context, _) => IconButton.filled(
            tooltip: streaming ? l10n.assistantStop : l10n.assistantSend,
            icon: Icon(
              streaming ? LucideIcons.square : LucideIcons.arrowUp,
              size: AppSize.smallIcon,
            ),
            onPressed: streaming
                ? onStop
                : busy || controller.text.trim().isEmpty
                ? null
                : onSend,
            style: IconButton.styleFrom(
              minimumSize: const Size.square(AppSize.field),
              backgroundColor: colors.ink,
              foregroundColor: colors.onInk,
            ),
          ),
        ),
      ],
    );
  }
}
