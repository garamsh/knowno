import 'package:flutter/material.dart';
import 'package:sign_in_with_apple/sign_in_with_apple.dart';

import '../../design/theme.dart';

/// Apple's "Continue with Apple" button, full width, as the
/// `sign_in_with_apple` package draws it to Apple's Human Interface
/// Guidelines: black in the light theme and white in the dark one, as tall as
/// it is laid out, 64 at the least, and rounded as the app's buttons are.
class AppleSignInButton extends StatelessWidget {
  const AppleSignInButton({
    super.key,
    required this.label,
    required this.onPressed,
  });

  /// Apple's title for the button in the app's language.
  final String label;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) => MediaQuery.withNoTextScaling(
    // The package sizes the title from the height it is given, so it is
    // given 64 and fills the height it is laid out at: the title keeps
    // Apple's proportion to a 64 high button at every text size.
    child: ConstrainedBox(
      constraints: const BoxConstraints(minHeight: AppSize.cta),
      child: SignInWithAppleButton(
        text: label,
        onPressed: onPressed,
        height: AppSize.cta,
        borderRadius: BorderRadius.circular(AppRadius.button),
        style: Theme.of(context).brightness == Brightness.dark
            ? SignInWithAppleButtonStyle.white
            : SignInWithAppleButtonStyle.black,
      ),
    ),
  );
}
