import 'package:flutter/material.dart';

import '../../design/app_button.dart';
import '../../design/app_chip.dart';
import '../../design/app_text_field.dart';
import '../../design/theme.dart';
import '../../design/undo_snack_bar.dart';
import '../../l10n/app_localizations.dart';
import 'content.dart';
import 'editor_group.dart';
import 'label_presets.dart';

/// The least width of a sense's label chip, which is otherwise as wide as
/// its text.
const _labelMinWidth = 40.0;

/// The space above and below a label chip that a tap on it takes too, so its
/// target is [kMinInteractiveDimension] high though the chip is a line high.
const _labelTapInset = (kMinInteractiveDimension - labelChipHeight) / 2;

/// One sense of a 단어 as the editor edits it: its labels as
/// typed, its meaning, and its examples, one per line (ADR 0100).
class SenseDraft {
  SenseDraft([CardSense? sense])
    : _stored = [...?sense?.labels],
      label = TextEditingController(text: _typed(sense?.labels ?? const [])),
      meaning = TextEditingController(text: sense?.meaning ?? ''),
      examples = TextEditingController(
        text: (sense?.examples ?? const []).join('\n'),
      ),
      hasExamples = sense?.examples.isNotEmpty ?? false;

  /// The labels the sense opened with, kept while their text is left as it
  /// was, so a label keeps the text it was printed with.
  final List<SenseLabel> _stored;

  final TextEditingController label;
  final TextEditingController meaning;
  final TextEditingController examples;

  /// The label field's focus, which shows the presets above the keyboard.
  final labelFocus = FocusNode();

  /// The meaning field's focus, which a new sense and the 단어 field's next
  /// key move to.
  final meaningFocus = FocusNode();

  /// Whether the sense opened with examples, so their field is shown.
  final bool hasExamples;

  /// The labels as saved: those the sense opened with while their text is
  /// unchanged, otherwise one per word typed.
  List<SenseLabel> get labels =>
      label.text == _typed(_stored) ? [..._stored] : labelsOf(label.text);

  /// Whether the meaning is empty, which saving refuses.
  bool get isBlank => meaning.text.trim().isEmpty;

  /// The sense as saved: its labels, its meaning trimmed, and each non-empty
  /// line of its examples, trimmed.
  CardSense get sense => CardSense(
    labels: labels,
    meaning: meaning.text.trim(),
    examples: [
      for (final line in examples.text.split('\n'))
        if (line.trim().isNotEmpty) line.trim(),
    ],
  );

  void dispose() {
    label.dispose();
    meaning.dispose();
    examples.dispose();
    labelFocus.dispose();
    meaningFocus.dispose();
  }

  /// [labels] as the label field shows them, one space apart.
  static String _typed(List<SenseLabel> labels) =>
      labels.map((label) => label.shown).join(' ');
}

/// A 단어's meanings inside its group: each sense a row of its label chip, its
/// meaning and, with more than one sense, a ⋯ menu that moves it up or down
/// or deletes it, the rows separated by a hairline; then "+ 뜻 추가". No field
/// is named by a side (#449). With [showErrors], an empty meaning says so
/// under it.
class SenseFields extends StatelessWidget {
  const SenseFields({
    super.key,
    required this.senses,
    required this.showErrors,
    required this.onChanged,
  });

  final List<SenseDraft> senses;
  final bool showErrors;

  /// Called after every change to [senses], which this widget makes in place.
  final VoidCallback onChanged;

  void _act(BuildContext context, int index, RowAction action) {
    switch (action) {
      case RowAction.up:
        senses.insert(index - 1, senses.removeAt(index));
      case RowAction.down:
        senses.insert(index + 1, senses.removeAt(index));
      case RowAction.delete:
        final removed = senses.removeAt(index);
        showUndoSnackBar(
          context,
          message: AppLocalizations.of(context).deletedSense,
          onUndo: () {
            senses.insert(index.clamp(0, senses.length), removed);
            onChanged();
          },
          onGone: removed.dispose,
        );
    }
    onChanged();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final single = senses.length == 1;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final (index, sense) in senses.indexed) ...[
          if (index > 0) const Divider(height: 1, thickness: 1),
          _SenseRow(
            // Keyed by the draft, so a moved sense keeps its fields' focus and
            // text.
            key: ObjectKey(sense),
            sense: sense,
            number: single ? null : index + 1,
            showError: showErrors && sense.isBlank,
            canMoveUp: index > 0,
            canMoveDown: index < senses.length - 1,
            onAction: (action) => _act(context, index, action),
            onChanged: onChanged,
          ),
        ],
        GroupAddRow(
          label: l10n.addSense,
          semanticsLabel: l10n.addSense,
          color: AppColors.of(context).ink2,
          onPressed: () {
            final sense = SenseDraft();
            senses.add(sense);
            onChanged();
            // Once its field is built; the focus scrolls it into view.
            WidgetsBinding.instance.addPostFrameCallback(
              (_) => sense.meaningFocus.requestFocus(),
            );
          },
        ),
      ],
    );
  }
}

/// One sense: its label chip inline before its meaning, on its baseline, and
/// its examples under the meaning when it has any. [number] is null while it
/// is the block's one meaning, whose field is hinted "뜻" and which has no
/// menu.
class _SenseRow extends StatelessWidget {
  const _SenseRow({
    super.key,
    required this.sense,
    required this.number,
    required this.showError,
    required this.canMoveUp,
    required this.canMoveDown,
    required this.onAction,
    required this.onChanged,
  });

  final SenseDraft sense;
  final int? number;
  final bool showError;
  final bool canMoveUp;
  final bool canMoveDown;
  final ValueChanged<RowAction> onAction;
  final VoidCallback onChanged;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    final number = this.number;
    final meaning = number == null
        ? l10n.senseMeaning
        : l10n.senseHeading(number);
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        AppSpace.s16,
        groupInset,
        groupInset,
        groupInset,
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.baseline,
        textBaseline: TextBaseline.alphabetic,
        children: [
          MergeSemantics(
            child: Semantics(
              label: number == null
                  ? l10n.senseLabelHint
                  : l10n.senseLabelField(number),
              // The chip is a line high; the space around it takes a tap too,
              // so the target is a tap target square.
              child: GestureDetector(
                behavior: HitTestBehavior.opaque,
                onTap: sense.labelFocus.requestFocus,
                child: ConstrainedBox(
                  constraints: const BoxConstraints(
                    minWidth: kMinInteractiveDimension,
                  ),
                  child: Align(
                    alignment: Alignment.centerLeft,
                    widthFactor: 1,
                    child: Padding(
                      padding: const EdgeInsets.symmetric(
                        vertical: _labelTapInset,
                      ),
                      child: ConstrainedBox(
                        constraints: const BoxConstraints(
                          minWidth: _labelMinWidth,
                        ),
                        child: IntrinsicWidth(
                          child: TextField(
                            controller: sense.label,
                            focusNode: sense.labelFocus,
                            textAlign: TextAlign.center,
                            style: AppType.bodyStrong.copyWith(
                              color: colors.ink,
                            ),
                            onChanged: (_) => onChanged(),
                            decoration: labelChipDecoration(
                              colors,
                              l10n.senseLabelHint,
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Semantics(
                  label: meaning,
                  child: AppTextField(
                    hint: meaning,
                    controller: sense.meaning,
                    focusNode: sense.meaningFocus,
                    maxLines: null,
                    errorText: !showError
                        ? null
                        : number == null
                        ? l10n.cardSideRequired
                        : l10n.senseMeaningRequired,
                    onChanged: (_) => onChanged(),
                  ),
                ),
                if (sense.hasExamples)
                  MergeSemantics(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      spacing: AppSpace.s8,
                      children: [
                        // Inset as the field's text is: the group's fields
                        // draw no border for a label to line up with.
                        Padding(
                          padding: const EdgeInsets.only(left: AppSpace.s20),
                          child: Text(
                            l10n.senseExamples,
                            style: AppType.section.copyWith(color: colors.ink2),
                          ),
                        ),
                        AppTextField(
                          hint: l10n.senseExamplesHint,
                          controller: sense.examples,
                          minLines: 1,
                          maxLines: null,
                          onChanged: (_) => onChanged(),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
          ),
          if (number != null)
            RowMenu(
              label: l10n.senseMenu(number),
              upLabel: l10n.moveUp,
              downLabel: l10n.moveDown,
              deleteLabel: l10n.deleteBlock,
              canMoveUp: canMoveUp,
              canMoveDown: canMoveDown,
              onAction: onAction,
            ),
        ],
      ),
    );
  }
}

/// The user's labels in a strip above the keyboard while a sense's label
/// field has focus: a tap on one fills that field with it, and "관리" opens
/// the "라벨" screen.
class LabelPresetStrip extends StatelessWidget {
  const LabelPresetStrip({
    super.key,
    required this.presets,
    required this.current,
    required this.onPick,
    required this.onManage,
  });

  final List<LabelPreset> presets;

  /// The focused field's text, whose preset shows chosen.
  final String current;
  final ValueChanged<String> onPick;
  final VoidCallback onManage;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    return Semantics(
      container: true,
      label: l10n.labelPresetsTitle,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: colors.surface,
          border: Border(top: BorderSide(color: colors.outline)),
        ),
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: AppSpace.s12,
            vertical: AppSpace.s8,
          ),
          child: Row(
            spacing: AppSpace.s8,
            children: [
              Expanded(
                child: SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: Row(
                    spacing: AppSpace.s8,
                    children: [
                      for (final preset in presets)
                        AppChip.action(
                          label: preset.label,
                          tooltip: preset.name.isEmpty ? null : preset.name,
                          selected: preset.label == current.trim(),
                          onPressed: () => onPick(preset.label),
                        ),
                    ],
                  ),
                ),
              ),
              AppButton(
                label: l10n.manageLabelPresets,
                variant: AppButtonVariant.text,
                onPressed: onManage,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
