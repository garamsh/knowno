import 'package:flutter/material.dart';

import '../../design/theme.dart';

/// [child] in a box on [AppHatch], rounded on [AppRadius.chip] and inset 12
/// by 8: how a card list's row marks what study hides until the reveal.
class HatchedBox extends StatelessWidget {
  const HatchedBox({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) => DecoratedBox(
    decoration: HatchDecoration(
      AppColors.of(context),
      borderRadius: BorderRadius.circular(AppRadius.chip),
    ),
    child: Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpace.s12,
        vertical: AppSpace.s8,
      ),
      child: child,
    ),
  );
}
