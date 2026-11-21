import 'package:flutter/material.dart';
import 'package:knowno/account/src/apple_button.dart';

/// Stands in for the iOS system's Apple button, which a test cannot host: a
/// box with the button's name that calls `onPressed` when tapped and keeps the
/// theme's [dark] it was drawn for.
class FakeAppleButton extends StatelessWidget {
  const FakeAppleButton({
    super.key,
    required this.dark,
    required this.onPressed,
  });

  final bool dark;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) => Semantics(
    button: true,
    label: 'Continue with Apple',
    excludeSemantics: true,
    onTap: onPressed,
    child: GestureDetector(
      onTap: onPressed,
      child: ColoredBox(color: dark ? Colors.white : Colors.black),
    ),
  );
}

/// The [AppleButtonView] that draws a [FakeAppleButton].
Widget fakeAppleButtonView(
  BuildContext context, {
  required bool dark,
  required VoidCallback onPressed,
}) => FakeAppleButton(dark: dark, onPressed: onPressed);
