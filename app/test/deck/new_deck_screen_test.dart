import 'dart:io';

import 'package:drift/drift.dart' show driftRuntimeOptions;
import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:knowno/database/database.dart' hide DeckRow;
import 'package:knowno/deck/deck.dart';
import 'package:knowno/deck/src/editor_group.dart';
import 'package:knowno/design/app_text_field.dart';
import 'package:knowno/design/theme.dart';
import 'package:knowno/l10n/app_localizations.dart';
import 'package:knowno/media/media.dart';
import 'package:uuid/uuid.dart';

import '../media/fakes.dart';
import '../word_breaks.dart';

/// Hands out [next] on each pick.
class _FakePick implements ImagePick {
  PreparedImage? next;

  @override
  Future<PreparedImage?> pick(
    ImageOrigin origin, {
    ImageShape shape = ImageShape.square,
  }) async => next;
}

void main() {
  driftRuntimeOptions.dontWarnAboutMultipleDatabases = true;
  late AppDatabase db;
  late Directory directory;
  late MediaStore media;
  late DeckRepository decks;
  late _FakePick pick;

  setUp(() {
    db = AppDatabase(NativeDatabase.memory());
    directory = newMediaDirectory();
    media = MediaStore(
      db,
      FakeMediaServer(),
      directory: directory,
      clock: () => DateTime.utc(2026, 11, 3),
      newId: const Uuid().v4,
    );
    decks = DeckRepository(
      db,
      clock: DateTime.now,
      newId: const Uuid().v4,
      media: media,
    );
    pick = _FakePick();
  });

  tearDown(() async {
    await db.close();
    await deleteMediaDirectory(directory);
  });

  /// Opens 새 노트 from a button, at [textScale], and returns what it pops
  /// with once it closes.
  Future<List<NewDeck?>> open(
    WidgetTester tester, {
    double textScale = 1,
    ThemeData? theme,
  }) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final result = <NewDeck?>[];
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          deckRepositoryProvider.overrideWithValue(decks),
          mediaStoreProvider.overrideWithValue(media),
          imagePickProvider.overrideWithValue(pick),
        ],
        child: MaterialApp(
          theme: theme ?? lightTheme,
          locale: const Locale('ko'),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          builder: (context, child) => MediaQuery.withClampedTextScaling(
            minScaleFactor: textScale,
            maxScaleFactor: textScale,
            child: child!,
          ),
          home: Builder(
            builder: (context) => TextButton(
              onPressed: () async => result.add(
                await Navigator.of(context).push(
                  MaterialPageRoute<NewDeck>(
                    builder: (_) => const NewDeckScreen(),
                  ),
                ),
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

  /// Taps [finder] and lets the real file and database work it starts
  /// finish.
  Future<void> tapAndFinish(WidgetTester tester, Finder finder) async {
    await tester.ensureVisible(finder);
    // A scroll still running, such as the focused field's reveal, takes the
    // tap from the form, so the tap waits for the form to settle.
    await tester.pumpAndSettle();
    await tester.tap(finder);
    for (var step = 0; step < 20; step++) {
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 20)),
      );
      await tester.pump();
    }
    await tester.pumpAndSettle();
  }

  Finder field() => widgetWithShownText(AppTextField, '노트 이름');

  /// The label of the name field, not the preview's placeholder.
  Finder label() => find.descendant(of: field(), matching: shownText('노트 이름'));

  /// The white group holding [finder].
  Rect groupOf(WidgetTester tester, Finder finder) => tester.getRect(
    find.ancestor(of: finder, matching: find.byType(EditorGroup)).first,
  );

  testWidgets(
    'the name field opens focused with its hint, its label inside its group at the group\'s inset, one line high on the ground fill',
    (tester) async {
      await open(tester);

      final editable = tester.widget<EditableText>(find.byType(EditableText));
      expect(editable.focusNode.hasFocus, isTrue);
      expect(find.text('예: 토익 단어'), findsOneWidget);
      final group = groupOf(tester, label());
      final shown = tester.getRect(label());
      expect(shown.left - group.left, AppSpace.s16);
      expect(shown.top - group.top, AppSpace.s16);
      final input = tester.getRect(find.byType(TextField));
      expect(input.height, AppSize.field);
      final decorator = tester.widget<InputDecorator>(
        find.byType(InputDecorator),
      );
      final colors = AppColors.of(tester.element(field()));
      expect(decorator.decoration.fillColor, colors.ground);
      // Control: the group itself is drawn on the surface, so the field
      // shows inside it.
      expect(colors.ground, isNot(colors.surface));
    },
  );

  for (final (theme, name) in [(lightTheme, 'light'), (darkTheme, 'dark')]) {
    testWidgets(
      'at the largest text size in the $name theme, 새 노트 lays out with nothing clipped, the label inset as at 1.0',
      (tester) async {
        await open(tester, textScale: 3.12, theme: theme);
        expect(tester.takeException(), isNull);
        final group = groupOf(tester, label());
        expect(tester.getRect(label()).left - group.left, AppSpace.s16);
        // The label keeps its words on its lines: it is not cut.
        final painted = tester.renderObject<RenderParagraph>(
          find.descendant(of: label(), matching: find.byType(RichText)),
        );
        expect(painted.didExceedMaxLines, isFalse);
        await tester.drag(find.byType(ListView), const Offset(0, -2000));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
      },
    );
  }

  testWidgets(
    'the preview at twice the tile shows the name as typed and each choice of icon and colour',
    (tester) async {
      await open(tester);
      Finder preview(Finder finder) =>
          find.descendant(of: find.byType(DeckTile), matching: finder);
      final tile = tester.getSize(find.byType(DeckTile));
      expect(tile.width, AppSize.deckTile * 2);
      expect(preview(find.byIcon(LucideIcons.layers)), findsOneWidget);

      await tester.enterText(find.byType(EditableText), '화학 기초');
      await tester.pump();
      expect(find.text('화학 기초'), findsNWidgets(2));
      await tester.tap(find.bySemanticsLabel('실험'));
      await tester.pump();
      expect(preview(find.byIcon(LucideIcons.flaskConical)), findsOneWidget);
      expect(preview(find.byIcon(LucideIcons.layers)), findsNothing);
    },
  );

  testWidgets(
    'a photo picked hides the icon and colour, offers another or its removal, and 저장 makes the deck with it as its image, queued for upload',
    (tester) async {
      pick.next = preparedImage(2);
      final result = await open(tester);
      // Control: before the photo, the icon and colour are offered.
      expect(find.text('아이콘'), findsOneWidget);
      expect(find.text('색'), findsOneWidget);

      await tester.enterText(find.byType(EditableText), '일본어 회화');
      await tapAndFinish(tester, shownText('앨범에서 고르기'));

      final shown = tester.widget<Image>(
        find.descendant(
          of: find.byType(DeckTile),
          matching: find.byType(Image),
        ),
      );
      expect((shown.image as MemoryImage).bytes, pick.next!.bytes);
      expect(find.text('아이콘'), findsNothing);
      expect(find.text('색'), findsNothing);
      expect(shownText('다른 사진'), findsOneWidget);
      expect(shownText('사진 삭제'), findsOneWidget);
      expect(shownText('사진 찍기'), findsNothing);

      await tapAndFinish(tester, shownText('저장'));

      final made = result.single!.deck;
      final stored = (await tester.runAsync(() => decks.getDeck(made.id)))!;
      expect(stored.name, '일본어 회화');
      expect(stored.image, isNotNull);
      final uploads = (await tester.runAsync(
        () => db.select(db.mediaUploads).get(),
      ))!;
      expect(uploads.map((row) => row.id), [stored.image!.value]);
    },
  );

  testWidgets(
    '사진 삭제 brings the icon and colour back and 저장 makes the deck with the icon and colour chosen and no image',
    (tester) async {
      pick.next = preparedImage(3);
      final result = await open(tester);
      await tester.enterText(find.byType(EditableText), 'Delta');
      await tapAndFinish(tester, find.bySemanticsLabel('별'));
      await tapAndFinish(tester, find.bySemanticsLabel('모래'));
      await tapAndFinish(tester, shownText('앨범에서 고르기'));
      await tapAndFinish(tester, shownText('사진 삭제'));
      expect(find.text('아이콘'), findsOneWidget);

      await tapAndFinish(tester, shownText('저장'));

      final stored = (await tester.runAsync(
        () => decks.getDeck(result.single!.deck.id),
      ))!;
      expect(
        (stored.icon, stored.color, stored.image),
        (DeckIcon.star, DeckColor.sand, null),
      );
      final uploads = (await tester.runAsync(
        () => db.select(db.mediaUploads).get(),
      ))!;
      expect(uploads, isEmpty);
    },
  );
}
