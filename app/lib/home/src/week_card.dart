import 'dart:math';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../design/dashed_outline.dart';
import '../../design/theme.dart';
import '../../l10n/app_localizations.dart';

/// "n일 연속", the count in the accent, with the last seven study days'
/// cards at its right, over a bar a day, today's last and in the accent, each
/// under its count and over its weekday. A day with no card is a dashed bar.
class WeekCard extends StatelessWidget {
  const WeekCard({super.key, required this.streak, required this.week});

  final int streak;
  final List<({DateTime date, int cards})> week;

  /// The bars' height at the week's most cards, and a day without any's.
  static const _barHeight = 48.0;
  static const _emptyBar = AppSpace.s16;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    final locale = Localizations.localeOf(context).toLanguageTag();
    final most = week.map((day) => day.cards).fold(0, max);
    final total = week.fold(0, (sum, day) => sum + day.cards);
    String name(int index) => index == week.length - 1
        ? l10n.dayToday
        : DateFormat.E(locale).format(week[index].date);
    final streakText = l10n.streakDays(streak);
    final number = '$streak';
    final at = streakText.indexOf(number);
    TextStyle small(int index) => AppType.caption.copyWith(
      color: index == week.length - 1 ? colors.accent : colors.ink2,
    );
    return DecoratedBox(
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(AppRadius.card),
        boxShadow: AppShadow.card(colors),
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(
          AppSpace.s20,
          AppSpace.s12,
          AppSpace.s20,
          AppSpace.s12,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          spacing: AppSpace.s8,
          children: [
            Wrap(
              alignment: WrapAlignment.spaceBetween,
              crossAxisAlignment: WrapCrossAlignment.center,
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
                              TextSpan(
                                text: streakText.substring(at + number.length),
                              ),
                            ],
                          ),
                    style: AppType.title.copyWith(color: colors.ink),
                  ),
                ),
                Text(
                  l10n.lastWeekCards(total),
                  style: AppType.caption.copyWith(color: colors.ink2),
                ),
              ],
            ),
            Semantics(
              container: true,
              image: true,
              label: [
                for (final (index, day) in week.indexed)
                  l10n.weekDayCards(name(index), day.cards),
              ].join(', '),
              excludeSemantics: true,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                spacing: AppSpace.s4,
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    spacing: AppSpace.s8,
                    children: [
                      for (final (index, day) in week.indexed)
                        Expanded(
                          child: Column(
                            spacing: AppSpace.s4,
                            children: [
                              FittedBox(
                                fit: BoxFit.scaleDown,
                                child: Text(
                                  '${day.cards}',
                                  style: small(index),
                                ),
                              ),
                              _Bar(
                                height: day.cards == 0
                                    ? _emptyBar
                                    : max(
                                        AppSpace.s8,
                                        _barHeight * day.cards / most,
                                      ),
                                color: index == week.length - 1
                                    ? colors.accent
                                    : day.cards == 0
                                    ? colors.edge
                                    : colors.heat1,
                                dashed: day.cards == 0,
                              ),
                            ],
                          ),
                        ),
                    ],
                  ),
                  Row(
                    spacing: AppSpace.s8,
                    children: [
                      for (var index = 0; index < week.length; index++)
                        Expanded(
                          child: Center(
                            child: FittedBox(
                              fit: BoxFit.scaleDown,
                              child: Text(name(index), style: small(index)),
                            ),
                          ),
                        ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// A day's bar, [height] tall in [color], or its outline dashed while
/// [dashed].
class _Bar extends StatelessWidget {
  const _Bar({required this.height, required this.color, required this.dashed});

  final double height;
  final Color color;
  final bool dashed;

  static const _shape = BorderRadius.vertical(
    top: Radius.circular(AppSpace.s8),
    bottom: Radius.circular(AppSpace.s4),
  );

  /// The width of a dashed bar's outline.
  static const _line = 2.0;

  @override
  Widget build(BuildContext context) => SizedBox(
    height: height,
    width: double.infinity,
    child: dashed
        ? DashedOutline(
            color: color,
            borderRadius: _shape,
            width: _line,
            dash: AppSpace.s4,
          )
        : DecoratedBox(
            decoration: BoxDecoration(color: color, borderRadius: _shape),
          ),
  );
}
