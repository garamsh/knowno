import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../design/theme.dart';
import 'account_state.dart';
import 'providers.dart';

/// The signed-in account's initial in a circle of [size]: the primary fill
/// with its text colour, so it is cocoa in the light theme and inverted in the
/// dark one. An account without an email shows a person.
class AccountAvatar extends ConsumerWidget {
  const AccountAvatar({super.key, required this.size});

  final double size;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = AppColors.of(context);
    final email = switch (ref.watch(accountStateProvider)) {
      SignedIn(:final email) => email,
      SignedOut() || AccountUnavailable() => null,
    };
    return ExcludeSemantics(
      child: Container(
        width: size,
        height: size,
        alignment: Alignment.center,
        decoration: ShapeDecoration(
          color: colors.ink,
          shape: const CircleBorder(),
        ),
        child: email == null || email.isEmpty
            ? Icon(LucideIcons.user, color: colors.onInk, size: size / 2)
            : Text(
                email.characters.first.toUpperCase(),
                style:
                    (size >= AppSize.avatar
                            ? AppType.deckName
                            : AppType.bodyStrong)
                        .copyWith(color: colors.onInk),
              ),
      ),
    );
  }
}
