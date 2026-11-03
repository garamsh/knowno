import 'dart:async';
import 'dart:math';
import 'dart:ui' show PathMetric;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../account/account.dart';
import '../../deck/deck.dart';
import '../../design/app_button.dart';
import '../../design/mascot.dart';
import '../../design/theme.dart';
import '../../design/word_break.dart';
import '../../l10n/app_localizations.dart';
import '../../sharing/sharing.dart';
import '../../study/study.dart';
import 'above_menu.dart';
import 'first_run.dart';
import 'new_deck.dart';

/// 홈: before the first deck, how to start; then today on the hero surface,
/// and under it the streak over the last seven study days. The profile button
/// at the top right opens 설정 through [onSettings]; a deck opens in the 노트
/// tab through [onOpenDeck], and [onNotes] shows that tab.
class HomeTab extends ConsumerWidget {
  const HomeTab({
    super.key,
    required this.onOpenDeck,
    required this.onNotes,
    required this.onSettings,
  });

  final OpenDeck onOpenDeck;
  final VoidCallback onNotes;
  final VoidCallback onSettings;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final sharing = ref.watch(sharingServiceProvider);
    return switch ((ref.watch(decksProvider), ref.watch(cardCountsProvider))) {
      (AsyncData(value: final decks), AsyncData(value: final counts)) =>
        switch (DeckSelection.of([for (final deck in decks) deck.id])) {
          null => Scaffold(
            appBar: AppBar(
              toolbarHeight: AppButton.barHeight(context),
              titleSpacing: AppSpace.gutter,
              title: const _AppName(),
              actions: [
                ProfileButton(onPressed: onSettings),
                const SizedBox(width: AppSpace.gutter),
              ],
            ),
            body: _FirstRunHome(
              onNewDeck: () => openNewDeck(context, onOpenDeck),
              onBrowse: sharing == null
                  ? null
                  : () => Navigator.of(aboveMenu(context)).push(
                      MaterialPageRoute<void>(
                        builder: (_) => sharing.browseScreen(),
                      ),
                    ),
            ),
          ),
          final all => TodayOverviewReader(
            decks: all,
            builder: (context, overview) {
              final cardless = counts.values.every((count) => count == 0);
              return _Home(
                face: cardless
                    ? _cardless(context, decks)
                    : _face(context, overview, all),
                cards: !cardless,
                below: switch (overview) {
                  _ when cardless => null,
                  TodayOverview(:final streak, :final week) => _WeekCard(
                    streak: streak,
                    week: week,
                  ),
                  OverviewUnavailable(:final message) => _ProblemRow(
                    message: message,
                  ),
                  OverviewPending() => null,
                },
                onSettings: onSettings,
              );
            },
          ),
        },
      _ => const Scaffold(body: Center(child: CircularProgressIndicator())),
    };
  }

  /// The hero's words and action for [overview]: today's cards, the backlog,
  /// or the day done; none while it is read, and only the action while it
  /// cannot be.
  _Face? _face(
    BuildContext context,
    TodayOverviewRead overview,
    DeckSelection all,
  ) {
    final l10n = AppLocalizations.of(context);
    void study() => unawaited(openStudy(aboveMenu(context), all));
    return switch (overview) {
      TodayOverview(count: TodayCounted(total: 0)) => _Face(
        mascot: MascotExpression.happy,
        title: l10n.todayDone,
        line: _nextReview(context, overview),
        action: l10n.todayStudy,
        onAction: study,
      ),
      TodayOverview(count: TodayCounted(backlog: true, :final total)) => _Face(
        mascot: MascotExpression.thinking,
        title: l10n.backlogTitle,
        line: l10n.backlogBody(total),
        action: l10n.homeStart,
        onAction: study,
      ),
      TodayOverview(:final count) => _Face(
        mascot: MascotExpression.happy,
        title: l10n.homeToday(count.total),
        figure: true,
        line: l10n.homeMinutes(count.minutes),
        action: l10n.homeStart,
        onAction: study,
      ),
      OverviewUnavailable() => _Face(
        mascot: MascotExpression.thinking,
        action: l10n.homeStart,
        onAction: study,
      ),
      OverviewPending() => null,
    };
  }

  /// The hero while no deck holds a card: add cards to the one deck, or, with
  /// more, show the 노트 tab to choose one.
  _Face _cardless(BuildContext context, List<Deck> decks) {
    final l10n = AppLocalizations.of(context);
    final (action, onAction) = switch (decks) {
      [final deck] => (l10n.newCard, () => onOpenDeck(deck, addingCard: true)),
      _ => (l10n.addCardsInDecks, onNotes),
    };
    return _Face(
      mascot: MascotExpression.happy,
      title: l10n.noCardsTitle,
      action: action,
      onAction: onAction,
    );
  }
}

/// "다음 복습은 내일 · n장, 약 m분", or the weekday, or that nothing is due in
/// the next seven days.
String _nextReview(BuildContext context, TodayOverview overview) {
  final l10n = AppLocalizations.of(context);
  final locale = Localizations.localeOf(context).toLanguageTag();
  final next = overview.nextReview;
  if (next == null) return l10n.noNextReview;
  return l10n.nextReview(
    next.after == 1
        ? l10n.dayTomorrow
        : DateFormat.EEEE(locale).format(overview.days[next.after]),
    next.cards,
    overview.minutesFor(next.cards),
  );
}

/// What the hero says: the [mascot] over [title], large as a figure while
/// [figure], then [line], and the one [action].
final class _Face {
  const _Face({
    required this.mascot,
    this.title,
    this.figure = false,
    this.line,
    required this.action,
    required this.onAction,
  });

  final MascotExpression mascot;
  final String? title;
  final bool figure;
  final String? line;
  final String action;
  final VoidCallback onAction;
}

/// The app's name, read as the screen's heading.
class _AppName extends StatelessWidget {
  const _AppName({this.color});

  final Color? color;

  @override
  Widget build(BuildContext context) => Semantics(
    header: true,
    child: Text(
      AppLocalizations.of(context).appTitle,
      style: AppType.title.copyWith(color: color),
    ),
  );
}

/// The first-run home: the mascot, "첫 노트를 만들어 볼까요?", "새 노트 만들기",
/// which [onNewDeck] opens, and, with sharing, the public decks.
class _FirstRunHome extends StatelessWidget {
  const _FirstRunHome({required this.onNewDeck, required this.onBrowse});

  final VoidCallback onNewDeck;
  final VoidCallback? onBrowse;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final onBrowse = this.onBrowse;
    return FirstRun(
      mascot: MascotExpression.thinking,
      title: l10n.emptyHomeTitle,
      actions: [
        AppButton(
          label: l10n.newDeckTitle,
          size: AppButtonSize.cta,
          onPressed: onNewDeck,
        ),
        if (onBrowse != null)
          AppButton(
            label: l10n.browsePublicDecks,
            variant: AppButtonVariant.secondary,
            size: AppButtonSize.cta,
            onPressed: onBrowse,
          ),
      ],
    );
  }
}

/// Today on the hero, rounded at its foot, and [below] it, on the ground,
/// the week card or why the day cannot be read: the hero takes the height
/// [below] leaves, and the page scrolls only where the hero's words leave its
/// mascot less than its floor.
class _Home extends StatelessWidget {
  const _Home({
    required this.face,
    required this.cards,
    required this.below,
    required this.onSettings,
  });

  final _Face? face;

  /// Whether any deck holds a card, before which the first-run step waits.
  final bool cards;
  final Widget? below;
  final VoidCallback onSettings;

  @override
  Widget build(BuildContext context) {
    final colors = AppColors.of(context);
    final face = this.face;
    final below = this.below;
    final hero = DecoratedBox(
      decoration: BoxDecoration(
        color: colors.hero,
        borderRadius: const BorderRadius.vertical(
          bottom: Radius.circular(AppRadius.sheet),
        ),
      ),
      child: Padding(
        padding: EdgeInsets.fromLTRB(
          AppSpace.gutter,
          MediaQuery.paddingOf(context).top + AppSpace.s12,
          AppSpace.gutter,
          AppSpace.s20,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // The first-run step asks for the minutes once a day with cards
            // shows.
            if (face != null && cards) const FirstDailyMinutes(),
            Row(
              spacing: AppSpace.s8,
              children: [
                Expanded(child: _AppName(color: colors.onHero)),
                ProfileButton(onPressed: onSettings, onHero: true),
              ],
            ),
            Expanded(child: _Hero(face: face)),
          ],
        ),
      ),
    );
    return Scaffold(
      body: LayoutBuilder(
        builder: (context, constraints) => SingleChildScrollView(
          child: _HomeFit(
            height: constraints.maxHeight,
            fill: hero,
            below: below == null
                ? const SizedBox.shrink()
                : Padding(
                    padding: const EdgeInsets.fromLTRB(
                      AppSpace.gutter,
                      AppSpace.s16,
                      AppSpace.gutter,
                      AppSpace.s12,
                    ),
                    child: below,
                  ),
          ),
        ),
      ),
    );
  }
}

/// [fill] over [below] in [height]: [below] at its own height, and [fill] in
/// what it leaves, but never shorter than [fill]'s least height, past which
/// the two are taller than [height].
class _HomeFit extends MultiChildRenderObjectWidget {
  _HomeFit({required this.height, required Widget fill, required Widget below})
    : super(children: [fill, below]);

  final double height;

  @override
  _RenderHomeFit createRenderObject(BuildContext context) =>
      _RenderHomeFit(height);

  @override
  void updateRenderObject(BuildContext context, _RenderHomeFit renderObject) =>
      renderObject.height = height;
}

final class _FitData extends ContainerBoxParentData<RenderBox> {}

/// Lays out and paints a fit's children, placed by [performLayout].
abstract class _RenderFit extends RenderBox
    with
        ContainerRenderObjectMixin<RenderBox, _FitData>,
        RenderBoxContainerDefaultsMixin<RenderBox, _FitData> {
  @override
  void setupParentData(RenderBox child) {
    if (child.parentData is! _FitData) child.parentData = _FitData();
  }

  void place(RenderBox child, Offset offset) =>
      (child.parentData! as _FitData).offset = offset;

  @override
  void paint(PaintingContext context, Offset offset) =>
      defaultPaint(context, offset);

  @override
  bool hitTestChildren(BoxHitTestResult result, {required Offset position}) =>
      defaultHitTestChildren(result, position: position);
}

class _RenderHomeFit extends _RenderFit {
  _RenderHomeFit(this._height);

  double _height;
  set height(double value) {
    if (value == _height) return;
    _height = value;
    markNeedsLayout();
  }

  @override
  void performLayout() {
    final fill = firstChild!;
    final below = lastChild!;
    final width = constraints.maxWidth;
    below.layout(BoxConstraints.tightFor(width: width), parentUsesSize: true);
    final height = max(
      _height - below.size.height,
      fill.getMinIntrinsicHeight(width),
    );
    fill.layout(BoxConstraints.tight(Size(width, height)));
    place(fill, Offset.zero);
    place(below, Offset(0, height));
    size = constraints.constrain(Size(width, height + below.size.height));
  }
}

/// The hero's face in its space: the mascot as large as the words leave room
/// for, the group centred.
class _Hero extends StatelessWidget {
  const _Hero({required this.face});

  final _Face? face;

  @override
  Widget build(BuildContext context) {
    final colors = AppColors.of(context);
    final face = this.face;
    final title = face?.title;
    final line = face?.line;
    return _HeroFit(
      mascot: LayoutBuilder(
        builder: (context, constraints) => Mascot(
          expression: face?.mascot ?? MascotExpression.thinking,
          size: constraints.maxWidth,
        ),
      ),
      words: Column(
        mainAxisSize: MainAxisSize.min,
        spacing: AppSpace.s8,
        children: [
          if (title != null)
            Semantics(
              header: true,
              child: Text(
                keepWords(title),
                semanticsLabel: title,
                textAlign: TextAlign.center,
                style: (face!.figure ? AppType.heroFigure : AppType.title)
                    .copyWith(color: colors.onHero),
              ),
            ),
          if (line != null)
            Text(
              keepWords(line),
              semanticsLabel: line,
              textAlign: TextAlign.center,
              style: AppType.bodyStrong.copyWith(color: colors.onHero),
            ),
          if (face != null) ...[
            const SizedBox(height: AppSpace.s8),
            ConstrainedBox(
              constraints: const BoxConstraints(
                minWidth: AppSize.mascotHero + AppSpace.s12,
              ),
              child: AppButton(
                label: face.action,
                variant: AppButtonVariant.onHero,
                size: AppButtonSize.cta,
                onPressed: face.onAction,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// The [mascot] over the [words] in the height it is given: the words at
/// their own size, and the mascot square in what they leave, from
/// [AppSize.mascotHero] down to [AppSize.mascotFloor], the two centred as a
/// group. Its least height is the words under the mascot at that floor.
class _HeroFit extends MultiChildRenderObjectWidget {
  _HeroFit({required Widget mascot, required Widget words})
    : super(children: [mascot, words]);

  @override
  _RenderHeroFit createRenderObject(BuildContext context) => _RenderHeroFit();
}

class _RenderHeroFit extends _RenderFit {
  /// The space between the mascot and the words, and around the group.
  static const _gap = AppSpace.s8;

  double _group(double words, double mascot) => mascot + _gap * 3 + words;

  @override
  double computeMinIntrinsicHeight(double width) =>
      _group(lastChild!.getMinIntrinsicHeight(width), AppSize.mascotFloor);

  @override
  double computeMaxIntrinsicHeight(double width) =>
      _group(lastChild!.getMaxIntrinsicHeight(width), AppSize.mascotHero);

  @override
  double computeMinIntrinsicWidth(double height) =>
      lastChild!.getMinIntrinsicWidth(double.infinity);

  @override
  double computeMaxIntrinsicWidth(double height) =>
      lastChild!.getMaxIntrinsicWidth(double.infinity);

  @override
  void performLayout() {
    final mascot = firstChild!;
    final words = lastChild!;
    final width = constraints.maxWidth;
    words.layout(BoxConstraints.tightFor(width: width), parentUsesSize: true);
    final room = constraints.hasBoundedHeight
        ? constraints.maxHeight
        : constraints.minHeight;
    final side = (room - _group(words.size.height, 0)).clamp(
      AppSize.mascotFloor,
      AppSize.mascotHero,
    );
    mascot.layout(BoxConstraints.tight(Size.square(side)));
    final group = _group(words.size.height, side) - _gap * 2;
    size = constraints.constrain(Size(width, max(room, group + _gap * 2)));
    final top = (size.height - group) / 2;
    place(mascot, Offset((width - side) / 2, top));
    place(words, Offset(0, top + side + _gap));
  }
}

/// "n일 연속", the count in the accent, with the last seven study days'
/// cards at its right, over a bar a day, today's last and in the accent, each
/// under its count and over its weekday. A day with no card is a dashed bar.
class _WeekCard extends StatelessWidget {
  const _WeekCard({required this.streak, required this.week});

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

  @override
  Widget build(BuildContext context) => SizedBox(
    height: height,
    width: double.infinity,
    child: dashed
        ? CustomPaint(painter: _DashedOutline(color))
        : DecoratedBox(
            decoration: BoxDecoration(color: color, borderRadius: _shape),
          ),
  );
}

/// The bar's outline in [color], dashed.
class _DashedOutline extends CustomPainter {
  const _DashedOutline(this.color);

  final Color color;

  static const _line = 2.0;
  static const _dash = AppSpace.s4;

  @override
  void paint(Canvas canvas, Size size) {
    final outline = Path()
      ..addRRect(_Bar._shape.toRRect((Offset.zero & size).deflate(_line / 2)));
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = _line;
    for (final PathMetric metric in outline.computeMetrics()) {
      for (var at = 0.0; at < metric.length; at += _dash * 2) {
        canvas.drawPath(metric.extractPath(at, at + _dash), paint);
      }
    }
  }

  @override
  bool shouldRepaint(_DashedOutline old) => old.color != color;
}

/// Why today's count cannot be read, in the week card's place.
class _ProblemRow extends StatelessWidget {
  const _ProblemRow({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    final colors = AppColors.of(context);
    return DecoratedBox(
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(AppRadius.row),
      ),
      child: Padding(
        padding: const EdgeInsets.all(AppSpace.s16),
        child: Row(
          spacing: AppSpace.s12,
          children: [
            Icon(LucideIcons.circleAlert, color: colors.ink2),
            Expanded(
              child: Text(
                message,
                style: AppType.body.copyWith(color: colors.ink),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
