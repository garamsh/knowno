import 'package:flutter/material.dart';

import '../../design/theme.dart';

/// Builds one side of a [SplitCard], given the width its text is laid out in.
typedef SideBuilder = Widget Function(BuildContext context, double textWidth);

/// A card split into its two sides, the front on the left half and the back on
/// the right, divided by a line: the one way every screen draws a card.
///
/// With [stackBelow], a half narrower than that at the current text scale puts
/// the back under the front instead, in two halves of the same height. Each
/// side sits in the middle of its half, and with [scrolls] it scrolls inside
/// its half from the top once the card is capped.
class SplitCard extends StatelessWidget {
  const SplitCard({
    super.key,
    required this.front,
    required this.back,
    this.padding = AppSpace.s16,
    this.dividerInset = 0,
    this.dividerColor,
    this.stackBelow,
    this.scrolls = false,
  });

  final SideBuilder front;
  final SideBuilder back;

  /// The space around each side inside its half.
  final double padding;

  /// How far the dividing line stops short of the card's edges.
  final double dividerInset;

  /// The dividing line's colour; the theme's divider colour when null.
  final Color? dividerColor;

  /// The narrowest half, in logical pixels at text scale 1, kept side by side.
  final double? stackBelow;
  final bool scrolls;

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, constraints) {
      final width = constraints.maxWidth;
      final stackBelow = this.stackBelow;
      final stacked =
          stackBelow != null &&
          width / 2 - padding * 2 <
              MediaQuery.textScalerOf(context).scale(stackBelow);
      // A side's text width: its half less the padding, and side by side less
      // the divider.
      final textWidth = stacked
          ? width - padding * 2
          : (width - 1) / 2 - padding * 2;
      Widget half(SideBuilder side) => _Half(
        padding: padding,
        scrolls: scrolls,
        child: side(context, textWidth),
      );
      final halves = [
        Expanded(child: half(front)),
        if (stacked)
          Divider(
            height: 1,
            thickness: 1,
            indent: dividerInset,
            endIndent: dividerInset,
            color: dividerColor,
          )
        else
          VerticalDivider(
            width: 1,
            thickness: 1,
            indent: dividerInset,
            endIndent: dividerInset,
            color: dividerColor,
          ),
        Expanded(child: half(back)),
      ];
      return IntrinsicHeight(
        child: stacked
            ? Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: halves,
              )
            : Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: halves,
              ),
      );
    },
  );
}

/// One half: its side centred, scrolling from the top once the card is
/// capped when it [scrolls].
class _Half extends StatelessWidget {
  const _Half({
    required this.padding,
    required this.scrolls,
    required this.child,
  });

  final double padding;
  final bool scrolls;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final side = SizedBox(width: double.infinity, child: child);
    return Center(
      child: scrolls
          ? SingleChildScrollView(padding: EdgeInsets.all(padding), child: side)
          : Padding(padding: EdgeInsets.all(padding), child: side),
    );
  }
}
