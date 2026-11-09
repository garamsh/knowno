import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/database/database.dart';
import 'package:knowno/sync/src/merge.dart';

final _t0 = DateTime.utc(2026, 10, 15, 9);
final _t1 = _t0.add(const Duration(minutes: 1));

DeckRow _deck(
  String name,
  DateTime updatedAt, {
  DateTime? deletedAt,
  bool dirty = false,
}) => DeckRow(
  id: 'deck',
  name: name,
  visibility: 'private',
  publication: 'private',
  createdAt: _t0,
  updatedAt: updatedAt,
  deletedAt: deletedAt,
  dirty: dirty,
);

CardRow _card(String front, DateTime updatedAt, {DateTime? deletedAt}) =>
    CardRow(
      id: 'card',
      deckId: 'deck',
      front: front,
      back: '[]',
      cardKey: front,
      source: 'manual',
      createdAt: _t0,
      updatedAt: updatedAt,
      deletedAt: deletedAt,
      dirty: false,
    );

ReviewRow _review(String rating, DateTime updatedAt, {bool dirty = false}) =>
    ReviewRow(
      id: 'review',
      cardId: 'card',
      rating: rating,
      reviewedAt: _t0,
      durationMs: 1000,
      fuzzFactor: 0.5,
      updatedAt: updatedAt,
      dirty: dirty,
    );

CardStateRow _state({required bool dirty}) => CardStateRow(
  cardId: 'card',
  stability: 1,
  difficulty: 5,
  lastReview: _t0,
  due: _t1,
  updatedAt: _t0,
  dirty: dirty,
);

void main() {
  group('decks and cards', () {
    test('a row only the server holds is taken', () {
      expect(mergeDeck(null, _deck('Server', _t0)), Kept.remote);
      expect(mergeCard(null, _card('server', _t0)), Kept.remote);
    });

    test('the later edit wins, from either side', () {
      expect(mergeDeck(_deck('Mine', _t1), _deck('Server', _t0)), Kept.local);
      // Control: the same two edits with the server's later.
      expect(mergeDeck(_deck('Mine', _t0), _deck('Server', _t1)), Kept.remote);
      expect(mergeCard(_card('mine', _t1), _card('server', _t0)), Kept.local);
      expect(mergeCard(_card('mine', _t0), _card('server', _t1)), Kept.remote);
    });

    test(
      'a tie keeps an unsynced local edit, which the server has not seen',
      () {
        expect(
          mergeDeck(_deck('Mine', _t0, dirty: true), _deck('Server', _t0)),
          Kept.local,
        );
        // Control: a synced local row at the same time gives way.
        expect(
          mergeDeck(_deck('Mine', _t0), _deck('Server', _t0)),
          Kept.remote,
        );
      },
    );

    test('a tombstone beats a later edit, from either side', () {
      expect(
        mergeDeck(_deck('Mine', _t0, deletedAt: _t0), _deck('Server', _t1)),
        Kept.local,
      );
      expect(
        mergeCard(_card('mine', _t1), _card('server', _t0, deletedAt: _t0)),
        Kept.remote,
      );
      // Control: without the tombstone, the later edit wins.
      expect(mergeDeck(_deck('Mine', _t0), _deck('Server', _t1)), Kept.remote);
      expect(mergeCard(_card('mine', _t1), _card('server', _t0)), Kept.local);
    });
  });

  group('reviews', () {
    test('a review only the server holds joins the union', () {
      expect(mergeReview(null, _review('good', _t0)), Kept.remote);
    });

    test('a review on both sides keeps the later rating', () {
      expect(
        mergeReview(_review('again', _t1), _review('good', _t0)),
        Kept.local,
      );
      // Control: the server's rating is the later one.
      expect(
        mergeReview(_review('again', _t0), _review('good', _t1)),
        Kept.remote,
      );
    });

    test('a tie keeps an unsynced local rating', () {
      expect(
        mergeReview(_review('again', _t0, dirty: true), _review('good', _t0)),
        Kept.local,
      );
      // Control: a synced local review at the same time gives way.
      expect(
        mergeReview(_review('again', _t0), _review('good', _t0)),
        Kept.remote,
      );
    });
  });

  group('card states', () {
    test('an unsynced local state is kept, never merged', () {
      expect(
        mergeCardState(_state(dirty: true), _state(dirty: false)),
        Kept.local,
      );
      // Control: a synced local state gives way to the server's.
      expect(
        mergeCardState(_state(dirty: false), _state(dirty: false)),
        Kept.remote,
      );
    });
  });

  group('study settings', () {
    StudySettingsRow settings(int minutes, DateTime at, {bool dirty = false}) =>
        StudySettingsRow(
          id: 0,
          dailyMinutes: minutes,
          updatedAt: at,
          dirty: dirty,
        );
    final at = DateTime.utc(2026, 10, 15, 9);

    test('keep the later edit, an unsynced local one on a tie, and the server\'s with none on the device', () {
      final later = at.add(const Duration(seconds: 1));
      expect(
        mergeStudySettings(settings(30, later), settings(10, at)),
        Kept.local,
      );
      expect(
        mergeStudySettings(settings(30, at), settings(10, later)),
        Kept.remote,
      );
      expect(
        mergeStudySettings(settings(30, at, dirty: true), settings(10, at)),
        Kept.local,
      );
      expect(
        mergeStudySettings(settings(30, at), settings(10, at)),
        Kept.remote,
      );
      expect(mergeStudySettings(null, settings(10, at)), Kept.remote);
    });
  });
}
