import 'package:drift/drift.dart' show Value, driftRuntimeOptions;
import 'package:drift/native.dart';
import 'package:flutter/material.dart' hide Card;
import 'package:flutter/rendering.dart';
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
    .ancestor(of: shownText(title), matching: find.byType(DecoratedBox))
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

      expect(shownText('목표보다 23% 낮아요'), findsOneWidget);
      expect(find.textContaining('%p'), findsNothing);
      // The target is named on the chart alone.
      expect(find.textContaining('90%'), findsOneWidget);
      expect(find.text('목표 90%'), findsOneWidget);
      expect(shownText('기억 상태'), findsOneWidget);
      expect(find.text('지금 기억하고 있을 확률'), findsNothing);
      expect(find.text('좋음'), findsOneWidget);
      expect(find.text('단단함'), findsNothing);
      expect(find.text('7주 전'), findsOneWidget);
      expect(shownText('7주 전보다 +3장'), findsOneWidget);
    },
  );

  testWidgets(
    'the retention shows its value, its gap to the 90% target and each day in its label, over 30 days by default, then 7 days and every day',
    (tester) async {
      await _pump(tester, await _seed(_history, recall: _recall));

      // 30 days: a's "Know" on 1 and 14 October, b's "Don't know" on 13.
      expect(find.text('67%'), findsOneWidget);
      expect(shownText('23% below target'), findsOneWidget);
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
      expect(shownText('40% below target'), findsOneWidget);
      expect(find.text('7 days ago'), findsOneWidget);
      expect(
        _label(tester, 'Correct in reviews, target'),
        'Correct in reviews, target 90%: Oct 13 0%, Oct 14 100%',
      );

      // Every day: b's "Know" on 10 September too; the left end is that day.
      await tester.tap(find.text('All'));
      await tester.pumpAndSettle();
      expect(find.text('75%'), findsOneWidget);
      expect(shownText('15% below target'), findsOneWidget);
      expect(find.text('Sep 10'), findsOneWidget);
    },
  );

  testWidgets(
    'the retention names the target on its dashed line at the left, and no scale: only the axis\'s two ends are labelled',
    (tester) async {
      await _pump(tester, await _seed(_history, recall: _recall));

      // Over 30 days the lowest day is 0%, so the scale runs from 0% to 100%
      // and the target, 90%, sits a tenth of the way down.
      final plot = find.byWidgetPredicate(
        (widget) =>
            widget is CustomPaint &&
            widget.painter.runtimeType.toString() == '_RetentionPainter',
      );
      expect(plot, findsOneWidget);
      final rect = tester.getRect(plot);
      final target = tester.getRect(find.text('Target 90%'));
      expect(target.left, rect.left);
      expect(target.center.dy, closeTo(rect.top + rect.height * 0.1, 1));
      // No scale at the side: the figure is the one percentage shown.
      expect(find.text('100%'), findsNothing);
      expect(find.text('0%'), findsNothing);
      for (final end in ['30 days ago', 'Today']) {
        expect(
          tester.getRect(find.text(end).first).top,
          greaterThanOrEqualTo(rect.bottom),
          reason: end,
        );
      }
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
      // The figure alone: the chart labels no scale.
      expect(find.text('100%'), findsOneWidget);
      expect(shownText('10% above target'), findsOneWidget);

      await tester.tap(find.text('7 days'));
      await tester.pumpAndSettle();
      expect(shownText('No reviews in this period.'), findsOneWidget);
      expect(find.text('100%'), findsNothing);
      // The period stays, so another can be chosen.
      expect(find.text('30 days'), findsOneWidget);
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
    'the period selector sits under the tab\'s title, above the retention it alone governs, the chosen period on the primary fill',
    (tester) async {
      await _pump(tester, await _seed(_history, recall: _recall));

      Rect segment(String name) => tester.getRect(find.text(name));
      Color? fill(String name) => tester
          .widget<Material>(
            find
                .ancestor(of: find.text(name), matching: find.byType(Material))
                .first,
          )
          .color;
      // One row of three, between the title and the retention's card.
      expect(segment('7 days').center.dy, segment('All').center.dy);
      expect(
        segment('7 days').top,
        greaterThan(tester.getRect(shownText('Record')).bottom),
      );
      expect(
        segment('7 days').bottom,
        lessThan(tester.getRect(_card('Correct in reviews')).top),
      );
      expect(
        find.descendant(
          of: _card('Correct in reviews'),
          matching: find.text('7 days'),
        ),
        findsNothing,
      );
      expect(fill('30 days'), AppColors.light.primary);
      expect(fill('7 days'), AppColors.light.surface);
      final semantics = tester.ensureSemantics();
      expect(
        tester.getSemantics(find.text('30 days')),
        isSemantics(isButton: true, isSelected: true, hasSelectedState: true),
      );
      semantics.dispose();

      // Another period changes the retention and the fill, and no other
      // card.
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
      expect(fill('7 days'), AppColors.light.primary);
      expect(fill('30 days'), AppColors.light.surface);
      expect([
        for (final text in tester.widgetList<Text>(mastered)) text.data,
      ], before);
    },
  );

  testWidgets(
    'the mastered weeks show the cards mastered now as the figure, the gain since the first of the weeks beside it, and name the first and the last week under the bars, the past weeks in the heatmap\'s second step and this week in the accent, reading each week\'s count',
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
      // The gain spans the chart, from its first week, 0, to this week's 3,
      // in the figure's row, beside it where both fit.
      final gain = shownText('+3 since 7 weeks ago');
      expect(gain, findsOneWidget);
      expect(
        find.descendant(
          of: find.ancestor(of: gain, matching: find.byType(Wrap)).first,
          matching: find.text('3 cards'),
        ),
        findsOneWidget,
      );
      // The bars: each past week's in the second step, this week's accent.
      final bars = [
        for (final box in tester.widgetList<DecoratedBox>(
          find.descendant(
            of: find.bySemanticsLabel(RegExp('^Mastered cards by week')),
            matching: find.byType(DecoratedBox),
          ),
        ))
          (box.decoration as BoxDecoration).color,
      ];
      expect(bars, [
        for (var week = 0; week < 7; week++) AppColors.light.heat1,
        AppColors.light.accent,
      ]);
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
      // One cell outlined in ink, clear of its fill: the last, today's.
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
      expect(
        ((tester.widget<DecoratedBox>(ringed).decoration as BoxDecoration)
                    .border!
                as Border)
            .top
            .color,
        AppColors.light.ink,
      );
      final cells = find.descendant(
        of: card,
        matching: find.byType(AspectRatio),
      );
      expect(cells, findsNWidgets(84));
      expect(
        tester.getRect(ringed),
        tester
            .getRect(cells.last)
            .inflate(StatsStyle.todayRing + StatsStyle.todayRingGap),
      );
      // Each day in one of the theme's four cobalt steps.
      final steps = [
        AppColors.light.heat0,
        AppColors.light.heat1,
        AppColors.light.heat2,
        AppColors.light.heat3,
      ];
      for (final box in tester.widgetList<DecoratedBox>(
        find.descendant(of: cells, matching: find.byType(DecoratedBox)),
      )) {
        final colour = (box.decoration as BoxDecoration).color;
        if (colour != null) expect(steps, contains(colour));
      }
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

  testWidgets(
    'at text scale 2 nothing overflows or is cut: the periods, each figure, pill and band count on its line, and the key',
    (tester) async {
      tester.platformDispatcher.textScaleFactorTestValue = 2;
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
      await _pump(tester, await _seed(_history, recall: _recall));

      expect(tester.takeException(), isNull);
      expect(find.text('Average 87%'), findsOneWidget);
      for (final text in [
        '7 days',
        '67%',
        '23% below target',
        '+3 since 7 weeks ago',
        '2 cards',
        'Fewer',
      ]) {
        final paragraph = tester.renderObject<RenderParagraph>(
          find
              .descendant(
                of: shownText(text).first,
                matching: find.byType(RichText),
              )
              .first,
        );
        expect(paragraph.didExceedMaxLines, isFalse, reason: text);
        expect(
          tester.getRect(shownText(text).first).right,
          lessThanOrEqualTo(390),
          reason: text,
        );
      }
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
    expect(shownText('Correct in reviews'), findsNothing);
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
      '$name: the recall bands are 3:1 on the surface but 보통 in light, the bands 45 degrees apart in hue, and the heatmap\'s four steps 1.5:1 apart in lightness',
      () {
        final surface = colors.surface;
        final (strong, fair, fading) = StatsStyle.bands(colors);
        final bands = [
          for (final band in [strong, fair, fading]) _over(band, surface),
        ];
        // 보통 is under 3:1 on the light surface; its count in ink carries it
        // (ADR 0147).
        for (final mark in [bands[0], if (name == 'dark') bands[1], bands[2]]) {
          expect(
            _contrast(mark, surface),
            greaterThanOrEqualTo(3),
            reason: '$mark',
          );
        }
        // The bands are told apart by hue, 45 degrees or more apart.
        double apart(Color a, Color b) {
          final turn = (HSVColor.fromColor(a).hue - HSVColor.fromColor(b).hue)
              .abs();
          return turn > 180 ? 360 - turn : turn;
        }

        for (var i = 0; i < bands.length; i++) {
          for (var j = i + 1; j < bands.length; j++) {
            expect(
              apart(bands[i], bands[j]),
              greaterThanOrEqualTo(45),
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
        // Control: the edge, which a chart does not draw in, fails the
        // check, the accent and its tint sit under 45 degrees apart, and the
        // second step first proposed, which ADR 0151 darkened, is under 1.5:1
        // from the first.
        expect(_contrast(colors.edge, surface), lessThan(3));
        expect(apart(colors.accent, colors.brandTint), lessThan(45));
        final proposed = name == 'light'
            ? const Color(0xFFB9C9F5)
            : const Color(0xFF34508F);
        expect(_contrast(colors.heat0, proposed), lessThan(1.5));
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
