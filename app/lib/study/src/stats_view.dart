import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart' hide Card;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../deck/deck.dart'
    show DeckFailure, DeckSelection, deckRepositoryProvider, describeFailure;
import '../../design/app_chip.dart';
import '../../design/theme.dart';
import '../../l10n/app_localizations.dart';
import 'failure.dart';
import 'failure_message.dart';
import 'providers.dart';
import 'queue.dart';
import 'stats.dart';
import 'stats_style.dart';
import '../../design/word_break.dart';

/// The 기록 tab's content: [title], then the retention against its target
/// with the period selector it alone follows, the recall bands, the mastered
/// weeks and the study days, read from the device by [readStats] over
/// [decks].
///
/// It is read again when [decks] changes and whenever the route that shows
/// it comes back on top.
class StatsView extends ConsumerStatefulWidget {
  const StatsView({super.key, required this.decks, required this.title});

  final DeckSelection decks;
  final Widget title;

  @override
  ConsumerState<StatsView> createState() => _StatsViewState();
}

/// The stats as read at [now], in the time zone [zone].
typedef _Read = ({StudyStats stats, DateTime now, UtcOffsetAt zone});

class _StatsViewState extends ConsumerState<StatsView> {
  late Future<_Read> _stats = _read();
  var _period = StatsPeriod.month;
  bool _onTop = true;

  Future<_Read> _read() async {
    final now = ref.read(studyClockProvider)();
    final zone = ref.read(studyZoneProvider);
    final stats = await readStats(
      widget.decks,
      cards: ref.read(deckRepositoryProvider),
      repository: ref.read(studyRepositoryProvider),
      scheduler: ref.read(schedulerProvider),
      now: now,
      offsetAt: zone,
    );
    return (stats: stats, now: now, zone: zone);
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final onTop = ModalRoute.isCurrentOf(context) ?? true;
    if (onTop && !_onTop) _stats = _read();
    _onTop = onTop;
  }

  @override
  void didUpdateWidget(StatsView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!setEquals(oldWidget.decks.ids, widget.decks.ids)) _stats = _read();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    return ListView(
      padding: const EdgeInsets.fromLTRB(
        AppSpace.gutter,
        AppSpace.s8,
        AppSpace.gutter,
        AppSpace.s28,
      ),
      children: [
        widget.title,
        const SizedBox(height: AppSpace.s16),
        FutureBuilder(
          future: _stats,
          builder: (context, read) => switch (read) {
            AsyncSnapshot(hasError: true, :final error?) => Text(
              switch (error) {
                DeckFailure() => describeFailure(l10n, error),
                StudyFailure() => describeStudyFailure(l10n, error),
                _ => Error.throwWithStackTrace(
                  error,
                  read.stackTrace ?? StackTrace.empty,
                ),
              },
              style: AppType.body.copyWith(color: colors.ink),
            ),
            AsyncSnapshot<_Read>(:final data?) => Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              spacing: AppSpace.s12,
              children: [
                _RetentionCard(
                  read: data,
                  period: _period,
                  onPeriod: (period) => setState(() => _period = period),
                ),
                _RecallCard(bands: data.stats.recall),
                _MasteredCard(weeks: data.stats.mastered),
                _StudyDaysCard(stats: data.stats),
              ],
            ),
            // A read of the device's own data: nothing to wait on shown.
            _ => const SizedBox.shrink(),
          },
        ),
      ],
    );
  }
}

/// A chart on the surface: its [title], an optional [trailing] line or
/// [control] beside it, and the [content] under them.
class _StatsCard extends StatelessWidget {
  const _StatsCard({
    required this.title,
    required this.content,
    this.trailing,
    this.control,
  });

  final String title;
  final String? trailing;

  /// What the chart follows, beside its heading, or under it where both do
  /// not fit.
  final Widget? control;
  final List<Widget> content;

  @override
  Widget build(BuildContext context) {
    final colors = AppColors.of(context);
    final trailing = this.trailing;
    final control = this.control;
    final heading = Semantics(
      header: true,
      child: Text(title, style: AppType.label.copyWith(color: colors.ink)),
    );
    return DecoratedBox(
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(AppRadius.previous),
      ),
      child: Padding(
        padding: const EdgeInsets.all(AppSpace.s16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          spacing: AppSpace.s12,
          children: [
            if (control != null)
              Wrap(
                alignment: WrapAlignment.spaceBetween,
                crossAxisAlignment: WrapCrossAlignment.center,
                spacing: AppSpace.s12,
                runSpacing: AppSpace.s8,
                children: [heading, control],
              )
            else
              Row(
                crossAxisAlignment: CrossAxisAlignment.baseline,
                textBaseline: TextBaseline.alphabetic,
                spacing: AppSpace.s8,
                children: [
                  Expanded(child: heading),
                  if (trailing != null)
                    Text(
                      trailing,
                      style: AppType.caption.copyWith(color: colors.ink2),
                    ),
                ],
              ),
            ...content,
          ],
        ),
      ),
    );
  }
}

/// A share as whole percent.
int _percent(double share) => (share * 100).round();

/// The calendar date the study day starting at [day] starts on, written for
/// [context]'s locale.
String _date(BuildContext context, DateTime day, UtcOffsetAt zone) {
  final wall = day.toUtc().add(zone(day));
  return DateFormat.MMMd(Localizations.localeOf(context).toLanguageTag())
      .format(DateTime(wall.year, wall.month, wall.day));
}

/// 7일, 30일 and 전체, the periods the retention is read over.
class _PeriodChoice extends StatelessWidget {
  const _PeriodChoice({required this.period, required this.onChanged});

  final StatsPeriod period;
  final ValueChanged<StatsPeriod> onChanged;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Semantics(
      container: true,
      label: l10n.statsPeriod,
      child: SegmentedButton<StatsPeriod>(
        showSelectedIcon: false,
        style: SegmentedButton.styleFrom(
          textStyle: AppType.section,
          padding: const EdgeInsets.symmetric(horizontal: AppSpace.s12),
          minimumSize: const Size(AppSize.tapTarget, AppSize.tapTarget),
        ),
        segments: [
          ButtonSegment(
            value: StatsPeriod.week,
            label: Text(l10n.statsPeriodWeek),
          ),
          ButtonSegment(
            value: StatsPeriod.month,
            label: Text(l10n.statsPeriodMonth),
          ),
          ButtonSegment(
            value: StatsPeriod.all,
            label: Text(l10n.statsPeriodAll),
          ),
        ],
        selected: {period},
        onSelectionChanged: (selected) => onChanged(selected.single),
      ),
    );
  }
}

/// The retention over [period]: its value against the target with the gap,
/// and a line of each study day's share against the dashed target.
class _RetentionCard extends StatelessWidget {
  const _RetentionCard({
    required this.read,
    required this.period,
    required this.onPeriod,
  });

  final _Read read;
  final StatsPeriod period;
  final ValueChanged<StatsPeriod> onPeriod;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    final choice = _PeriodChoice(period: period, onChanged: onPeriod);
    final zone = read.zone;
    final days = retentionIn(
      read.stats.retention,
      period,
      read.now,
      offsetAt: zone,
    );
    final total = retentionOver(days);
    final target = _percent(targetRetention);
    if (total == null) {
      return _StatsCard(
        title: l10n.retentionTitle,
        control: choice,
        content: [
          Text(
            keepWords(l10n.retentionEmpty),
            semanticsLabel: l10n.retentionEmpty,
            style: AppType.secondary.copyWith(color: colors.ink2),
          ),
        ],
      );
    }
    final value = _percent(total.share);
    final gap = value - target;
    final today = studyDayStart(read.now, zone);
    // Each study day's place from the period's first day, today last.
    final first = period.start(read.now, offsetAt: zone) ?? days.first.day;
    final index = <DateTime, int>{};
    var day = today;
    final span = <DateTime>[day];
    while (day.isAfter(first)) {
      day = studyDayBefore(day, zone);
      span.add(day);
    }
    for (final (position, start) in span.reversed.indexed) {
      index[start] = position;
    }
    final points = [
      for (final (:day, :retention) in days)
        (x: index[day] ?? 0, share: retention.share),
    ];
    final quiet = AppType.caption.copyWith(color: colors.muted);
    return _StatsCard(
      title: l10n.retentionTitle,
      control: choice,
      content: [
        // The gap sits at the right, or under the figures where both do not
        // fit.
        Wrap(
          alignment: WrapAlignment.spaceBetween,
          crossAxisAlignment: WrapCrossAlignment.end,
          spacing: AppSpace.s16,
          runSpacing: AppSpace.s8,
          children: [
            // The target is named once, on the chart's dashed line.
            Text(
              l10n.retentionPercent(value),
              style: AppType.figure.copyWith(color: colors.ink),
            ),
            Padding(
              padding: const EdgeInsets.only(bottom: AppSpace.s8),
              child: AppChip(
                tone: gap < 0 ? AppChipTone.amber : AppChipTone.brand,
                label: gap < 0
                    ? l10n.retentionBelow(-gap)
                    : gap > 0
                    ? l10n.retentionAbove(gap)
                    : l10n.retentionOnTarget,
              ),
            ),
          ],
        ),
        Semantics(
          container: true,
          image: true,
          label: l10n.retentionSemantics(
            target,
            [
              for (final (:day, :retention) in days)
                l10n.retentionDay(
                  _date(context, day, zone),
                  _percent(retention.share),
                ),
            ].join(', '),
          ),
          excludeSemantics: true,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            spacing: AppSpace.s4,
            children: [
              _RetentionChart(
                points: points,
                span: span.length,
                targetLabel: l10n.retentionTargetLine(target),
              ),
              Padding(
                padding: const EdgeInsets.only(
                  left: StatsStyle.scaleWidth + AppSpace.s8,
                ),
                child: Row(
                  children: [
                    Text(switch (period.days) {
                      final days? => l10n.retentionDaysAgo(days),
                      null => _date(context, first, zone),
                    }, style: quiet),
                    const Spacer(),
                    Text(l10n.statsToday, style: quiet),
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

/// A line through each of [points], placed by its day from the first of
/// [span] days and by its share, over a scale from at most
/// [StatsStyle.retentionFloor] to 1, both ends labelled at its left, with the
/// target dashed across it and named [targetLabel] in a row above the plot,
/// where no line passes (issue #155).
class _RetentionChart extends StatelessWidget {
  const _RetentionChart({
    required this.points,
    required this.span,
    required this.targetLabel,
  });

  final List<({int x, double share})> points;
  final int span;
  final String targetLabel;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    final lowest = points.map((point) => point.share).reduce(min);
    final floor = min(StatsStyle.retentionFloor, (lowest * 10).floor() / 10);
    final scale = AppType.micro.copyWith(color: colors.muted);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      spacing: AppSpace.s4,
      children: [
        Align(
          alignment: Alignment.centerRight,
          child: Text(
            targetLabel,
            style: AppType.micro.copyWith(
              color: colors.onKnowTint,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
        SizedBox(
          height: StatsStyle.retentionHeight,
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            spacing: AppSpace.s8,
            children: [
              SizedBox(
                width: StatsStyle.scaleWidth,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(l10n.retentionPercent(100), style: scale),
                    Text(
                      l10n.retentionPercent((floor * 100).round()),
                      style: scale,
                    ),
                  ],
                ),
              ),
              Expanded(
                child: CustomPaint(
                  painter: _RetentionPainter(
                    points: points,
                    span: span,
                    floor: floor,
                    grid: colors.hairline,
                    target: colors.know,
                    line: colors.accent,
                    area: colors.brandTint,
                    ring: colors.surface,
                  ),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _RetentionPainter extends CustomPainter {
  const _RetentionPainter({
    required this.points,
    required this.span,
    required this.floor,
    required this.grid,
    required this.target,
    required this.line,
    required this.area,
    required this.ring,
  });

  final List<({int x, double share})> points;
  final int span;
  final double floor;
  final Color grid;
  final Color target;
  final Color line;
  final Color area;
  final Color ring;

  @override
  void paint(Canvas canvas, Size size) {
    double y(double share) => size.height * (1 - share) / (1 - floor);
    double x(int day) => span <= 1 ? size.width : size.width * day / (span - 1);

    final gridPaint = Paint()..color = grid;
    for (final share in [1.0, (1 + floor) / 2, floor]) {
      canvas.drawLine(
        Offset(0, y(share)),
        Offset(size.width, y(share)),
        gridPaint,
      );
    }

    final targetPaint = Paint()
      ..color = target
      ..strokeWidth = StatsStyle.bandGap;
    final targetY = y(targetRetention);
    for (
      var start = 0.0;
      start < size.width;
      start += 2 * StatsStyle.targetDash
    ) {
      canvas.drawLine(
        Offset(start, targetY),
        Offset(min(start + StatsStyle.targetDash, size.width), targetY),
        targetPaint,
      );
    }

    final offsets = [
      for (final point in points) Offset(x(point.x), y(point.share)),
    ];
    final path = Path()..addPolygon(offsets, false);
    if (offsets.length > 1) {
      final fill = Path()..moveTo(offsets.first.dx, size.height);
      for (final offset in offsets) {
        fill.lineTo(offset.dx, offset.dy);
      }
      fill
        ..lineTo(offsets.last.dx, size.height)
        ..close();
      canvas.drawPath(fill, Paint()..color = area);
      canvas.drawPath(
        path,
        Paint()
          ..color = line
          ..style = PaintingStyle.stroke
          ..strokeWidth = StatsStyle.retentionLine
          ..strokeJoin = StrokeJoin.round
          ..strokeCap = StrokeCap.round,
      );
    }
    canvas
      ..drawCircle(offsets.last, StatsStyle.retentionDot, Paint()..color = ring)
      ..drawCircle(
        offsets.last,
        StatsStyle.retentionDot - StatsStyle.retentionDotRing,
        Paint()..color = line,
      );
  }

  @override
  bool shouldRepaint(_RetentionPainter old) =>
      !listEquals(old.points, points) ||
      old.span != span ||
      old.floor != floor ||
      old.grid != grid ||
      old.target != target ||
      old.line != line ||
      old.area != area ||
      old.ring != ring;
}

/// The recall bands now: one bar of the three bands' shares, their counts,
/// and the mean.
class _RecallCard extends StatelessWidget {
  const _RecallCard({required this.bands});

  final RecallBands bands;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    final mean = bands.mean;
    if (mean == null) {
      return _StatsCard(
        title: l10n.recallTitle,
        content: [
          Text(
            keepWords(l10n.recallEmpty),
            semanticsLabel: l10n.recallEmpty,
            style: AppType.secondary.copyWith(color: colors.ink2),
          ),
        ],
      );
    }
    final (strong, fair, fading) = StatsStyle.bands(colors);
    final shares = [
      (count: bands.strong, colour: strong, name: l10n.recallStrong),
      (count: bands.fair, colour: fair, name: l10n.recallFair),
      (count: bands.fading, colour: fading, name: l10n.recallFading),
    ];
    return _StatsCard(
      title: l10n.recallTitle,
      trailing: l10n.recallMean(_percent(mean)),
      content: [
        Semantics(
          container: true,
          image: true,
          label: l10n.recallSemantics(
            bands.strong + bands.fair + bands.fading,
            bands.strong,
            bands.fair,
            bands.fading,
            _percent(mean),
          ),
          excludeSemantics: true,
          child: ClipRRect(
            borderRadius: BorderRadius.circular(StatsStyle.recallHeight),
            child: SizedBox(
              height: StatsStyle.recallHeight,
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                spacing: StatsStyle.bandGap,
                children: [
                  for (final share in shares)
                    if (share.count > 0)
                      Expanded(
                        flex: share.count,
                        child: ColoredBox(color: share.colour),
                      ),
                ],
              ),
            ),
          ),
        ),
        ExcludeSemantics(
          child: Row(
            spacing: AppSpace.s8,
            children: [
              for (final share in shares)
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    spacing: AppSpace.s4,
                    children: [
                      Row(
                        spacing: AppSpace.s4,
                        children: [
                          DecoratedBox(
                            decoration: BoxDecoration(
                              color: share.colour,
                              borderRadius: BorderRadius.circular(
                                StatsStyle.bandGap,
                              ),
                            ),
                            child: const SizedBox.square(
                              dimension: StatsStyle.swatch,
                            ),
                          ),
                          Flexible(
                            child: Text(
                              share.name,
                              style: AppType.caption.copyWith(
                                color: colors.ink2,
                              ),
                            ),
                          ),
                        ],
                      ),
                      Text(
                        l10n.statsCards(share.count),
                        style: AppType.label.copyWith(color: colors.ink),
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

/// The mastered cards now as the figure, then at the end of each of the last
/// eight weeks, this week's in ink, the first and the last week named under
/// them, with the gain since the first of them beside the heading.
class _MasteredCard extends StatelessWidget {
  const _MasteredCard({required this.weeks});

  final List<int> weeks;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    final most = weeks.reduce(max);
    final gain = masteredGain(weeks);
    final quiet = AppType.caption.copyWith(color: colors.muted);
    if (most == 0) {
      return _StatsCard(
        title: l10n.masteredTitle,
        content: [
          Text(
            keepWords(l10n.masteredEmpty),
            semanticsLabel: l10n.masteredEmpty,
            style: AppType.secondary.copyWith(color: colors.ink2),
          ),
        ],
      );
    }
    return _StatsCard(
      title: l10n.masteredTitle,
      trailing: gain == null ? null : l10n.masteredGain(weeks.length - 1, gain),
      content: [
        Text(
          l10n.statsCards(weeks.last),
          style: AppType.figure.copyWith(color: colors.ink),
        ),
        Semantics(
          container: true,
          image: true,
          label: l10n.masteredSemantics(
            [for (final count in weeks) l10n.statsCards(count)].join(', '),
          ),
          excludeSemantics: true,
          child: SizedBox(
            height: StatsStyle.masteredHeight,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              spacing: AppSpace.s8,
              children: [
                for (final (index, count) in weeks.indexed)
                  Expanded(
                    child: DecoratedBox(
                      decoration: BoxDecoration(
                        color: index == weeks.length - 1
                            ? colors.accent
                            : colors.chartQuiet,
                        borderRadius: BorderRadius.circular(AppSpace.s4),
                      ),
                      child: SizedBox(
                        height: StatsStyle.masteredHeight * count / most,
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ),
        // The chart's label names every week; these name its two ends.
        ExcludeSemantics(
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(l10n.masteredWeeksAgo(weeks.length - 1), style: quiet),
              Text(l10n.masteredThisWeek, style: quiet),
            ],
          ),
        ),
      ],
    );
  }
}

/// The last twelve weeks of study days, a column a week and a cell a day,
/// shaded by the cards answered, today's ringed in ink, with the current and
/// the best streak; under them the first day's date, the shades' key and
/// 오늘.
class _StudyDaysCard extends StatelessWidget {
  const _StudyDaysCard({required this.stats});

  final StudyStats stats;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    final days = stats.days;
    final most = days.map((day) => day.cards).reduce(max);
    final shades = StatsStyle.heat(colors);
    final quiet = AppType.caption.copyWith(color: colors.muted);
    final locale = Localizations.localeOf(context).toLanguageTag();
    final studied = [
      for (final (:date, :cards) in days)
        if (cards > 0)
          l10n.studyDay(
            DateFormat.MMMd(locale)
                .format(DateTime(date.year, date.month, date.day)),
            cards,
          ),
    ];
    return _StatsCard(
      title: l10n.studyDaysTitle,
      trailing: l10n.studyDaysStreak(stats.streak, stats.bestStreak),
      content: [
        Semantics(
          container: true,
          image: true,
          label: studied.isEmpty
              ? l10n.studyDaysNone
              : l10n.studyDaysSemantics(studied.length, studied.join(', ')),
          excludeSemantics: true,
          child: Row(
            spacing: StatsStyle.cellGap,
            children: [
              for (var week = 0; week < days.length ~/ 7; week++)
                Expanded(
                  child: Column(
                    spacing: StatsStyle.cellGap,
                    children: [
                      for (var day = 0; day < 7; day++)
                        AspectRatio(
                          aspectRatio: 1,
                          child: DecoratedBox(
                            decoration: BoxDecoration(
                              color:
                                  shades[heatLevel(
                                    days[week * 7 + day].cards,
                                    most,
                                  )],
                              borderRadius: BorderRadius.circular(
                                StatsStyle.cellRadius,
                              ),
                              // Today, the grid's last cell.
                              border: week * 7 + day == days.length - 1
                                  ? Border.all(
                                      color: colors.ink,
                                      width: StatsStyle.todayRing,
                                    )
                                  : null,
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
            ],
          ),
        ),
        // The label above reads every study day by its date; these place the
        // grid in time and key its shades for the eye.
        ExcludeSemantics(
          child: Wrap(
            alignment: WrapAlignment.spaceBetween,
            crossAxisAlignment: WrapCrossAlignment.center,
            spacing: AppSpace.s8,
            runSpacing: AppSpace.s4,
            children: [
              Text(
                DateFormat.MMMd(locale).format(
                  DateTime(
                    days.first.date.year,
                    days.first.date.month,
                    days.first.date.day,
                  ),
                ),
                style: quiet,
              ),
              Row(
                mainAxisSize: MainAxisSize.min,
                spacing: AppSpace.s4,
                children: [
                  Text(l10n.studyDaysFewer, style: quiet),
                  for (final shade in shades)
                    DecoratedBox(
                      decoration: BoxDecoration(
                        color: shade,
                        borderRadius: BorderRadius.circular(
                          StatsStyle.cellRadius / 2,
                        ),
                      ),
                      child: const SizedBox.square(
                        dimension: StatsStyle.swatch + AppSpace.s4,
                      ),
                    ),
                  Text(l10n.studyDaysMore, style: quiet),
                ],
              ),
              Text(l10n.dayToday, style: quiet),
            ],
          ),
        ),
      ],
    );
  }
}
