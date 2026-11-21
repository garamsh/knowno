import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../design/theme.dart';

/// Draws the Apple sign-in button's view for the theme's [dark] and calls
/// [onPressed] when it is tapped.
typedef AppleButtonView = Widget Function(
  BuildContext context, {
  required bool dark,
  required VoidCallback onPressed,
});

/// The view the Apple button shows: the iOS system button, or, in a test, a
/// stand-in, since a test has no iOS to host a platform view.
final appleButtonViewProvider = Provider<AppleButtonView>(
  (ref) => systemAppleButton,
);

/// The registered name of the native view in `app/ios/Runner/`.
const _viewType = 'app.knowno/apple-sign-in-button';

/// The iOS system's `ASAuthorizationAppleIDButton`, type continue, black in
/// the light theme and white in the dark one, with the app's button radius.
/// The system draws its title in the device's language and answers a tap
/// through a channel named for the view.
Widget systemAppleButton(
  BuildContext context, {
  required bool dark,
  required VoidCallback onPressed,
}) => UiKitView(
  // The style is fixed when the view is made, so a theme change makes a new one.
  key: ValueKey(dark),
  viewType: _viewType,
  creationParams: {'dark': dark, 'radius': AppRadius.button},
  creationParamsCodec: const StandardMessageCodec(),
  onPlatformViewCreated: (id) =>
      MethodChannel('$_viewType/$id').setMethodCallHandler((call) async {
        if (call.method == 'pressed') onPressed();
      }),
);

/// Apple's "Continue with Apple" button, full width, as the iOS system draws
/// it, as tall as it is laid out.
class AppleSignInButton extends ConsumerWidget {
  const AppleSignInButton({super.key, required this.onPressed});

  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context, WidgetRef ref) =>
      ref.watch(appleButtonViewProvider)(
        context,
        dark: Theme.of(context).brightness == Brightness.dark,
        onPressed: onPressed,
      );
}
