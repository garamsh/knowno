import 'package:drift/drift.dart' show driftRuntimeOptions;
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/database/database.dart';
import 'package:knowno/deck/deck.dart';
import 'package:knowno/study/src/model.dart';
import 'package:knowno/study/src/rust/api/engine.dart';
import 'package:knowno/study/src/scheduler.dart';
import 'package:knowno/study/src/session.dart';
import 'package:knowno/study/src/study_repository.dart';

import 'fixtures.dart';

/// Schedules every review one day out, at once.
class _InstantScheduler implements Scheduler {
  @override
  Future<CardState?> fold(List<ReviewRow> reviews) =>
      throw UnimplementedError('sessions do not fold');

  @override
  Future<List<CardState>> history(List<ReviewRow> reviews) =>
      throw UnimplementedError('sessions do not fold');

  @override
  Future<double> retrievability(CardState state, DateTime at) =>
      throw UnimplementedError('sessions read no recall');

  @override
  Future<CardState> review(
    CardState? state,
    Answer answer,
    DateTime at, {
    required FuzzFactor fuzz,
  }) async => CardState(
    stability: 1,
    difficulty: 5,
    lastReview: at,
    due: at.add(const Duration(days: 1)),
  );
}

/// A session over a new deck holding a card for each of [names], in order.
Future<StudySession> _open(List<String> names) async {
  final db = AppDatabase(NativeDatabase.memory());
  addTearDown(db.close);
  var created = DateTime.utc(2026, 9, 1);
  var ids = 0;
  final cards = DeckRepository(
    db,
    clock: () => created = created.add(const Duration(minutes: 1)),
    newId: () => 'deck${ids++}',
  );
  final deck = await cards.createDeck('French');
  for (final name in names) {
    await cards.addCard(
      deck.id,
      front: [TextContent(name)],
      back: [TextContent(name)],
    );
  }
  final session = StudySession(
    decks: DeckSelection(deck.id),
    cards: cards,
    repository: StudyRepository(db, newId: () => 'review${ids++}'),
    scheduler: _InstantScheduler(),
    clock: () => DateTime.utc(2026, 10, 14, 9),
    random: FirstDraw(),
    onFailure: (failure) => fail('unexpected $failure'),
  );
  addTearDown(session.dispose);
  // Runs before the database closes: the writes still queued need it.
  addTearDown(() => session.settled);
  await untilLoaded(session);
  return session;
}

/// The front of the card on screen, or null once no card is left.
String? _current(StudySession session) => switch (session.state) {
  SessionStudying(:final current) => plainText(current.front),
  _ => null,
};

/// Answers "Know" until no card is left, and returns the fronts shown.
List<String> _knowToTheEnd(StudySession session) {
  final shown = <String>[];
  for (
    var front = _current(session);
    front != null;
    front = _current(session)
  ) {
    shown.add(front);
    session.answer(Answer.know);
  }
  return shown;
}

void main() {
  driftRuntimeOptions.dontWarnAboutMultipleDatabases = true;

  test("a toggle to Don't know of an answer given before a later one does not put the card back; one of its last answer does", () async {
    final session = await _open(['a', 'b', 'c', 'd', 'e']);
    session.answer(Answer.dontKnow);
    for (final _ in ['b', 'c', 'd']) {
      session.answer(Answer.know);
    }
    expect(_current(session), 'a', reason: 'the re-show is on screen');
    session.answer(Answer.know);

    session.toggle(0);
    session.toggle(0);
    expect(
      (session.state as SessionStudying).previous.first.answer,
      Answer.dontKnow,
    );
    expect(_knowToTheEnd(session), ['e']);

    // Control: the same card's last answer, toggled, does put it back.
    session.toggle(4);
    expect(_current(session), 'a');
  });

  test("a toggle to Know removes the card's waiting re-show, and a toggle back to Don't know puts it back", () async {
    final session = await _open(['a', 'b', 'c', 'd', 'e']);
    session.answer(Answer.dontKnow);

    session.toggle(0);
    final shown = [?_current(session)];
    session.answer(Answer.know);
    // Control: toggled back while nothing waits, the card is put back.
    session.toggle(0);

    expect([...shown, ..._knowToTheEnd(session)], ['b', 'c', 'd', 'e', 'a']);
  });

  test('a re-show already on screen is neither removed by a toggle to Know nor put back again by a toggle to Don\'t know', () async {
    final session = await _open(['a', 'b']);
    session.answer(Answer.dontKnow);
    session.answer(Answer.know);
    expect(_current(session), 'a', reason: 'the re-show is on screen');

    session.toggle(0);
    expect(_current(session), 'a');
    session.toggle(0);

    expect(_knowToTheEnd(session), ['a']);
    expect(session.state, isA<SessionComplete>());
  });

  test("after the queue empties, a toggle that puts a card back ends the completion, and one that does not leaves it", () async {
    final session = await _open(['a']);
    session.answer(Answer.dontKnow);
    session.answer(Answer.know);
    expect(session.state, isA<SessionComplete>());

    // The first answer is followed by the re-show, so nothing is put back.
    session.toggle(0);
    expect(session.state, isA<SessionComplete>());

    // Control: the last answer toggled to Don't know reopens the session.
    session.toggle(1);
    expect(_current(session), 'a');
  });

  test("the completion sheet counts each card answered today once, a re-shown one included, before and after a toggle", () async {
    final session = await _open(['a', 'b']);
    session.answer(Answer.know);
    session.answer(Answer.dontKnow);
    session.answer(Answer.know);
    final before = (session.state as SessionComplete).completion;
    // Three answers, to two cards.
    expect(before.cards, 2);

    session.toggle(1);

    final after = (session.state as SessionComplete).completion;
    expect(after.cards, 2);
    expect(
      [
        for (final card in (session.state as SessionComplete).previous)
          card.changed,
      ],
      [false, true, false],
    );
  });
}
