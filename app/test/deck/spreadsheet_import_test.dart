import 'dart:convert';
import 'dart:typed_data';

import 'package:drift/drift.dart' show driftRuntimeOptions;
import 'package:drift/native.dart';
import 'package:flutter/material.dart' hide Card;
import 'package:flutter/rendering.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/database/database.dart';
import 'package:knowno/deck/deck.dart';
import 'package:knowno/deck/src/spreadsheet_cards.dart'
    show spreadsheetCellLimit;
import 'package:knowno/design/theme.dart';
import 'package:knowno/l10n/app_localizations.dart';
import 'package:uuid/uuid.dart';

import 'xlsx.dart';
import '../word_breaks.dart';

/// Hands out each of [next] in turn; null is a cancelled picker.
final class _FakePick implements SpreadsheetPick {
  final next = <OpenedFile?>[];

  @override
  Future<OpenedFile?> pick() async => next.removeAt(0);
}

OpenedFile _csv(String text, {String name = 'words.csv'}) =>
    parseSpreadsheet(name, Uint8List.fromList(utf8.encode(text)));

void main() {
  driftRuntimeOptions.dontWarnAboutMultipleDatabases = true;
  late AppDatabase db;
  late DeckRepository decks;
  late Deck deck;
  late _FakePick pick;
  final ko = lookupAppLocalizations(const Locale('ko'));

  setUp(() async {
    db = AppDatabase(NativeDatabase.memory());
    decks = DeckRepository(db, clock: DateTime.now, newId: const Uuid().v4);
    deck = await decks.createDeck('단어장');
    await decks.addCard(
      deck.id,
      front: [const TextContent('apple')],
      back: [const TextContent('사과')],
    );
    pick = _FakePick();
  });

  tearDown(() => db.close());

  /// The stored cards' fronts, oldest first.
  Future<List<String>> fronts(WidgetTester tester) async =>
      (await tester.runAsync(() async {
        final cards = await decks.listCards(deck.id);
        return [for (final card in cards) plainText(card.front)];
      }))!;

  /// A page with a button opening the flow into [into]; what it resolves to
  /// lands in the returned list.
  Future<List<Deck?>> open(WidgetTester tester, {DeckId? into}) async {
    final result = <Deck?>[];
    tester.platformDispatcher.localesTestValue = const [Locale('ko')];
    addTearDown(tester.platformDispatcher.clearLocalesTestValue);
    tester.view.physicalSize = const Size(780, 1688);
    tester.view.devicePixelRatio = 2;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          deckRepositoryProvider.overrideWithValue(decks),
          spreadsheetPickProvider.overrideWithValue(pick),
        ],
        child: MaterialApp(
          theme: lightTheme,
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: Builder(
            builder: (context) => Scaffold(
              body: Center(
                child: TextButton(
                  onPressed: () async =>
                      result.add(await importFromSpreadsheet(context, into)),
                  child: const Text('open'),
                ),
              ),
            ),
          ),
        ),
      ),
    );
    await tester.tap(shownText('open'));
    await tester.pumpAndSettle();
    return result;
  }

  /// Unmounts the screens, whose deck list's stream closes on a timer.
  Future<void> unmount(WidgetTester tester) async {
    await tester.pumpWidget(const SizedBox());
    await tester.pump(const Duration(seconds: 1));
  }

  Future<void> tap(WidgetTester tester, Finder finder) async {
    await tester.ensureVisible(finder);
    await tester.pumpAndSettle();
    await tester.tap(finder);
    await tester.pumpAndSettle();
  }

  /// Pumps while a save's writes finish on the database's own zone.
  Future<void> save(WidgetTester tester, String label) async {
    await tester.tap(shownText(label));
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(milliseconds: 50)),
    );
    await tester.pumpAndSettle();
  }

  /// Opens [file] from the start sheet onto the review.
  Future<List<Deck?>> review(
    WidgetTester tester,
    OpenedFile file, {
    DeckId? into,
  }) async {
    pick.next.add(file);
    final result = await open(tester, into: into);
    await tap(tester, shownText(ko.spreadsheetChoose));
    expect(shownText(ko.spreadsheetReviewTitle), findsOneWidget);
    return result;
  }

  bool switchValue(WidgetTester tester) =>
      tester.widget<Switch>(find.byType(Switch)).value;

  group('cards from a file', () {
    testWidgets(
      'a screen reader counts the review as one list over the cards: the '
      'parts above them indexed 0 on without a restart, the cards 0 on',
      (tester) async {
        final semantics = tester.ensureSemantics();
        final over = '가' * (spreadsheetCellLimit + 1);
        await review(
          tester,
          _csv('front,back\npear,배\n,빈 앞면\nplum,자두\nfig,$over\n'),
        );
        expect(
          [
            find.bySemanticsLabel(ko.spreadsheetSkipped(1)),
            find.bySemanticsLabel(RegExp('^${ko.photoTargetTitle}')),
          ].map((finder) => finder.evaluate().length),
          [1, greaterThan(0)],
          reason: 'setup: each part above the cards shows',
        );

        final scroll = tester.getSemantics(find.byType(CustomScrollView));
        final cards = <int?>[];
        final above = <int?>[];
        String labels(SemanticsNode node) {
          final own = node.getSemanticsData().label;
          final inner = <String>[];
          node.visitChildren((child) {
            inner.add(labels(child));
            return true;
          });
          return [own, ...inner].join('|');
        }

        void indexed(SemanticsNode node) {
          if (node.indexInParent != null) {
            (RegExp(r'^\|?\d+행 ').hasMatch(labels(node)) ? cards : above).add(
              node.indexInParent,
            );
            return;
          }
          node.visitChildren((child) {
            indexed(child);
            return true;
          });
        }

        indexed(scroll);
        expect(cards, [0, 1]);
        expect(above, [for (var i = 0; i < above.length; i++) i]);
        expect(above.length, greaterThan(8), reason: 'every part is counted');
        semantics.dispose();
        await unmount(tester);
      },
    );
    testWidgets(
      'maps columns under a detected header, counts skipped rows and saves only the chosen cards',
      (tester) async {
        final book = parseSpreadsheet(
          'words.xlsx',
          xlsxOf([
            const TestSheet('단어', [
              [StringCell('단어'), StringCell('뜻'), StringCell('품사')],
              [StringCell('pear'), StringCell('배'), StringCell('명')],
              [StringCell(''), StringCell('빈 앞면')],
              [StringCell('plum'), StringCell('자두'), StringCell('명')],
            ]),
          ]),
        );
        final result = await review(tester, book, into: deck.id);
        expect(switchValue(tester), isTrue);
        expect(find.bySemanticsLabel(ko.spreadsheetSkipped(1)), findsOneWidget);

        await tap(tester, shownText(ko.spreadsheetLabelColumn));
        await tap(tester, shownText('C · 품사').last);
        await tap(
          tester,
          find.bySemanticsLabel(ko.spreadsheetRowCard(4, 'plum')),
        );
        await save(tester, ko.importAdd(1));

        expect(await fronts(tester), ['apple', 'pear']);
        final card = (await tester.runAsync(() => decks.listCards(deck.id)))!
            .last;
        expect(card.back, [
          const SensesContent([
            CardSense(
              labels: [PartOfSpeechLabel(PartOfSpeech.noun, '명')],
              meaning: '배',
            ),
          ]),
        ]);
        expect(card.source, CardSource.import);
        expect(card.templateVersion, 2);
        expect(result.single?.id, deck.id);
      },
    );

    testWidgets(
      'names a row repeating a stored card and saves nothing until it is left out, never overwriting the stored card',
      (tester) async {
        await review(
          tester,
          _csv('front,back\nApple,사과\nbanana,바나나\n'),
          into: deck.id,
        );
        await save(tester, ko.importAdd(2));
        expect(
          find.bySemanticsLabel(ko.spreadsheetDuplicateStored(2)),
          findsOneWidget,
        );
        expect(await fronts(tester), ['apple']);

        await tap(tester, shownText(ko.spreadsheetLeaveOut(2)));
        await save(tester, ko.importAdd(1));
        expect(await fronts(tester), ['apple', 'banana']);
      },
    );

    testWidgets(
      'names the earlier row a row repeats in the file, and adds both on 그래도 추가',
      (tester) async {
        await review(tester, _csv('단어,뜻\nkiwi,키위\nKIWI,참다래\n'), into: deck.id);
        await save(tester, ko.importAdd(2));
        expect(
          find.bySemanticsLabel(ko.spreadsheetDuplicateRow(3, 2)),
          findsOneWidget,
        );
        expect(await fronts(tester), ['apple']);

        await save(tester, ko.spreadsheetAddAnyway);
        expect(await fronts(tester), ['apple', 'kiwi', 'KIWI']);
      },
    );

    testWidgets('states a refused file and asks before discarding read cards', (
      tester,
    ) async {
      pick.next.addAll([
        const RefusedFile(SpreadsheetRefusal.wrongType),
        _csv('pear,배'),
      ]);
      final result = await open(tester, into: deck.id);
      expect(find.bySemanticsLabel(ko.spreadsheetStartBody), findsOneWidget);
      await tap(tester, shownText(ko.spreadsheetChoose));
      expect(find.bySemanticsLabel(ko.spreadsheetWrongType), findsOneWidget);
      expect(shownText(ko.spreadsheetReviewTitle), findsNothing);

      await tap(tester, shownText(ko.spreadsheetChoose));
      expect(shownText(ko.spreadsheetReviewTitle), findsOneWidget);

      await tap(tester, find.byTooltip(ko.close));
      expect(find.bySemanticsLabel(ko.spreadsheetDiscardTitle), findsOneWidget);
      await tap(tester, shownText(ko.discardImport));
      expect(shownText(ko.spreadsheetReviewTitle), findsNothing);
      expect(result, [null]);
      expect(await fronts(tester), ['apple']);
    });

    testWidgets('a cancelled picker leaves the start sheet as it was', (
      tester,
    ) async {
      pick.next.add(null);
      await open(tester, into: deck.id);
      await tap(tester, shownText(ko.spreadsheetChoose));
      expect(find.bySemanticsLabel(ko.spreadsheetStartBody), findsOneWidget);
      expect(shownText(ko.spreadsheetReviewTitle), findsNothing);
    });

    testWidgets(
      'closes with no question once every card is left out, against one card kept',
      (tester) async {
        await review(tester, _csv('pear,배\nplum,자두'), into: deck.id);
        await tap(tester, shownText(ko.spreadsheetExcludeAll));
        expect(shownText(ko.spreadsheetSelectAll), findsOneWidget);
        await tap(tester, shownText(ko.spreadsheetSelectAll));
        await tap(tester, shownText(ko.spreadsheetExcludeAll));
        await tap(tester, find.byTooltip(ko.close));
        expect(shownText(ko.spreadsheetReviewTitle), findsNothing);
      },
    );

    testWidgets(
      'says the columns must differ and lists no card until they do, then the header switch makes the first row a card',
      (tester) async {
        await review(tester, _csv('pear,배\nplum,자두'), into: deck.id);
        expect(switchValue(tester), isFalse);
        expect(shownText(ko.importAdd(2)), findsOneWidget);

        await tap(tester, shownText(ko.cardBack));
        await tap(tester, shownText('A · pear').last);
        expect(find.bySemanticsLabel(ko.spreadsheetDistinct), findsOneWidget);
        expect(shownText(ko.importAdd(2)), findsNothing);

        await tap(tester, shownText(ko.cardBack));
        await tap(tester, shownText('B · 배').last);
        expect(find.bySemanticsLabel(ko.spreadsheetDistinct), findsNothing);
        await tap(tester, find.byType(Switch));
        expect(shownText(ko.importAdd(1)), findsOneWidget);
      },
    );

    testWidgets(
      'names up to five rows with a long cell, then how many more, and chooses another sheet with its own defaults',
      (tester) async {
        final over = '가' * (spreadsheetCellLimit + 1);
        final book = parseSpreadsheet(
          'words.xlsx',
          xlsxOf([
            TestSheet('긴 칸', [
              for (var row = 0; row < 7; row++)
                [StringCell('word $row'), StringCell(over)],
              [const StringCell('ok'), const StringCell('뜻')],
            ]),
            const TestSheet('머리글', [
              [StringCell('단어'), StringCell('뜻')],
              [StringCell('run'), StringCell('달리다')],
            ]),
          ]),
        );
        await review(tester, book, into: deck.id);
        final rows = ko.spreadsheetRowsMore(
          [1, 2, 3, 4, 5].map(ko.spreadsheetRow).join(', '),
          2,
        );
        expect(
          find.bySemanticsLabel(
            ko.spreadsheetTooLong(rows, spreadsheetCellLimit),
          ),
          findsOneWidget,
        );
        expect(switchValue(tester), isFalse);

        await tap(tester, shownText(ko.spreadsheetSheet));
        await tap(tester, shownText('머리글').last);
        expect(switchValue(tester), isTrue);
        expect(shownText(ko.importAdd(1)), findsOneWidget);
      },
    );

    testWidgets(
      'a refused sheet says so and lists nothing, and another file replaces the first, one refused leaving it',
      (tester) async {
        final lines = [for (var at = 0; at < 1001; at++) 'w$at,뜻'];
        await review(tester, _csv(lines.join('\n')), into: deck.id);
        expect(
          find.bySemanticsLabel(ko.spreadsheetTooManyRows),
          findsOneWidget,
        );
        expect(shownText(ko.cardCount(0)), findsNothing);

        pick.next.addAll([
          const RefusedFile(SpreadsheetRefusal.tooLarge),
          _csv('pear,배', name: 'other.csv'),
        ]);
        await tap(tester, shownText(ko.spreadsheetAnother));
        expect(find.bySemanticsLabel(ko.spreadsheetTooLarge), findsOneWidget);
        expect(shownText('words.csv'), findsOneWidget);

        await tap(tester, shownText(ko.spreadsheetAnother));
        expect(shownText('other.csv'), findsOneWidget);
        expect(shownText(ko.importAdd(1)), findsOneWidget);
      },
    );

    testWidgets(
      'with no deck, offers the decks and a new one, and asks a new deck its name on saving',
      (tester) async {
        final result = await review(tester, _csv('pear,배'));
        expect(shownText(ko.photoTargetTitle), findsOneWidget);
        expect(shownText(ko.newDeck), findsOneWidget);

        await tap(tester, shownText(ko.importAdd(1)));
        await tester.enterText(find.byType(TextField), '과일');
        await tester.pumpAndSettle();
        await tester.tap(shownText(ko.create));
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 50)),
        );
        await tester.pumpAndSettle();
        // A new deck is offered 노트 꾸미기, whose dismissal keeps the default.
        expect(find.bySemanticsLabel(ko.deckAppearance), findsOneWidget);
        await tester.binding.handlePopRoute();
        await tester.pumpAndSettle();
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 50)),
        );
        await tester.pumpAndSettle();

        expect(result.single?.name, '과일');
        final stored = (await tester.runAsync(
          () => decks.listCards(result.single!.id),
        ))!;
        expect(stored.map((card) => plainText(card.front)), ['pear']);
        await unmount(tester);
      },
    );

    testWidgets('with no deck, saves into the one chosen, checking its cards', (
      tester,
    ) async {
      final result = await review(tester, _csv('apple,사과\npear,배'));
      await tap(tester, shownText(ko.photoTargetTitle));
      await tap(tester, shownText('단어장'));
      await save(tester, ko.importAdd(2));
      expect(
        find.bySemanticsLabel(ko.spreadsheetDuplicateStored(1)),
        findsOneWidget,
      );
      await tap(tester, shownText(ko.spreadsheetLeaveOut(1)));
      await save(tester, ko.importAdd(1));
      expect(result.single?.id, deck.id);
      expect(await fronts(tester), ['apple', 'pear']);
      await unmount(tester);
    });

    testWidgets(
      'a save into a deck deleted meanwhile stores nothing and says so',
      (tester) async {
        await review(tester, _csv('pear,배\nplum,자두'), into: deck.id);
        await tester.runAsync(() => decks.deleteDeck(deck.id));
        await save(tester, ko.importAdd(2));
        expect(
          find.bySemanticsLabel(describeFailure(ko, DeckDeleted(deck.id))),
          findsOneWidget,
        );
        expect(await tester.runAsync(() => decks.listCards(deck.id)), isEmpty);
      },
    );
  });
}
