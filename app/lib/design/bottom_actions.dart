import 'package:flutter/material.dart';

import '../../design/theme.dart';

/// A screen's bottom bar: a [secondary] action, and a [primary] one beside it
/// when the screen has one to offer. Beside a primary, the secondary takes its
/// label's width and the primary the rest, so a long primary label keeps one
/// line.
class BottomActions extends StatelessWidget {
  const BottomActions({super.key, required this.secondary, this.primary});

  final Widget secondary;
  final Widget? primary;

  static const _gap = AppSpace.s12;

  @override
  Widget build(BuildContext context) {
    final primary = this.primary;
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(
          AppSpace.gutter,
          AppSpace.s8,
          AppSpace.gutter,
          AppSpace.s16,
        ),
        child: primary == null
            ? Row(children: [Expanded(child: secondary)])
            : LayoutBuilder(
                // The secondary never takes more than half, so a long label
                // there wraps inside its button rather than off the row.
                builder: (context, constraints) => Row(
                  spacing: _gap,
                  children: [
                    ConstrainedBox(
                      constraints: BoxConstraints(
                        maxWidth: (constraints.maxWidth - _gap) / 2,
                      ),
                      child: secondary,
                    ),
                    Expanded(child: primary),
                  ],
                ),
              ),
      ),
    );
  }
}
