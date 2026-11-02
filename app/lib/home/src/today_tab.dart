import 'dart:async';
import 'dart:math';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../account/account.dart';
import '../../deck/deck.dart';
import '../../design/app_button.dart';
import '../../design/app_chip.dart';
import '../../design/mascot.dart';
import '../../design/streak_flame.dart';
import '../../design/theme.dart';
import '../../design/word_break.dart';
import '../../l10n/app_localizations.dart';
import '../../study/study.dart';
import '../../sync/sync.dart';
import 'deck_screen.dart';
import 'first_run.dart';

/// The 오늘 tab over [decks]: the today card, the last seven study days, and
/// the decks that hold cards for today; in a backlog, the backlog card and the
/// catch-up at an average day's load; once today's cards are done, the done
/// card with 학습하기 and the last seven days. The last seven days open 기록
/// through [onShowRecord]. While no deck holds a card, by
/// [counts], how to start: with one deck, adding cards to it; with more,
/// [onShowDecks], which shows the 노트 tab. Showing a day with cards, it asks for
/// the daily study minutes once ([FirstDailyMinutes]).
class TodayTab extends StatelessWidget {
  const TodayTab({
    super.key,
    required this.decks,
    required this.counts,
    required this.onShowDecks,
    required this.onShowRecord,
  });

  final List<Deck> decks;
  final Map<DeckId, int> counts;
  final VoidCallback onShowDecks;
  final VoidCallback onShowRecord;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final all = DeckSelection.of([for (final deck in decks) deck.id]);
    return Scaffold(
      appBar: AppBar(
        titleSpacing: AppSpace.gutter,
        title: const BrandTitle(),
        actions: const [AccountButton()],
      ),
      body: all == null
          ? const SizedBox.shrink()
          : counts.values.every((count) => count == 0)
          ? _NoCards(decks: decks, onShowDecks: onShowDecks)
          : TodayOverviewReader(
              decks: all,
              builder: (context, overview) => ListView(
                padding: const EdgeInsets.fromLTRB(
                  AppSpace.gutter,
                  AppSpace.s8,
                  AppSpace.gutter,
                  AppSpace.s24,
                ),
                children: switch (overview) {
                  // The first-run step asks for the minutes once a deck has
                  // cards.
                  TodayOverview(count: TodayCounted(total: 0)) => [
                    const FirstDailyMinutes(),
                    _DoneCard(
                      overview: overview,
                      onStudy: () => _study(context, all),
                    ),
                    const SizedBox(height: AppSpace.s12),
                    _LastWeek(overview: overview, onOpen: onShowRecord),
                  ],
                  TodayOverview(count: TodayCounted(backlog: true)) => [
                    const FirstDailyMinutes(),
                    _BacklogCard(
                      overview: overview,
                      onStudy: () => _study(context, all),
                    ),
                    const SizedBox(height: AppSpace.s12),
                    _CatchUp(overview: overview),
                  ],
                  TodayOverview() => [
                    const FirstDailyMinutes(),
                    _TodayCard(
                      overview: overview,
                      onStudy: () => _study(context, all),
                    ),
                    const SizedBox(height: AppSpace.s12),
                    _LastWeek(overview: overview, onOpen: onShowRecord),
                    _TodayDecks(decks: decks),
                  ],
                  OverviewUnavailable(:final message) => [
                    _HeroCard(
                      children: [
                        Text(
                          message,
                          style: AppType.secondary.copyWith(
                            color: AppColors.of(context).muted,
                          ),
                        ),
                        AppButton(
                          label: l10n.studyAll,
                          icon: LucideIcons.play,
                          onPressed: () => _study(context, all),
                        ),
                      ],
                    ),
                  ],
                  // The card's height, so it does not jump.
                  OverviewPending() => [
                    const _HeroCard(
                      children: [
                        SizedBox(height: AppSize.heroSymbol + AppSpace.s40),
                      ],
                    ),
                  ],
                },
              ),
            ),
    );
  }
}

/// How to start while no deck holds a card, the mascot glad of the deck just
/// made: add cards to the one deck; with more decks, go to the 노트 tab to add
/// cards in one of them.
class _NoCards extends StatelessWidget {
  const _NoCards({required this.decks, required this.onShowDecks});

  final List<Deck> decks;
  final VoidCallback onShowDecks;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    void open(Deck deck) => Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => DeckScreen(deck: deck, addingCard: true),
      ),
    );
    return FirstRun(
      mascot: MascotExpression.happy,
      title: l10n.noCardsTitle,
      actions: switch (decks) {
        [final deck] => [
          AppButton(
            label: l10n.newCard,
            icon: LucideIcons.plus,
            size: AppButtonSize.cta,
            onPressed: () => open(deck),
          ),
        ],
        _ => [
          AppButton(
            label: l10n.addCardsInDecks,
            icon: LucideIcons.layers,
            size: AppButtonSize.cta,
            onPressed: onShowDecks,
          ),
        ],
      },
    );
  }
}

void _study(BuildContext context, DeckSelection decks) =>
    unawaited(openStudy(context, decks));

/// The horizontal lockup as the top bar's title, read as the app's name.
class BrandTitle extends StatelessWidget {
  const BrandTitle({super.key});

  @override
  Widget build(BuildContext context) => Semantics(
    header: true,
    image: true,
    label: AppLocalizations.of(context).appTitle,
    child: Image.asset(
      AppBrand.lockup(Theme.of(context).brightness),
      height: AppSize.lockupHeight,
      excludeFromSemantics: true,
    ),
  );
}

/// The account's avatar at the end of a top bar, which opens the settings
/// screen.
class AccountButton extends StatelessWidget {
  const AccountButton({super.key});

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(right: AppSpace.s12),
    child: IconButton(
      tooltip: AppLocalizations.of(context).account,
      icon: const AccountAvatar(size: AppSize.smallAvatar),
      onPressed: () => Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => const AccountScreen(
            syncStatus: SyncStatusView(),
            studySettings: [
              DailyMinutesRow(),
              AutoplayAudioRow(),
              PartOfSpeechPresetsRow(),
            ],
          ),
        ),
      ),
    ),
  );
}

/// A white card holding [children], one under another, its accents in ink.
class _HeroCard extends StatelessWidget {
  const _HeroCard({required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final colors = AppColors.of(context);
    return DecoratedBox(
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(AppRadius.card),
        boxShadow: AppShadow.card(colors),
      ),
      child: Padding(
        padding: const EdgeInsets.all(AppSpace.s20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          spacing: AppSpace.s16,
          children: children,
        ),
      ),
    );
  }
}

/// Today's cards over every deck on the white card: "오늘 할 카드" with the
/// streak, the cards done over the day's cards with their minutes, a bar of
/// them, the cards studied past the day's plan, and 모두 학습. No line
/// restates the figures and the bar.
class _TodayCard extends StatelessWidget {
  const _TodayCard({required this.overview, required this.onStudy});

  final TodayOverview overview;
  final VoidCallback onStudy;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    final quiet = AppType.secondary.copyWith(color: colors.muted);
    final TodayOverview(:count, :goal, :streak) = overview;
    return _HeroCard(
      children: [
        // A wrap, so a long streak at a large text size goes under the title.
        Wrap(
          spacing: AppSpace.s8,
          runSpacing: AppSpace.s8,
          alignment: WrapAlignment.spaceBetween,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            Text(l10n.todayTitle, style: quiet),
            if (streak > 0) _StreakChip(days: streak),
          ],
        ),
        Wrap(
          spacing: AppSpace.s8,
          alignment: WrapAlignment.spaceBetween,
          crossAxisAlignment: WrapCrossAlignment.end,
          children: [
            // The bar under it reads the same figures.
            ExcludeSemantics(
              child: Text.rich(
                TextSpan(
                  children: [
                    TextSpan(text: '${goal.done}', style: AppType.figure),
                    TextSpan(
                      text: l10n.todayOfGoal(goal.goal),
                      style: AppType.headline.copyWith(color: colors.muted),
                    ),
                  ],
                ),
                style: TextStyle(color: colors.ink),
              ),
            ),
            Text(
              goal.done == 0
                  ? l10n.todayAbout(count.minutes)
                  : l10n.todayAboutLeft(count.minutes),
              style: quiet,
            ),
          ],
        ),
        // A node of its own, so the card's text is not read as the bar.
        Semantics(
          container: true,
          child: LinearProgressIndicator(
            value: goal.goal == 0 ? 0 : goal.done / goal.goal,
            semanticsLabel: l10n.todayProgress(goal.goal, goal.done),
            minHeight: AppSpace.s8,
            borderRadius: BorderRadius.circular(AppSpace.s8),
            color: colors.accent,
            backgroundColor: colors.edge,
          ),
        ),
        if (overview.extra > 0)
          Align(
            alignment: Alignment.centerLeft,
            child: _ExtraPill(count: overview.extra),
          ),
        AppButton(
          label: l10n.studyAll,
          icon: LucideIcons.play,
          onPressed: onStudy,
        ),
      ],
    );
  }
}

/// In a backlog of reviews, on the white card: the mascot, that the
/// user can pick up again, how many reviews are overdue and that new cards
/// pause, and 모두 학습. The button names no count, so the catch-up's daily
/// pace is the one plan for today the screen states.
class _BacklogCard extends StatelessWidget {
  const _BacklogCard({required this.overview, required this.onStudy});

  final TodayOverview overview;
  final VoidCallback onStudy;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    final count = overview.count;
    return _HeroCard(
      children: [
        Row(
          spacing: AppSpace.s16,
          children: [
            const Mascot(
              expression: MascotExpression.thinking,
              size: AppSize.mascotGuide,
            ),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                spacing: AppSpace.s4,
                children: [
                  Semantics(
                    header: true,
                    child: Text(l10n.backlogTitle, style: AppType.headline),
                  ),
                  Text(
                    keepWords(l10n.backlogBody(count.total)),
                    semanticsLabel: l10n.backlogBody(count.total),
                    style: AppType.secondary.copyWith(color: colors.muted),
                  ),
                ],
              ),
            ),
          ],
        ),
        if (overview.streak > 0)
          Align(
            alignment: Alignment.centerLeft,
            child: _StreakChip(days: overview.streak),
          ),
        AppButton(
          label: l10n.studyAll,
          icon: LucideIcons.play,
          onPressed: onStudy,
        ),
      ],
    );
  }
}

/// "n일 연속" after a flame, on the white card or on the done card.
class _StreakChip extends StatelessWidget {
  const _StreakChip({required this.days});

  final int days;

  @override
  Widget build(BuildContext context) => AppChip(
    leading: StreakFlame(days: days, size: AppSpace.s16),
    label: AppLocalizations.of(context).streakDays(days),
  );
}

/// "오늘 n장 더 했어요": the cards studied past the day's plan, which its goal
/// never counts.
class _ExtraPill extends StatelessWidget {
  const _ExtraPill({required this.count});

  final int count;

  @override
  Widget build(BuildContext context) =>
      AppChip(label: AppLocalizations.of(context).todayExtra(count));
}

/// Once today's cards are done, on the white card, so the coral button stands
/// alone: the mascot, that the day is done, the next review, the streak and
/// the goal reached, and 학습하기, which goes on past today's cards.
class _DoneCard extends StatelessWidget {
  const _DoneCard({required this.overview, required this.onStudy});

  final TodayOverview overview;
  final VoidCallback onStudy;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    final next = overview.nextReview;
    final locale = Localizations.localeOf(context).toLanguageTag();
    return DecoratedBox(
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(AppRadius.card),
        boxShadow: AppShadow.card(colors),
      ),
      child: Padding(
        padding: const EdgeInsets.all(AppSpace.s24),
        child: Column(
          spacing: AppSpace.s8,
          children: [
            const Mascot(
              expression: MascotExpression.happy,
              size: AppSize.mascotMedium,
            ),
            const SizedBox(height: AppSpace.s4),
            Semantics(
              header: true,
              child: Text(
                l10n.todayDone,
                textAlign: TextAlign.center,
                style: AppType.title,
              ),
            ),
            Text(
              next == null
                  ? l10n.noNextReview
                  : l10n.nextReview(
                      next.after == 1
                          ? l10n.dayTomorrow
                          : DateFormat.EEEE(locale)
                                .format(overview.days[next.after]),
                      next.cards,
                      overview.minutesFor(next.cards),
                    ),
              textAlign: TextAlign.center,
              style: AppType.secondary.copyWith(color: colors.ink2),
            ),
            Wrap(
              spacing: AppSpace.s8,
              runSpacing: AppSpace.s8,
              alignment: WrapAlignment.center,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                if (overview.streak > 0) _StreakChip(days: overview.streak),
                if (overview.goal.reached)
                  AppChip(label: l10n.goalReached(overview.goal.goal)),
                if (overview.extra > 0) _ExtraPill(count: overview.extra),
              ],
            ),
            const SizedBox(height: AppSpace.s8),
            SizedBox(
              width: double.infinity,
              child: AppButton(
                label: l10n.todayStudy,
                icon: LucideIcons.play,
                onPressed: onStudy,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// The labels of the seven days of [overview]: 오늘, 내일, then the weekday.
List<String> _dayLabels(BuildContext context, TodayOverview overview) {
  final l10n = AppLocalizations.of(context);
  final locale = Localizations.localeOf(context).toLanguageTag();
  return [
    for (final (index, day) in overview.days.indexed)
      switch (index) {
        0 => l10n.dayToday,
        1 => l10n.dayTomorrow,
        _ => DateFormat.E(locale).format(day),
      },
  ];
}

/// The last seven study days on a card: the cards answered on each as a bar,
/// today's coral and last, under the heading; a tap opens 기록 through
/// [onOpen].
class _LastWeek extends StatelessWidget {
  const _LastWeek({required this.overview, required this.onOpen});

  final TodayOverview overview;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final locale = Localizations.localeOf(context).toLanguageTag();
    final week = overview.week;
    final cards = week.fold(0, (sum, day) => sum + day.cards);
    final minutes =
        (week.fold(Duration.zero, (sum, day) => sum + day.time).inSeconds / 60)
            .ceil();
    final labels = [
      for (final (index, day) in week.indexed)
        index == week.length - 1
            ? l10n.dayToday
            : DateFormat.E(locale).format(day.date),
    ];
    final summary = l10n.weekSemantics(cards, minutes);
    return Semantics(
      button: true,
      label: [
        summary,
        for (final day in week)
          l10n.dayCount(DateFormat.EEEE(locale).format(day.date), day.cards),
      ].join(', '),
      hint: l10n.weekOpenRecord,
      excludeSemantics: true,
      child: Material(
        type: MaterialType.transparency,
        borderRadius: BorderRadius.circular(AppRadius.previous),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onOpen,
          child: _ChartCard(
            title: l10n.weekTitle,
            chart: _DayBars(
              counts: [for (final day in week) day.cards],
              labels: labels,
              emphasised: week.length - 1,
              semantics: summary,
            ),
          ),
        ),
      ),
    );
  }
}

/// In a backlog: the overdue reviews left at the start of each of the next
/// seven days at an average day's load, today's coral, under how many days
/// that takes at that pace, which the heading alone states.
class _CatchUp extends StatelessWidget {
  const _CatchUp({required this.overview});

  final TodayOverview overview;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final counts = overview.backlogLeft;
    final labels = _dayLabels(context, overview);
    final days = (overview.count.total / overview.load).ceil();
    return _ChartCard(
      title: l10n.catchUpTitle(overview.load, days),
      chart: _DayBars(
        counts: counts,
        labels: labels,
        emphasised: 0,
        semantics: l10n.catchUpSemantics(
          [
            for (final (index, count) in counts.indexed)
              l10n.dayCount(labels[index], count),
          ].join(', '),
        ),
      ),
    );
  }
}

/// A chart on the surface: its [title] over the [chart].
class _ChartCard extends StatelessWidget {
  const _ChartCard({required this.title, required this.chart});

  final String title;
  final Widget chart;

  @override
  Widget build(BuildContext context) {
    final colors = AppColors.of(context);
    return DecoratedBox(
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(AppRadius.previous),
        boxShadow: AppShadow.card(colors),
      ),
      child: Padding(
        padding: const EdgeInsets.all(AppSpace.s16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          spacing: AppSpace.s12,
          children: [
            Semantics(header: true, child: Text(title, style: AppType.label)),
            chart,
          ],
        ),
      ),
    );
  }
}

/// A bar for each of [counts], its count above it and its label under it,
/// the [emphasised] one coral and the others the brand tint, which their
/// counts carry; read as [semantics].
class _DayBars extends StatelessWidget {
  const _DayBars({
    required this.counts,
    required this.labels,
    required this.emphasised,
    required this.semantics,
  });

  final List<int> counts;
  final List<String> labels;
  final int emphasised;
  final String semantics;

  @override
  Widget build(BuildContext context) {
    final colors = AppColors.of(context);
    final most = counts.fold(1, max);
    const barHeight = AppSpace.s40;
    return Semantics(
      container: true,
      label: semantics,
      excludeSemantics: true,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        spacing: AppSpace.s8,
        children: [
          for (final (index, count) in counts.indexed)
            Expanded(
              child: Column(
                spacing: AppSpace.s4,
                children: [
                  // A figure and a label stay on one line, shrunk to the
                  // column only where a large text size is wider than it.
                  FittedBox(
                    fit: BoxFit.scaleDown,
                    child: Text(
                      '$count',
                      style: AppType.micro.copyWith(
                        fontWeight: FontWeight.w700,
                        color: colors.ink2,
                      ),
                    ),
                  ),
                  Container(
                    height: max(
                      AppSpace.s4,
                      (count / most * barHeight).roundToDouble(),
                    ),
                    constraints: const BoxConstraints(
                      maxWidth: AppSpace.s24 - 2,
                    ),
                    decoration: BoxDecoration(
                      color: index == emphasised
                          ? colors.accent
                          : colors.chartOther,
                      borderRadius: BorderRadius.circular(AppSpace.s8 - 2),
                    ),
                  ),
                  FittedBox(
                    fit: BoxFit.scaleDown,
                    child: Text(
                      labels[index],
                      style: AppType.micro.copyWith(color: colors.muted),
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

/// "오늘 할 노트" and a row for each deck with cards left today, which studies
/// that deck.
class _TodayDecks extends StatelessWidget {
  const _TodayDecks({required this.decks});

  final List<Deck> decks;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(
            AppSpace.s4,
            AppSpace.s20,
            AppSpace.s4,
            AppSpace.s8,
          ),
          child: Semantics(
            header: true,
            child: Text(l10n.todayDecks, style: AppType.label),
          ),
        ),
        for (final deck in decks)
          TodayCounter(
            decks: DeckSelection(deck.id),
            builder: (context, count) => switch (count) {
              TodayCounted(:final total) when total > 0 => Padding(
                padding: const EdgeInsets.only(bottom: AppSpace.rowGap),
                child: Semantics(
                  container: true,
                  button: true,
                  label: l10n.studyDeckToday(deck.name, total),
                  onTap: () => _study(context, DeckSelection(deck.id)),
                  excludeSemantics: true,
                  child: Material(
                    color: colors.surface,
                    borderRadius: BorderRadius.circular(AppRadius.row),
                    child: InkWell(
                      borderRadius: BorderRadius.circular(AppRadius.row),
                      excludeFromSemantics: true,
                      onTap: () => _study(context, DeckSelection(deck.id)),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(
                          horizontal: AppSpace.s12,
                          vertical: AppSpace.s8,
                        ),
                        child: Row(
                          spacing: AppSpace.s12,
                          children: [
                            DeckTile(deck: deck),
                            Expanded(
                              child: Text(deck.name, style: AppType.bodyStrong),
                            ),
                            Text(
                              l10n.deckDueCount(total),
                              style: AppType.caption.copyWith(
                                fontWeight: FontWeight.w700,
                                color: colors.ink2,
                              ),
                            ),
                            Icon(LucideIcons.play, color: colors.ink),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              ),
              _ => const SizedBox.shrink(),
            },
          ),
      ],
    );
  }
}
