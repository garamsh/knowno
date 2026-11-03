import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../design/theme.dart';
import '../../l10n/app_localizations.dart';
import 'account_state.dart';
import 'providers.dart';

/// The signed-in account's initial in a round button over its edge, named
/// "설정", which [onPressed] opens; a person's outline for an account with no
/// email. On the hero it takes the hero's button colours, [onHero], and on
/// the ground the raised surface's.
class ProfileButton extends ConsumerWidget {
  const ProfileButton({
    super.key,
    required this.onPressed,
    this.onHero = false,
  });

  final VoidCallback onPressed;
  final bool onHero;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = AppColors.of(context);
    final ink = onHero ? colors.onHeroButton : colors.accent;
    final initial = switch (ref.watch(accountStateProvider)) {
      SignedIn(:final email?) when email.isNotEmpty =>
        email.characters.first.toUpperCase(),
      _ => null,
    };
    return DecoratedBox(
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        boxShadow: AppShadow.edge(
          onHero ? colors.onHeroEdge : colors.edge,
          AppSize.edgeRow,
        ),
      ),
      child: IconButton(
        tooltip: AppLocalizations.of(context).accountTitle,
        onPressed: onPressed,
        // What a user wrote, so Pretendard (ADR 0147).
        icon: initial == null
            ? const Icon(LucideIcons.user)
            : Text(initial, style: AppType.bodyStrong.copyWith(color: ink)),
        style: IconButton.styleFrom(
          backgroundColor: onHero ? colors.heroButton : colors.raised,
          foregroundColor: ink,
          minimumSize: const Size.square(AppSize.tapTarget),
          shape: const CircleBorder(),
        ),
      ),
    );
  }
}
