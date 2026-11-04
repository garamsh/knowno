import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/scheduler.dart';
import 'package:flutter/services.dart';
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
import 'week_card.dart';

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
                  TodayOverview(:final streak, :final week) when !cardless =>
                    WeekCard(streak: streak, week: week),
                  _ => null,
                },
                problem: switch (overview) {
                  OverviewUnavailable(:final message) when !cardless =>
                    _ProblemRow(message: message),
                  _ => null,
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
        bar: l10n.homeTodayBar(count.total, count.minutes),
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
/// [figure], then [line], and the one [action]. Collapsed, the hero says
/// [bar] beside the action, or, without one, the [title].
final class _Face {
  const _Face({
    required this.mascot,
    this.title,
    this.figure = false,
    this.line,
    this.bar,
    required this.action,
    required this.onAction,
  });

  final MascotExpression mascot;
  final String? title;
  final bool figure;
  final String? line;
  final String? bar;
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
/// the week card. At rest the hero fills the first screen but for [below]'s
/// top edge, [_peek] high, and grows past it rather than cut a word; it runs
/// up behind the status bar, its content in the safe area. Scrolled, the
/// hero shrinks into a slim pinned bar with the action, [below] going up
/// beneath it, and a release part way collapses or expands it fully (#728).
/// Why the day cannot be read, [problem], is in the hero under its action,
/// so it is on the first screen.
class _Home extends StatefulWidget {
  const _Home({
    required this.face,
    required this.cards,
    required this.below,
    required this.problem,
    required this.onSettings,
  });

  final _Face? face;

  /// Whether any deck holds a card, before which the first-run step waits.
  final bool cards;
  final Widget? below;
  final Widget? problem;
  final VoidCallback onSettings;

  /// How much of [below] the first screen shows: its top edge, so that the
  /// page reads as one that scrolls.
  static const _peek = AppSpace.s16;

  /// The space between the hero and [below].
  static const _gap = AppSpace.s16;

  @override
  State<_Home> createState() => _HomeState();
}

class _HomeState extends State<_Home> {
  final _scroll = ScrollController();

  /// The hero's height at rest, as its content last laid out; null until
  /// then.
  double? _rest;

  /// The hero as last built, which a release settles.
  _HeroHeader? _header;

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  /// Whether the scroll under way started from the user's drag.
  var _dragged = false;

  /// Collapses or expands the hero fully where a scroll the user started
  /// ended part way, by whichever end is nearer.
  bool _settle(ScrollNotification notification) {
    switch (notification) {
      case ScrollStartNotification(:final dragDetails):
        _dragged = dragDetails != null;
        return false;
      case ScrollEndNotification() when _dragged:
        _dragged = false;
      case _:
        return false;
    }
    final header = _header;
    if (header == null) return false;
    final instant = MediaQuery.disableAnimationsOf(context);
    // Moving the position from inside its own end notification would
    // replace the activity that is still ending.
    scheduleMicrotask(() {
      if (!mounted || !_scroll.hasClients) return;
      final position = _scroll.position;
      if (position.isScrollingNotifier.value) return;
      final from = header.excess;
      final to = math.min(header.collapsed, position.maxScrollExtent);
      final at = position.pixels;
      if (at <= from || at >= to) return;
      final target = at - from < (to - from) / 2 ? from : to;
      if (instant) {
        position.jumpTo(target);
      } else {
        unawaited(
          position.animateTo(
            target,
            duration: const Duration(milliseconds: 200),
            curve: Curves.easeOut,
          ),
        );
      }
    });
    return false;
  }

  @override
  Widget build(BuildContext context) {
    final face = widget.face;
    final below = widget.below;
    return PrimaryScrollController(
      controller: _scroll,
      child: Scaffold(
        body: LayoutBuilder(
          builder: (context, constraints) {
            final screen = constraints.maxHeight;
            final fill = below == null
                ? screen
                : screen - _Home._gap - _Home._peek;
            final header = _header = _HeroHeader(
              fill: fill,
              maxExtent: math.max(fill, _rest ?? 0),
              minExtent: math.min(
                fill,
                MediaQuery.paddingOf(context).top +
                    _CollapsedBar.height(context),
              ),
              content: _Measured(
                onHeight: (height) {
                  if (mounted && height != _rest) {
                    setState(() => _rest = height);
                  }
                },
                child: _HeroContent(
                  fill: fill,
                  face: face,
                  problem: widget.problem,
                  onSettings: widget.onSettings,
                ),
              ),
              bar: face == null ? null : _CollapsedBar(face: face),
            );
            return Stack(
              fit: StackFit.expand,
              children: [
                // The first-run step asks for the minutes once a day with
                // cards shows.
                if (face != null && widget.cards) const FirstDailyMinutes(),
                NotificationListener<ScrollNotification>(
                  onNotification: _settle,
                  child: CustomScrollView(
                    primary: true,
                    slivers: [
                      SliverPersistentHeader(pinned: true, delegate: header),
                      if (below != null)
                        SliverToBoxAdapter(
                          // Room for the hero to collapse fully however short
                          // what is under it.
                          child: ConstrainedBox(
                            constraints: BoxConstraints(
                              minHeight: screen - header.minExtent,
                            ),
                            child: Align(
                              alignment: Alignment.topCenter,
                              child: Padding(
                                padding: const EdgeInsets.fromLTRB(
                                  AppSpace.gutter,
                                  _Home._gap,
                                  AppSpace.gutter,
                                  AppSpace.s12,
                                ),
                                child: below,
                              ),
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}

/// The hero as a pinned header, from [maxExtent] at rest to [minExtent], the
/// collapsed bar under the status bar. Where the content is taller than the
/// first screen, [fill], the part past it scrolls as a page does before the
/// hero starts to shrink.
final class _HeroHeader extends SliverPersistentHeaderDelegate {
  const _HeroHeader({
    required this.fill,
    required this.maxExtent,
    required this.minExtent,
    required this.content,
    required this.bar,
  });

  final double fill;
  @override
  final double maxExtent;
  @override
  final double minExtent;
  final Widget content;
  final Widget? bar;

  /// How far the page scrolls before the hero shrinks.
  double get excess => maxExtent - fill;

  /// How far the page scrolls to collapse the hero fully.
  double get collapsed => maxExtent - minExtent;

  /// Past this share of the collapse the bar is the hero's to read and press.
  static const _swap = 0.5;

  @override
  Widget build(BuildContext context, double shrinkOffset, bool _) {
    final colors = AppColors.of(context);
    final follow = math.min(shrinkOffset, excess);
    final travel = fill - minExtent;
    final t = switch (shrinkOffset) {
      _ when travel <= 0 => 0.0,
      // Within rounding of the whole way, so the bar alone is drawn there.
      final offset when offset >= collapsed - precisionErrorTolerance => 1.0,
      final offset => ((offset - follow) / travel).clamp(0.0, 1.0),
    };
    final bar = this.bar;
    const foot = BorderRadius.vertical(
      bottom: Radius.circular(AppRadius.sheet),
    );
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: AppStatusBar.over(Brightness.dark),
      child: DecoratedBox(
        decoration: BoxDecoration(color: colors.hero, borderRadius: foot),
        child: ClipRRect(
          borderRadius: foot,
          child: Stack(
            children: [
              // Laid out at its own height, past the hero's while it
              // shrinks, so that nothing in it moves but as it is told.
              if (t < 1)
                Positioned(
                  top: -follow,
                  left: 0,
                  right: 0,
                  child: IgnorePointer(
                    ignoring: t >= _swap,
                    child: ExcludeSemantics(
                      excluding: t >= _swap,
                      child: _Collapse(
                        t: t,
                        // The face stays centred in the hero as it shrinks.
                        rise: (shrinkOffset - follow) / 2,
                        child: content,
                      ),
                    ),
                  ),
                ),
              if (bar != null && t > 0)
                Positioned(
                  top: 0,
                  left: 0,
                  right: 0,
                  child: IgnorePointer(
                    ignoring: t < _swap,
                    child: ExcludeSemantics(
                      excluding: t < _swap,
                      child: Opacity(
                        opacity: ((t - _swap) / (1 - _swap)).clamp(0.0, 1.0),
                        child: Padding(
                          padding: EdgeInsets.only(
                            top: MediaQuery.paddingOf(context).top,
                          ),
                          child: bar,
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

  @override
  bool shouldRebuild(_HeroHeader oldDelegate) => true;
}

/// How far the hero has collapsed, 0 at rest and 1 as the bar, and how far
/// its face has risen with it, for the hero's parts to follow.
class _Collapse extends InheritedWidget {
  const _Collapse({required this.t, required this.rise, required super.child});

  final double t;
  final double rise;

  static _Collapse? _of(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<_Collapse>();

  /// [t], 0 outside a collapsing hero.
  static double tOf(BuildContext context) => _of(context)?.t ?? 0;

  /// [rise], 0 outside a collapsing hero.
  static double riseOf(BuildContext context) => _of(context)?.rise ?? 0;

  /// 1 at rest, falling to 0 as [t] reaches [end].
  static double fadeBy(BuildContext context, double end) =>
      1 - (tOf(context) / end).clamp(0.0, 1.0);

  @override
  bool updateShouldNotify(_Collapse oldWidget) =>
      t != oldWidget.t || rise != oldWidget.rise;
}

/// The hero at rest, at least [fill] high and taller where its words need
/// it: the app's name and the profile button, in the safe area, over the
/// face, centred in what they leave, and [problem].
class _HeroContent extends StatelessWidget {
  const _HeroContent({
    required this.fill,
    required this.face,
    required this.problem,
    required this.onSettings,
  });

  final double fill;
  final _Face? face;
  final Widget? problem;
  final VoidCallback onSettings;

  @override
  Widget build(BuildContext context) {
    final colors = AppColors.of(context);
    final problem = this.problem;
    return ConstrainedBox(
      constraints: BoxConstraints(minHeight: fill),
      child: IntrinsicHeight(
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
              Opacity(
                opacity: _Collapse.fadeBy(context, 0.5),
                child: Row(
                  spacing: AppSpace.s8,
                  children: [
                    Expanded(child: _AppName(color: colors.onHero)),
                    ProfileButton(onPressed: onSettings, onHero: true),
                  ],
                ),
              ),
              Expanded(child: _Hero(face: face)),
              if (problem != null)
                Opacity(
                  opacity: _Collapse.fadeBy(context, 0.4),
                  child: problem,
                ),
            ],
          ),
        ),
      ),
    );
  }
}

/// The hero's face in its space: the mascot at [AppSize.mascotHero] over the
/// words and the action, the group centred. As the hero collapses the group
/// rises with its centre, the mascot shrinking and fading first, the line
/// and the action fading, and the title shrinking and then fading as the
/// bar comes in.
class _Hero extends StatelessWidget {
  const _Hero({required this.face});

  final _Face? face;

  /// The space between the mascot and the words, and around the group.
  static const _gap = AppSpace.s8;

  @override
  Widget build(BuildContext context) {
    final colors = AppColors.of(context);
    final face = this.face;
    final title = face?.title;
    final line = face?.line;
    final t = _Collapse.tOf(context);
    final fading = _Collapse.fadeBy(context, 0.4);
    return Transform.translate(
      offset: Offset(0, -_Collapse.riseOf(context)),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: _gap),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          spacing: _gap,
          children: [
            Opacity(
              opacity: _Collapse.fadeBy(context, 0.6),
              child: Transform.scale(
                scale: 1 - t / 2,
                child: Mascot(
                  expression: face?.mascot ?? MascotExpression.thinking,
                  size: AppSize.mascotHero,
                ),
              ),
            ),
            Column(
              mainAxisSize: MainAxisSize.min,
              spacing: AppSpace.s8,
              children: [
                if (title != null)
                  Opacity(
                    opacity: 1 - ((t - 0.3) / 0.4).clamp(0.0, 1.0),
                    child: Transform.scale(
                      scale: 1 - t * 0.4,
                      child: Semantics(
                        header: true,
                        child: Text(
                          keepWords(title),
                          semanticsLabel: title,
                          textAlign: TextAlign.center,
                          style:
                              (face!.figure
                                      ? AppType.heroFigure
                                      : AppType.title)
                                  .copyWith(color: colors.onHero),
                        ),
                      ),
                    ),
                  ),
                if (line != null)
                  Opacity(
                    opacity: fading,
                    child: Text(
                      keepWords(line),
                      semanticsLabel: line,
                      textAlign: TextAlign.center,
                      style: AppType.bodyStrong.copyWith(color: colors.onHero),
                    ),
                  ),
                if (face != null) ...[
                  const SizedBox(height: AppSpace.s8),
                  Opacity(
                    opacity: fading,
                    child: ConstrainedBox(
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
                  ),
                ],
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// The hero collapsed: the day in a line, or its title, and the action at
/// the header size, in a top bar's height with room under it for the
/// action's edge.
class _CollapsedBar extends StatelessWidget {
  const _CollapsedBar({required this.face});

  final _Face face;

  /// The bar's height, the safe area left out.
  static double height(BuildContext context) =>
      AppButton.barHeight(context) + AppSpace.s4;

  @override
  Widget build(BuildContext context) {
    final colors = AppColors.of(context);
    final text = face.bar ?? face.title;
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpace.s4),
      child: SizedBox(
        height: AppButton.barHeight(context),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: AppSpace.gutter),
          child: Row(
            spacing: AppSpace.s12,
            children: [
              Expanded(
                child: text == null
                    ? const SizedBox.shrink()
                    // One line, shrunk to the bar only where it is wider.
                    : FittedBox(
                        fit: BoxFit.scaleDown,
                        alignment: AlignmentDirectional.centerStart,
                        child: Text(
                          text,
                          maxLines: 1,
                          style: AppType.headline.copyWith(
                            color: colors.onHero,
                          ),
                        ),
                      ),
              ),
              AppButton(
                label: face.action,
                variant: AppButtonVariant.onHero,
                size: AppButtonSize.header,
                onPressed: face.onAction,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Reports its child's height to [onHeight] after a frame that changed it.
class _Measured extends SingleChildRenderObjectWidget {
  const _Measured({required this.onHeight, required super.child});

  final ValueChanged<double> onHeight;

  @override
  RenderObject createRenderObject(BuildContext context) =>
      _RenderMeasured(onHeight);

  @override
  void updateRenderObject(BuildContext context, _RenderMeasured renderObject) =>
      renderObject.onHeight = onHeight;
}

class _RenderMeasured extends RenderProxyBox {
  _RenderMeasured(this.onHeight);

  ValueChanged<double> onHeight;
  double? _reported;

  @override
  void performLayout() {
    super.performLayout();
    final height = size.height;
    if (height == _reported) return;
    _reported = height;
    // A layout cannot change what is built; the next frame takes it.
    SchedulerBinding.instance.addPostFrameCallback((_) {
      if (attached) onHeight(height);
    });
  }
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
