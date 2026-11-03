import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';

import '../../design/theme.dart';

/// A screen's bottom bar: a [secondary] action, and a [primary] one beside it
/// when the screen has one to offer. The two sit side by side, the secondary
/// at its label's width and the primary taking the rest, only while both
/// labels fit on one line at the text size shown; otherwise they stack full
/// width, the primary last.
class BottomActions extends StatelessWidget {
  const BottomActions({super.key, required this.secondary, this.primary});

  final Widget secondary;
  final Widget? primary;

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
            : _Pair(secondary: secondary, primary: primary),
      ),
    );
  }
}

/// [secondary] then [primary], in a row while their one-line widths fit it,
/// else stacked full width.
class _Pair extends MultiChildRenderObjectWidget {
  _Pair({required Widget secondary, required Widget primary})
    : super(children: [secondary, primary]);

  @override
  RenderObject createRenderObject(BuildContext context) => _RenderPair();
}

class _PairParentData extends ContainerBoxParentData<RenderBox> {}

class _RenderPair extends RenderBox
    with
        ContainerRenderObjectMixin<RenderBox, _PairParentData>,
        RenderBoxContainerDefaultsMixin<RenderBox, _PairParentData> {
  static const _gap = AppSpace.s12;

  @override
  void setupParentData(RenderBox child) {
    if (child.parentData is! _PairParentData) {
      child.parentData = _PairParentData();
    }
  }

  RenderBox get _secondary => firstChild!;
  RenderBox get _primary => lastChild!;

  /// The secondary's width in a row of [width], or null where the two
  /// labels do not both fit on one line there.
  double? _rowSecondaryWidth(double width) {
    final secondary = _secondary.getMaxIntrinsicWidth(double.infinity);
    final primary = _primary.getMaxIntrinsicWidth(double.infinity);
    return secondary + _gap + primary <= width ? secondary : null;
  }

  /// Lays the two out in [width] through [layout], which sizes a child, and
  /// returns where each goes and the height they take.
  (Offset, Offset, double) _arrange(
    double width,
    Size Function(RenderBox child, BoxConstraints constraints) layout,
  ) {
    final rowSecondary = _rowSecondaryWidth(width);
    if (rowSecondary != null) {
      final secondary = layout(
        _secondary,
        BoxConstraints.tightFor(width: rowSecondary),
      );
      final primary = layout(
        _primary,
        BoxConstraints.tightFor(width: width - rowSecondary - _gap),
      );
      final height = math.max(secondary.height, primary.height);
      return (
        Offset(0, (height - secondary.height) / 2),
        Offset(rowSecondary + _gap, (height - primary.height) / 2),
        height,
      );
    }
    final full = BoxConstraints.tightFor(width: width);
    final secondary = layout(_secondary, full);
    final primary = layout(_primary, full);
    return (
      Offset.zero,
      Offset(0, secondary.height + _gap),
      secondary.height + _gap + primary.height,
    );
  }

  @override
  Size computeDryLayout(BoxConstraints constraints) {
    final (_, _, height) = _arrange(
      constraints.maxWidth,
      (child, constraints) => child.getDryLayout(constraints),
    );
    return constraints.constrain(Size(constraints.maxWidth, height));
  }

  @override
  void performLayout() {
    final width = constraints.maxWidth;
    final (secondary, primary, height) = _arrange(width, (child, constraints) {
      child.layout(constraints, parentUsesSize: true);
      return child.size;
    });
    (_secondary.parentData! as _PairParentData).offset = secondary;
    (_primary.parentData! as _PairParentData).offset = primary;
    size = constraints.constrain(Size(width, height));
  }

  @override
  double computeMinIntrinsicHeight(double width) =>
      computeMaxIntrinsicHeight(width);

  @override
  double computeMaxIntrinsicHeight(double width) {
    final rowSecondary = _rowSecondaryWidth(width);
    if (rowSecondary != null) {
      return math.max(
        _secondary.getMaxIntrinsicHeight(rowSecondary),
        _primary.getMaxIntrinsicHeight(width - rowSecondary - _gap),
      );
    }
    return _secondary.getMaxIntrinsicHeight(width) +
        _gap +
        _primary.getMaxIntrinsicHeight(width);
  }

  @override
  double computeMinIntrinsicWidth(double height) => math.max(
    _secondary.getMinIntrinsicWidth(height),
    _primary.getMinIntrinsicWidth(height),
  );

  @override
  double computeMaxIntrinsicWidth(double height) =>
      _secondary.getMaxIntrinsicWidth(height) +
      _gap +
      _primary.getMaxIntrinsicWidth(height);

  @override
  bool hitTestChildren(BoxHitTestResult result, {required Offset position}) =>
      defaultHitTestChildren(result, position: position);

  @override
  void paint(PaintingContext context, Offset offset) =>
      defaultPaint(context, offset);
}
