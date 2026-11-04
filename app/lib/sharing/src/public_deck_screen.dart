import 'package:flutter/material.dart';

import '../../deck/deck.dart';
import '../../design/app_button.dart';
import '../../design/app_list_row.dart';
import '../../design/app_sheet.dart';
import '../../design/theme.dart';
import '../../l10n/app_localizations.dart';
import 'failure.dart';
import 'failure_message.dart';
import 'copy_sheet.dart';
import 'model.dart';
import 'sharing_service.dart';
import '../../design/word_break.dart';

/// A public deck's name, owner, description, counts and first cards, with
/// the action that copies it and a menu that reports it or blocks its owner.
/// Pops with true once the owner is blocked.
class PublicDeckScreen extends StatefulWidget {
  const PublicDeckScreen({
    super.key,
    required this.sharing,
    required this.deck,
  });

  final SharingService sharing;
  final PublicDeckSummary deck;

  @override
  State<PublicDeckScreen> createState() => _PublicDeckScreenState();
}

enum _Action { report, block }

class _PublicDeckScreenState extends State<PublicDeckScreen> {
  late Future<List<PublicCard>> _cards = widget.sharing.preview(widget.deck.id);

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    final deck = widget.deck;
    final description = deck.description;
    return Scaffold(
      appBar: AppBar(
        actions: [
          PopupMenuButton<_Action>(
            tooltip: l10n.deckActions,
            onSelected: (action) => switch (action) {
              _Action.report => _report(),
              _Action.block => _block(),
            },
            itemBuilder: (_) => [
              PopupMenuItem(
                value: _Action.report,
                child: Text(l10n.reportDeck),
              ),
              PopupMenuItem(value: _Action.block, child: Text(l10n.blockUser)),
            ],
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(
          AppSpace.gutter,
          0,
          AppSpace.gutter,
          AppSpace.s16,
        ),
        children: [
          Semantics(
            header: true,
            child: Text(deck.name, style: AppType.deckName),
          ),
          const SizedBox(height: AppSpace.s4),
          Text(
            l10n.publicDeckLine(
              deck.ownerName.value,
              deck.cardCount,
              deck.copyCount,
            ),
            style: AppType.secondary.copyWith(color: colors.muted),
          ),
          if (description != null && description.isNotEmpty) ...[
            const SizedBox(height: AppSpace.s12),
            Text(description, style: AppType.body),
          ],
          const SizedBox(height: AppSpace.s24),
          FutureBuilder(
            future: _cards,
            builder: (context, snapshot) => switch (snapshot) {
              AsyncSnapshot(hasData: true, :final data?) when data.isEmpty =>
                _State(text: l10n.noCards),
              AsyncSnapshot(hasData: true, :final data?) => Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  AppGroup(
                    children: [
                      for (final card in data)
                        CardBackRow(
                          front: card.front,
                          back: card.back,
                          cells: card.cells,
                        ),
                    ],
                  ),
                  if (deck.cardCount > data.length)
                    Padding(
                      padding: const EdgeInsets.only(top: AppSpace.s8),
                      child: Text(
                        l10n.previewFirstCards(data.length, deck.cardCount),
                        textAlign: TextAlign.center,
                        style: AppType.caption.copyWith(color: colors.muted),
                      ),
                    ),
                ],
              ),
              AsyncSnapshot(:final error?, :final stackTrace) => _State(
                text: switch (error) {
                  SharingFailure() => describeSharingFailure(l10n, error),
                  _ => Error.throwWithStackTrace(
                    error,
                    stackTrace ?? StackTrace.current,
                  ),
                },
                onRetry: () => setState(() {
                  // Shown by the builder, which subscribes a frame later.
                  _cards = widget.sharing.preview(widget.deck.id)..ignore();
                }),
              ),
              _ => Padding(
                padding: const EdgeInsets.symmetric(vertical: AppSpace.s40),
                child: Center(
                  child: CircularProgressIndicator(
                    semanticsLabel: l10n.loading,
                  ),
                ),
              ),
            },
          ),
        ],
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(
            AppSpace.gutter,
            AppSpace.s8,
            AppSpace.gutter,
            AppSpace.s16,
          ),
          child: AppButton(
            label: l10n.copyToMyDecks,
            size: AppButtonSize.cta,
            onPressed: _copy,
          ),
        ),
      ),
    );
  }

  Future<void> _copy() async {
    final messenger = ScaffoldMessenger.of(context);
    final message = await showCopySheet(
      context,
      sharing: widget.sharing,
      deck: widget.deck,
    );
    if (message != null) {
      messenger.showSnackBar(SnackBar(content: Text(message)));
    }
  }

  Future<void> _report() async {
    final messenger = ScaffoldMessenger.of(context);
    final l10n = AppLocalizations.of(context);
    final reason = await showAppSheet<ReportReason>(
      context,
      builder: (_) => const _ReportSheet(),
    );
    if (reason == null) return;
    final message = await describing(l10n, () async {
      return switch (await widget.sharing.report(widget.deck.id, reason)) {
        ReportOutcome.reported => l10n.reported,
        ReportOutcome.alreadyReported => l10n.alreadyReported,
      };
    });
    messenger.showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _block() async {
    final messenger = ScaffoldMessenger.of(context);
    final navigator = Navigator.of(context);
    final l10n = AppLocalizations.of(context);
    final name = widget.deck.ownerName.value;
    final confirmed = await showAppConfirm(
      context,
      title: l10n.blockTitle(name),
      titleWritten: true,
      consequence: l10n.blockBody,
      confirmLabel: l10n.block,
    );
    if (!confirmed) return;
    var blocked = false;
    final message = await describing(l10n, () async {
      await widget.sharing.block(widget.deck.owner);
      blocked = true;
      return l10n.blocked(name);
    });
    messenger.showSnackBar(SnackBar(content: Text(message)));
    if (blocked) navigator.pop(true);
  }
}

/// A state in place of the cards: what happened, and a retry when [onRetry]
/// is given.
class _State extends StatelessWidget {
  const _State({required this.text, this.onRetry});

  final String text;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final onRetry = this.onRetry;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpace.s32),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        spacing: AppSpace.s12,
        children: [
          Text(
            keepWords(text),
            semanticsLabel: text,
            textAlign: TextAlign.center,
            style: AppType.body.copyWith(color: AppColors.of(context).muted),
          ),
          if (onRetry != null)
            AppButton(
              label: AppLocalizations.of(context).retry,
              variant: AppButtonVariant.secondary,
              onPressed: onRetry,
            ),
        ],
      ),
    );
  }
}

/// Asks why the deck is reported; pops with the reason, or nothing when
/// dismissed.
class _ReportSheet extends StatefulWidget {
  const _ReportSheet();

  @override
  State<_ReportSheet> createState() => _ReportSheetState();
}

class _ReportSheetState extends State<_ReportSheet> {
  ReportReason? _reason;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final reason = _reason;
    return AppSheet(
      title: l10n.reportTitle,
      content: RadioGroup<ReportReason>(
        groupValue: reason,
        onChanged: (value) => setState(() => _reason = value),
        child: Column(
          children: [
            for (final option in ReportReason.values)
              RadioListTile<ReportReason>(
                value: option,
                contentPadding: EdgeInsets.zero,
                title: Text(switch (option) {
                  ReportReason.inappropriate => l10n.reportInappropriate,
                  ReportReason.spam => l10n.reportSpam,
                  ReportReason.copyright => l10n.reportCopyright,
                  ReportReason.other => l10n.reportOther,
                }, style: AppType.body),
              ),
          ],
        ),
      ),
      actions: [
        AppButton(
          label: l10n.reportConfirm,
          size: AppButtonSize.cta,
          onPressed: reason == null
              ? null
              : () => Navigator.of(context).pop(reason),
        ),
      ],
    );
  }
}
