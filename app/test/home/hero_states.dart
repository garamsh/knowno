import 'package:flutter/widgets.dart';
import 'package:knowno/database/database.dart';
import 'package:knowno/deck/deck.dart';
import 'package:knowno/l10n/app_localizations.dart';

import 'home_data.dart';

/// A phone's screen in points, with its status bar's and home indicator's
/// insets.
typedef HeroPhone = ({String name, Size size, double top, double bottom});

/// The phones 홈's hero is laid out on: the smallest, the owner's and the
/// tallest.
const List<HeroPhone> heroPhones = [
  (name: 'SE', size: Size(375, 667), top: 20, bottom: 0),
  (name: '13 Pro', size: Size(390, 844), top: 47, bottom: 34),
  (name: 'Pro Max', size: Size(430, 932), top: 59, bottom: 34),
];

/// The days in a row the 'today' state was studied, up to yesterday, and
/// the cards answered on each of the six days before today, oldest first.
const heroStreak = 19;
const heroWeek = [38, 52, 23, 41, 66, 47];

/// The notes every state's cards are in.
const heroNotes = ['영단어 기본', '토익 빈출', '일본어 N3', '회화 표현'];

/// The cards each state stores in [db] through [repository], and the daily
/// study minutes it sets, if any.
typedef HeroSetup = Future<int?> Function(
  AppDatabase db,
  DeckRepository repository,
  List<DeckId> decks,
);

Future<CardId> _add(
  DeckRepository repository,
  DeckId deck,
  String front,
) async => switch (await repository.addCard(
  deck,
  front: [TextContent(front)],
  back: [TextContent(front)],
)) {
  CardSaved(:final card) => card.id,
  DuplicateFront() => throw StateError('the deck held no duplicate'),
};

/// Each hero state, its title, and how it is stored.
final Map<String, (String Function(AppLocalizations), HeroSetup)> heroStates = {
  // The owner's case on #610 and #611: 481 cards today over four notes, on a
  // 19-day streak.
  'today': (
    (l10n) => l10n.homeToday(481),
    // Due after a day's interval and three hours' study a day, so not a
    // backlog; answered on each of the [heroStreak] days before, the last six
    // as [heroWeek] counts them.
    (db, repository, decks) async {
      final cards = [
        for (var i = 0; i < 481; i++)
          await _add(repository, decks[i % decks.length], 'today $i'),
      ];
      for (final card in cards) {
        await storeState(db, card, due: homeNow, days: 1);
      }
      for (var daysAgo = 1; daysAgo <= heroStreak; daysAgo++) {
        final count = daysAgo <= heroWeek.length
            ? heroWeek[heroWeek.length - daysAgo]
            : 10;
        for (final card in cards.take(count)) {
          await storeAnswerAt(
            db,
            card,
            homeNow.subtract(Duration(days: daysAgo)),
          );
        }
      }
      return 180;
    },
  ),
  'backlog': (
    (l10n) => l10n.backlogTitle,
    (db, repository, decks) async {
      for (var i = 0; i < 70; i++) {
        final card = await _add(repository, decks[i % 2], 'backlog $i');
        await storeState(db, card, due: homeNow, days: 30);
      }
      return null;
    },
  ),
  'done': (
    (l10n) => l10n.todayDone,
    (db, repository, decks) async {
      for (var i = 0; i < 35; i++) {
        final card = await _add(repository, decks[0], 'done $i');
        await storeState(db, card, due: homeNow.add(const Duration(days: 1)));
        await storeAnswerAt(
          db,
          card,
          homeNow.subtract(const Duration(hours: 1)),
        );
      }
      return 5;
    },
  ),
  'no cards': (
    (l10n) => l10n.noCardsTitle,
    (db, repository, decks) async => null,
  ),
};
