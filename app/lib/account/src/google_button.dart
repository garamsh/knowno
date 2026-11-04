import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../design/theme.dart';
import '../../design/word_break.dart';

/// Google's "Sign in with Google" button, full width: the "G" mark and
/// [label] on the light button in the light theme and the dark one in the
/// dark theme, as Google's branding guidelines draw them.
class GoogleSignInButton extends StatelessWidget {
  const GoogleSignInButton({
    super.key,
    required this.label,
    required this.onPressed,
  });

  final String label;
  final VoidCallback onPressed;

  /// The height the button takes at [width] for [label] in [context]: the
  /// app's call-to-action height, or the wrapped label's with 8 above and
  /// below where a large text size makes that taller.
  static double heightFor(BuildContext context, String label, double width) {
    final spacing = GoogleButtonStyle.spacing(Theme.of(context).platform);
    final painter =
        TextPainter(
          // The label's style over the text style of the Material the button
          // draws its surface with, and the app's locale, as the label has.
          text: TextSpan(
            text: keepWords(label),
            style: Theme.of(context).textTheme.bodyMedium!
                .merge(GoogleButtonStyle.labelStyle),
          ),
          textDirection: Directionality.of(context),
          locale: Localizations.maybeLocaleOf(context),
          textScaler: MediaQuery.textScalerOf(context),
        )..layout(
          maxWidth:
              width -
              spacing.start -
              GoogleButtonStyle.markSize -
              spacing.gap -
              spacing.end,
        );
    final labelHeight = painter.height;
    painter.dispose();
    return math.max(AppSize.cta, labelHeight + 2 * AppSpace.s8);
  }

  @override
  Widget build(BuildContext context) {
    final style = GoogleButtonStyle.of(context);
    final spacing = GoogleButtonStyle.spacing(Theme.of(context).platform);
    final shape = RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(AppRadius.button),
      side: BorderSide(color: style.stroke),
    );
    return Semantics(
      button: true,
      // At least the app's call-to-action height, and taller where a large
      // text size wraps the label.
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: AppSize.cta),
        child: Material(
          color: style.fill,
          shape: shape,
          child: InkWell(
            customBorder: shape,
            onTap: onPressed,
            child: Padding(
              padding: EdgeInsetsDirectional.only(
                start: spacing.start,
                top: AppSpace.s8,
                end: spacing.end,
                bottom: AppSpace.s8,
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                spacing: spacing.gap,
                children: [
                  Image.asset(
                    style.mark,
                    width: GoogleButtonStyle.markSize,
                    height: GoogleButtonStyle.markSize,
                    excludeFromSemantics: true,
                  ),
                  Flexible(
                    child: Text(
                      keepWords(label),
                      semanticsLabel: label,
                      // As wide as its longest line, so a wrapped label and
                      // the mark stay centred together.
                      textWidthBasis: TextWidthBasis.longestLine,
                      style: GoogleButtonStyle.labelStyle.copyWith(
                        color: style.label,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Google's "Sign in with Google" button as its branding guidelines specify
/// (developers.google.com/identity/branding-guidelines): each theme's fill,
/// one-pixel stroke, label colour and "G" mark, the label's font and size,
/// and the space around the mark per platform.
final class GoogleButtonStyle {
  const GoogleButtonStyle._({
    required this.fill,
    required this.stroke,
    required this.label,
    required this.mark,
  });

  /// The light button, drawn in the light theme.
  static const light = GoogleButtonStyle._(
    fill: Color(0xFFFFFFFF),
    stroke: Color(0xFF747775),
    label: Color(0xFF1F1F1F),
    mark: 'assets/google/g_mark_light.png',
  );

  /// The dark button, drawn in the dark theme.
  static const dark = GoogleButtonStyle._(
    fill: Color(0xFF131314),
    stroke: Color(0xFF8E918F),
    label: Color(0xFFE3E3E3),
    mark: 'assets/google/g_mark_dark.png',
  );

  /// The button of the theme [context] is drawn in.
  static GoogleButtonStyle of(BuildContext context) =>
      Theme.of(context).brightness == Brightness.dark ? dark : light;

  final Color fill;
  final Color stroke;
  final Color label;

  /// The "G" mark's asset, taken from Google's button for this theme.
  final String mark;

  /// The mark's width and height.
  static const markSize = 20.0;

  /// The label: Google Sans Medium, 14 on 20. Google Sans has no Hangul, so
  /// a Korean label's other characters are the app's font.
  static const labelStyle = TextStyle(
    fontFamily: 'GoogleSans',
    fontFamilyFallback: [appFontFamily],
    fontSize: 14,
    height: 20 / 14,
    fontWeight: FontWeight.w500,
  );

  /// The space before the mark, between the mark and the label, and after
  /// the label: 16, 12 and 16 on iOS, 12, 10 and 12 elsewhere.
  static ({double start, double gap, double end}) spacing(
    TargetPlatform platform,
  ) => switch (platform) {
    TargetPlatform.iOS || TargetPlatform.macOS => (start: 16, gap: 12, end: 16),
    _ => (start: 12, gap: 10, end: 12),
  };
}
