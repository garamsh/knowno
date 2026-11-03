import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../design/theme.dart';

/// The width of a focused field's ink outline inside a group (#454).
const _focusRing = 1.5;

/// The space around a label chip's text, as the "라벨" screen draws it.
const _labelChipPadding = EdgeInsets.symmetric(
  horizontal: AppSpace.s8,
  vertical: AppSpace.s4,
);

/// A label chip's height at text scale 1: a line of body text, 24, and its
/// padding.
const labelChipHeight = 24 + 2 * AppSpace.s4;

/// The space between a group's edge and the fields in its rows, so a focused
/// field's outline stays inside the group's corners.
const groupInset = AppSpace.s4;

/// One white group of rows: a 칸 of a card in the editor, or the label
/// presets. Its [children] are separated by a hairline, never boxed one by
/// one, and its fields are drawn without a border until they have the
/// focus, when a 1.5 px ink outline shows (#454).
class EditorGroup extends StatelessWidget {
  const EditorGroup({super.key, required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final colors = AppColors.of(context);
    final theme = Theme.of(context);
    return Theme(
      data: theme.copyWith(inputDecorationTheme: groupFieldTheme(colors)),
      child: DecoratedBox(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(AppRadius.group),
          boxShadow: AppShadow.card(colors),
        ),
        child: Material(
          color: colors.surface,
          borderRadius: BorderRadius.circular(AppRadius.group),
          clipBehavior: Clip.antiAlias,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (final (index, child) in children.indexed) ...[
                if (index > 0) const Divider(height: 1, thickness: 1),
                child,
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// Something a 칸's editor took out, kept until it is clear it stays out:
/// [undo] puts it back where it was, and [forget] lets go of its fields once
/// it will not be.
typedef Removal = ({VoidCallback undo, VoidCallback forget});

/// A field inside a group: no border and no fill of its own while it rests,
/// the 1.5 px ink outline while it has the focus, and red in place of ink
/// while it shows an error.
InputDecorationTheme groupFieldTheme(AppColors colors) {
  OutlineInputBorder ring(Color color) => OutlineInputBorder(
    borderRadius: BorderRadius.circular(AppRadius.group - groupInset),
    borderSide: BorderSide(color: color, width: _focusRing),
  );
  const none = OutlineInputBorder(borderSide: BorderSide.none);
  return InputDecorationTheme(
    filled: true,
    fillColor: colors.surface,
    hintStyle: AppType.body.copyWith(color: colors.muted),
    contentPadding: const EdgeInsets.symmetric(
      horizontal: AppSpace.s16,
      vertical: AppSpace.s12,
    ),
    border: none,
    enabledBorder: none,
    errorBorder: none,
    focusedBorder: ring(colors.ink),
    focusedErrorBorder: ring(colors.dontKnowText),
    errorStyle: AppType.caption.copyWith(color: colors.dontKnowText),
  );
}

/// A label typed before a meaning, drawn as a small chip a line of body text
/// high on `brandTint` with the label chip's radius; the 1.5 px ink outline
/// while it has the focus.
InputDecoration labelChipDecoration(AppColors colors, String hint) {
  OutlineInputBorder border(BorderSide side) => OutlineInputBorder(
    borderRadius: BorderRadius.circular(AppRadius.chip),
    borderSide: side,
  );
  return InputDecoration(
    hintText: hint,
    hintStyle: AppType.body.copyWith(color: colors.ink2),
    // As wide as the label typed, not as its hint once it has one.
    maintainHintSize: false,
    filled: true,
    fillColor: colors.brandTint,
    isDense: true,
    contentPadding: _labelChipPadding,
    border: border(BorderSide.none),
    enabledBorder: border(BorderSide.none),
    focusedBorder: border(BorderSide(color: colors.ink, width: _focusRing)),
  );
}

/// The quiet row at the end of a group that adds to it: "+" and [label] in
/// [color], `muted` unless given, read as [semanticsLabel].
class GroupAddRow extends StatelessWidget {
  const GroupAddRow({
    super.key,
    required this.label,
    required this.semanticsLabel,
    required this.onPressed,
    this.color,
  });

  final String label;
  final String semanticsLabel;
  final VoidCallback? onPressed;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final color = this.color ?? AppColors.of(context).muted;
    return Semantics(
      button: true,
      label: semanticsLabel,
      excludeSemantics: true,
      onTap: onPressed,
      child: InkWell(
        onTap: onPressed,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: AppSize.tapTarget),
          child: Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: AppSpace.s20,
              vertical: AppSpace.s12,
            ),
            child: Align(
              alignment: Alignment.centerLeft,
              child: Text(
                '+ $label',
                style: AppType.body.copyWith(color: color),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// What a row's ⋯ menu does.
enum RowAction { up, down, delete }

/// A row's ⋯ menu, named [label] for a screen reader: "위로" and "아래로",
/// each disabled where it cannot act, and the red "삭제", so nothing needs a
/// drag (WCAG 2.2 dragging).
class RowMenu extends StatelessWidget {
  const RowMenu({
    super.key,
    required this.label,
    required this.upLabel,
    required this.downLabel,
    required this.deleteLabel,
    required this.canMoveUp,
    required this.canMoveDown,
    required this.onAction,
    this.enabled = true,
  });

  final String label;
  final String upLabel;
  final String downLabel;
  final String deleteLabel;
  final bool canMoveUp;
  final bool canMoveDown;
  final bool enabled;
  final ValueChanged<RowAction> onAction;

  @override
  Widget build(BuildContext context) {
    final colors = AppColors.of(context);
    return PopupMenuButton<RowAction>(
      tooltip: label,
      enabled: enabled,
      icon: Icon(LucideIcons.ellipsis, color: colors.muted),
      onSelected: onAction,
      itemBuilder: (_) => [
        PopupMenuItem(
          value: RowAction.up,
          enabled: canMoveUp,
          child: Text(upLabel),
        ),
        PopupMenuItem(
          value: RowAction.down,
          enabled: canMoveDown,
          child: Text(downLabel),
        ),
        PopupMenuItem(
          value: RowAction.delete,
          child: Text(
            deleteLabel,
            style: AppType.body.copyWith(color: colors.dontKnowText),
          ),
        ),
      ],
    );
  }
}

/// Tells its listeners of each edit in one 칸's group, which ends an undo
/// offered for what was taken out of it.
class GroupEdits extends ChangeNotifier {
  void edited() => notifyListeners();
}
