import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart' hide Card;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../deck/deck.dart'
    show DeckFailure, DeckSelection, deckRepositoryProvider, describeFailure;
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
              spacing: AppSpace.s16,
              children: [
                // It governs the retention alone, which comes next.
                _PeriodChoice(
                  period: _period,
                  onChanged: (period) => setState(() => _period = period),
                ),
                _RetentionCard(read: data, period: _period),
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

/// A chart on the surface, raised on its edge: its [title], an optional
/// [trailing] line beside it, and the [content] under them.
class _StatsCard extends StatelessWidget {
  const _StatsCard({required this.title, required this.content, this.trailing});

  final String title;
  final String? trailing;
  final List<Widget> content;

  @override
  Widget build(BuildContext context) {
    final colors = AppColors.of(context);
    final trailing = this.trailing;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(AppRadius.card),
        boxShadow: AppShadow.card(colors),
      ),
      child: Padding(
        padding: const EdgeInsets.all(AppSpace.s16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          spacing: AppSpace.s12,
          children: [
            // The line goes under the heading where both do not fit.
            Wrap(
              alignment: WrapAlignment.spaceBetween,
              crossAxisAlignment: WrapCrossAlignment.end,
              spacing: AppSpace.s8,
              children: [
                Semantics(
                  header: true,
                  child: Text(
                    title,
                    style: AppType.label.copyWith(color: colors.ink),
                  ),
                ),
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

/// 7일, 30일 and 전체, the periods the retention is read over: one segmented
/// control on its edge, the chosen period on the primary fill.
class _PeriodChoice extends StatelessWidget {
  const _PeriodChoice({required this.period, required this.onChanged});

  final StatsPeriod period;
  final ValueChanged<StatsPeriod> onChanged;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    final segments = [
      (StatsPeriod.week, l10n.statsPeriodWeek),
      (StatsPeriod.month, l10n.statsPeriodMonth),
      (StatsPeriod.all, l10n.statsPeriodAll),
    ];
    return Semantics(
      container: true,
      label: l10n.statsPeriod,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: colors.surface,
          borderRadius: BorderRadius.circular(AppRadius.field),
          boxShadow: AppShadow.edge(colors.edge, AppSize.edgeRow),
        ),
        child: Padding(
          padding: const EdgeInsets.all(AppSpace.s4),
          child: Row(
            spacing: AppSpace.s4,
            children: [
              for (final (value, name) in segments)
                Expanded(
                  child: Semantics(
                    button: true,
                    selected: value == period,
                    inMutuallyExclusiveGroup: true,
                    child: Material(
                      color: value == period ? colors.primary : colors.surface,
                      borderRadius: BorderRadius.circular(AppRadius.chip),
                      child: InkWell(
                        borderRadius: BorderRadius.circular(AppRadius.chip),
                        splashFactory: NoSplash.splashFactory,
                        onTap: () => onChanged(value),
                        child: ConstrainedBox(
                          // Android's least tap target, as the
                          // segmented button this replaced had.
                          constraints: const BoxConstraints(
                            minHeight: kMinInteractiveDimension,
                          ),
                          child: Center(
                            child: Text(
                              name,
                              textAlign: TextAlign.center,
                              style: AppType.label.copyWith(
                                color: value == period
                                    ? colors.onPrimary
                                    : colors.ink2,
                              ),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

/// A figure with [pill] beside it, or under it where both do not fit.
class _Figure extends StatelessWidget {
  const _Figure({required this.value, required this.pill});

  final String value;
  final Widget? pill;

  @override
  Widget build(BuildContext context) {
    final pill = this.pill;
    return Wrap(
      crossAxisAlignment: WrapCrossAlignment.center,
      spacing: AppSpace.s12,
      runSpacing: AppSpace.s8,
      children: [
        Text(
          value,
          style: AppType.figure.copyWith(color: AppColors.of(context).ink),
        ),
        ?pill,
      ],
    );
  }
}

/// A round pill beside a figure: a gain on the green tint, or a
/// [shortfall] on the amber.
class _Pill extends StatelessWidget {
  const _Pill({required this.label, this.shortfall = false});

  final String label;
  final bool shortfall;

  @override
  Widget build(BuildContext context) {
    final colors = AppColors.of(context);
    return DecoratedBox(
      decoration: ShapeDecoration(
        color: shortfall ? colors.tintAmber : colors.tintGreen,
        shape: const StadiumBorder(),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpace.s12,
          vertical: AppSpace.s4,
        ),
        child: Text(
          label,
          style: AppType.section.copyWith(
            color: shortfall ? colors.ink : colors.onKnowTint,
          ),
        ),
      ),
    );
  }
}

/// The retention over [period]: its value against the target with the gap,
/// and a line of each study day's share against the dashed target.
class _RetentionCard extends StatelessWidget {
  const _RetentionCard({required this.read, required this.period});

  final _Read read;
  final StatsPeriod period;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
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
    final quiet = AppType.caption.copyWith(color: colors.ink2);
    return _StatsCard(
      title: l10n.retentionTitle,
      content: [
        _Figure(
          value: l10n.retentionPercent(value),
          pill: _Pill(
            shortfall: gap < 0,
            label: gap < 0
                ? l10n.retentionBelow(-gap)
                : gap > 0
                ? l10n.retentionAbove(gap)
                : l10n.retentionOnTarget,
          ),
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
              // Only the axis's ends are named, on two lines where one
              // does not hold both.
              Wrap(
                alignment: WrapAlignment.spaceBetween,
                spacing: AppSpace.s8,
                children: [
                  Text(switch (period.days) {
                    final days? => l10n.retentionDaysAgo(days),
                    null => _date(context, first, zone),
                  }, style: quiet),
                  Text(l10n.statsToday, style: quiet),
                ],
              ),
            ],
          ),
        ),
      ],
    );
  }
}

/// A line through each of [points], placed by its day from the first of
/// [span] days and by its share, over a soft fill, on a scale from at most
/// [StatsStyle.retentionFloor] to 1, with the target dashed across it and
/// named [targetLabel] on its line at the left, and today ringed.
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
    final colors = AppColors.of(context);
    final lowest = points.map((point) => point.share).reduce(min);
    final floor = min(StatsStyle.retentionFloor, (lowest * 10).floor() / 10);
    final targetY =
        StatsStyle.retentionHeight * (1 - targetRetention) / (1 - floor);
    return SizedBox(
      height: StatsStyle.retentionHeight,
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          Positioned.fill(
            child: CustomPaint(
              painter: _RetentionPainter(
                points: points,
                span: span,
                floor: floor,
                target: colors.ink2,
                line: colors.accent,
                ring: colors.surface,
              ),
            ),
          ),
          // On the dashed line, its middle on the line's.
          Positioned(
            left: 0,
            top: targetY,
            child: FractionalTranslation(
              translation: const Offset(0, -0.5),
              child: ColoredBox(
                color: colors.surface,
                child: Padding(
                  padding: const EdgeInsets.only(right: AppSpace.s4),
                  child: Text(
                    targetLabel,
                    style: AppType.micro.copyWith(
                      color: colors.ink2,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _RetentionPainter extends CustomPainter {
  const _RetentionPainter({
    required this.points,
    required this.span,
    required this.floor,
    required this.target,
    required this.line,
    required this.ring,
  });

  final List<({int x, double share})> points;
  final int span;
  final double floor;
  final Color target;
  final Color line;
  final Color ring;

  @override
  void paint(Canvas canvas, Size size) {
    double y(double share) => size.height * (1 - share) / (1 - floor);
    double x(int day) => span <= 1 ? size.width : size.width * day / (span - 1);

    final offsets = [
      for (final point in points) Offset(x(point.x), y(point.share)),
    ];
    if (offsets.length > 1) {
      final fill = Path()..moveTo(offsets.first.dx, size.height);
      for (final offset in offsets) {
        fill.lineTo(offset.dx, offset.dy);
      }
      fill
        ..lineTo(offsets.last.dx, size.height)
        ..close();
      canvas.drawPath(
        fill,
        Paint()..color = line.withValues(alpha: StatsStyle.retentionArea),
      );
    }

    final targetPaint = Paint()
      ..color = target
      ..strokeWidth = StatsStyle.targetLine;
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

    if (offsets.length > 1) {
      canvas.drawPath(
        Path()..addPolygon(offsets, false),
        Paint()
          ..color = line
          ..style = PaintingStyle.stroke
          ..strokeWidth = StatsStyle.retentionLine
          ..strokeJoin = StrokeJoin.round
          ..strokeCap = StrokeCap.round,
      );
    }
    canvas
      ..drawCircle(offsets.last, StatsStyle.todayDot, Paint()..color = ring)
      ..drawCircle(
        offsets.last,
        StatsStyle.todayDot - StatsStyle.todayDotRing / 2,
        Paint()
          ..color = line
          ..style = PaintingStyle.stroke
          ..strokeWidth = StatsStyle.todayDotRing,
      );
  }

  @override
  bool shouldRepaint(_RetentionPainter old) =>
      !listEquals(old.points, points) ||
      old.span != span ||
      old.floor != floor ||
      old.target != target ||
      old.line != line ||
      old.ring != ring;
}

/// The recall bands now: one bar of the three bands' shares, a tile with
/// each band's count, and the mean.
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
                      child: DecoratedBox(
                        decoration: BoxDecoration(
                          color: share.colour,
                          borderRadius: BorderRadius.circular(
                            StatsStyle.bandRadius,
                          ),
                        ),
                      ),
                    ),
              ],
            ),
          ),
        ),
        ExcludeSemantics(
          child: IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              spacing: AppSpace.s8,
              children: [
                for (final share in shares)
                  Expanded(
                    child: DecoratedBox(
                      decoration: BoxDecoration(
                        color: colors.ground,
                        borderRadius: BorderRadius.circular(AppRadius.field),
                      ),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(
                          horizontal: AppSpace.s12,
                          vertical: AppSpace.s8,
                        ),
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
                                      StatsStyle.swatchRadius,
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
                                      fontWeight: FontWeight.w700,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                            // One line, shrunk to the tile where wider.
                            FittedBox(
                              fit: BoxFit.scaleDown,
                              alignment: AlignmentDirectional.centerStart,
                              child: Text(
                                l10n.statsCards(share.count),
                                style: AppType.display.copyWith(
                                  color: colors.ink,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

/// The mastered cards now as the figure with the gain since the first of
/// the last eight weeks beside it, then a bar at the end of each of those
/// weeks, this week's in the accent, the first and the last week named under
/// them.
class _MasteredCard extends StatelessWidget {
  const _MasteredCard({required this.weeks});

  final List<int> weeks;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    final most = weeks.reduce(max);
    final gain = masteredGain(weeks);
    final quiet = AppType.caption.copyWith(color: colors.ink2);
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
      content: [
        _Figure(
          value: l10n.statsCards(weeks.last),
          pill: gain == null
              ? null
              : _Pill(label: l10n.masteredGain(weeks.length - 1, gain)),
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
                            : colors.heat1,
                        borderRadius: const BorderRadius.vertical(
                          top: Radius.circular(StatsStyle.barTop),
                          bottom: Radius.circular(StatsStyle.barBottom),
                        ),
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
          child: Wrap(
            alignment: WrapAlignment.spaceBetween,
            spacing: AppSpace.s8,
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
/// in four cobalt steps by the cards answered, today's outlined in ink, with
/// the current and the best streak; under them the first day's date, the
/// steps' key and 오늘.
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
    final quiet = AppType.caption.copyWith(color: colors.ink2);
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
    const ring = StatsStyle.todayRing + StatsStyle.todayRingGap;
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
                          child: Stack(
                            clipBehavior: Clip.none,
                            children: [
                              Positioned.fill(
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
                                  ),
                                ),
                              ),
                              // Today, the grid's last cell, outlined
                              // clear of its fill.
                              if (week * 7 + day == days.length - 1)
                                Positioned.fill(
                                  left: -ring,
                                  top: -ring,
                                  right: -ring,
                                  bottom: -ring,
                                  child: DecoratedBox(
                                    key: const Key('studyDaysToday'),
                                    decoration: BoxDecoration(
                                      borderRadius: BorderRadius.circular(
                                        StatsStyle.cellRadius + ring,
                                      ),
                                      border: Border.all(
                                        color: colors.ink,
                                        width: StatsStyle.todayRing,
                                      ),
                                    ),
                                  ),
                                ),
                            ],
                          ),
                        ),
                    ],
                  ),
                ),
            ],
          ),
        ),
        // The label above reads every study day by its date; these place the
        // grid in time and key its steps for the eye.
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
                          StatsStyle.swatchRadius,
                        ),
                      ),
                      child: const SizedBox.square(
                        dimension: StatsStyle.swatch + AppSpace.s4 / 2,
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
