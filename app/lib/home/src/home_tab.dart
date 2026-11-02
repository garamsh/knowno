import 'dart:async';
import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../deck/deck.dart';
import '../../design/app_button.dart';
import '../../design/app_chip.dart';
import '../../design/app_text_field.dart';
import '../../design/mascot.dart';
import '../../design/theme.dart';
import '../../design/word_break.dart';
import '../../l10n/app_localizations.dart';
import '../../sharing/sharing.dart';
import '../../study/study.dart';
import 'above_menu.dart';
import 'deck_screen.dart';
import 'first_run.dart';
import 'new_deck.dart';
import 'progress_bar.dart';

/// 홈: before the first deck, how to start; then today on the hero surface
/// over a drawer of the decks. Closed, the drawer shows "내 노트 n" and one
/// row, or three while no card is due; pulled up, every deck, with the
/// search, "새 노트" and the public decks.
class HomeTab extends ConsumerStatefulWidget {
  const HomeTab({super.key});

  @override
  ConsumerState<HomeTab> createState() => _HomeTabState();
}

class _HomeTabState extends ConsumerState<HomeTab> {
  var _open = false;

  @override
  Widget build(BuildContext context) {
    final sharing = ref.watch(sharingServiceProvider);
    void browse() => Navigator.of(aboveMenu(context))
        .push(MaterialPageRoute<void>(builder: (_) => sharing!.browseScreen()));
    return switch ((ref.watch(decksProvider), ref.watch(cardCountsProvider))) {
      (AsyncData(value: final decks), AsyncData(value: final counts)) =>
        switch (DeckSelection.of([for (final deck in decks) deck.id])) {
          null => Scaffold(
            appBar: AppBar(
              titleSpacing: AppSpace.gutter,
              title: const _AppName(),
            ),
            body: _FirstRunHome(onBrowse: sharing == null ? null : browse),
          ),
          final all => TodayOverviewReader(
            decks: all,
            builder: (context, overview) => _Home(
              decks: decks,
              counts: counts,
              cards: counts.values.any((count) => count > 0),
              face: counts.values.every((count) => count == 0)
                  ? _cardless(context, decks)
                  : _face(context, overview, all),
              streak: switch (overview) {
                TodayOverview(:final streak) => streak,
                _ => 0,
              },
              problem: switch (overview) {
                OverviewUnavailable(:final message) => message,
                _ => null,
              },
              open: _open,
              onOpen: (open) => setState(() => _open = open),
              onBrowse: sharing == null ? null : browse,
            ),
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
        due: false,
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
  /// more, open the drawer to choose one.
  _Face _cardless(BuildContext context, List<Deck> decks) {
    final l10n = AppLocalizations.of(context);
    final (action, onAction) = switch (decks) {
      [final deck] => (
        l10n.newCard,
        () => Navigator.of(context).push(
          MaterialPageRoute<void>(
            builder: (_) => DeckScreen(deck: deck, addingCard: true),
          ),
        ),
      ),
      _ => (l10n.addCardsInDecks, () => setState(() => _open = true)),
    };
    return _Face(
      mascot: MascotExpression.happy,
      title: l10n.noCardsTitle,
      due: false,
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
/// [figure], then [line], and the one [action]. [due] is false while no card
/// is due today, which opens the drawer higher.
final class _Face {
  const _Face({
    required this.mascot,
    this.title,
    this.figure = false,
    this.line,
    required this.action,
    required this.onAction,
    this.due = true,
  });

  final MascotExpression mascot;
  final String? title;
  final bool figure;
  final String? line;
  final String action;
  final VoidCallback onAction;
  final bool due;
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
/// which opens 새 노트, and, with sharing, the public decks.
class _FirstRunHome extends StatelessWidget {
  const _FirstRunHome({required this.onBrowse});

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
          onPressed: () => openNewDeck(context),
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

/// Today on the hero over the drawer, or, with the drawer [open], the hero in
/// a band over every deck.
class _Home extends StatelessWidget {
  const _Home({
    required this.decks,
    required this.counts,
    required this.face,
    required this.cards,
    required this.streak,
    required this.problem,
    required this.open,
    required this.onOpen,
    required this.onBrowse,
  });

  final List<Deck> decks;
  final Map<DeckId, int> counts;
  final _Face? face;

  /// Whether any deck holds a card, before which the first-run step waits.
  final bool cards;
  final int streak;

  /// Why today's count cannot be read, shown atop the drawer.
  final String? problem;
  final bool open;
  final ValueChanged<bool> onOpen;
  final VoidCallback? onBrowse;

  @override
  Widget build(BuildContext context) {
    final colors = AppColors.of(context);
    final face = this.face;
    final drawer = _Drawer(
      decks: decks,
      counts: counts,
      open: open,
      shut: face == null || face.due ? 1 : 3,
      problem: problem,
      onOpen: onOpen,
      onBrowse: onBrowse,
    );
    return Scaffold(
      backgroundColor: colors.hero,
      body: SafeArea(
        bottom: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // The first-run step asks for the minutes once a day with cards
            // shows.
            if (face != null && cards) const FirstDailyMinutes(),
            if (open) ...[
              _HeroBand(face: face),
              Expanded(child: drawer),
            ] else ...[
              _HeroTop(streak: streak),
              Expanded(child: _Hero(face: face)),
              Flexible(child: drawer),
            ],
          ],
        ),
      ),
    );
  }
}

/// The hero's top bar: the app's name and, while the streak is above zero,
/// "n일 연속" on a card in the accent.
class _HeroTop extends StatelessWidget {
  const _HeroTop({required this.streak});

  final int streak;

  @override
  Widget build(BuildContext context) {
    final colors = AppColors.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        AppSpace.gutter,
        AppSpace.s16,
        AppSpace.gutter,
        0,
      ),
      child: Wrap(
        alignment: WrapAlignment.spaceBetween,
        crossAxisAlignment: WrapCrossAlignment.center,
        spacing: AppSpace.s8,
        runSpacing: AppSpace.s8,
        children: [
          _AppName(color: colors.onHero),
          if (streak > 0) StreakBadge(days: streak),
        ],
      ),
    );
  }
}

/// "n일 연속" on the surface over its edge, in the accent.
class StreakBadge extends StatelessWidget {
  const StreakBadge({super.key, required this.days});

  final int days;

  @override
  Widget build(BuildContext context) {
    final colors = AppColors.of(context);
    return DecoratedBox(
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(AppRadius.chip),
        boxShadow: AppShadow.edge(colors.edge, AppSize.edgeRow),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpace.s12,
          vertical: AppSpace.s4,
        ),
        child: Text(
          AppLocalizations.of(context).streakDays(days),
          style: AppType.label.copyWith(color: colors.accent),
        ),
      ),
    );
  }
}

/// The hero's face, centred in its space and scrolled where a large text
/// size makes it taller: the mascot, the words, and the action.
class _Hero extends StatelessWidget {
  const _Hero({required this.face});

  final _Face? face;

  @override
  Widget build(BuildContext context) {
    final colors = AppColors.of(context);
    final face = this.face;
    final title = face?.title;
    final line = face?.line;
    return LayoutBuilder(
      builder: (context, constraints) => SingleChildScrollView(
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpace.gutter,
          vertical: AppSpace.s16,
        ),
        child: ConstrainedBox(
          constraints: BoxConstraints(
            minHeight: max(0, constraints.maxHeight - AppSpace.s32),
          ),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            spacing: AppSpace.s8,
            children: [
              Mascot(
                expression: face?.mascot ?? MascotExpression.thinking,
                size: AppSize.mascotHero,
              ),
              if (title != null)
                Semantics(
                  header: true,
                  child: Text(
                    keepWords(title),
                    semanticsLabel: title,
                    textAlign: TextAlign.center,
                    style: (face!.figure ? AppType.heroFigure : AppType.display)
                        .copyWith(color: colors.onHero),
                  ),
                ),
              if (line != null)
                Text(
                  keepWords(line),
                  semanticsLabel: line,
                  textAlign: TextAlign.center,
                  style: AppType.headline.copyWith(color: colors.onHero),
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
        ),
      ),
    );
  }
}

/// The hero in a band over the open drawer: the mascot small, the words, and
/// the action.
class _HeroBand extends StatelessWidget {
  const _HeroBand({required this.face});

  final _Face? face;

  @override
  Widget build(BuildContext context) {
    final colors = AppColors.of(context);
    final face = this.face;
    final title = face?.title;
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        AppSpace.gutter,
        AppSpace.s16,
        AppSpace.gutter,
        AppSpace.s20,
      ),
      child: Row(
        spacing: AppSpace.s12,
        children: [
          Mascot(
            expression: face?.mascot ?? MascotExpression.thinking,
            size: AppSize.mascotMedium,
          ),
          Expanded(
            child: title == null
                ? const SizedBox.shrink()
                : Text(
                    keepWords(title),
                    semanticsLabel: title,
                    style: AppType.display.copyWith(color: colors.onHero),
                  ),
          ),
          if (face != null)
            Flexible(
              child: AppButton(
                label: face.action,
                variant: AppButtonVariant.onHero,
                onPressed: face.onAction,
              ),
            ),
        ],
      ),
    );
  }
}

/// The decks on the ground, rounded at the top: closed, "내 노트 n" and the
/// first [shut] rows; [open], every deck under the search, "새 노트" and the
/// public decks. A drag up on its head opens it and a drag down closes it; a
/// tap on its handle does either, and on its closed head opens it.
class _Drawer extends StatefulWidget {
  const _Drawer({
    required this.decks,
    required this.counts,
    required this.open,
    required this.shut,
    required this.problem,
    required this.onOpen,
    required this.onBrowse,
  });

  final List<Deck> decks;
  final Map<DeckId, int> counts;
  final bool open;

  /// How many rows the closed drawer shows.
  final int shut;
  final String? problem;
  final ValueChanged<bool> onOpen;
  final VoidCallback? onBrowse;

  @override
  State<_Drawer> createState() => _DrawerState();
}

class _DrawerState extends State<_Drawer> {
  /// The search, or null while its field is closed.
  String? _query;

  /// How far the head was dragged, down positive.
  var _drag = 0.0;

  @override
  void didUpdateWidget(_Drawer old) {
    super.didUpdateWidget(old);
    if (!widget.open) _query = null;
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    final open = widget.open;
    final query = (_query ?? '').trim().toLowerCase();
    final shown = open
        ? [
            for (final deck in widget.decks)
              if (deck.name.toLowerCase().contains(query)) deck,
          ]
        : widget.decks.take(widget.shut).toList();
    final problem = widget.problem;
    final head = GestureDetector(
      behavior: HitTestBehavior.opaque,
      // Closed, a tap anywhere on the head opens it, as its handle does.
      onTap: open ? null : () => widget.onOpen(true),
      onVerticalDragStart: (_) => _drag = 0,
      onVerticalDragUpdate: (details) => _drag += details.delta.dy,
      onVerticalDragEnd: (details) {
        final velocity = details.primaryVelocity ?? 0;
        if (_drag < -AppSpace.s24 || velocity < -300) widget.onOpen(true);
        if (_drag > AppSpace.s24 || velocity > 300) widget.onOpen(false);
      },
      child: Padding(
        padding: const EdgeInsets.fromLTRB(
          AppSpace.gutter,
          AppSpace.s12,
          AppSpace.gutter,
          AppSpace.s8,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          spacing: AppSpace.s12,
          children: [
            Center(
              child: Semantics(
                button: true,
                label: open ? l10n.drawerClose : l10n.drawerOpen,
                onTap: () => widget.onOpen(!open),
                excludeSemantics: true,
                child: GestureDetector(
                  onTap: () => widget.onOpen(!open),
                  child: SizedBox(
                    width: AppSize.tapTarget * 2,
                    height: kMinInteractiveDimension,
                    child: Center(
                      child: DecoratedBox(
                        decoration: BoxDecoration(
                          color: colors.edge,
                          borderRadius: BorderRadius.circular(AppSpace.s4),
                        ),
                        child: const SizedBox(
                          width: AppSize.tapTarget,
                          height: AppSpace.s4,
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
            Wrap(
              alignment: WrapAlignment.spaceBetween,
              crossAxisAlignment: WrapCrossAlignment.center,
              spacing: AppSpace.s8,
              runSpacing: AppSpace.s8,
              children: [
                Semantics(
                  header: true,
                  child: Text(
                    l10n.myDecks(widget.decks.length),
                    style: AppType.headline.copyWith(color: colors.ink),
                  ),
                ),
                if (open)
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    spacing: AppSpace.s8,
                    children: [
                      RaisedIconButton(
                        icon: _query == null
                            ? LucideIcons.search
                            : LucideIcons.x,
                        tooltip: _query == null
                            ? l10n.searchDecks
                            : l10n.closeSearch,
                        onPressed: () =>
                            setState(() => _query = _query == null ? '' : null),
                      ),
                      AppChip.action(
                        label: l10n.newDeck,
                        onPressed: () => openNewDeck(context),
                      ),
                    ],
                  )
                else
                  ExcludeSemantics(
                    child: Text(
                      l10n.drawerOpen,
                      style: AppType.secondary.copyWith(color: colors.ink2),
                    ),
                  ),
              ],
            ),
            if (open && _query != null)
              AppTextField(
                hint: l10n.searchDecks,
                prefixIcon: const Icon(LucideIcons.search),
                height: AppSize.search,
                autofocus: true,
                onChanged: (query) => setState(() => _query = query),
              ),
          ],
        ),
      ),
    );
    final rows = [
      if (problem != null) _ProblemRow(message: problem),
      if (shown.isEmpty && open)
        Padding(
          padding: const EdgeInsets.symmetric(vertical: AppSpace.s32),
          child: Text(
            keepWords(l10n.noDeckMatches),
            semanticsLabel: l10n.noDeckMatches,
            textAlign: TextAlign.center,
            style: AppType.body.copyWith(color: colors.muted),
          ),
        ),
      for (final deck in shown)
        DeckRow(
          deck: deck,
          cardCount: widget.counts[deck.id] ?? 0,
          onOpen: () => Navigator.of(context).push(
            MaterialPageRoute<void>(builder: (_) => DeckScreen(deck: deck)),
          ),
          today: TodayCounter(
            decks: DeckSelection(deck.id),
            builder: (context, count) => TodayChip(count: count),
          ),
          progress: ProgressCounter(
            decks: DeckSelection(deck.id),
            builder: (context, progress) => _DeckProgress(
              progress: progress,
              cardCount: widget.counts[deck.id] ?? 0,
            ),
          ),
        ),
      if (open && widget.onBrowse != null)
        AppButton(
          label: l10n.browsePublicDecks,
          variant: AppButtonVariant.text,
          onPressed: widget.onBrowse,
        ),
    ];
    const padding = EdgeInsets.fromLTRB(
      AppSpace.gutter,
      0,
      AppSpace.gutter,
      AppSpace.s16,
    );
    return DecoratedBox(
      decoration: BoxDecoration(
        color: colors.ground,
        borderRadius: const BorderRadius.vertical(
          top: Radius.circular(AppRadius.sheet),
        ),
      ),
      child: open
          ? Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                head,
                Expanded(
                  child: ListView(padding: padding, children: rows),
                ),
              ],
            )
          // Closed, it takes its rows' height, and at a large text size no
          // more than the hero beside it, its rows scrolling.
          : Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                head,
                Flexible(
                  child: ListView(
                    shrinkWrap: true,
                    padding: padding,
                    children: rows,
                  ),
                ),
              ],
            ),
    );
  }
}

/// Why today's count cannot be read, as a row atop the drawer.
class _ProblemRow extends StatelessWidget {
  const _ProblemRow({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    final colors = AppColors.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpace.rowGap),
      child: DecoratedBox(
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
      ),
    );
  }
}

/// A brand-tint "오늘 n" when a session over the deck would study any card
/// now, and the reason when the count cannot be read.
class TodayChip extends StatelessWidget {
  const TodayChip({super.key, required this.count});

  final TodayCount count;

  @override
  Widget build(BuildContext context) {
    final colors = AppColors.of(context);
    return switch (count) {
      TodayCounted(:final total) when total > 0 => AppChip(
        label: AppLocalizations.of(context).todayChip(total),
        tone: AppChipTone.brand,
      ),
      TodayUnavailable(:final message) => Tooltip(
        message: message,
        child: Icon(
          LucideIcons.circleAlert,
          color: colors.muted,
          semanticLabel: message,
        ),
      ),
      TodayCounted() || TodayPending() => const SizedBox.shrink(),
    };
  }
}

/// A deck row's "n장 중 m장 익힘" over its progress bar, whose label carries
/// the mastered, learning and new counts; "n장" alone while the progress is
/// read, and for a deck with no card, which has nothing to draw.
class _DeckProgress extends StatelessWidget {
  const _DeckProgress({required this.progress, required this.cardCount});

  final DeckProgress? progress;
  final int cardCount;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final quiet = AppType.caption.copyWith(color: AppColors.of(context).muted);
    final progress = this.progress;
    if (progress == null || progress.total == 0) {
      return Text(l10n.deckRowCards(cardCount), style: quiet);
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      spacing: AppSpace.s4,
      children: [
        Text(
          l10n.deckMastered(progress.total, progress.mastered),
          style: quiet,
        ),
        ProgressBar(progress: progress),
      ],
    );
  }
}
