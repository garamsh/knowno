import 'package:flutter/material.dart';

import '../../design/theme.dart';
import '../../design/word_break.dart';
import 'google_button.dart';

/// The "continue with email" button, full width, drawn as the Google button
/// beside it is: as tall as that at the least, a capsule on the surface with
/// a one-pixel muted outline, its label centred in ink and wrapping between
/// words, the button growing to hold it at a large text size.
class EmailSignInButton extends StatelessWidget {
  const EmailSignInButton({
    super.key,
    required this.label,
    required this.onPressed,
  });

  final String label;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final colors = AppColors.of(context);
    final shape = RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(AppRadius.button),
      side: BorderSide(color: colors.muted),
    );
    return Semantics(
      button: true,
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: GoogleButtonStyle.height),
        child: Material(
          color: colors.surface,
          shape: shape,
          child: InkWell(
            customBorder: shape,
            onTap: onPressed,
            child: Padding(
              padding: const EdgeInsets.symmetric(
                horizontal: AppSpace.s16,
                vertical: AppSpace.s8,
              ),
              child: Center(
                child: Text(
                  keepWords(label),
                  semanticsLabel: label,
                  textAlign: TextAlign.center,
                  style: GoogleButtonStyle.labelStyle.copyWith(
                    color: colors.ink,
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
