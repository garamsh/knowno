import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../design/app_button.dart';
import '../../design/app_chip.dart';
import '../../design/app_list_row.dart';
import '../../design/round_check.dart';
import '../../design/theme.dart';
import '../../design/word_break.dart';
import '../../l10n/app_localizations.dart';
import 'card_preview.dart';
import 'conversation.dart';
import 'protocol.dart';

/// A group of this many cards or more starts collapsed to its count and form.
const collapsedFrom = 6;

/// [form] in the words the chat's choices use.
String formName(AppLocalizations l10n, CardForm form) => switch (form) {
  CardForm.text => l10n.assistantFormText,
  CardForm.senses => l10n.assistantFormSenses,
  CardForm.cloze => l10n.assistantFormCloze,
  CardForm.table => l10n.assistantFormTable,
  CardForm.image => l10n.assistantFormImage,
  CardForm.mixed => l10n.assistantFormMixed,
};

/// The forms a group can be remade in from the chat: each but a photo's.
final _remakeForms = CardForm.values.where((form) => form != CardForm.image);

/// A proposal in the chat: its note, then its groups in one surface; once
/// added, the shortcut to the note it wrote, which [onOpenNote] opens.
/// [disabled] holds the checks' and remakes' buttons still.
class ProposalView extends StatelessWidget {
  const ProposalView({
    super.key,
    required this.shown,
    required this.disabled,
    required this.onCheck,
    required this.onRemake,
    required this.onOpenNote,
  });

  final ShownProposal shown;
  final bool disabled;
  final void Function(String groupId, List<String> ids) onCheck;
  final void Function(ProposalGroup group, CardForm form) onRemake;
  final void Function(String deckId) onOpenNote;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    final proposal = shown.proposal;
    final added = shown.added;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      spacing: AppSpace.s8,
      children: [
        AppGroup(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(
                AppSpace.s16,
                AppSpace.s12,
                AppSpace.s16,
                AppSpace.s4,
              ),
              child: Text(
                proposal.deckId == null
                    ? l10n.assistantNewNote(proposal.deckName)
                    : proposal.deckName,
                style: AppType.secondary.copyWith(color: colors.muted),
              ),
            ),
            for (final group in proposal.groups)
              _GroupView(
                key: ValueKey(group.id),
                group: group,
                checked: shown.checked[group.id] ?? const [],
                added: added != null,
                disabled: disabled,
                onCheck: (ids) => onCheck(group.id, ids),
                onRemake: (form) => onRemake(group, form),
              ),
          ],
        ),
        if (added != null)
          AppListRow(
            title: added.deckName,
            subtitle: [
              l10n.assistantNoteCards(added.count),
              if (added.skipped > 0) l10n.assistantCardsSkipped(added.skipped),
              if (added.refused > 0) l10n.assistantCardsRefused(added.refused),
            ].join(' · '),
            trailing: Icon(LucideIcons.chevronRight, color: colors.muted),
            onTap: () => onOpenNote(added.deckId),
          ),
      ],
    );
  }
}

/// One group of a proposal: its check over its cards, its title and form
/// chip, "다른 형식으로", which offers the other forms, and its cards, each
/// with its own check, collapsed to "카드 n장 · form" from [collapsedFrom]
/// cards until opened. Once [added], the checks are gone.
class _GroupView extends StatefulWidget {
  const _GroupView({
    super.key,
    required this.group,
    required this.checked,
    required this.added,
    required this.disabled,
    required this.onCheck,
    required this.onRemake,
  });

  final ProposalGroup group;
  final List<String> checked;
  final bool added;
  final bool disabled;
  final ValueChanged<List<String>> onCheck;
  final ValueChanged<CardForm> onRemake;

  @override
  State<_GroupView> createState() => _GroupViewState();
}

class _GroupViewState extends State<_GroupView> {
  late var _open = widget.group.cards.length < collapsedFrom;
  var _remaking = false;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    final group = widget.group;
    final all = [for (final card in group.cards) card.id];
    final allChecked = widget.checked.length == all.length;
    final form = formName(l10n, group.form);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(
            AppSpace.s16,
            AppSpace.s4,
            AppSpace.s16,
            0,
          ),
          child: Row(
            spacing: AppSpace.s12,
            children: [
              if (!widget.added)
                _CheckBox(
                  on: allChecked,
                  label: l10n.assistantSelectAll(group.title),
                  onChanged: () => widget.onCheck(allChecked ? [] : all),
                ),
              Expanded(
                child: Semantics(
                  header: true,
                  child: Text(
                    keepWords(group.title),
                    semanticsLabel: group.title,
                    style: AppType.bodyStrong.copyWith(color: colors.ink),
                  ),
                ),
              ),
              Flexible(
                child: AppChip(label: form, tone: AppChipTone.brand),
              ),
            ],
          ),
        ),
        if (!widget.added)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppSpace.s8),
            child: Wrap(
              crossAxisAlignment: WrapCrossAlignment.center,
              spacing: AppSpace.s8,
              children: [
                AppButton(
                  label: l10n.assistantOtherForm,
                  variant: AppButtonVariant.text,
                  size: AppButtonSize.header,
                  onPressed: widget.disabled
                      ? null
                      : () => setState(() => _remaking = !_remaking),
                ),
                if (_remaking)
                  for (final other in _remakeForms.where(
                    (f) => f != group.form,
                  ))
                    AppChip.action(
                      label: formName(l10n, other),
                      onPressed: widget.disabled
                          ? null
                          : () {
                              setState(() => _remaking = false);
                              widget.onRemake(other);
                            },
                    ),
              ],
            ),
          ),
        if (_open)
          for (final card in group.cards)
            _CardRow(
              card: card,
              on: widget.checked.contains(card.id),
              added: widget.added,
              onChanged: () => widget.onCheck(
                widget.checked.contains(card.id)
                    ? [
                        for (final id in widget.checked)
                          if (id != card.id) id,
                      ]
                    : [...widget.checked, card.id],
              ),
            )
        else
          AppListRow(
            title: l10n.assistantGroupCount(group.cards.length, form),
            trailing: Icon(LucideIcons.chevronRight, color: colors.muted),
            onTap: () => setState(() => _open = true),
          ),
      ],
    );
  }
}

/// A check of Material's tap target size, read as a checkbox named [label].
class _CheckBox extends StatelessWidget {
  const _CheckBox({
    required this.on,
    required this.label,
    required this.onChanged,
  });

  final bool on;
  final String label;
  final VoidCallback onChanged;

  @override
  Widget build(BuildContext context) => Semantics(
    label: label,
    checked: on,
    child: InkWell(
      onTap: onChanged,
      customBorder: const CircleBorder(),
      child: ConstrainedBox(
        constraints: const BoxConstraints.tightFor(
          width: kMinInteractiveDimension,
          height: kMinInteractiveDimension,
        ),
        child: Center(
          child: ExcludeSemantics(child: RoundCheck(on: on)),
        ),
      ),
    ),
  );
}

/// A proposed card: two lines, with its check unless [added].
class _CardRow extends StatelessWidget {
  const _CardRow({
    required this.card,
    required this.on,
    required this.added,
    required this.onChanged,
  });

  final ProposalCard card;
  final bool on;
  final bool added;
  final VoidCallback onChanged;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    final preview = previewOf(card.card);
    final front = preview.front.isNotEmpty
        ? preview.front
        : preview.photo
        ? l10n.assistantFormImage
        : '—';
    final lines = Expanded(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            keepWords(front),
            semanticsLabel: front,
            style: AppType.bodyStrong.copyWith(color: colors.ink),
          ),
          if (preview.back.isNotEmpty)
            Text(
              keepWords(preview.back),
              semanticsLabel: preview.back,
              style: AppType.secondary.copyWith(color: colors.muted),
            ),
        ],
      ),
    );
    return MergeSemantics(
      child: Semantics(
        checked: added ? null : on,
        child: AppRowSurface(
          onTap: added ? null : onChanged,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: AppSize.tapTarget),
            child: Padding(
              padding: AppListRow.inset,
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                spacing: AppSpace.s12,
                children: [
                  if (!added) ExcludeSemantics(child: RoundCheck(on: on)),
                  lines,
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
