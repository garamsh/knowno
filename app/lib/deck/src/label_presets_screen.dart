import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../design/app_button.dart';
import '../../design/app_list_row.dart';
import '../../design/app_text_field.dart';
import '../../design/screen_skeleton.dart';
import '../../design/theme.dart';
import '../../l10n/app_localizations.dart';
import 'editor_group.dart';
import 'failure_message.dart';
import 'label_presets.dart';

/// The settings row "라벨", which opens [PartOfSpeechPresetsScreen].
class PartOfSpeechPresetsRow extends StatelessWidget {
  const PartOfSpeechPresetsRow({super.key});

  @override
  Widget build(BuildContext context) => AppListRow(
    title: AppLocalizations.of(context).labelPresetsTitle,
    trailing: const Icon(LucideIcons.chevronRight),
    onTap: () => openPartOfSpeechPresets(context),
  );
}

/// Pushes the "라벨" screen.
Future<void> openPartOfSpeechPresets(BuildContext context) =>
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => const PartOfSpeechPresetsScreen(),
      ),
    );

/// "라벨": the labels the card editor offers above the keyboard, in their
/// order, each with its name, in one white group whose rows a hairline
/// separates. A tap on one edits it in place, "+ 라벨 추가" at the group's end
/// adds one, and each moves by a drag on its handle or by "위로" and "아래로"
/// in its ⋯ menu, which also deletes it. While one is edited, no other moves
/// or goes. Every change is stored on the device at once (ADR 0100,
/// ADR 0117).
class PartOfSpeechPresetsScreen extends ConsumerStatefulWidget {
  const PartOfSpeechPresetsScreen({super.key});

  @override
  ConsumerState<PartOfSpeechPresetsScreen> createState() =>
      _PartOfSpeechPresetsScreenState();
}

class _PartOfSpeechPresetsScreenState
    extends ConsumerState<PartOfSpeechPresetsScreen> {
  late List<LabelPreset> _presets = labelPresets(ref.read(deckStorageProvider));

  /// The preset being edited, by its place, or null.
  int? _editing;

  /// Whether the preset being edited was just added, so leaving it empty
  /// removes it.
  bool _adding = false;

  final _label = TextEditingController();
  final _name = TextEditingController();
  bool _showLabelError = false;

  @override
  void dispose() {
    _label.dispose();
    _name.dispose();
    super.dispose();
  }

  Future<void> _store(List<LabelPreset> presets) async {
    setState(() => _presets = presets);
    await reportingFailure(
      context,
      () => saveLabelPresets(ref.read(deckStorageProvider), presets),
    );
  }

  void _edit(int index) => setState(() {
    _editing = index;
    _adding = false;
    _showLabelError = false;
    _label.text = _presets[index].label;
    _name.text = _presets[index].name;
  });

  void _add() => setState(() {
    _presets = [..._presets, const LabelPreset('')];
    _editing = _presets.length - 1;
    _adding = true;
    _showLabelError = false;
    _label.clear();
    _name.clear();
  });

  Future<void> _done() async {
    final index = _editing!;
    final label = _label.text.trim();
    if (label.isEmpty) {
      if (_adding && _name.text.trim().isEmpty) {
        setState(() {
          _presets = [..._presets]..removeAt(index);
          _editing = null;
        });
      } else {
        setState(() => _showLabelError = true);
      }
      return;
    }
    _editing = null;
    await _store(
      [..._presets]..[index] = LabelPreset(label, _name.text.trim()),
    );
  }

  Future<void> _act(int index, RowAction action) => switch (action) {
    RowAction.up => _move(index, index - 1),
    RowAction.down => _move(index, index + 1),
    RowAction.delete => _store([..._presets]..removeAt(index)),
  };

  Future<void> _move(int from, int to) async {
    final presets = [..._presets];
    presets.insert(to, presets.removeAt(from));
    await _store(presets);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    final idle = _editing == null;
    return Theme(
      data: Theme.of(context)
          .copyWith(inputDecorationTheme: groupFieldTheme(colors)),
      child: ScreenSkeleton(
        title: l10n.labelPresetsTitle,
        body: [
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(
                AppSpace.s4,
                0,
                AppSpace.s4,
                AppSpace.s16,
              ),
              child: Text(
                l10n.labelPresetsBody,
                style: AppType.caption.copyWith(color: colors.muted),
              ),
            ),
          ),
          SliverReorderableList(
            itemCount: _presets.length,
            onReorderItem: _move,
            // While a row is edited, the list holds what it does not store
            // yet: no other row moves or goes until it is done.
            itemBuilder: (context, index) => _GroupPart(
              key: _editing == index
                  ? ValueKey(('editing', index))
                  : ValueKey((_presets[index], index)),
              first: index == 0,
              last: false,
              child: _editing == index
                  ? _EditingRow(
                      label: _label,
                      name: _name,
                      showLabelError: _showLabelError,
                      onDone: _done,
                    )
                  : _PresetRow(
                      index: index,
                      preset: _presets[index],
                      idle: idle,
                      canMoveUp: index > 0,
                      canMoveDown: index < _presets.length - 1,
                      onEdit: () => _edit(index),
                      onAction: (action) => _act(index, action),
                    ),
            ),
          ),
          SliverToBoxAdapter(
            child: _GroupPart(
              first: _presets.isEmpty,
              last: true,
              child: GroupAddRow(
                label: l10n.addLabelPreset,
                semanticsLabel: l10n.addLabelPreset,
                color: colors.ink2,
                onPressed: idle ? _add : null,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// A row of the presets' one group: the group's surface, its top corners
/// rounded on the [first] row and its bottom corners on the [last], and a
/// hairline above every row but the first.
class _GroupPart extends StatelessWidget {
  const _GroupPart({
    super.key,
    required this.first,
    required this.last,
    required this.child,
  });

  final bool first;
  final bool last;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    const radius = Radius.circular(AppRadius.group);
    return Material(
      color: AppColors.of(context).surface,
      clipBehavior: Clip.antiAlias,
      borderRadius: BorderRadius.vertical(
        top: first ? radius : Radius.zero,
        bottom: last ? radius : Radius.zero,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [if (!first) const Divider(height: 1, thickness: 1), child],
      ),
    );
  }
}

/// A preset as it is listed: its handle, which a drag moves, its label chip
/// and name, which a tap edits, and its ⋯ menu of "위로", "아래로" and
/// "삭제", so no move needs a drag. While another is edited, [idle] is false
/// and none of them acts.
class _PresetRow extends StatelessWidget {
  const _PresetRow({
    required this.index,
    required this.preset,
    required this.idle,
    required this.canMoveUp,
    required this.canMoveDown,
    required this.onEdit,
    required this.onAction,
  });

  final int index;
  final LabelPreset preset;
  final bool idle;
  final bool canMoveUp;
  final bool canMoveDown;
  final VoidCallback onEdit;
  final ValueChanged<RowAction> onAction;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    return Row(
      children: [
        // The menu moves it without a drag, so a screen reader skips this.
        ExcludeSemantics(
          child: ReorderableDragStartListener(
            index: index,
            enabled: idle,
            child: SizedBox.square(
              dimension: AppSize.tapTarget,
              child: Icon(LucideIcons.gripVertical, color: colors.muted),
            ),
          ),
        ),
        Expanded(
          child: Semantics(
            button: true,
            label: l10n.editLabelPreset(preset.label, preset.name),
            excludeSemantics: true,
            child: InkWell(
              onTap: idle ? onEdit : null,
              child: ConstrainedBox(
                constraints: const BoxConstraints(minHeight: AppSize.tapTarget),
                child: Row(
                  spacing: AppSpace.s12,
                  children: [
                    ConstrainedBox(
                      // The names start level while a label is short.
                      constraints: const BoxConstraints(
                        minWidth: _labelFieldWidth,
                      ),
                      child: Align(
                        alignment: Alignment.centerLeft,
                        widthFactor: 1,
                        child: DecoratedBox(
                          decoration: BoxDecoration(
                            color: colors.brandTint,
                            borderRadius: BorderRadius.circular(AppRadius.chip),
                          ),
                          child: Padding(
                            padding: const EdgeInsets.symmetric(
                              horizontal: AppSpace.s8,
                              vertical: AppSpace.s4,
                            ),
                            child: Text(
                              preset.label,
                              style: AppType.bodyStrong.copyWith(
                                color: colors.ink,
                              ),
                            ),
                          ),
                        ),
                      ),
                    ),
                    Expanded(
                      child: Text(
                        preset.name,
                        style: AppType.body.copyWith(color: colors.ink2),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
        RowMenu(
          label: l10n.labelPresetMenu(preset.label),
          upLabel: l10n.moveUp,
          downLabel: l10n.moveDown,
          deleteLabel: l10n.deleteBlock,
          canMoveUp: canMoveUp,
          canMoveDown: canMoveDown,
          enabled: idle,
          onAction: onAction,
        ),
      ],
    );
  }
}

/// The preset being edited: its label and its name, and "완료". An empty
/// label says so under it.
class _EditingRow extends StatelessWidget {
  const _EditingRow({
    required this.label,
    required this.name,
    required this.showLabelError,
    required this.onDone,
  });

  final TextEditingController label;
  final TextEditingController name;
  final bool showLabelError;
  final VoidCallback onDone;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final labelField = AppTextField(
      label: l10n.labelPresetLabel,
      controller: label,
      autofocus: true,
      textAlign: TextAlign.center,
      style: AppType.bodyStrong,
      errorText: showLabelError ? l10n.labelPresetRequired : null,
    );
    final nameField = AppTextField(
      label: l10n.labelPresetName,
      controller: name,
      onSubmitted: (_) => onDone(),
    );
    final done = AppButton(
      label: l10n.labelPresetDone,
      variant: AppButtonVariant.text,
      onPressed: onDone,
    );
    return Padding(
      padding: const EdgeInsets.all(groupInset),
      child: _labelFits(context)
          ? Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              spacing: AppSpace.s4,
              children: [
                SizedBox(width: _labelFieldWidth, child: labelField),
                Expanded(child: nameField),
                done,
              ],
            )
          : Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              spacing: AppSpace.s8,
              children: [
                labelField,
                nameField,
                Align(alignment: AlignmentDirectional.centerEnd, child: done),
              ],
            ),
    );
  }
}

/// Whether, at the text size of [context], a label of one Hangul syllable,
/// as the presets' are, fits the label field inside its insets. Where it
/// does not, the fields stand one above another at the row's width.
bool _labelFits(BuildContext context) {
  final painter = TextPainter(
    text: TextSpan(text: '가', style: AppType.bodyStrong),
    textDirection: Directionality.of(context),
    textScaler: MediaQuery.textScalerOf(context),
  )..layout();
  final width = painter.width;
  painter.dispose();
  return width + 2 * AppSpace.s16 <= _labelFieldWidth;
}

/// The width of a preset's label field while it is edited, and the least
/// width its chip's column takes.
const _labelFieldWidth = 64.0;
