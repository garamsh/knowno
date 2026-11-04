import 'package:flutter/material.dart';

import 'theme.dart';
import 'word_break.dart';

/// How a chip is coloured.
enum AppChipTone {
  /// The raised surface, with ink text.
  neutral,

  /// The brand tint, for what is due today and for a selected chip.
  brand,

  /// The amber tint, for a shortfall.
  amber,

  /// "Know" green, with its text on it.
  know,

  /// The green tint, for a gain, with "Know" as text on it.
  knowTint,

  /// "Don't know" red, with its text on it.
  dontKnow,
}

/// The app's one chip (#454): a small label of radius [AppRadius.chip] in
/// its [tone], in the section style. It wraps inside itself, between words,
/// where the line has no room.
///
/// [AppChip.action] is the same chip pressed to act or to toggle: a status
/// chip, a filter chip and an editor tool chip differ in what they do, not
/// in how they look.
class AppChip extends StatelessWidget {
  const AppChip({
    super.key,
    required this.label,
    this.tone = AppChipTone.neutral,
  }) : onPressed = null,
       selected = null,
       tooltip = null,
       _acts = false;

  /// A chip that acts when pressed, disabled while [onPressed] is null, its
  /// tap target as large as Material's padded chips, [kMinInteractiveDimension]. Given [selected], it
  /// toggles, and a selected chip takes the brand tint.
  const AppChip.action({
    super.key,
    required this.label,
    required this.onPressed,
    this.selected,
    this.tooltip,
  }) : tone = AppChipTone.neutral,
       _acts = true;

  final String label;
  final AppChipTone tone;
  final VoidCallback? onPressed;

  /// Whether a toggling chip is on, or null where the chip does not toggle.
  final bool? selected;

  /// What a long press shows, and a screen reader reads after the label.
  final String? tooltip;

  final bool _acts;

  @override
  Widget build(BuildContext context) {
    final colors = AppColors.of(context);
    final tone = selected ?? false ? AppChipTone.brand : this.tone;
    final (fill, outline, ink) = switch (tone) {
      AppChipTone.neutral => (colors.raised, colors.raised, colors.ink),
      AppChipTone.brand => (colors.brandTint, colors.brandTint, colors.ink),
      AppChipTone.amber => (colors.tintAmber, colors.tintAmber, colors.ink),
      AppChipTone.know => (colors.know, colors.know, colors.onKnow),
      AppChipTone.knowTint => (
        colors.tintGreen,
        colors.tintGreen,
        colors.onKnowTint,
      ),
      AppChipTone.dontKnow => (
        colors.dontKnowText,
        colors.dontKnowText,
        colors.onDontKnowText,
      ),
    };
    final enabled = !_acts || onPressed != null;
    final shape = RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(AppRadius.chip),
      side: BorderSide(color: outline),
    );
    final face = Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpace.s12,
        vertical: AppSpace.s4,
      ),
      child: Text(
        keepWords(label),
        semanticsLabel: label,
        style: AppType.section.copyWith(color: enabled ? ink : colors.muted),
      ),
    );
    if (!_acts) {
      return DecoratedBox(
        decoration: ShapeDecoration(color: fill, shape: shape),
        child: face,
      );
    }
    final tooltip = this.tooltip;
    final chip = MergeSemantics(
      child: Semantics(
        button: true,
        selected: selected,
        enabled: enabled,
        child: ConstrainedBox(
          constraints: const BoxConstraints(
            minWidth: kMinInteractiveDimension,
            minHeight: kMinInteractiveDimension,
          ),
          child: Stack(
            alignment: Alignment.center,
            children: [
              // The space around the chip that makes up its tap target; a
              // tap on the chip itself reaches the chip's own ink first.
              Positioned.fill(
                child: GestureDetector(
                  behavior: HitTestBehavior.opaque,
                  excludeFromSemantics: true,
                  onTap: onPressed,
                ),
              ),
              Material(
                color: fill,
                shape: shape,
                clipBehavior: Clip.antiAlias,
                child: InkWell(onTap: onPressed, child: face),
              ),
            ],
          ),
        ),
      ),
    );
    return tooltip == null ? chip : Tooltip(message: tooltip, child: chip);
  }
}
