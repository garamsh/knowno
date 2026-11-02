import 'package:flutter/material.dart';

import 'app_raised.dart';
import 'theme.dart';

/// What a button does, which decides how prominent it is.
enum AppButtonVariant {
  /// The screen's or the sheet's one primary action: the primary fill on its
  /// edge.
  primary,

  /// The study coach's action: the [AppColors.onHero] fill on its edge.
  onHero,

  /// An action beside the primary one: the surface on its edge.
  secondary,

  /// A destructive action that is not yet the final step: red text.
  destructive,

  /// The final step of a destructive action: a red fill.
  destructiveFinal,

  /// A quiet action, such as one in a top bar: ink text.
  text,

  /// A quiet action on the hero surface, such as the study coach's
  /// "건너뛰기": text in the colour drawn on the hero.
  onHeroText,
}

/// How tall a button is.
enum AppButtonSize {
  /// [AppSize.button], for buttons inside content.
  regular,

  /// [AppSize.cta], for the actions at the bottom of a screen or a sheet.
  cta,
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

  @override
  Widget build(BuildContext context) {
    final colors = AppColors.of(context);
    final height = switch ((variant, size)) {
      (_, AppButtonSize.cta) => AppSize.cta,
      (
        AppButtonVariant.text ||
            AppButtonVariant.onHeroText ||
            AppButtonVariant.destructive,
        _,
      ) =>
        AppSize.tapTarget,
      (_, AppButtonSize.regular) => AppSize.button,
    };
    final minimumSize = Size(AppSize.tapTarget, height);
    final pressed = loading ? null : onPressed;
    final (fill, onFill) = switch (variant) {
      AppButtonVariant.primary => (colors.primary, colors.onPrimary),
      AppButtonVariant.onHero => (colors.onHero, colors.brand),
      AppButtonVariant.destructiveFinal => (
        colors.dontKnowText,
        colors.onDontKnowText,
      ),
      AppButtonVariant.secondary ||
      AppButtonVariant.text => (colors.surface, colors.ink),
      AppButtonVariant.destructive => (colors.surface, colors.dontKnowText),
      AppButtonVariant.onHeroText => (colors.hero, colors.onHero),
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
        : switch (icon) {
            final icon? => Row(
              mainAxisSize: MainAxisSize.min,
              spacing: AppSpace.s8,
              children: [
                Icon(icon, size: AppSize.smallIcon),
                Flexible(child: Text(label, textAlign: TextAlign.center)),
              ],
            ),
            null => Text(label, textAlign: TextAlign.center),
          };
    final edge = switch (variant) {
      _ when pressed == null => null,
      AppButtonVariant.primary => colors.primaryEdge,
      AppButtonVariant.onHero => colors.onHeroEdge,
      AppButtonVariant.destructiveFinal => colors.dontKnowEdge,
      AppButtonVariant.secondary => colors.edge,
      _ => null,
    };
    final edgeHeight = variant == AppButtonVariant.secondary
        ? AppSize.edgeCard
        : AppSize.edgeButton;
    return AppRaised(
      edge: edge,
      height: edgeHeight,
      radius: AppRadius.button,
      builder: (context, states) => switch (variant) {
        AppButtonVariant.primary ||
        AppButtonVariant.onHero ||
        AppButtonVariant.destructiveFinal => FilledButton(
          statesController: states,
          style: FilledButton.styleFrom(
            minimumSize: minimumSize,
            backgroundColor: fill,
            foregroundColor: onFill,
          ),
          onPressed: pressed,
          child: child,
        ),
        AppButtonVariant.secondary => OutlinedButton(
          statesController: states,
          style: OutlinedButton.styleFrom(minimumSize: minimumSize),
          onPressed: pressed,
          child: child,
        ),
        AppButtonVariant.destructive ||
        AppButtonVariant.text ||
        AppButtonVariant.onHeroText => TextButton(
          style: TextButton.styleFrom(
            minimumSize: minimumSize,
            foregroundColor: onFill,
          ),
          onPressed: pressed,
          child: child,
        ),
      },
    );
  }
}
