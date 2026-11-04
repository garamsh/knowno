import 'package:drift/drift.dart' show driftRuntimeOptions;
import 'package:drift/native.dart';
import 'package:flutter/material.dart' hide Card;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/database/database.dart';
import 'package:knowno/deck/deck.dart';
import 'package:knowno/design/theme.dart';
import 'package:knowno/l10n/app_localizations.dart';
import 'package:knowno/study/study.dart';

import '../app_fonts.dart';
import '../word_breaks.dart';

/// Recalls each state at its difficulty over ten.
class _RecallScheduler extends Fake implements Scheduler {
  @override
  Future<List<CardState>> history(List<ReviewRow> reviews) async => [];

  @override
  Future<double> retrievability(CardState state, DateTime at) async =>
      state.difficulty / 10;
}

/// 기록 over a deck of cards recalled at 0.96 and 0.95, strong; 0.8, fair;
/// and 0.78, fading, on a 390 wide phone.
Future<void> _pump(WidgetTester tester, Locale locale) async {
  final at = DateTime.utc(2026, 10, 15, 9);
  final db = AppDatabase(NativeDatabase.memory());
  addTearDown(db.close);
  var ids = 0;
  final cards = DeckRepository(db, clock: () => at, newId: () => 'id${ids++}');
  final deck = await cards.createDeck('French');
  for (final (name, recall) in [
    ('a', 0.96),
    ('b', 0.8),
    ('c', 0.78),
    ('d', 0.95),
  ]) {
    final card = switch (await cards.addCard(
      deck.id,
      front: [TextContent(name)],
      back: [TextContent(name)],
    )) {
      CardSaved(:final card) => card.id,
      DuplicateFront() => fail('the setup saved a duplicate'),
    };
    await db
        .into(db.cardStates)
        .insert(
          CardStatesCompanion.insert(
            cardId: card.value,
            stability: 5,
            difficulty: recall * 10,
            lastReview: at,
            due: at.add(const Duration(days: 5)),
            updatedAt: at,
          ),
        );
  }
  tester.view
    ..physicalSize = const Size(390, 844)
    ..devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        deckRepositoryProvider.overrideWithValue(cards),
        studyRepositoryProvider.overrideWithValue(
          StudyRepository(db, newId: () => 'unused'),
        ),
        schedulerProvider.overrideWithValue(_RecallScheduler()),
        studyClockProvider.overrideWithValue(() => at),
        studyZoneProvider.overrideWithValue((_) => Duration.zero),
      ],
      child: MaterialApp(
        theme: lightTheme,
        locale: locale,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(
          body: StatsView(
            decks: DeckSelection(deck.id),
            title: const Text('Record'),
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  driftRuntimeOptions.dontWarnAboutMultipleDatabases = true;
  setUpAll(loadAppFonts);

  for (final locale in [const Locale('ko'), const Locale('en')]) {
    final l10n = lookupAppLocalizations(locale);
    // Each band's name and its count: two strong, one fair, one fading.
    final bands = [
      (l10n.recallStrong, l10n.statsCards(2)),
      (l10n.recallFair, l10n.statsCards(1)),
      (l10n.recallFading, l10n.statsCards(1)),
    ];
    for (final scale in [1.0, 3.12]) {
      testWidgets(
        'in ${locale.languageCode} at text scale $scale, in the bundled '
        'fonts, each recall band names itself broken only between words, '
        'the tiles side by side while the names fit and otherwise one above '
        'another, each count then drawn whole',
        (tester) async {
          tester.platformDispatcher.textScaleFactorTestValue = scale;
          addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
          await _pump(tester, locale);
          await tester.ensureVisible(shownText(bands.last.$1));
          await tester.pumpAndSettle();

          expect(tester.takeException(), isNull);
          final tops = <double>{};
          for (final (name, count) in bands) {
            final (ends, plain) = lineEnds(tester, name);
            for (final end in ends.take(ends.length - 1)) {
              expect(
                plain[end - 1] == ' ' || plain[end] == ' ',
                isTrue,
                reason: 'a break at $end in "$name"',
              );
            }
            final tile = find
                .ancestor(
                  of: shownText(name),
                  matching: find.byType(DecoratedBox),
                )
                .first;
            final figure = find.descendant(
              of: tile,
              matching: shownText(count),
            );
            expect(tester.getRect(figure).right, lessThanOrEqualTo(390));
            // One above another, the count is at its own size, no smaller
            // than laid out; side by side it may shrink to its tile.
            if (scale > 1) {
              expect(
                tester.getRect(figure).width,
                moreOrLessEquals(tester.getSize(figure).width),
                reason: name,
              );
            }
            tops.add(tester.getTopLeft(shownText(name)).dy);
          }
          if (scale == 1.0) {
            // Control: at the default size the tiles stand side by side.
            expect(tops, hasLength(1));
          } else {
            expect(tops, hasLength(3));
          }
        },
      );
    }
  }
}
