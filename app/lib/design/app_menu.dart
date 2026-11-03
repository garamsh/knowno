import 'package:flutter/material.dart';

import 'theme.dart';

/// A pull-down menu of [items], opened from the anchor [builder] draws and
/// hanging [AppSpace.s4] under it, its end on the anchor's end: from an
/// anchor on the screen's gutter, as a header's ⋯ is, the menu keeps
/// [AppSpace.gutter] from the screen's side as the screen's content does.
class AppMenu extends StatelessWidget {
  const AppMenu({super.key, required this.items, required this.builder});

  final List<Widget> items;
  final MenuAnchorChildBuilder builder;

  @override
  Widget build(BuildContext context) {
    final direction = Directionality.of(context);
    // MenuAnchor hangs a menu from the anchor's start in its direction, and
    // past the screen's side it moves the menu only as far as the side, not
    // to the gutter. Laid out in the other direction, its start is the
    // anchor's end; the anchor and the items keep the screen's direction.
    return Directionality(
      textDirection: switch (direction) {
        TextDirection.ltr => TextDirection.rtl,
        TextDirection.rtl => TextDirection.ltr,
      },
      child: MenuAnchor(
        alignmentOffset: const Offset(0, AppSpace.s4),
        menuChildren: [
          for (final item in items)
            Directionality(textDirection: direction, child: item),
        ],
        builder: (context, controller, child) => Directionality(
          textDirection: direction,
          child: builder(context, controller, child),
        ),
      ),
    );
  }
}
