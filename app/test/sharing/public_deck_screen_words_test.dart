import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/database/database.dart';
import 'package:knowno/deck/deck.dart';
import 'package:knowno/design/theme.dart';
import 'package:knowno/l10n/app_localizations.dart';
import 'package:knowno/sharing/sharing.dart';
import 'package:knowno/sharing/src/public_deck_screen.dart';

import '../app_fonts.dart';
import '../word_breaks.dart';
import 'fakes.dart';
import 'sharing_service_test.dart' show publicDeck;

void main() {
  setUpAll(loadAppFonts);
  final ko = lookupAppLocalizations(const Locale('ko'));

  for (final scale in [1.0, 3.12]) {
    testWidgets(
      'on a 390 wide phone at text scale $scale, in the bundled fonts, the '
      'public deck\'s line and description break only between words, read as '
      'written',
      (tester) async {
        tester.view
          ..physicalSize = const Size(390, 844)
          ..devicePixelRatio = 1;
        addTearDown(tester.view.reset);
        tester.platformDispatcher.textScaleFactorTestValue = scale;
        addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
        final semantics = tester.ensureSemantics();
        final db = AppDatabase(NativeDatabase.memory());
        addTearDown(db.close);
        const description =
            '스페인어 동물 이름을 모아 둔 노트예요 함께 외워 보고 퀴즈도 풀어 봐요 매일 조금씩 외우면 금방 늘어요';
        final deck = publicDeck(
          'spanish',
          name: '스페인어 동물',
          ownerName: '김가람',
          description: description,
          cards: 3,
          copies: 12,
        );
        final line = ko.publicDeckLine('김가람', 3, 12);
        final sharing = SharingService(
          server: FakeSharingServer(decks: [deck]),
          decks: DeckRepository(
            db,
            clock: () => DateTime.utc(2026, 10, 15),
            newId: () => 'id',
          ),
          reachability: FakeReachability(),
          clock: () => DateTime.utc(2026, 10, 15, 12),
        );
        await tester.pumpWidget(
          MaterialApp(
            theme: lightTheme,
            locale: const Locale('ko'),
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: PublicDeckScreen(sharing: sharing, deck: deck),
          ),
        );
        await tester.pumpAndSettle();
        for (final text in [line, description]) {
          // The line fits one line at 1.0, so only its reading is tested then.
          if (scale > 1 || text == description) {
            expectBreaksBetweenWords(tester, text);
          }
          expect(find.bySemanticsLabel(text), findsOneWidget);
        }
        semantics.dispose();
      },
    );
  }
}
