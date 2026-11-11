import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/assistant/src/assistant_client.dart';
import 'package:knowno/assistant/src/assistant_controller.dart';
import 'package:knowno/assistant/src/conversation.dart';
import 'package:knowno/assistant/src/protocol.dart';
import 'package:knowno/assistant/src/providers.dart';
import 'package:knowno/photo_import/photo_import.dart' show PhotoAccessDenied;

import '../photo_import/fakes.dart';
import '../word_breaks.dart';
import 'fakes.dart';

Finder _text(String text) => shownText(text);

Future<void> _type(WidgetTester tester, String text) async {
  await tester.enterText(find.byType(TextField), text);
  await tester.pump();
}

/// Sends [text]; a reply still open goes with [settle] false, as the typing
/// dots never settle.
Future<void> _send(
  WidgetTester tester,
  String text, {
  bool settle = true,
}) async {
  await _type(tester, text);
  await tester.tap(find.byTooltip('Send'));
  if (settle) {
    await tester.pumpAndSettle();
  } else {
    await tester.pump();
    await tester.pump();
  }
}

/// A poll's time passes and its answer is drawn.
Future<void> _tick(WidgetTester tester) async {
  await tester.pump(jobPollEvery);
  await tester.pump();
  await tester.pump();
}

/// Unmounts the chat and stops the chat's poll, which a test that ends with a
/// job reading would leave as a pending timer.
Future<void> _end(WidgetTester tester, ProviderContainer container) async {
  await tester.pumpWidget(const SizedBox());
  container.dispose();
}

/// The photos waiting to go, drawn as images from memory.
Finder get _staged => find.byWidgetPredicate(
  (widget) => widget is Image && widget.image is MemoryImage,
);

JobPolled _polled(int finished, {JobState state = JobState.running}) =>
    JobPolled(
      JobProgress(id: 'job-1', photos: 3, finished: finished, state: state),
    );

final _started = reply([
  const TextDelta('사진을 읽을게요'),
  const JobEvent(id: 'job-1', photos: 3),
]);

final _proposal = proposalOf(
  groups: [
    ('Unit 1', CardForm.text, [('apple', '사과')]),
  ],
);

/// A source whose library holds three photos of different widths.
FakePhotoSource _library() => FakePhotoSource()
  ..libraryPhotos = [
    Future.value(photoOfWidth(8)),
    Future.value(photoOfWidth(9)),
    Future.value(photoOfWidth(10)),
  ];

Future<void> _attachFromAlbum(WidgetTester tester) async {
  await tester.tap(find.byTooltip('Attach photos'));
  await tester.pumpAndSettle();
  await tester.tap(_text('Choose from album'));
  await tester.pumpAndSettle();
}

void main() {
  group('photos', () {
    testWidgets('has no photo button where the app cannot take a photo', (
      tester,
    ) async {
      await pumpChat(
        tester,
        FakeAssistantClient(),
        await openAssistantStorage(tester),
      );
      expect(find.byTooltip('Attach photos'), findsNothing);
      // Control: with a photo source the button is there.
      await tester.pumpWidget(const SizedBox());
      await pumpChat(
        tester,
        FakeAssistantClient(),
        await openAssistantStorage(tester),
        photoSource: FakePhotoSource(),
      );
      expect(find.byTooltip('Attach photos'), findsOneWidget);
    });

    testWidgets(
      'stages the photos picked, takes one back out, and sends the rest uploaded',
      (tester) async {
        final source = _library();
        final client = FakeAssistantClient(
          scripts: [
            reply([const TextDelta('받았어요')]),
          ],
        );
        await pumpChat(
          tester,
          client,
          await openAssistantStorage(tester),
          photoSource: source,
        );
        await _attachFromAlbum(tester);
        expect(source.libraryLimits, [50], reason: 'a job reads up to 50');
        expect(_staged, findsNWidgets(3));
        final semantics = tester.ensureSemantics();
        await tester.tap(find.bySemanticsLabel('Remove photo').first);
        await tester.pump();
        semantics.dispose();
        expect(_staged, findsNWidgets(2));
        // Photos alone are a message.
        await tester.tap(find.byTooltip('Send'));
        await tester.pumpAndSettle();
        expect(client.uploaded, hasLength(2));
        final ids = client.sent.single.single['photos']! as List<Object?>;
        expect(ids, unorderedEquals(client.uploaded.keys));
        expect(client.sent.single.single['text'], '');
        expect(
          _text('2 photos'),
          findsOneWidget,
          reason: 'the user\'s message',
        );
        expect(_staged, findsNothing);
        expect(_text('받았어요'), findsOneWidget);
      },
    );

    testWidgets(
      'keeps the photos and the text where one did not upload, and sends them on the next try',
      (tester) async {
        final client = FakeAssistantClient(
          scripts: [
            reply([const TextDelta('받았어요')]),
          ],
        )..uploadsWork = false;
        await pumpChat(
          tester,
          client,
          await openAssistantStorage(tester),
          photoSource: _library(),
        );
        await _attachFromAlbum(tester);
        await _type(tester, '표로 만들어 줘');
        await tester.tap(find.byTooltip('Send'));
        await tester.pumpAndSettle();
        expect(
          _text('Could not upload the photos. Try again.'),
          findsOneWidget,
        );
        expect(client.sent, isEmpty, reason: 'nothing was sent');
        expect(_staged, findsNWidgets(3));
        expect(find.widgetWithText(TextField, '표로 만들어 줘'), findsOneWidget);
        client.uploadsWork = true;
        await tester.tap(find.byTooltip('Send'));
        await tester.pumpAndSettle();
        expect(client.sent.single.single['text'], '표로 만들어 줘');
        expect(client.uploaded, hasLength(3));
        expect(_text('Could not upload the photos. Try again.'), findsNothing);
        expect(_staged, findsNothing);
      },
    );

    testWidgets('says a photo could not be picked and stages none', (
      tester,
    ) async {
      final source = FakePhotoSource()
        ..libraryFailure = PhotoAccessDenied('denied');
      await pumpChat(
        tester,
        FakeAssistantClient(),
        await openAssistantStorage(tester),
        photoSource: source,
      );
      await _attachFromAlbum(tester);
      expect(_text('Could not get the photos. Try again.'), findsOneWidget);
      expect(_staged, findsNothing);
    });

    testWidgets('takes one photo with the camera', (tester) async {
      final source = FakePhotoSource();
      await pumpChat(
        tester,
        FakeAssistantClient(),
        await openAssistantStorage(tester),
        photoSource: source,
      );
      await tester.tap(find.byTooltip('Attach photos'));
      await tester.pumpAndSettle();
      await tester.tap(_text('Take photo'));
      await tester.pumpAndSettle();
      expect(source.cameraCalls, 1);
      expect(_staged, findsOneWidget);
    });
  });

  group('photo job', () {
    testWidgets(
      'shows how far the job has read and asks again every few seconds',
      (tester) async {
        expect(
          jobPollEvery.inSeconds,
          inInclusiveRange(2, 5),
          reason: 'every few seconds',
        );
        final client = FakeAssistantClient(scripts: [_started])
          ..polls.addAll([_polled(1), const JobPollFailed(), _polled(2)]);
        final container = await pumpChat(
          tester,
          client,
          await openAssistantStorage(tester),
        );
        // Not settled: a settling pump lets the interval run.
        await _type(tester, '읽어 줘');
        await tester.tap(find.byTooltip('Send'));
        await tester.pump();
        await tester.pump();
        await tester.pump();
        expect(_text('Reading 0 of 3 photos'), findsOneWidget);
        expect(_text('Cancel reading'), findsOneWidget);
        await tester.pump(jobPollEvery - const Duration(milliseconds: 1));
        expect(client.polls, hasLength(3), reason: 'not before the interval');
        await tester.pump(const Duration(milliseconds: 1));
        await tester.pump();
        await tester.pump();
        expect(_text('Reading 1 of 3 photos'), findsOneWidget);
        await _tick(tester);
        expect(
          _text('Reading 1 of 3 photos'),
          findsOneWidget,
          reason: 'a poll that failed leaves the progress',
        );
        await _tick(tester);
        expect(_text('Reading 2 of 3 photos'), findsOneWidget);
        await _end(tester, container);
      },
    );

    testWidgets(
      'sends the next message itself once the job is done, the job on the reply that started it',
      (tester) async {
        final client = FakeAssistantClient(
          scripts: [
            _started,
            reply([const TextDelta('카드를 만들었어요'), ProposalEvent(_proposal)]),
          ],
        )..polls.addAll([_polled(3, state: JobState.done)]);
        final container = await pumpChat(
          tester,
          client,
          await openAssistantStorage(tester),
        );
        await _send(tester, '읽어 줘');
        await _tick(tester);
        await tester.pumpAndSettle();
        expect(client.sent, hasLength(2));
        final next = client.sent.last;
        expect(next.map((turn) => turn['role']), ['user', 'assistant', 'user']);
        expect(next[1]['job'], {'id': 'job-1', 'photos': 3});
        expect(next.last['text'], jobDoneMessage);
        expect(_text('Read all 3 photos'), findsOneWidget);
        expect(_text(jobDoneMessage), findsNothing, reason: 'not drawn');
        expect(_text('카드를 만들었어요'), findsOneWidget);
        expect(
          container.read(assistantReadyCardsProvider),
          1,
          reason: 'the cards made from the photos are ready',
        );
        // The poll stopped with the job: nothing more is asked.
        client.polls.add(_polled(3, state: JobState.done));
        await tester.pump(jobPollEvery * 2);
        expect(client.polls, hasLength(1));
      },
    );

    testWidgets(
      'sends nothing itself when the user wrote after the job started',
      (tester) async {
        final client = FakeAssistantClient(
          scripts: [
            _started,
            reply([const TextDelta('표로 할게요')]),
          ],
        )..polls.add(_polled(3, state: JobState.done));
        final container = await pumpChat(
          tester,
          client,
          await openAssistantStorage(tester),
        );
        await _send(tester, '읽어 줘');
        await _send(tester, '표로 해 줘');
        await _tick(tester);
        await tester.pumpAndSettle();
        expect(client.sent, hasLength(2));
        expect(_text('Read all 3 photos'), findsOneWidget);
        await _end(tester, container);
      },
    );

    testWidgets('cancels the job, and sends nothing when it stops', (
      tester,
    ) async {
      final client = FakeAssistantClient(scripts: [_started]);
      final container = await pumpChat(
        tester,
        client,
        await openAssistantStorage(tester),
      );
      await _send(tester, '읽어 줘');
      await tester.tap(_text('Cancel reading'));
      await tester.pumpAndSettle();
      expect(client.cancelled, ['job-1']);
      expect(_text('Cancelled reading the photos'), findsOneWidget);
      expect(_text('Cancel reading'), findsNothing);
      client.polls.add(_polled(3, state: JobState.done));
      await tester.pump(jobPollEvery * 2);
      expect(client.polls, hasLength(1), reason: 'no more asking');
      expect(client.sent, hasLength(1));
      await _end(tester, container);
    });

    testWidgets('goes on reading where the server did not cancel', (
      tester,
    ) async {
      final client = FakeAssistantClient(scripts: [_started])
        ..cancelWorks = false;
      final container = await pumpChat(
        tester,
        client,
        await openAssistantStorage(tester),
      );
      await _send(tester, '읽어 줘');
      await tester.tap(_text('Cancel reading'));
      await tester.pumpAndSettle();
      expect(_text('Reading 0 of 3 photos'), findsOneWidget);
      await _end(tester, container);
    });

    testWidgets('ends a job the server has no record of', (tester) async {
      final client = FakeAssistantClient(scripts: [_started])
        ..polls.add(const JobMissing());
      await pumpChat(tester, client, await openAssistantStorage(tester));
      await _send(tester, '읽어 줘');
      await _tick(tester);
      expect(_text('Cancelled reading the photos'), findsOneWidget);
      expect(client.sent, hasLength(1));
    });

    testWidgets(
      'asks after a job a closed app left reading, and goes on from it',
      (tester) async {
        final stored = Conversation(
          turns: [
            const UserTurn(id: 'u', text: '', photos: ['a', 'b', 'c']),
            const AssistantTurn(
              id: 'a',
              text: '읽을게요',
              ending: Ending.ok,
              job: JobProgress(id: 'job-1', photos: 3, finished: 1),
            ),
          ],
        );
        final client = FakeAssistantClient(
          scripts: [
            reply([const TextDelta('다 만들었어요')]),
          ],
        )..polls.add(_polled(3, state: JobState.done));
        final container = await pumpChat(
          tester,
          client,
          await openAssistantStorage(tester, {
            'assistant.conversation': stored.encode(),
          }),
        );
        expect(_text('Reading 1 of 3 photos'), findsOneWidget);
        await _tick(tester);
        await tester.pumpAndSettle();
        expect(client.sent.single.last['text'], jobDoneMessage);
        expect(_text('다 만들었어요'), findsOneWidget);
        await _end(tester, container);
      },
    );

    testWidgets('waits a poll out while a reply still streams', (tester) async {
      final feed = StreamController<AssistantEvent>();
      final client =
          FakeAssistantClient(
              scripts: [
                streaming(feed),
                reply([const TextDelta('끝')]),
              ],
            )
            ..polls.addAll([
              _polled(3, state: JobState.done),
              _polled(3, state: JobState.done),
            ]);
      final container = await pumpChat(
        tester,
        client,
        await openAssistantStorage(tester),
      );
      await _send(tester, '읽어 줘', settle: false);
      feed.add(const JobEvent(id: 'job-1', photos: 3));
      await tester.pump();
      await tester.pump();
      await _tick(tester);
      expect(client.sent, hasLength(1), reason: 'the reply has not ended');
      expect(_text('Reading 0 of 3 photos'), findsOneWidget);
      await feed.close();
      await tester.pumpAndSettle();
      await _tick(tester);
      await tester.pumpAndSettle();
      expect(client.sent, hasLength(2));
      await _end(tester, container);
    });
  });

  group('a stored note line', () {
    // A thread stored before ADR 0248 holds the line a chat opened from a
    // note wrote.
    final stored = Conversation(
      turns: const [
        ContextTurn(id: 'c1', deckId: 'deck-1', text: '영단어'),
        UserTurn(id: 'u1', text: '단어 더 만들어 줘'),
      ],
    ).encode();

    testWidgets('still loads and draws, and is sent as no turn', (
      tester,
    ) async {
      final client = FakeAssistantClient(
        scripts: [
          reply([const TextDelta('네')]),
        ],
      );
      await pumpChat(
        tester,
        client,
        await openAssistantStorage(tester, {'assistant.conversation': stored}),
      );
      expect(_text('From the note 영단어'), findsOneWidget);
      await _send(tester, '고마워');
      expect(client.sent.single.map((turn) => turn['text']), [
        '단어 더 만들어 줘',
        '고마워',
      ], reason: 'the line is not sent as a turn');
    });

    testWidgets('is not added by opening the chat', (tester) async {
      await pumpChat(
        tester,
        FakeAssistantClient(),
        await openAssistantStorage(tester),
      );
      // Control: the stored line above is drawn; a fresh thread has none.
      expect(shownTextContaining('From the note'), findsNothing);
    });
  });
}
