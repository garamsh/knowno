import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import 'app_list_row.dart';
import 'app_sheet.dart';
import 'theme.dart';
import 'word_break.dart';

/// One option of [showAppChoice]: its [title] and the [value] it stands for.
typedef AppChoiceOption<T> = ({String title, T value});

/// Opens a sheet titled [title] with an [AppListRow] for each of [options],
/// the [current] one checked, or none when [current] is not given. Resolves
/// to the option tapped, in a record so that a null value differs from a
/// dismissal, which resolves to null.
Future<({T value})?> showAppChoice<T>(
  BuildContext context, {
  required String title,
  required List<AppChoiceOption<T>> options,
  ({T value})? current,
}) => showAppSheet<({T value})>(
  context,
  builder: (context) => AppSheet(
    title: title,
    content: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final option in options)
          AppListRow(
            title: option.title,
            selected: current == null ? null : option.value == current.value,
            trailing: current != null && option.value == current.value
                ? Icon(LucideIcons.check, color: AppColors.of(context).ink)
                : null,
            onTap: () => Navigator.of(context).pop((value: option.value)),
          ),
      ],
    ),
  ),
);

/// A row that chooses one of several options: its [title], the [value]
/// chosen in [AppColors.ink2] and a chevron, which [onTap] follows to the
/// choices, usually [showAppChoice]'s sheet; a null [onTap] disables it.
///
/// It lies on [AppListRow]'s insets. Where the title and the value do not fit
/// one line, as at a large text size, the value and the chevron go under the
/// title at the row's end, the title staying at its start, and a value too
/// long for the line is ellipsized.
class AppChoiceRow extends StatelessWidget {
  const AppChoiceRow({
    super.key,
    required this.title,
    required this.value,
    required this.onTap,
  });

  final String title;

  /// The option chosen, or null while it is not yet known, which shows the
  /// chevron alone.
  final String? value;

  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final value = this.value;
    return MergeSemantics(
      child: Semantics(
        button: true,
        child: AppRowSurface(
          onTap: onTap,
          child: Padding(
            padding: AppListRow.inset,
            child: _TitleAndValue(
              title: Text(
                keepWords(title),
                semanticsLabel: title,
                style: AppType.bodyStrong,
              ),
              value: Row(
                mainAxisSize: MainAxisSize.min,
                spacing: AppSpace.s4,
                children: [
                  if (value != null)
                    Flexible(
                      child: Text(
                        value,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: AppType.secondary.copyWith(
                          color: AppColors.of(context).ink2,
                        ),
                      ),
                    ),
                  const Icon(LucideIcons.chevronRight),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// [title] at the start and [value] at the end, on one line while their
/// one-line widths fit it, else [value] under [title].
class _TitleAndValue extends MultiChildRenderObjectWidget {
  _TitleAndValue({required Widget title, required Widget value})
    : super(children: [title, value]);

  @override
  RenderObject createRenderObject(BuildContext context) =>
      _RenderTitleAndValue();
}

class _TitleAndValueParentData extends ContainerBoxParentData<RenderBox> {}

class _RenderTitleAndValue extends RenderBox
    with
        ContainerRenderObjectMixin<RenderBox, _TitleAndValueParentData>,
        RenderBoxContainerDefaultsMixin<RenderBox, _TitleAndValueParentData> {
  static const _gap = AppSpace.s12;

  @override
  void setupParentData(RenderBox child) {
    if (child.parentData is! _TitleAndValueParentData) {
      child.parentData = _TitleAndValueParentData();
    }
  }

  RenderBox get _title => firstChild!;
  RenderBox get _value => lastChild!;

  bool _fitsOneLine(double width) =>
      _title.getMaxIntrinsicWidth(double.infinity) +
          _gap +
          _value.getMaxIntrinsicWidth(double.infinity) <=
      width;

  /// Lays the two out in [width] through [layout], which sizes a child, and
  /// returns where each goes and the height they take.
  (Offset, Offset, double) _arrange(
    double width,
    Size Function(RenderBox child, BoxConstraints constraints) layout,
  ) {
    final loose = BoxConstraints(maxWidth: width);
    final title = layout(_title, loose);
    final value = layout(_value, loose);
    if (_fitsOneLine(width)) {
      final height = math.max(title.height, value.height);
      return (
        Offset(0, (height - title.height) / 2),
        Offset(width - value.width, (height - value.height) / 2),
        height,
      );
    }
    return (
      Offset.zero,
      Offset(width - value.width, title.height),
      title.height + value.height,
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
    final (title, value, height) = _arrange(width, (child, constraints) {
      child.layout(constraints, parentUsesSize: true);
      return child.size;
    });
    (_title.parentData! as _TitleAndValueParentData).offset = title;
    (_value.parentData! as _TitleAndValueParentData).offset = value;
    size = constraints.constrain(Size(width, height));
  }

  @override
  double computeMinIntrinsicHeight(double width) =>
      computeMaxIntrinsicHeight(width);

  @override
  double computeMaxIntrinsicHeight(double width) {
    final title = _title.getMaxIntrinsicHeight(width);
    final value = _value.getMaxIntrinsicHeight(width);
    return _fitsOneLine(width) ? math.max(title, value) : title + value;
  }

  @override
  double computeMinIntrinsicWidth(double height) => math.max(
    _title.getMinIntrinsicWidth(height),
    _value.getMinIntrinsicWidth(height),
  );

  @override
  double computeMaxIntrinsicWidth(double height) =>
      _title.getMaxIntrinsicWidth(height) +
      _gap +
      _value.getMaxIntrinsicWidth(height);

  @override
  bool hitTestChildren(BoxHitTestResult result, {required Offset position}) =>
      defaultHitTestChildren(result, position: position);

  @override
  void paint(PaintingContext context, Offset offset) =>
      defaultPaint(context, offset);
}
