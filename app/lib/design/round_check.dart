import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import 'theme.dart';

/// A round check, filled in ink with a tick when on, outlined when off: the
/// one control that marks a row as chosen, in photo import's list and edit
/// sheet and in the spreadsheet import's rows alike.
class RoundCheck extends StatelessWidget {
  const RoundCheck({super.key, required this.on});

  final bool on;

  @override
  Widget build(BuildContext context) {
    final colors = AppColors.of(context);
    return Container(
      width: AppSpace.s20 + AppSpace.s4,
      height: AppSpace.s20 + AppSpace.s4,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: on ? colors.ink : null,
        border: on ? null : Border.all(color: colors.muted, width: 1.5),
      ),
      child: on
          ? Icon(
              LucideIcons.check,
              size: AppSize.checkIcon,
              color: colors.onInk,
            )
          : null,
    );
  }
}
