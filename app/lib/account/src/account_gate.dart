import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'account_state.dart';
import 'plan_controller.dart';
import 'providers.dart';
import 'sign_in_screen.dart';

/// The app's root: the sign-in screen until an account is signed in, then
/// [signedIn]. It shows whichever state the account is in now, so a restored
/// session opens the app without waiting on the network.
class AccountGate extends ConsumerWidget {
  const AccountGate({super.key, required this.signedIn});

  /// The app the gate opens while an account is signed in.
  final Widget signedIn;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // The plan follows the account from sign-in on, whichever screen is open.
    ref.listen(planProvider, (_, _) {});
    ref.listen(accountStateProvider, (previous, next) {
      // Every screen opened over the app leaves with the account.
      if (previous is SignedIn && next is! SignedIn) {
        Navigator.of(context).popUntil((route) => route.isFirst);
      }
    });
    return switch (ref.watch(accountStateProvider)) {
      SignedIn() => signedIn,
      SignedOut() || AccountUnavailable() => const SignInScreen(),
    };
  }
}
