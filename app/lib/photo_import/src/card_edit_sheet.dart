import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../design/app_button.dart';
import '../../design/app_sheet.dart';
import '../../design/app_text_field.dart';
import '../../design/round_check.dart';
import '../../design/theme.dart';
import '../../l10n/app_localizations.dart';
import 'extraction_client.dart';
import 'import_list.dart';

/// Opens the sheet that edits [row]: its front, and a vocabulary row's senses,
/// each kept or dropped by its round check, edited, and moved up or down
/// through its ⋯ menu, or a note's back. "완료"
/// applies the edits, and is disabled while every sense is dropped; a
/// dismissal applies none. Resolves to whether the row changed.
Future<bool> showCardEditSheet(BuildContext context, ImportRow row) async =>
    await showAppSheet<bool>(
      context,
      builder: (context) => _CardEditSheet(row: row),
    ) ??
    false;

/// A sense as the sheet edits it, before it is applied.
final class _Draft {
  _Draft(this.sense)
    : controller = TextEditingController(text: sense.meaning),
      kept = sense.kept;

  final RowSense sense;
  final TextEditingController controller;
  bool kept;
}

class _CardEditSheet extends StatefulWidget {
  const _CardEditSheet({required this.row});

  final ImportRow row;

  @override
  State<_CardEditSheet> createState() => _CardEditSheetState();
}

class _CardEditSheetState extends State<_CardEditSheet> {
  late final _front = TextEditingController(text: widget.row.front);
  late final _back = TextEditingController(text: widget.row.answer);
  late final _senses = [for (final sense in widget.row.senses) _Draft(sense)];

  bool get _vocabulary => widget.row.kind == CardKind.vocabulary;

  @override
  void dispose() {
    _front.dispose();
    _back.dispose();
    for (final draft in _senses) {
      draft.controller.dispose();
    }
    super.dispose();
  }

  /// Applies the drafts, a field left empty keeping its text.
  void _apply() {
    final row = widget.row;
    if (_front.text.trim().isNotEmpty) row.front = _front.text.trim();
    if (_vocabulary) {
      row.senses
        ..clear()
        ..addAll(
          _senses.map((draft) {
            final meaning = draft.controller.text.trim();
            if (meaning.isNotEmpty) draft.sense.meaning = meaning;
            return draft.sense..kept = draft.kept;
          }),
        );
    } else if (_back.text.trim().isNotEmpty) {
      row.answer = _back.text.trim();
    }
    Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    final savable = !_vocabulary || _senses.any((draft) => draft.kept);
    return AppSheet(
      title: l10n.editTitle,
      content: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        spacing: AppSpace.s16,
        children: [
          AppTextField(label: l10n.editFront, controller: _front),
          if (_vocabulary) ...[
            Text(
              l10n.editSenses,
              style: AppType.section.copyWith(color: colors.ink),
            ),
            for (final (i, draft) in _senses.indexed)
              Row(
                key: ObjectKey(draft),
                children: [
                  // The list's round check, so a meaning is kept the way a
                  // row is.
                  Semantics(
                    container: true,
                    label: l10n.editKeepSense(i + 1),
                    excludeSemantics: true,
                    checked: draft.kept,
                    onTap: () => setState(() => draft.kept = !draft.kept),
                    child: InkResponse(
                      onTap: () => setState(() => draft.kept = !draft.kept),
                      radius: AppSize.tapTarget / 2,
                      child: SizedBox.square(
                        dimension: AppSize.tapTarget + AppSpace.s4,
                        child: Center(child: RoundCheck(on: draft.kept)),
                      ),
                    ),
                  ),
                  Expanded(
                    child: AppTextField(
                      label: [
                        l10n.editSense(i + 1),
                        ?draft.sense.labelText,
                      ].join(' · '),
                      controller: draft.controller,
                    ),
                  ),
                  // Moved through ⋯, as the card editor moves a meaning,
                  // so nothing needs a drag.
                  PopupMenuButton<int>(
                    tooltip: l10n.editMoveSense(i + 1),
                    icon: Icon(LucideIcons.ellipsis, color: colors.muted),
                    onSelected: (to) =>
                        setState(() => _senses.insert(to, _senses.removeAt(i))),
                    itemBuilder: (_) => [
                      PopupMenuItem(
                        value: i - 1,
                        enabled: i > 0,
                        child: Text(l10n.moveUp),
                      ),
                      PopupMenuItem(
                        value: i + 1,
                        enabled: i < _senses.length - 1,
                        child: Text(l10n.moveDown),
                      ),
                    ],
                  ),
                ],
              ),
          ] else
            AppTextField(
              label: l10n.editBack,
              controller: _back,
              minLines: 2,
              maxLines: 6,
            ),
        ],
      ),
      actions: [
        AppButton(
          label: l10n.editDone,
          size: AppButtonSize.cta,
          onPressed: savable ? _apply : null,
        ),
      ],
    );
  }
}
