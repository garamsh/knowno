import 'dart:async';
import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart' show DateFormat;
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
import 'new_deck.dart';
import 'streak_days.dart';

/// 홈, one screen: the sky, with the app's name, the profile button and the
/// day's words, over a hill on the ground, with the mascot on its crest; on
/// the ground the streak over the last seven study days and the one action.
/// Before the first deck the same screen says how to start. The profile
/// button opens 설정 through [onSettings]; a deck opens in the 노트 tab
/// through [onOpenDeck], and [onNotes] shows that tab.
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
    return switch ((ref.watch(decksProvider), ref.watch(cardCountsProvider))) {
      (AsyncData(value: final decks), AsyncData(value: final counts)) =>
        switch (DeckSelection.of([for (final deck in decks) deck.id])) {
          null => _Home(
            face: _firstRun(context, ref),
            cards: false,
            onSettings: onSettings,
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
                ground: switch (overview) {
                  _ when cardless => null,
                  TodayOverview(:final streak, :final week, :final count) =>
                    StreakDays(
                      streak: streak,
                      week: week,
                      done: count.total == 0,
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

  /// Before the first deck: "첫 노트를 만들어 볼까요?", "새 노트 만들기" and,
  /// with sharing, the public decks.
  _Face _firstRun(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final sharing = ref.watch(sharingServiceProvider);
    return _Face(
      mascot: MascotExpression.thinking,
      title: l10n.emptyHomeTitle,
      actions: [
        AppButton(
          label: l10n.newDeckTitle,
          size: AppButtonSize.cta,
          onPressed: () => openNewDeck(context, onOpenDeck),
        ),
        if (sharing != null)
          AppButton(
            label: l10n.browsePublicDecks,
            variant: AppButtonVariant.secondary,
            size: AppButtonSize.cta,
            onPressed: () => Navigator.of(aboveMenu(context)).push(
              MaterialPageRoute<void>(builder: (_) => sharing.browseScreen()),
            ),
          ),
      ],
    );
  }

  /// The sky's words and the action for [overview]: today's cards, the
  /// backlog, or the day done; none while it is read, and only the action
  /// while it cannot be.
  _Face? _face(
    BuildContext context,
    TodayOverviewRead overview,
    DeckSelection all,
  ) {
    final l10n = AppLocalizations.of(context);
    void study() => unawaited(openStudy(aboveMenu(context), all));
    AppButton start({bool done = false}) => AppButton(
      label: done ? l10n.todayStudy : l10n.homeStart,
      variant: done ? AppButtonVariant.secondary : AppButtonVariant.primary,
      size: AppButtonSize.cta,
      onPressed: study,
    );
    return switch (overview) {
      TodayOverview(count: TodayCounted(total: 0), :final week) => _Face(
        mascot: MascotExpression.sleepy,
        eyebrow: l10n.dayToday,
        title: l10n.todayDone,
        figure: true,
        // The cards done today, or, where none was due, the next review.
        line: switch (week.last.cards) {
          0 => _nextReview(context, overview),
          final cards => l10n.homeCards(cards),
        },
        actions: [start(done: true)],
      ),
      TodayOverview(count: TodayCounted(backlog: true, :final total)) => _Face(
        mascot: MascotExpression.thinking,
        title: l10n.backlogTitle,
        line: l10n.backlogBody(total),
        actions: [start()],
      ),
      TodayOverview(:final count) => _Face(
        mascot: MascotExpression.thinking,
        eyebrow: l10n.dayToday,
        title: l10n.homeCards(count.total),
        figure: true,
        line: l10n.homeMinutes(count.minutes),
        actions: [start()],
      ),
      OverviewUnavailable() => _Face(
        mascot: MascotExpression.thinking,
        actions: [start()],
      ),
      OverviewPending() => null,
    };
  }

  /// While no deck holds a card: add cards to the one deck, or, with more,
  /// show the 노트 tab to choose one.
  _Face _cardless(BuildContext context, List<Deck> decks) {
    final l10n = AppLocalizations.of(context);
    final (action, onAction) = switch (decks) {
      [final deck] => (l10n.newCard, () => onOpenDeck(deck, addingCard: true)),
      _ => (l10n.addCardsInDecks, onNotes),
    };
    return _Face(
      mascot: MascotExpression.thinking,
      title: l10n.noCardsTitle,
      actions: [
        AppButton(label: action, size: AppButtonSize.cta, onPressed: onAction),
      ],
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

/// What 홈 says: the [mascot], and in the sky [eyebrow] over [title], large
/// as a figure while [figure], over [line]; on the ground the [actions].
final class _Face {
  const _Face({
    required this.mascot,
    this.eyebrow,
    this.title,
    this.figure = false,
    this.line,
    required this.actions,
  });

  final MascotExpression mascot;
  final String? eyebrow;
  final String? title;
  final bool figure;
  final String? line;
  final List<Widget> actions;
}

/// The app's name, read as the screen's heading.
class _AppName extends StatelessWidget {
  const _AppName({required this.color});

  final Color color;

  @override
  Widget build(BuildContext context) => Semantics(
    header: true,
    child: Text(
      AppLocalizations.of(context).appTitle,
      style: AppType.title.copyWith(color: color),
    ),
  );
}

/// 홈's one screen: the sky, up behind the status bar, about [_skyShare] of
/// the screen, its foot a hill on the ground with the mascot on its crest;
/// on the ground [ground], the streak or why the day cannot be read, over
/// the [face]'s actions. Where the words need more than the screen, at a
/// large text size, the page scrolls rather than cut a word.
class _Home extends StatelessWidget {
  const _Home({
    required this.face,
    required this.cards,
    this.ground,
    required this.onSettings,
  });

  final _Face? face;

  /// Whether any deck holds a card, before which the first-run step waits.
  final bool cards;
  final Widget? ground;
  final VoidCallback onSettings;

  /// How much of the screen the sky takes where the ground leaves it room.
  static const _skyShare = 0.58;

  @override
  Widget build(BuildContext context) {
    final colors = AppColors.of(context);
    final face = this.face;
    final sky = _Sky(
      face: face,
      top: [
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
      ],
    );
    final below = Padding(
      padding: const EdgeInsets.fromLTRB(
        AppSpace.gutter,
        AppSpace.s4,
        AppSpace.gutter,
        AppSpace.s16,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        spacing: AppSpace.s16,
        children: [
          Expanded(child: Center(child: ground)),
          ...?face?.actions,
        ],
      ),
    );
    // The sky is drawn under the status bar, whose glyphs are light on it.
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: AppStatusBar.over(Brightness.dark),
      child: Scaffold(
        backgroundColor: colors.ground,
        body: LayoutBuilder(
          builder: (context, constraints) => SingleChildScrollView(
            child: _SkyOverGround(
              viewport: constraints.maxHeight,
              sky: MediaQuery.sizeOf(context).height * _skyShare,
              children: [sky, below],
            ),
          ),
        ),
      ),
    );
  }
}

/// The sky: [top] under the status bar, then the [face]'s words centred in
/// what the mascot leaves, the mascot on the crest of the hill at its foot.
class _Sky extends StatelessWidget {
  const _Sky({required this.face, required this.top});

  final _Face? face;
  final List<Widget> top;

  /// How high the hill's crest rises above the sky's foot at its sides.
  static const _hill = AppSpace.s32;

  /// How far the mascot's box reaches below the crest, where its feet stand.
  static const _sink = AppSpace.s8;

  @override
  Widget build(BuildContext context) {
    final colors = AppColors.of(context);
    final face = this.face;
    final eyebrow = face?.eyebrow;
    final title = face?.title;
    final line = face?.line;
    Widget words(String text, TextStyle style, {bool header = false}) =>
        Semantics(
          header: header,
          child: Text(
            keepWords(text),
            semanticsLabel: text,
            textAlign: TextAlign.center,
            style: style.copyWith(color: colors.onHero),
          ),
        );
    return DecoratedBox(
      decoration: ShapeDecoration(
        color: colors.hero,
        shape: const _SkyShape(hill: _hill),
      ),
      child: Stack(
        children: [
          Padding(
            padding: EdgeInsets.fromLTRB(
              AppSpace.gutter,
              MediaQuery.paddingOf(context).top + AppSpace.s12,
              AppSpace.gutter,
              AppSize.mascotHero + _hill - _sink,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                ...top,
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: AppSpace.s4),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      spacing: AppSpace.s4,
                      children: [
                        if (eyebrow != null) words(eyebrow, AppType.label),
                        if (title != null)
                          words(
                            title,
                            face!.figure ? AppType.heroFigure : AppType.title,
                            header: true,
                          ),
                        if (line != null) words(line, AppType.bodyStrong),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
          // Nothing else is drawn at its upper right, where the assistant's
          // bubble is to go (#721).
          Positioned(
            left: 0,
            right: 0,
            bottom: _hill - _sink,
            child: Center(
              child: Mascot(
                expression: face?.mascot ?? MascotExpression.thinking,
                size: AppSize.mascotHero,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// The sky's shape: a box whose foot is a hill [hill] high at its centre, a
/// quadratic curve from either side, the ground under it.
class _SkyShape extends ShapeBorder {
  const _SkyShape({required this.hill});

  final double hill;

  @override
  EdgeInsetsGeometry get dimensions => EdgeInsets.zero;

  @override
  Path getOuterPath(Rect rect, {TextDirection? textDirection}) => Path()
    ..moveTo(rect.left, rect.top)
    ..lineTo(rect.right, rect.top)
    ..lineTo(rect.right, rect.bottom)
    // A quadratic's peak is half its control point's height.
    ..quadraticBezierTo(
      rect.center.dx,
      rect.bottom - 2 * hill,
      rect.left,
      rect.bottom,
    )
    ..close();

  @override
  Path getInnerPath(Rect rect, {TextDirection? textDirection}) =>
      getOuterPath(rect, textDirection: textDirection);

  @override
  void paint(Canvas canvas, Rect rect, {TextDirection? textDirection}) {}

  @override
  ShapeBorder scale(double t) => _SkyShape(hill: hill * t);
}

/// The sky over the ground in a [viewport] high: the sky [sky] high where the
/// ground's content leaves it room, shorter down to its own content where
/// not, and the ground the rest; both grow past the viewport, which then
/// scrolls, rather than cut their content.
class _SkyOverGround extends MultiChildRenderObjectWidget {
  const _SkyOverGround({
    required this.viewport,
    required this.sky,
    required super.children,
  });

  final double viewport;
  final double sky;

  @override
  RenderObject createRenderObject(BuildContext context) =>
      _RenderSkyOverGround(viewport, sky);

  @override
  void updateRenderObject(
    BuildContext context,
    _RenderSkyOverGround renderObject,
  ) => renderObject
    ..viewport = viewport
    ..sky = sky;
}

class _SkyOverGroundData extends ContainerBoxParentData<RenderBox> {}

class _RenderSkyOverGround extends RenderBox
    with
        ContainerRenderObjectMixin<RenderBox, _SkyOverGroundData>,
        RenderBoxContainerDefaultsMixin<RenderBox, _SkyOverGroundData> {
  _RenderSkyOverGround(this._viewport, this._sky);

  double _viewport;
  set viewport(double value) {
    if (value == _viewport) return;
    _viewport = value;
    markNeedsLayout();
  }

  double _sky;
  set sky(double value) {
    if (value == _sky) return;
    _sky = value;
    markNeedsLayout();
  }

  @override
  void setupParentData(RenderBox child) {
    if (child.parentData is! _SkyOverGroundData) {
      child.parentData = _SkyOverGroundData();
    }
  }

  @override
  void performLayout() {
    final width = constraints.maxWidth;
    final sky = firstChild!;
    final ground = childAfter(sky)!;
    final groundNeeds = ground.getMinIntrinsicHeight(width);
    final skyHeight = max(
      sky.getMinIntrinsicHeight(width),
      min(_sky, _viewport - groundNeeds),
    );
    final groundHeight = max(groundNeeds, _viewport - skyHeight);
    sky.layout(BoxConstraints.tightFor(width: width, height: skyHeight));
    ground.layout(BoxConstraints.tightFor(width: width, height: groundHeight));
    (ground.parentData! as _SkyOverGroundData).offset = Offset(0, skyHeight);
    size = constraints.constrain(Size(width, skyHeight + groundHeight));
  }

  @override
  void paint(PaintingContext context, Offset offset) =>
      defaultPaint(context, offset);

  @override
  bool hitTestChildren(BoxHitTestResult result, {required Offset position}) =>
      defaultHitTestChildren(result, position: position);
}

/// Why today's count cannot be read, in the streak's place.
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
