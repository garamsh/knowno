import 'package:drift/drift.dart' show Value, driftRuntimeOptions;
import 'package:drift/native.dart';
import 'package:flutter/material.dart' hide Card;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/database/database.dart';
import 'package:knowno/deck/deck.dart';
import 'package:knowno/design/theme.dart';
import 'package:knowno/l10n/app_localizations.dart';
import 'package:knowno/l10n/app_localizations_en.dart';
import 'package:knowno/study/src/failure.dart';
import 'package:knowno/study/src/rust/api/engine.dart'
    show EngineError, Quantity;
import 'package:knowno/study/src/stats.dart' show StatsPeriod;
import 'package:knowno/study/src/stats_style.dart';
import 'package:knowno/study/study.dart';

import '../contrast.dart';
import '../word_breaks.dart';

/// 09:00 UTC on Thursday 15 October, five hours into the study day.
final _now = DateTime.utc(2026, 10, 15, 9);

/// Recalls each state at its difficulty over ten, and gives each "Know" a
/// 30-day interval and each "Don't know" one day, so a test sets both.
class _FixedScheduler extends Fake implements Scheduler {
  _FixedScheduler({this.refuse = false});

  final bool refuse;

  @override
  Future<List<CardState>> history(List<ReviewRow> reviews) async => [
    for (final review in reviews)
      CardState(
        stability: 1,
        difficulty: 5,
        lastReview: review.reviewedAt,
        due: review.reviewedAt.add(
          Duration(days: review.rating == 'good' ? 30 : 1),
        ),
      ),
  ];

  @override
  Future<double> retrievability(CardState state, DateTime at) async {
    if (refuse) {
      throw SchedulingFailure(
        EngineError.nonFinite(quantity: Quantity.stability),
      );
    }
    return state.difficulty / 10;
  }
}

/// A deck in an in-memory database whose cards hold [answers], each card's
/// state stored with the difficulty [recall] names for it.
Future<(AppDatabase, DeckRepository, DeckId)> _seed(
  Map<String, List<(String, DateTime)>> answers, {
  Map<String, double> recall = const {},
}) async {
  final db = AppDatabase(NativeDatabase.memory());
  addTearDown(db.close);
  var ids = 0;
  final cards = DeckRepository(
    db,
    clock: () => DateTime.utc(2026, 8, 1),
    newId: () => 'id${ids++}',
  );
  final deck = await cards.createDeck('French');
  for (final MapEntry(key: name, value: given) in answers.entries) {
    final card = switch (await cards.addCard(
      deck.id,
      front: [TextContent(name)],
      back: [TextContent(name)],
    )) {
      CardSaved(:final card) => card.id,
      DuplicateFront() => fail('the setup saved a duplicate'),
    };
    for (final (rating, at) in given) {
      await db
          .into(db.reviews)
          .insert(
            ReviewsCompanion.insert(
              id: 'review${ids++}',
              cardId: card.value,
              rating: rating,
              reviewedAt: at,
              durationMs: 3000,
              fuzzFactor: const Value(0),
              updatedAt: at,
            ),
          );
    }
    if (given.isNotEmpty) {
      await db
          .into(db.cardStates)
          .insert(
            CardStatesCompanion.insert(
              cardId: card.value,
              stability: 5,
              difficulty: (recall[name] ?? 0.9) * 10,
              lastReview: given.last.$2,
              due: given.last.$2.add(const Duration(days: 5)),
              updatedAt: given.last.$2,
            ),
          );
    }
  }
  return (db, cards, deck.id);
}

/// The 기록 view over [seed]'s deck, in the [theme], at a height that shows
/// every card.
Future<void> _pump(
  WidgetTester tester,
  (AppDatabase, DeckRepository, DeckId) seed, {
  ThemeData? theme,
  Scheduler? scheduler,
  Locale locale = const Locale('en'),
}) async {
  final (db, cards, deck) = seed;
  tester.view
    ..physicalSize = const Size(390, 1600)
    ..devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        deckRepositoryProvider.overrideWithValue(cards),
        studyRepositoryProvider.overrideWithValue(
          StudyRepository(db, newId: () => 'unused'),
        ),
        schedulerProvider.overrideWithValue(scheduler ?? _FixedScheduler()),
        studyClockProvider.overrideWithValue(() => _now),
        studyZoneProvider.overrideWithValue((_) => Duration.zero),
      ],
      child: MaterialApp(
        theme: theme ?? lightTheme,
        locale: locale,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(
          body: StatsView(
            decks: DeckSelection(deck),
            title: const Text('Record'),
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

DateTime _at(int month, int day, [int hour = 9]) =>
    DateTime.utc(2026, month, day, hour);

/// Four cards: a and b first answered on 1 September, a's later answers all
/// "Know", b's last one "Don't know" on 13 October; d first answered on
/// 5 October and c today.
final _history = {
  'a': [('good', _at(9, 1)), ('good', _at(10, 1)), ('good', _at(10, 14))],
  'b': [('good', _at(9, 1)), ('good', _at(9, 10)), ('again', _at(10, 13))],
  'c': [('good', _at(10, 15, 8))],
  'd': [('good', _at(10, 5))],
};

const _recall = {'a': 0.96, 'b': 0.8, 'c': 0.78, 'd': 0.95};

String _label(WidgetTester tester, String prefix) {
  final node = tester.getSemantics(
    find.bySemanticsLabel(RegExp('^${RegExp.escape(prefix)}')),
  );
  return node.label;
}

/// The card headed [title], the surface nearest its heading.
Finder _card(String title) => find
    .ancestor(of: find.text(title), matching: find.byType(DecoratedBox))
    .first;

void main() {
  driftRuntimeOptions.dontWarnAboutMultipleDatabases = true;

  testWidgets(
    'in Korean the record speaks plainly: the gap in %, "기억 상태" and its bands, the gain over the chart\'s weeks, and the target named once (#458)',
    (tester) async {
      await _pump(
        tester,
        await _seed(_history, recall: _recall),
        locale: const Locale('ko'),
      );

      expect(find.text('목표보다 23% 낮아요'), findsOneWidget);
      expect(find.textContaining('%p'), findsNothing);
      // The target is named on the chart alone.
      expect(find.textContaining('90%'), findsOneWidget);
      expect(find.text('목표 90%'), findsOneWidget);
      expect(find.text('기억 상태'), findsOneWidget);
      expect(find.text('지금 기억하고 있을 확률'), findsNothing);
      expect(find.text('좋음'), findsOneWidget);
      expect(find.text('단단함'), findsNothing);
      expect(find.text('7주 전'), findsOneWidget);
      expect(find.text('7주 전보다 +3장'), findsOneWidget);
    },
  );

  testWidgets(
    'the retention shows its value, its gap to the 90% target and each day in its label, over 30 days by default, then 7 days and every day',
    (tester) async {
      await _pump(tester, await _seed(_history, recall: _recall));

      // 30 days: a's "Know" on 1 and 14 October, b's "Don't know" on 13.
      expect(find.text('67%'), findsOneWidget);
      expect(find.text('23% below target'), findsOneWidget);
      expect(find.text('30 days ago'), findsOneWidget);
      // The target is named once, on the chart's line, not beside the figure.
      expect(find.text('Target 90%'), findsOneWidget);
      expect(find.text('90%'), findsNothing);
      expect(find.text('Target'), findsNothing);
      expect(
        _label(tester, 'Correct in reviews, target'),
        'Correct in reviews, target 90%: Oct 1 100%, Oct 13 0%, Oct 14 100%',
      );

      await tester.tap(find.text('7 days'));
      await tester.pumpAndSettle();
      expect(find.text('50%'), findsOneWidget);
      expect(find.text('40% below target'), findsOneWidget);
      expect(find.text('7 days ago'), findsOneWidget);
      expect(
        _label(tester, 'Correct in reviews, target'),
        'Correct in reviews, target 90%: Oct 13 0%, Oct 14 100%',
      );

      // Every day: b's "Know" on 10 September too; the left end is that day.
      await tester.tap(find.text('All'));
      await tester.pumpAndSettle();
      expect(find.text('75%'), findsOneWidget);
      expect(find.text('15% below target'), findsOneWidget);
      expect(find.text('Sep 10'), findsOneWidget);
    },
  );

  testWidgets(
    'the retention scale labels its top and its floor, and the target is named above the plot, clear of the line (#155)',
    (tester) async {
      await _pump(tester, await _seed(_history, recall: _recall));

      // Over 30 days the lowest day is 0%, so the scale runs from 0% to 100%.
      final plot = find.byWidgetPredicate(
        (widget) =>
            widget is CustomPaint &&
            widget.painter.runtimeType.toString() == '_RetentionPainter',
      );
      expect(plot, findsOneWidget);
      final rect = tester.getRect(plot);
      final top = tester.getRect(find.text('100%'));
      final floor = tester.getRect(find.text('0%'));
      expect(top.right, lessThanOrEqualTo(rect.left));
      expect(floor.right, lessThanOrEqualTo(rect.left));
      expect(floor.top, greaterThan(top.top));
      expect(
        tester.getRect(find.text('Target 90%')).bottom,
        lessThanOrEqualTo(rect.top),
      );
    },
  );

  testWidgets(
    'the retention says so when its period holds no review, and the gap reads above or on target',
    (tester) async {
      await _pump(
        tester,
        await _seed({
          'a': [('good', _at(9, 1)), ('good', _at(10, 1))],
        }),
      );
      // The figure, and the scale's top.
      expect(find.text('100%'), findsNWidgets(2));
      expect(find.text('10% above target'), findsOneWidget);

      await tester.tap(find.text('7 days'));
      await tester.pumpAndSettle();
      expect(shownText('No reviews in this period.'), findsOneWidget);
      expect(find.text('100%'), findsNothing);
      // The period stays in the card, so another can be chosen.
      expect(
        find.descendant(
          of: _card('Correct in reviews'),
          matching: find.byType(SegmentedButton<StatsPeriod>),
        ),
        findsOneWidget,
      );
    },
  );

  testWidgets(
    'the recall bands show each band\'s count and the mean, and read them in one label',
    (tester) async {
      await _pump(tester, await _seed(_history, recall: _recall));

      expect(find.text('Average 87%'), findsOneWidget);
      expect(
        _label(tester, 'Of '),
        'Of 4 cards: good 2, fair 1, fading soon 1, average 87%',
      );
      expect(find.text('2 cards'), findsOneWidget);
      expect(find.text('1 card'), findsNWidgets(2));
    },
  );

  testWidgets(
    'the period selector sits in the retention card beside its heading, not beside the tab\'s title, and governs the retention alone',
    (tester) async {
      await _pump(tester, await _seed(_history, recall: _recall));

      final selector = find.byType(SegmentedButton<StatsPeriod>);
      expect(selector, findsOneWidget);
      expect(
        find.descendant(of: _card('Correct in reviews'), matching: selector),
        findsOneWidget,
      );
      // Beside the heading: in its row, which puts the selector at the
      // card's right where both fit and under the heading where they do not.
      final row = find
          .ancestor(of: selector, matching: find.byType(Wrap))
          .first;
      expect(
        find.descendant(of: row, matching: find.text('Correct in reviews')),
        findsOneWidget,
      );
      expect(
        tester.getRect(selector).right,
        tester.getRect(_card('Correct in reviews')).right - AppSpace.s16,
      );
      // Control: the tab's title stands alone above the cards.
      expect(
        tester.getRect(find.text('Record')).bottom,
        lessThan(tester.getRect(_card('Correct in reviews')).top),
      );

      // Another period changes the retention, and no other card.
      final mastered = find.descendant(
        of: _card('Mastered cards'),
        matching: find.byType(Text),
      );
      final before = [
        for (final text in tester.widgetList<Text>(mastered)) text.data,
      ];
      await tester.tap(find.text('7 days'));
      await tester.pumpAndSettle();
      expect(find.text('50%'), findsOneWidget);
      expect([
        for (final text in tester.widgetList<Text>(mastered)) text.data,
      ], before);
    },
  );

  testWidgets(
    'the mastered weeks show the cards mastered now as the figure and name the first and the last week under the bars, reading each week\'s count, with the gain since the first of them beside the heading',
    (tester) async {
      await _pump(tester, await _seed(_history, recall: _recall));

      final card = _card('Mastered cards');
      // This week's three, as the figure.
      final figure = tester.widget<Text>(
        find.descendant(of: card, matching: find.text('3 cards')),
      );
      expect(figure.style?.fontSize, AppType.figure.fontSize);
      expect(
        find.descendant(of: card, matching: find.text('7 weeks ago')),
        findsOneWidget,
      );
      expect(
        find.descendant(of: card, matching: find.text('This week')),
        findsOneWidget,
      );
      // The week names sit under the bars, the first at the left.
      expect(
        tester.getRect(find.text('7 weeks ago')).left,
        lessThan(tester.getRect(find.text('This week')).left),
      );

      expect(
        _label(tester, 'Mastered cards by week'),
        'Mastered cards by week, from 7 weeks ago to this week: '
        '0 cards, 2 cards, 2 cards, 2 cards, 2 cards, 2 cards, 3 cards, 3 cards',
      );
      // The gain spans the chart, from its first week, 0, to this week's 3.
      expect(find.text('+3 since 7 weeks ago'), findsOneWidget);
    },
  );

  testWidgets(
    'the first mastered week is named seven weeks ago, the week a card mastered seven weeks before today falls in and one mastered a day later does not',
    (tester) async {
      // Today's study day is 15 October; seven weeks before it, 27 August.
      for (final (day, first) in [(27, 1), (28, 0)]) {
        // A fresh scope, so the second deck's figures are not the first's.
        await tester.pumpWidget(const SizedBox());
        await _pump(
          tester,
          await _seed({
            'chat': [('good', DateTime.utc(2026, 8, day, 9))],
          }),
        );
        expect(
          _label(tester, 'Mastered cards by week'),
          startsWith(
            'Mastered cards by week, from 7 weeks ago to this week: '
            '$first card${first == 1 ? '' : 's'}, 1 card,',
          ),
          reason: 'mastered on $day August',
        );
        expect(
          find.descendant(
            of: _card('Mastered cards'),
            matching: find.text('7 weeks ago'),
          ),
          findsOneWidget,
        );
      }
    },
  );

  testWidgets(
    'the study days read each studied day with its cards, with the current and the best streak, today\'s cell ringed, and the first day\'s date, the shades\' key and today under the grid',
    (tester) async {
      await _pump(tester, await _seed(_history, recall: _recall));

      expect(find.text('3-day streak · best 3'), findsOneWidget);
      final card = _card('Study days');
      // The grid's first day, 84 study days back to 24 July, and today.
      expect(
        find.descendant(of: card, matching: find.text('Jul 24')),
        findsOneWidget,
      );
      expect(
        find.descendant(of: card, matching: find.text('Today')),
        findsOneWidget,
      );
      // The shades' key, palest to darkest between its two words.
      expect(
        find.descendant(of: card, matching: find.text('Fewer')),
        findsOneWidget,
      );
      expect(
        find.descendant(of: card, matching: find.text('More')),
        findsOneWidget,
      );
      // One cell ringed: the last, today's.
      final ringed = find.descendant(
        of: card,
        matching: find.byWidgetPredicate(
          (widget) =>
              widget is DecoratedBox &&
              widget.decoration is BoxDecoration &&
              (widget.decoration as BoxDecoration).border != null,
        ),
      );
      expect(ringed, findsOneWidget);
      final cells = find.descendant(
        of: card,
        matching: find.byType(AspectRatio),
      );
      expect(cells, findsNWidgets(84));
      expect(
        tester.getRect(ringed),
        tester.getRect(
          find.descendant(of: cells.last, matching: find.byType(DecoratedBox)),
        ),
      );
      expect(
        _label(tester, 'Studied on'),
        'Studied on 7 days in the last 12 weeks: Sep 1 2, Sep 10 1, Oct 1 1, '
        'Oct 5 1, Oct 13 1, Oct 14 1, Oct 15 1',
      );
    },
  );

  testWidgets(
    'with nothing studied, each card says so in a sentence or a label',
    (tester) async {
      await _pump(tester, await _seed({'a': []}));

      expect(shownText('No reviews in this period.'), findsOneWidget);
      expect(shownText('No card reviewed yet.'), findsOneWidget);
      expect(find.textContaining('since'), findsNothing);
      expect(shownText('No card mastered yet.'), findsOneWidget);
      expect(
        find.bySemanticsLabel('No study days in the last 12 weeks'),
        findsOneWidget,
      );
      expect(find.text('0-day streak · best 0'), findsOneWidget);
    },
  );

  testWidgets('a refused recall shows the scheduling failure\'s message', (
    tester,
  ) async {
    await _pump(
      tester,
      await _seed(_history, recall: _recall),
      scheduler: _FixedScheduler(refuse: true),
    );

    expect(find.text(AppLocalizationsEn().schedulingFailure), findsOneWidget);
    expect(find.text('Correct in reviews'), findsNothing);
  });

  for (final (name, theme) in [('light', lightTheme), ('dark', darkTheme)]) {
    testWidgets(
      'in the $name theme the view meets the tap target and contrast guidelines',
      (tester) async {
        await _pump(
          tester,
          await _seed(_history, recall: _recall),
          theme: theme,
        );
        expect(find.text('Average 87%'), findsOneWidget);

        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
        expectScreenTextReadable(tester);
      },
    );
  }

  for (final (name, colors) in [
    ('light', AppColors.light),
    ('dark', AppColors.dark),
  ]) {
    test(
      '$name: the recall bands and the quiet week are 3:1 on the surface, and the bands and the heatmap levels differ in lightness by 1.5:1',
      () {
        final surface = colors.surface;
        final (strong, fair, fading) = StatsStyle.bands(colors);
        final bands = [
          for (final band in [strong, fair, fading]) _over(band, surface),
        ];
        for (final mark in [...bands, colors.chartQuiet]) {
          expect(
            _contrast(mark, surface),
            greaterThanOrEqualTo(3),
            reason: '$mark',
          );
        }
        for (var i = 0; i < bands.length; i++) {
          for (var j = i + 1; j < bands.length; j++) {
            expect(
              _contrast(bands[i], bands[j]),
              greaterThanOrEqualTo(1.5),
              reason: 'band $i against band $j',
            );
          }
        }
        final heat = [
          for (final level in StatsStyle.heat(colors)) _over(level, surface),
        ];
        for (var level = 1; level < heat.length; level++) {
          expect(
            _contrast(heat[level - 1], heat[level]),
            greaterThanOrEqualTo(1.5),
            reason: 'level ${level - 1} against $level',
          );
        }
        // Control: the mint fill and the edge, which a chart does not draw
        // in, fail the check, so it can fail.
        expect(_contrast(colors.edge, surface), lessThan(3));
      },
    );
  }
}

/// [colour] drawn over the opaque [ground].
Color _over(Color colour, Color ground) => Color.alphaBlend(colour, ground);

/// The WCAG 2.1 contrast ratio of two opaque colours.
double _contrast(Color a, Color b) {
  final (lighter, darker) = a.computeLuminance() > b.computeLuminance()
      ? (a, b)
      : (b, a);
  return (lighter.computeLuminance() + 0.05) /
      (darker.computeLuminance() + 0.05);
}
