import 'dart:math' as math;

import 'package:flutter/material.dart';

import 'app_raised.dart';
import 'theme.dart';
import 'word_break.dart';

/// What a button does, which decides how prominent it is.
enum AppButtonVariant {
  /// The screen's or the sheet's one primary action: the primary fill on its
  /// edge.
  primary,

  /// An action on the hero surface, such as the completion panel's
  /// "학습하기": the [AppColors.heroButton] fill on its edge.
  onHero,

  /// An action beside the primary one: the surface on its edge.
  secondary,

  /// A list screen's own action beside its title, which is not the screen's
  /// primary: the [AppColors.brandTint] fill under an [AppColors.accent]
  /// label on its [AppColors.edge].
  tonal,

  /// A destructive action that is not yet the final step: red text.
  destructive,

  /// The final step of a destructive action: a red fill.
  destructiveFinal,

  /// A quiet action, such as one in a top bar: ink text.
  text,

  /// An action the screen offers in passing, quieter than the content around
  /// it, such as "안내 다시 보기" under study's card: [AppColors.muted] text
  /// in [AppType.micro], on one line, ellipsized, so its row keeps its
  /// height.
  faint,

  /// A link to a document outside the app, such as the terms of service:
  /// underlined [AppType.caption] at w600 in [AppColors.ink2], inset
  /// [AppSpace.s4] at its sides so it sits in a line of text.
  link,

  /// A quiet action on the hero surface, such as the completion panel's
  /// "그만하기" under "학습하기": text in the colour drawn on the hero.
  onHeroText,
}

/// How tall a button is.
enum AppButtonSize {
  /// [AppSize.button], for buttons inside content.
  regular,

  /// [AppSize.cta], for the actions at the bottom of a screen or a sheet.
  cta,

  /// [AppSize.tapTarget], in [AppType.label], for the action beside a
  /// screen's title.
  header,
}

/// The app's button. A filled one sits on its edge and, pressed, moves down
/// onto it; any press dims under its label's colour, with no splash and no
/// haptic of its own. While [loading] it shows progress in place of its label
/// and cannot be pressed again.
class AppButton extends StatelessWidget {
  const AppButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.variant = AppButtonVariant.primary,
    this.size = AppButtonSize.regular,
    this.loading = false,
    this.loadingLabel,
    this.icon,
  });

  final String label;

  /// An icon before the label.
  final IconData? icon;

  /// Null disables the button.
  final VoidCallback? onPressed;

  final AppButtonVariant variant;
  final AppButtonSize size;
  final bool loading;

  /// What the progress is read as while [loading]; the [label] when null.
  final String? loadingLabel;

  /// The height of a top bar holding a header or quiet button: the bar's
  /// own, or, at a text size whose label is taller, that label's line with a
  /// filled button's inset around it and the bar's around that, so the label
  /// is never cut.
  static double barHeight(BuildContext context) {
    final line =
        MediaQuery.textScalerOf(context).scale(AppType.label.fontSize!) *
        AppType.label.height!;
    return math.max(kToolbarHeight, line + 4 * AppSpace.s8);
  }

  @override
  Widget build(BuildContext context) {
    final colors = AppColors.of(context);
    final height = switch ((variant, size)) {
      (_, AppButtonSize.cta) => AppSize.cta,
      (_, AppButtonSize.header) => AppSize.tapTarget,
      (
        AppButtonVariant.text ||
            AppButtonVariant.faint ||
            AppButtonVariant.link ||
            AppButtonVariant.onHeroText ||
            AppButtonVariant.destructive,
        _,
      ) =>
        AppSize.tapTarget,
      (_, AppButtonSize.regular) => AppSize.button,
    };
    final minimumSize = Size(AppSize.tapTarget, height);
    final (textStyle, padding) = switch ((variant, size)) {
      (_, AppButtonSize.header) => (
        AppType.label,
        const EdgeInsets.symmetric(horizontal: AppSpace.s16),
      ),
      (AppButtonVariant.faint, _) => (AppType.micro, null),
      (AppButtonVariant.link, _) => (
        AppType.caption.copyWith(
          fontWeight: FontWeight.w600,
          decoration: TextDecoration.underline,
        ),
        const EdgeInsets.symmetric(horizontal: AppSpace.s4),
      ),
      _ => (null, null),
    };
    final pressed = loading ? null : onPressed;
    final (fill, onFill) = switch (variant) {
      AppButtonVariant.primary => (colors.primary, colors.onPrimary),
      AppButtonVariant.onHero => (colors.heroButton, colors.onHeroButton),
      AppButtonVariant.tonal => (colors.brandTint, colors.accent),
      AppButtonVariant.destructiveFinal => (
        colors.dontKnowText,
        colors.onDontKnowText,
      ),
      AppButtonVariant.secondary ||
      AppButtonVariant.text => (colors.surface, colors.ink),
      AppButtonVariant.destructive => (colors.surface, colors.dontKnowText),
      AppButtonVariant.faint => (colors.surface, colors.muted),
      AppButtonVariant.link => (colors.surface, colors.ink2),
      AppButtonVariant.onHeroText => (colors.hero, colors.onHero),
    };
    final quiet = switch (variant) {
      AppButtonVariant.text ||
      AppButtonVariant.faint ||
      AppButtonVariant.link ||
      AppButtonVariant.onHeroText ||
      AppButtonVariant.destructive => true,
      _ => false,
    };
    final child = loading
        ? SizedBox.square(
            dimension: AppSpace.s20,
            child: CircularProgressIndicator(
              strokeWidth: 2,
              color: onFill,
              semanticsLabel: loadingLabel ?? label,
            ),
          )
        // Inset from a filled or outlined button's top and bottom, which
        // Material pads at the sides alone, so a label a large text size
        // makes taller than the button grows it and is never cut.
        : Padding(
            padding: EdgeInsets.symmetric(vertical: quiet ? 0 : AppSpace.s8),
            child: switch (icon) {
              final icon? => Row(
                mainAxisSize: MainAxisSize.min,
                spacing: AppSpace.s8,
                children: [
                  Icon(icon, size: AppSize.smallIcon),
                  Flexible(
                    child: Text(
                      keepWords(label),
                      semanticsLabel: label,
                      textAlign: TextAlign.center,
                    ),
                  ),
                ],
              ),
              null => Text(
                keepWords(label),
                semanticsLabel: label,
                textAlign: TextAlign.center,
                // A faint button's row keeps one tap target's height.
                maxLines: variant == AppButtonVariant.faint ? 1 : null,
                overflow: variant == AppButtonVariant.faint
                    ? TextOverflow.ellipsis
                    : null,
              ),
            },
          );
    final edge = switch (variant) {
      _ when pressed == null => null,
      AppButtonVariant.primary => colors.primaryEdge,
      AppButtonVariant.onHero => colors.onHeroEdge,
      AppButtonVariant.destructiveFinal => colors.dontKnowEdge,
      AppButtonVariant.secondary || AppButtonVariant.tonal => colors.edge,
      _ => null,
    };
    final edgeHeight = switch (variant) {
      AppButtonVariant.secondary || AppButtonVariant.tonal => AppSize.edgeCard,
      _ => AppSize.edgeButton,
    };
    return AppRaised(
      edge: edge,
      height: edgeHeight,
      radius: AppRadius.button,
      builder: (context, states) => switch (variant) {
        AppButtonVariant.primary ||
        AppButtonVariant.onHero ||
        AppButtonVariant.tonal ||
        AppButtonVariant.destructiveFinal => FilledButton(
          statesController: states,
          style: FilledButton.styleFrom(
            minimumSize: minimumSize,
            textStyle: textStyle,
            padding: padding,
            backgroundColor: fill,
            foregroundColor: onFill,
          ),
          onPressed: pressed,
          child: child,
        ),
        AppButtonVariant.secondary => OutlinedButton(
          statesController: states,
          style: OutlinedButton.styleFrom(
            minimumSize: minimumSize,
            textStyle: textStyle,
            padding: padding,
          ),
          onPressed: pressed,
          child: child,
        ),
        AppButtonVariant.destructive ||
        AppButtonVariant.text ||
        AppButtonVariant.faint ||
        AppButtonVariant.link ||
        AppButtonVariant.onHeroText => TextButton(
          style: TextButton.styleFrom(
            minimumSize: minimumSize,
            textStyle: textStyle,
            padding: padding,
            foregroundColor: onFill,
          ),
          onPressed: pressed,
          child: child,
        ),
      },
    );
  }
}
