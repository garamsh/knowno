import 'package:flutter/material.dart';

import '../../design/theme.dart';

/// The context whose navigator opens a screen or a sheet over the menu, from
/// anywhere inside 노트's own navigator, which keeps the menu under what it
/// shows.
BuildContext aboveMenu(BuildContext context) =>
    Navigator.of(context, rootNavigator: true).context;

/// An icon button 44 square at least, on the raised surface over its edge as
/// a chip is, named by [tooltip].
class RaisedIconButton extends StatelessWidget {
  const RaisedIconButton({
    super.key,
    required this.icon,
    required this.tooltip,
    required this.onPressed,
  });

  final IconData icon;
  final String tooltip;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final colors = AppColors.of(context);
    final radius = BorderRadius.circular(AppRadius.chip);
    return DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: radius,
        boxShadow: AppShadow.edge(colors.edge, AppSize.edgeRow),
      ),
      child: IconButton(
        tooltip: tooltip,
        onPressed: onPressed,
        icon: Icon(icon),
        style: IconButton.styleFrom(
          backgroundColor: colors.raised,
          foregroundColor: colors.ink,
          minimumSize: const Size.square(AppSize.tapTarget),
          shape: RoundedRectangleBorder(borderRadius: radius),
        ),
      ),
    );
  }
}
