import 'package:flutter/material.dart';
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
/// title at the row's end, and a value too long for the line is ellipsized.
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
            child: OverflowBar(
              spacing: AppSpace.s12,
              alignment: MainAxisAlignment.spaceBetween,
              overflowAlignment: OverflowBarAlignment.end,
              children: [
                Text(
                  keepWords(title),
                  semanticsLabel: title,
                  style: AppType.bodyStrong,
                ),
                Row(
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
              ],
            ),
          ),
        ),
      ),
    );
  }
}
