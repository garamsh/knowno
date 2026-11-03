import 'dart:io';

import 'package:drift/drift.dart' show driftRuntimeOptions;
import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/database/database.dart';
import 'package:knowno/deck/deck.dart';
import 'package:knowno/design/theme.dart';
import 'package:knowno/l10n/app_localizations.dart';
import 'package:knowno/media/media.dart';
import 'package:uuid/uuid.dart';

import '../media/fakes.dart';
import '../word_breaks.dart';

/// Hands out [next] once, or throws [MediaUnreadable] while [fails].
class _FakePick implements ImagePick {
  PreparedImage? next;
  bool fails = false;
  final origins = <ImageOrigin>[];
  final shapes = <ImageShape>[];

  @override
  Future<PreparedImage?> pick(
    ImageOrigin origin, {
    ImageShape shape = ImageShape.square,
  }) async {
    origins.add(origin);
    shapes.add(shape);
    if (fails) throw const MediaUnreadable('unreadable');
    return next;
  }
}

void main() {
  driftRuntimeOptions.dontWarnAboutMultipleDatabases = true;
  late AppDatabase db;
  late Directory directory;
  late MediaStore media;
  late DeckRepository decks;
  late _FakePick pick;
  late Deck deck;

  setUp(() async {
    db = AppDatabase(NativeDatabase.memory());
    directory = newMediaDirectory();
    media = MediaStore(
      db,
      FakeMediaServer(),
      directory: directory,
      clock: () => DateTime.utc(2026, 10, 26),
      newId: const Uuid().v4,
    );
    decks = DeckRepository(
      db,
      clock: DateTime.now,
      newId: const Uuid().v4,
      media: media,
    );
    pick = _FakePick();
    deck = await decks.createDeck('French');
  });

  tearDown(() async {
    await db.close();
    await deleteMediaDirectory(directory);
  });

  /// Opens the sheet over [shown] from a button, and returns what it pops
  /// with once it closes, through [result].
  Future<List<(DeckIcon, DeckColor?)?>> open(
    WidgetTester tester,
    Deck shown,
  ) async {
    final result = <(DeckIcon, DeckColor?)?>[];
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          deckRepositoryProvider.overrideWithValue(decks),
          mediaStoreProvider.overrideWithValue(media),
          imagePickProvider.overrideWithValue(pick),
        ],
        child: MaterialApp(
          theme: lightTheme,
          locale: const Locale('ko'),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: Builder(
            builder: (context) => TextButton(
              onPressed: () async => result.add(
                await showDeckAppearanceSheet(context, deck: shown),
              ),
              child: const Text('open'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(shownText('open'));
    await tester.pumpAndSettle();
    return result;
  }

  /// Taps [label] and lets what it starts finish: each step of real file and
  /// database work completes in real time, and its continuation on a pump.
  Future<void> tapAndFinish(WidgetTester tester, String label) async {
    await tester.ensureVisible(shownText(label));
    await tester.tap(shownText(label));
    for (var step = 0; step < 20; step++) {
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 20)),
      );
      await tester.pump();
    }
    await tester.pumpAndSettle();
  }

  testWidgets(
    'a photo from the album shows on the tile, and 저장 stores it as the deck\'s image, queued for upload',
    (tester) async {
      pick.next = preparedImage(1);
      final result = await open(tester, deck);

      await tapAndFinish(tester, '앨범에서 고르기');
      expect(pick.origins, [ImageOrigin.album]);
      // A tile's photo is its centred square, unlike a card's (ADR 0109).
      expect(pick.shapes, [ImageShape.square]);
      final preview = tester.widget<Image>(find.byType(Image));
      expect((preview.image as MemoryImage).bytes, pick.next!.bytes);
      expect(shownText('사진 삭제'), findsOneWidget);

      await tapAndFinish(tester, '저장');

      expect(result, [(DeckIcon.fallback, null)]);
      final stored = (await tester.runAsync(() => decks.getDeck(deck.id)))!;
      final uploads = (await tester.runAsync(
        () => db.select(db.mediaUploads).get(),
      ))!;
      expect(uploads.map((row) => row.id), [stored.image!.value]);
    },
  );

  testWidgets('사진 찍기 takes the photo with the camera', (tester) async {
    pick.next = preparedImage(4);
    await open(tester, deck);

    await tapAndFinish(tester, '사진 찍기');

    expect(pick.origins, [ImageOrigin.camera]);
    expect(find.byType(Image), findsOneWidget);
  });

  testWidgets(
    '사진 삭제 on a deck with an image stores none on 저장 and releases the image',
    (tester) async {
      final image = (await tester.runAsync(
        () => media.addImage(preparedImage(1)),
      ))!;
      await tester.runAsync(() => decks.setImage(deck.id, image));
      final shown = (await tester.runAsync(() => decks.getDeck(deck.id)))!;
      await open(tester, shown);

      await tapAndFinish(tester, '사진 삭제');
      expect(shownText('사진 삭제'), findsNothing);
      await tapAndFinish(tester, '저장');

      final stored = (await tester.runAsync(() => decks.getDeck(deck.id)))!;
      expect(stored.image, isNull);
      final released = (await tester.runAsync(
        () => db.select(db.mediaDeletions).get(),
      ))!;
      expect(released.map((row) => row.id), [image.value]);
    },
  );

  testWidgets(
    'a photo that cannot be read says so and leaves the tile as it was',
    (tester) async {
      pick.fails = true;
      await open(tester, deck);

      await tapAndFinish(tester, '앨범에서 고르기');

      expect(find.text('사진을 불러오지 못했어요. 다시 시도해 주세요.'), findsOneWidget);
      expect(find.byType(Image), findsNothing);
      expect(shownText('사진 삭제'), findsNothing);
    },
  );

  testWidgets('a dismissed sheet stores no photo it showed', (tester) async {
    pick.next = preparedImage(1);
    final result = await open(tester, deck);
    await tapAndFinish(tester, '앨범에서 고르기');
    expect(find.byType(Image), findsOneWidget);

    await tester.tapAt(const Offset(10, 10));
    await tester.pumpAndSettle();

    expect(result, [null]);
    final stored = (await tester.runAsync(() => decks.getDeck(deck.id)))!;
    expect(stored.image, isNull);
    final uploads = (await tester.runAsync(
      () => db.select(db.mediaUploads).get(),
    ))!;
    expect(uploads, isEmpty);
  });
}
