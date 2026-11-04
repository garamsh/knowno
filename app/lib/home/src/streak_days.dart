import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../design/theme.dart';
import '../../l10n/app_localizations.dart';

/// "n일 연속", the count in the accent, over a dot a day for the last seven
/// study days, today's last: a day with cards filled in the accent, a day
/// without an outline, and today outlined in [AppColors.todayMark], filled
/// once the day is [done]. Each dot is over its weekday, today's "오늘" in
/// [AppColors.todayText].
class StreakDays extends StatelessWidget {
  const StreakDays({
    super.key,
    required this.streak,
    required this.week,
    required this.done,
  });

  final int streak;
  final List<({DateTime date, int cards})> week;

  /// Whether today's cards are done.
  final bool done;

  /// A day's dot, and the width of its outline.
  static const _dot = AppSpace.s28;
  static const _line = 2.0;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    final locale = Localizations.localeOf(context).toLanguageTag();
    final last = week.length - 1;
    String name(int index) => index == last
        ? l10n.dayToday
        : DateFormat.E(locale).format(week[index].date);
    final streakText = l10n.streakDays(streak);
    final number = '$streak';
    final at = streakText.indexOf(number);
    return Column(
      spacing: AppSpace.s8,
      children: [
        Semantics(
          header: true,
          child: Text.rich(
            // The count in the accent, where the sentence holds it.
            at < 0
                ? TextSpan(text: streakText)
                : TextSpan(
                    children: [
                      TextSpan(text: streakText.substring(0, at)),
                      TextSpan(
                        text: number,
                        style: TextStyle(color: colors.accent),
                      ),
                      TextSpan(text: streakText.substring(at + number.length)),
                    ],
                  ),
            textAlign: TextAlign.center,
            style: AppType.title.copyWith(color: colors.ink),
          ),
        ),
        Semantics(
          container: true,
          image: true,
          label: [
            for (final (index, day) in week.indexed)
              l10n.weekDayCards(name(index), day.cards),
          ].join(', '),
          excludeSemantics: true,
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            spacing: AppSpace.s8,
            children: [
              for (final (index, day) in week.indexed)
                Expanded(
                  child: Column(
                    spacing: AppSpace.s4,
                    children: [
                      SizedBox.square(
                        dimension: _dot,
                        child: DecoratedBox(
                          decoration: switch ((index == last, day.cards > 0)) {
                            (true, _) => BoxDecoration(
                              shape: BoxShape.circle,
                              color: done ? colors.todayMark : null,
                              border: Border.all(
                                color: colors.todayMark,
                                width: _line,
                              ),
                            ),
                            (false, true) => BoxDecoration(
                              shape: BoxShape.circle,
                              color: colors.accent,
                            ),
                            (false, false) => BoxDecoration(
                              shape: BoxShape.circle,
                              border: Border.all(
                                color: colors.outline,
                                width: _line,
                              ),
                            ),
                          },
                        ),
                      ),
                      FittedBox(
                        fit: BoxFit.scaleDown,
                        child: Text(
                          name(index),
                          style: index == last
                              ? AppType.section.copyWith(
                                  color: colors.todayText,
                                )
                              : AppType.micro.copyWith(color: colors.ink2),
                        ),
                      ),
                    ],
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }
}
