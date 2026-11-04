import 'dart:async';
import 'dart:io';

import 'package:drift/drift.dart' show driftRuntimeOptions;
import 'package:drift/native.dart';
import 'package:flutter/material.dart' hide Card;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/database/database.dart';
import 'package:knowno/deck/deck.dart';
import 'package:knowno/deck/src/editor_group.dart';
import 'package:knowno/design/app_chip.dart';
import 'package:knowno/deck/src/image_block.dart';
import 'package:knowno/design/app_text_field.dart';
import 'package:knowno/design/theme.dart';
import 'package:knowno/l10n/app_localizations.dart';
import 'package:knowno/media/media.dart';
import 'package:uuid/uuid.dart';

import '../contrast.dart';
import '../home/deck_screens.dart';
import '../media/fakes.dart';
import '../settle_until.dart';
import 'editor.dart';
import '../word_breaks.dart';

/// Two boxes, one near the top left and one near the bottom right, the first
/// with an answer.
const _boxes = [
  ImageBox(id: '1', x: 0.1, y: 0.2, w: 0.3, h: 0.15, answer: 'Paris'),
  ImageBox(id: '2', x: 0.55, y: 0.7, w: 0.4, h: 0.25),
];

const _tall = ImageContent(
  media: MediaId('tall'),
  width: 600,
  height: 1200,
  boxes: _boxes,
);
const _wide = ImageContent(
  media: MediaId('wide'),
  width: 1600,
  height: 900,
  boxes: _boxes,
);

/// A phone held upright, the same phone on its side, and a desktop window.
const _screens = {
  'phone portrait': Size(390, 844),
  'phone landscape': Size(844, 390),
  'desktop': Size(1280, 800),
};

Finder _box(String id) => find.byKey(ValueKey(('image box', id)));

void main() {
  driftRuntimeOptions.dontWarnAboutMultipleDatabases = true;

  /// A store whose files no test writes: a photo is read as missing and
  /// drawn as its fallback, which has the photo's frame.
  MediaStore emptyStore() => MediaStore(
    AppDatabase(NativeDatabase.memory()),
    FakeMediaServer(),
    directory: unusedMediaDirectory,
    clock: DateTime.now,
    newId: const Uuid().v7,
  );

  /// One card's face, [face], drawn as the previous study card draws it,
  /// across a [screen]-sized view less a margin, revealed or not.
  Future<void> drawCard(
    WidgetTester tester,
    Size screen,
    List<Content> face, {
    bool revealed = false,
  }) async {
    tester.view.physicalSize = screen;
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final media = emptyStore();
    await tester.pumpWidget(
      ProviderScope(
        overrides: [mediaStoreProvider.overrideWithValue(media)],
        child: MaterialApp(
          theme: lightTheme,
          locale: const Locale('en'),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: Scaffold(
            body: Padding(
              padding: const EdgeInsets.all(AppSpace.s24),
              child: LayoutBuilder(
                builder: (context, constraints) => Center(
                  child: WholeCardView(
                    face,
                    revealed: revealed,
                    style: AppType.front,
                    minFontSize: AppType.frontFloor,
                    width: constraints.maxWidth,
                    height: constraints.maxHeight,
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
    await tester.pump();
  }

  group('drawing (ADR 0109)', () {
    for (final image in [_tall, _wide]) {
      for (final MapEntry(key: name, value: screen) in _screens.entries) {
        testWidgets(
          'a ${image.media.value} photo at $name is drawn whole at its own aspect ratio, each box over the part of the photo it was drawn on',
          (tester) async {
            await drawCard(tester, screen, [image]);
            final photo = tester.getRect(find.byType(ImagePhoto));

            // Whole and uncropped, inside the screen: contain.
            expect(
              photo.width / photo.height,
              moreOrLessEquals(image.aspectRatio, epsilon: 1e-6),
            );
            expect((Offset.zero & screen).contains(photo.topLeft), isTrue);
            expect(photo.right, lessThanOrEqualTo(screen.width));
            expect(photo.bottom, lessThanOrEqualTo(screen.height));
            for (final box in image.boxes) {
              final drawn = tester.getRect(_box(box.id));
              final fractions = [
                (drawn.left - photo.left) / photo.width,
                (drawn.top - photo.top) / photo.height,
                drawn.width / photo.width,
                drawn.height / photo.height,
              ];
              for (final (index, expected) in [
                box.x,
                box.y,
                box.w,
                box.h,
              ].indexed) {
                expect(
                  fractions[index],
                  moreOrLessEquals(expected, epsilon: 1e-6),
                  reason: 'box ${box.id}, part $index',
                );
              }
            }
          },
        );
      }
    }

    testWidgets(
      'a box hides what it covers until revealed, then shows its answer in it, its border and label the same size on a phone and a desktop',
      (tester) async {
        await drawCard(tester, _screens['phone portrait']!, [_wide]);
        expect(find.text('Paris'), findsNothing);
        final hidden = tester.widget<DecoratedBox>(
          find.descendant(of: _box('1'), matching: find.byType(DecoratedBox)),
        );
        expect(
          (hidden.decoration as BoxDecoration).color,
          AppColors.light.hero,
          reason: 'an opaque fill over the photo',
        );

        final labels = <Size>[];
        final photos = <Size>[];
        for (final (image, screen) in [
          (_wide, _screens['phone portrait']!),
          (_wide, _screens['desktop']!),
          // Tall on a short screen: fitted by its height, not its width.
          (_tall, _screens['phone landscape']!),
        ]) {
          await drawCard(tester, screen, [image], revealed: true);
          expect(find.text('Paris'), findsOneWidget);
          final border = tester
              .widgetList<DecoratedBox>(
                find.descendant(
                  of: _box('1'),
                  matching: find.byType(DecoratedBox),
                ),
              )
              .map((box) => (box.decoration as BoxDecoration).border)
              .nonNulls
              .single;
          expect((border as Border).top.width, 2);
          // As drawn on the screen: nothing scales the photo and its chrome
          // as a picture, so the border and the label keep their size.
          final photo = find.byType(ImagePhoto);
          final drawn = tester.getRect(photo).size;
          final laidOut = tester.getSize(photo);
          expect(drawn.width, moreOrLessEquals(laidOut.width, epsilon: 1e-6));
          expect(drawn.height, moreOrLessEquals(laidOut.height, epsilon: 1e-6));
          labels.add(tester.getRect(find.text('Paris')).size);
          photos.add(tester.getRect(photo).size);
        }
        // Within a rounding of the text's layout.
        for (final label in labels) {
          expect(
            label.width,
            moreOrLessEquals(labels.first.width, epsilon: 0.5),
          );
          expect(label.height, labels.first.height, reason: '$labels');
        }
        // Control: the photo itself is drawn at three sizes.
        expect(photos.toSet(), hasLength(3), reason: '$photos');
      },
    );

    testWidgets(
      'at text scale 2.0 on a phone a photo under a title is still whole and inside the screen, each box over its part',
      (tester) async {
        tester.platformDispatcher.textScaleFactorTestValue = 2;
        addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
        final screen = _screens['phone portrait']!;
        await drawCard(tester, screen, [
          const TextContent('The capital of France'),
          _wide,
        ], revealed: true);
        final photo = tester.getRect(find.byType(ImagePhoto));

        expect(
          photo.width / photo.height,
          moreOrLessEquals(_wide.aspectRatio, epsilon: 1e-6),
        );
        expect((Offset.zero & screen).contains(photo.topLeft), isTrue);
        expect(photo.right, lessThanOrEqualTo(screen.width));
        expect(photo.bottom, lessThanOrEqualTo(screen.height));
        for (final box in _wide.boxes) {
          final drawn = tester.getRect(_box(box.id));
          expect(
            (drawn.left - photo.left) / photo.width,
            moreOrLessEquals(box.x, epsilon: 1e-6),
          );
          expect(
            (drawn.top - photo.top) / photo.height,
            moreOrLessEquals(box.y, epsilon: 1e-6),
          );
          expect(
            drawn.width / photo.width,
            moreOrLessEquals(box.w, epsilon: 1e-6),
          );
          expect(
            drawn.height / photo.height,
            moreOrLessEquals(box.h, epsilon: 1e-6),
          );
        }
        expect(find.text('Paris'), findsOneWidget);
      },
    );

    testWidgets(
      'a screen reader hears the photo and each box as a blank, and each answer once revealed',
      (tester) async {
        final l10n = await AppLocalizations.delegate.load(const Locale('ko'));

        expect(spokenContent(l10n, [_wide], revealed: false), '사진, 빈칸, 빈칸');
        expect(spokenContent(l10n, [_wide], revealed: true), '사진, Paris, 빈칸');
        expect(describeContent(l10n, [_wide]), '사진');
      },
    );
  });

  test("the move and size tools keep inside the photo a box another writer stored a rounding past its edge, or narrower than the least side", () {
    final draft = ImageDraft(
      const ImageContent(
        media: MediaId('photo'),
        width: 4,
        height: 3,
        boxes: [
          ImageBox(id: '1', x: 0, y: 0, w: 1 + 1e-9, h: 0.5),
          ImageBox(id: '2', x: 0.99, y: 0.99, w: 0.01, h: 0.01),
        ],
      ),
    );
    addTearDown(draft.dispose);

    draft
      ..move(0, 0.05, 0.05)
      ..resize(0, 0.05, 0.05)
      ..move(1, 0.05, 0.05)
      ..resize(1, 0.05, 0.05);

    final [wide, sliver] = draft.image!.boxes;
    expect((wide.x, wide.y, wide.w, wide.h), (0, 0.05, 1, 0.55));
    expect(sliver.x, moreOrLessEquals(0.98));
    expect(sliver.y, moreOrLessEquals(0.98));
    expect(sliver.w, moreOrLessEquals(0.02));
    expect(sliver.h, moreOrLessEquals(0.02));
    expect(sliver.x + sliver.w, lessThanOrEqualTo(1));
    expect(sliver.y + sliver.h, lessThanOrEqualTo(1));
  });

  group('the editor (ADR 0109)', () {
    late Directory directory;
    late AppDatabase mediaDb;
    late MediaStore media;
    late FakeImagePick pick;

    setUp(() {
      directory = newMediaDirectory();
      mediaDb = AppDatabase(NativeDatabase.memory());
      var ids = 0;
      media = MediaStore(
        mediaDb,
        FakeMediaServer(),
        directory: directory,
        clock: () => DateTime.utc(2026, 10, 27),
        newId: () => 'photo${ids++}',
      );
      pick = FakeImagePick()..next = preparedWholeImage(160, 90);
    });

    tearDown(() async {
      await mediaDb.close();
      await deleteMediaDirectory(directory);
    });

    Future<Set<String>> released(WidgetTester tester) async => {
      for (final row in (await tester.runAsync(
        () => mediaDb.select(mediaDb.mediaDeletions).get(),
      ))!)
        row.id,
    };

    /// Waits until the store holds the chosen photo and the block shows it.
    Future<void> chosen(WidgetTester tester) => settleUntil(
      tester,
      'the chosen photo',
      () => find.byType(ImagePhoto).evaluate().isNotEmpty,
    );

    /// Waits until a photo is released: the editor lets go of one it does
    /// not save without waiting for the store.
    Future<void> anyReleased(WidgetTester tester) => settleUntil(
      tester,
      'a released photo',
      () async => (await released(tester)).isNotEmpty,
    );

    /// Fills a new 자유 card's empty 글 on each side.
    Future<void> fillText(WidgetTester tester) async {
      for (final (index, text) in ['front', 'back'].indexed) {
        await tester.enterText(find.byType(TextField).at(index), text);
      }
      await tester.pump();
    }

    /// A new 자유 card's editor with a 사진 block added to its front and a
    /// photo of 160 by 90 chosen from the album.
    Future<DeckScreens> openWithPhoto(
      WidgetTester tester, {
      ThemeMode themeMode = ThemeMode.light,
    }) async {
      final screens = await DeckScreens.open(
        tester,
        themeMode: themeMode,
        overrides: [
          mediaStoreProvider.overrideWithValue(media),
          imagePickProvider.overrideWithValue(pick),
        ],
      );
      await screens.push(
        (deck) => CardEditorScreen(preview: studyPreview, deck: deck),
      );
      await fillText(tester);
      await tester.ensureVisible(find.bySemanticsLabel('Add block'));
      await screens.tap(find.bySemanticsLabel('Add block'));
      await screens.tap(shownText('Photo').last);
      await tester.ensureVisible(shownText('Choose from album'));
      await tester.tap(shownText('Choose from album'));
      await chosen(tester);
      return screens;
    }

    Future<void> tapVisible(WidgetTester tester, Finder finder) async {
      await tester.ensureVisible(finder);
      await tester.pumpAndSettle();
      await tester.tap(finder);
      await tester.pumpAndSettle();
    }

    /// Taps a button that picks a photo, leaving the store to the caller:
    /// the button's progress turns while it stores, so nothing settles
    /// before.
    Future<void> tapPick(WidgetTester tester, Finder finder) async {
      await tester.ensureVisible(finder);
      await tester.pumpAndSettle();
      await tester.tap(finder);
      await tester.pump();
    }

    /// Saves the card and waits until the editor closes, which it does once
    /// the card is stored and the photos it does not hold are let go.
    Future<void> save(WidgetTester tester) async {
      await tapVisible(tester, shownText('Save'));
      await settleUntil(
        tester,
        'the editor to close on the saved card',
        () => find.byType(CardEditorScreen).evaluate().isEmpty,
      );
    }

    Future<ImageContent> storedImage(DeckScreens screens) async =>
        (await screens.cards()).single.front.whereType<ImageContent>().single;

    testWidgets(
      'the add sheet offers Photo, which picks a whole photo and stores it with its size',
      (tester) async {
        final screens = await openWithPhoto(tester);
        expect(pick.picks, [(ImageOrigin.album, ImageShape.whole)]);
        expect(find.byType(ImagePhoto), findsWidgets);

        await tapVisible(tester, shownText('Add blank'));
        await save(tester);

        final image = await storedImage(screens);
        expect(
          (image.media, image.width, image.height),
          (const MediaId('photo0'), 160, 90),
        );
        expect(image.boxes, hasLength(1));
      },
    );

    testWidgets(
      'a photo with no box sits on the side its chips choose, the chips go with its first box, and come back with its last gone',
      (tester) async {
        final screens = await openWithPhoto(tester);
        final group = find.ancestor(
          of: shownText('Add blank'),
          matching: find.byType(EditorGroup),
        );
        Finder side(String name) => find.descendant(
          of: group,
          matching: widgetWithShownText(AppChip, name),
        );
        expect(side('Front'), findsOneWidget);
        expect(tester.widget<AppChip>(side('Front')).selected, isTrue);
        await tapVisible(tester, side('Back'));
        expect(tester.widget<AppChip>(side('Back')).selected, isTrue);

        await tapVisible(tester, shownText('Add blank'));
        expect(side('Front'), findsNothing, reason: 'a box has no side');
        expect(side('Back'), findsNothing);

        await tapVisible(tester, shownText('Delete blank'));
        expect(side('Back'), findsOneWidget, reason: 'no box, a side again');
        expect(tester.widget<AppChip>(side('Back')).selected, isTrue);

        await save(tester);
        final card = (await screens.cards()).single;
        expect(card.cells!.whereType<PlacedCell>().single.side, CellSide.back);
        expect(card.back.whereType<ImageContent>(), hasLength(1));
      },
    );

    testWidgets(
      'a photo with a box is saved with no side, drawn as a question',
      (tester) async {
        final screens = await openWithPhoto(tester);
        await tapVisible(tester, shownText('Add blank'));
        await save(tester);
        final cells = (await screens.cards()).single.cells!;
        expect(cells.whereType<PlacedCell>(), isEmpty);
        expect(cells.whereType<BlankCell>(), hasLength(1));
      },
    );

    testWidgets(
      'Add blank, the move and size tools, the answer and Delete blank edit a box without a drag',
      (tester) async {
        final screens = await openWithPhoto(tester);
        await tapVisible(tester, shownText('Add blank'));
        await tapVisible(tester, shownText('Add blank'));
        expect(_target('Blank 1'), findsOneWidget);
        expect(_target('Blank 2'), findsOneWidget);

        // The second box, selected as it is added.
        await tapVisible(tester, find.byTooltip('Move right'));
        await tapVisible(tester, find.byTooltip('Move up'));
        await tapVisible(tester, find.byTooltip('Wider'));
        await tapVisible(tester, find.byTooltip('Shorter'));
        await tester.ensureVisible(
          find.descendant(
            of: widgetWithShownText(AppTextField, 'Answer (optional)'),
            matching: find.byType(TextField),
          ),
        );
        await tester.enterText(
          find.descendant(
            of: widgetWithShownText(AppTextField, 'Answer (optional)'),
            matching: find.byType(TextField),
          ),
          '  Seoul  ',
        );
        await tester.pump();
        // The first box, under the second, selected as a screen reader
        // taps it, then deleted.
        tester.semantics.tap(find.semantics.byLabel('Blank 1'));
        await tester.pumpAndSettle();
        await tapVisible(tester, shownText('Delete blank'));
        expect(_target('Blank 2'), findsNothing);
        expect(_target('Blank 1'), findsOneWidget);
        await save(tester);

        final box = (await storedImage(screens)).boxes.single;
        expect(box.id, '2', reason: 'a box keeps its id once another goes');
        // Added at 0.35, 0.4, 0.3 by 0.2, then one step right and up, wider
        // and shorter.
        expect(box.x, moreOrLessEquals(0.40));
        expect(box.y, moreOrLessEquals(0.35));
        expect(box.w, moreOrLessEquals(0.35));
        expect(box.h, moreOrLessEquals(0.15));
        expect(box.answer, 'Seoul');
      },
    );

    testWidgets(
      'a drag over the photo draws a box, a drag on a box moves it and a drag on its corner resizes it',
      (tester) async {
        final screens = await openWithPhoto(tester);
        // The editor's photo, under the preview's.
        final photo = find.byType(ImagePhoto).last;
        await tester.ensureVisible(photo);
        await tester.pumpAndSettle();
        final frame = tester.getRect(photo);
        Offset at(double x, double y) =>
            frame.topLeft + Offset(x * frame.width, y * frame.height);

        await tester.dragFrom(at(0.2, 0.2), at(0.6, 0.6) - at(0.2, 0.2));
        await tester.pumpAndSettle();
        expect(_target('Blank 1'), findsOneWidget);

        // Each drag is longer than the slop that tells a pan from a tap.
        final box = tester.getRect(_target('Blank 1'));
        await tester.dragFrom(box.center, Offset(0.2 * frame.width, 0));
        await tester.pumpAndSettle();
        final handle = tester.getCenter(
          find.byKey(const ValueKey('image box handle')),
        );
        await tester.dragFrom(handle, Offset(0, 0.3 * frame.height));
        await tester.pumpAndSettle();
        await save(tester);

        final stored = (await storedImage(screens)).boxes.single;
        // Drawn from 0.2, 0.2 to 0.6, 0.6, moved 0.2 right, then 0.3 taller;
        // each drag counts from where the finger went down.
        const epsilon = 1e-3;
        expect(stored.x, moreOrLessEquals(0.4, epsilon: epsilon));
        expect(stored.y, moreOrLessEquals(0.2, epsilon: epsilon));
        expect(stored.w, moreOrLessEquals(0.4, epsilon: epsilon));
        expect(stored.h, moreOrLessEquals(0.7, epsilon: epsilon));
      },
    );

    testWidgets(
      'a screen reader stops on a selected box but not on its resize handle, which the tools stand in for',
      (tester) async {
        await openWithPhoto(tester);
        await tapVisible(tester, shownText('Add blank'));
        final semantics = tester.ensureSemantics();
        final handle = find.byKey(const ValueKey('image box handle'));
        expect(handle, findsOneWidget, reason: 'setup: the box is selected');

        // Control: the box's target is a node of its own.
        expect(tester.getSemantics(_target('Blank 1')).label, 'Blank 1');
        // The handle's node is an ancestor's, larger than the handle.
        final node = tester.getSemantics(handle);
        expect(node.rect.width, greaterThan(tester.getSize(handle).width));
        expect(node.label, isNot(contains('1')));
        semantics.dispose();
      },
    );

    testWidgets(
      'a box drawn smaller than a fingertip still has a target of at least 44 on each side',
      (tester) async {
        await openWithPhoto(tester);
        await tapVisible(tester, shownText('Add blank'));
        for (var step = 0; step < 6; step++) {
          await tapVisible(tester, find.byTooltip('Narrower'));
          await tapVisible(tester, find.byTooltip('Shorter'));
        }
        final drawn = tester.getRect(_editorBoxMark());
        final target = tester.getRect(_target('Blank 1'));

        expect(drawn.width, lessThan(AppSize.tapTarget), reason: 'setup');
        expect(drawn.height, lessThan(AppSize.tapTarget), reason: 'setup');
        expect(target.width, greaterThanOrEqualTo(AppSize.tapTarget));
        expect(target.height, greaterThanOrEqualTo(AppSize.tapTarget));
        expect((target.center - drawn.center).distance, lessThan(0.001));
      },
    );

    testWidgets('a 사진 block saved without a photo says so and saves nothing', (
      tester,
    ) async {
      final screens = await DeckScreens.open(
        tester,
        overrides: [
          mediaStoreProvider.overrideWithValue(media),
          imagePickProvider.overrideWithValue(pick),
        ],
      );
      await screens.push(
        (deck) => CardEditorScreen(preview: studyPreview, deck: deck),
      );
      for (final (index, text) in ['front', 'back'].indexed) {
        await tester.enterText(find.byType(TextField).at(index), text);
      }
      await tester.ensureVisible(find.bySemanticsLabel('Add block'));
      await screens.tap(find.bySemanticsLabel('Add block'));
      await screens.tap(shownText('Photo').last);
      expect(shownText('Choose a photo'), findsNothing);
      await tapVisible(tester, shownText('Save'));

      expect(shownText('Choose a photo'), findsOneWidget);
      expect(await screens.cards(), isEmpty);
    });

    testWidgets(
      'a new blank takes the focus in its answer; the photo is replaced keeping its blanks, showing progress while stored, or deleted with an undo (#622)',
      (tester) async {
        final screens = await openWithPhoto(tester);
        await tapVisible(tester, shownText('Add blank'));
        final answer = find.descendant(
          of: find
              .ancestor(
                of: shownText('Answer (optional)'),
                matching: find.byType(Column),
              )
              .first,
          matching: find.byType(TextField),
        );
        expect(hasFocus(tester, answer), isTrue, reason: 'typed next');
        expect(inView(tester, answer), isTrue);
        await tester.enterText(answer, 'Paris');

        await tapPick(tester, shownText('Choose another photo'));
        expect(find.byType(CircularProgressIndicator), findsOneWidget);
        await settleUntil(
          tester,
          'the replacing photo',
          () => find.byType(CircularProgressIndicator).evaluate().isEmpty,
        );
        expect(_target('Blank 1'), findsOneWidget, reason: 'its blank kept');

        await tapVisible(tester, shownText('Delete photo'));
        expect(shownText('Photo deleted'), findsOneWidget);
        expect(find.byType(ImagePhoto), findsNothing);
        expect(shownText('Choose from album'), findsOneWidget);
        await tapVisible(tester, find.text('Undo'));
        expect(find.byType(ImagePhoto), findsOneWidget);

        await save(tester);
        final image = await storedImage(screens);
        expect(image.media, const MediaId('photo1'), reason: 'the second');
        expect(image.boxes.single.answer, 'Paris');
        await anyReleased(tester);
        expect(await released(tester), {'photo0'}, reason: 'the replaced one');
      },
    );

    testWidgets("a photo's three actions stack full width under it (#632)", (
      tester,
    ) async {
      await openWithPhoto(tester);
      expectStackedFullWidth(tester, [
        'Choose another photo',
        'Take again',
        'Delete photo',
      ], full: 'Add blank');
    });

    testWidgets(
      "an edit in the photo's 칸 ends Delete photo's Undo, and an edit in another 칸 does not (#632)",
      (tester) async {
        await openWithPhoto(tester);
        await tapVisible(tester, shownText('Delete photo'));
        expect(shownText('Photo deleted'), findsOneWidget);
        await typeBlock(tester, 'more');
        await tester.pumpAndSettle();
        expect(
          shownText('Photo deleted'),
          findsOneWidget,
          reason: "the Text's edit is outside the photo's group",
        );
        await tapVisible(
          tester,
          find.descendant(
            of: find.ancestor(
              of: shownText('Photo').first,
              matching: find.byType(EditorGroup),
            ),
            matching: widgetWithShownText(AppChip, 'Back'),
          ),
        );
        await tester.pumpAndSettle();
        expect(shownText('Photo deleted'), findsNothing);
        expect(find.text('Undo'), findsNothing);
      },
    );

    testWidgets(
      'a photo the card is saved with is kept, and one left unsaved goes when the editor is left',
      (tester) async {
        await openWithPhoto(tester);
        await save(tester);
        expect(await released(tester), isEmpty, reason: 'saved with the card');

        final screens = await DeckScreens.open(
          tester,
          overrides: [
            mediaStoreProvider.overrideWithValue(media),
            imagePickProvider.overrideWithValue(pick),
          ],
        );
        await screens.push(
          (deck) => CardEditorScreen(preview: studyPreview, deck: deck),
        );
        await fillText(tester);
        await tester.ensureVisible(find.bySemanticsLabel('Add block'));
        await screens.tap(find.bySemanticsLabel('Add block'));
        await screens.tap(shownText('Photo').last);
        await tapPick(tester, shownText('Choose from album'));
        await chosen(tester);
        await tapVisible(tester, find.byTooltip('Close'));
        await tapVisible(tester, shownText('Discard'));
        await anyReleased(tester);

        expect(await released(tester), {'photo1'});
      },
    );

    testWidgets(
      'a photo whose pick ends after the editor is left is stored and released, with no error',
      (tester) async {
        final screens = await DeckScreens.open(
          tester,
          overrides: [
            mediaStoreProvider.overrideWithValue(media),
            imagePickProvider.overrideWithValue(pick),
          ],
        );
        await screens.push(
          (deck) => CardEditorScreen(preview: studyPreview, deck: deck),
        );
        await fillText(tester);
        await tester.ensureVisible(find.bySemanticsLabel('Add block'));
        await screens.tap(find.bySemanticsLabel('Add block'));
        await screens.tap(shownText('Photo').last);
        final hold = pick.hold = Completer<void>();
        await tapPick(tester, shownText('Choose from album'));
        // The pick's progress turns until it ends, so nothing settles: each
        // tap waits out the sheet's transition instead.
        for (final control in [find.byTooltip('Close'), shownText('Discard')]) {
          await tester.tap(control);
          for (var frame = 0; frame < 10; frame++) {
            await tester.pump(const Duration(milliseconds: 100));
          }
        }
        expect(find.byType(CardEditorScreen), findsNothing, reason: 'setup');

        hold.complete();
        await anyReleased(tester);

        expect(tester.takeException(), isNull);
        expect(
          (await tester.runAsync(
            () => mediaDb.select(mediaDb.mediaUploads).get(),
          ))!,
          isEmpty,
          reason: 'its upload is let go',
        );
        expect(await released(tester), {'photo0'});
      },
    );

    for (final mode in [ThemeMode.light, ThemeMode.dark]) {
      testWidgets(
        'in the ${mode.name} theme a photo with a small selected box meets the tap target, label and contrast guidelines',
        (tester) async {
          await openWithPhoto(tester, themeMode: mode);
          await tapVisible(tester, shownText('Add blank'));
          for (var step = 0; step < 6; step++) {
            await tapVisible(tester, find.byTooltip('Shorter'));
          }
          await tester.ensureVisible(_target('Blank 1'));
          await tester.pumpAndSettle();
          final handle = tester.ensureSemantics();
          await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
          await expectLater(tester, meetsGuideline(iOSTapTargetGuideline));
          await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
          await expectLater(tester, meetsGuideline(textContrastGuideline));
          expectScreenTextReadable(tester);
          handle.dispose();
        },
      );
    }
  });
}

/// The editor's box target read as [label], a button.
Finder _target(String label) => find.byWidgetPredicate(
  (widget) =>
      widget is Semantics &&
      widget.properties.label == label &&
      widget.properties.button == true,
);

/// The drawn outline of the editor's one box, inside its larger target.
Finder _editorBoxMark() => find
    .descendant(of: _target('Blank 1'), matching: find.byType(DecoratedBox))
    .first;
