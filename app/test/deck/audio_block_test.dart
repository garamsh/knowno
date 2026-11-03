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
import 'package:knowno/design/app_button.dart';
import 'package:knowno/design/theme.dart';
import 'package:knowno/l10n/app_localizations.dart';
import 'package:knowno/media/media.dart';

import '../contrast.dart';
import '../home/deck_screens.dart';
import '../media/fakes.dart';
import '../settle_until.dart';
import 'editor.dart';

const _sound = AudioContent(
  media: MediaId('sound'),
  duration: Duration(milliseconds: 1250),
);

void main() {
  driftRuntimeOptions.dontWarnAboutMultipleDatabases = true;

  group('the play control (ADR 0112)', () {
    late FakeAudioPlayback playback;

    setUp(() => playback = FakeAudioPlayback());

    Future<void> drawSide(
      WidgetTester tester,
      List<Content> side, {
      ThemeMode themeMode = ThemeMode.light,
    }) async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: [audioPlaybackProvider.overrideWithValue(playback)],
          child: MaterialApp(
            theme: lightTheme,
            darkTheme: darkTheme,
            themeMode: themeMode,
            locale: const Locale('en'),
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: Scaffold(body: Center(child: ContentView(side))),
          ),
        ),
      );
    }

    testWidgets(
      'a side holding a sound draws a control named Play sound, which plays it, and its length rounded up',
      (tester) async {
        await drawSide(tester, const [TextContent('cat'), _sound]);
        final handle = tester.ensureSemantics();

        expect(find.text('0:02'), findsOneWidget);
        expect(
          tester.getSemantics(find.byTooltip('Play sound')),
          isSemantics(
            tooltip: 'Play sound',
            isButton: true,
            hasTapAction: true,
          ),
        );
        expect(playback.plays, isEmpty, reason: 'nothing plays on its own');
        await tester.tap(find.byTooltip('Play sound'));
        await tester.pump();

        expect(playback.plays, [const MediaId('sound')]);
        handle.dispose();
      },
    );

    testWidgets('a sound that cannot be played says so', (tester) async {
      playback.playable = false;
      await drawSide(tester, const [_sound]);

      await tester.tap(find.byTooltip('Play sound'));
      await tester.pump();

      expect(find.text("Couldn't play the sound"), findsOneWidget);
    });

    for (final mode in [ThemeMode.light, ThemeMode.dark]) {
      testWidgets(
        'in the ${mode.name} theme the control meets the tap target, label and contrast guidelines',
        (tester) async {
          await drawSide(tester, const [_sound], themeMode: mode);
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

  group('the editor (ADR 0112)', () {
    late Directory directory;
    late AppDatabase mediaDb;
    late MediaStore media;
    late FakeAudioRecording recording;
    late FakeAudioPick pick;
    late FakeAudioPlayback playback;

    setUp(() {
      directory = newMediaDirectory();
      mediaDb = AppDatabase(NativeDatabase.memory());
      var ids = 0;
      media = MediaStore(
        mediaDb,
        FakeMediaServer(),
        directory: directory,
        clock: () => DateTime.utc(2026, 10, 27),
        newId: () => 'sound${ids++}',
      );
      recording = FakeAudioRecording()..next = preparedAudio(3400);
      pick = FakeAudioPick()..next = preparedAudio(9000);
      playback = FakeAudioPlayback();
    });

    tearDown(() async {
      await mediaDb.close();
      await deleteMediaDirectory(directory);
    });

    /// Waits until the block holds the sound just recorded or picked, which
    /// "Remove sound" shows only then: the store's file and row are written
    /// outside the test's fake time.
    Future<void> stored(WidgetTester tester) async {
      final holding = find.text('Remove sound');
      await settleUntil(
        tester,
        'the stored sound',
        () => holding.evaluate().isNotEmpty,
      );
      expect(holding, findsOneWidget, reason: 'the sound was stored');
    }

    Future<void> tapVisible(WidgetTester tester, Finder finder) async {
      await tester.ensureVisible(finder);
      await tester.pumpAndSettle();
      await tester.tap(finder);
      await tester.pumpAndSettle();
    }

    /// Saves the card and waits until the editor closes, which it does once
    /// the card is stored and the sounds it does not hold are let go.
    Future<void> save(WidgetTester tester) async {
      await tapVisible(tester, find.text('Save'));
      await settleUntil(
        tester,
        'the editor to close on the saved card',
        () => find.byType(CardEditorScreen).evaluate().isEmpty,
      );
    }

    Future<Set<String>> released(WidgetTester tester) async => {
      for (final row in (await tester.runAsync(
        () => mediaDb.select(mediaDb.mediaDeletions).get(),
      ))!)
        row.id,
    };

    /// A new 자유 card's editor, its 글 on each side filled and a 음성 block
    /// added to its front.
    Future<DeckScreens> openWithSoundBlock(
      WidgetTester tester, {
      ThemeMode themeMode = ThemeMode.light,
    }) async {
      final screens = await DeckScreens.open(
        tester,
        themeMode: themeMode,
        overrides: [
          mediaStoreProvider.overrideWithValue(media),
          audioRecordingProvider.overrideWithValue(recording),
          audioPickProvider.overrideWithValue(pick),
          audioPlaybackProvider.overrideWithValue(playback),
        ],
      );
      await screens.push((deck) => CardEditorScreen(preview: studyPreview, deck: deck));
      for (final (index, text) in ['front', 'back'].indexed) {
        await tester.enterText(find.byType(TextField).at(index), text);
      }
      await tester.pump();
      await tapVisible(tester, find.bySemanticsLabel('Add block'));
      await tapVisible(tester, find.text('Sound').last);
      return screens;
    }

    Future<AudioContent> storedSound(DeckScreens screens) async =>
        (await screens.cards()).single.front.whereType<AudioContent>().single;

    testWidgets(
      'the add sheet offers Sound, whose recording is stored with its length and saved with the card',
      (tester) async {
        final screens = await openWithSoundBlock(tester);
        await tapVisible(tester, find.text('Record'));
        expect(recording.starts, 1);
        expect(find.text('Recording 0:00 / 1:00'), findsOneWidget);
        await tester.pump(const Duration(seconds: 3));
        expect(find.text('Recording 0:03 / 1:00'), findsOneWidget);

        await tapVisible(tester, find.text('Stop recording'));
        await stored(tester);
        expect(find.text('0:04'), findsWidgets, reason: '3.4 s, rounded up');
        await tapVisible(tester, find.byTooltip('Play sound').last);
        expect(playback.plays, [const MediaId('sound0')]);
        await save(tester);

        final sound = await storedSound(screens);
        expect(
          (sound.media, sound.duration),
          (const MediaId('sound0'), const Duration(milliseconds: 3400)),
        );
        expect(await released(tester), isEmpty, reason: 'saved with the card');
      },
    );

    testWidgets(
      'a sound sits on the side its chips choose and is saved there',
      (tester) async {
        final screens = await openWithSoundBlock(tester);
        await tapVisible(tester, find.text('Record'));
        await tester.pump(const Duration(seconds: 1));
        await tapVisible(tester, find.text('Stop recording'));
        await stored(tester);
        final group = find.ancestor(
          of: find.text('Sound').first,
          matching: find.byType(EditorGroup),
        );
        Finder side(String name) => find.descendant(
          of: group,
          matching: find.widgetWithText(AppChip, name),
        );
        expect(tester.widget<AppChip>(side('Front')).selected, isTrue);
        await tapVisible(tester, side('Back'));
        await save(tester);
        final card = (await screens.cards()).single;
        expect(card.cells!.whereType<PlacedCell>().single.side, CellSide.back);
        expect(card.back.whereType<AudioContent>(), hasLength(1));
        expect(card.front.whereType<AudioContent>(), isEmpty);
      },
    );

    testWidgets('a recording stops itself at the 60 second limit', (
      tester,
    ) async {
      await openWithSoundBlock(tester);
      await tapVisible(tester, find.text('Record'));
      await tester.pump(const Duration(seconds: 59));
      expect(recording.stops, 0, reason: 'still under the limit');

      await tester.pump(const Duration(seconds: 1));
      await stored(tester);

      expect(recording.stops, 1);
      expect(find.text('Stop recording'), findsNothing);
      expect(find.byTooltip('Play sound'), findsWidgets);
    });

    testWidgets(
      'a refused microphone says so and stores nothing, where an allowed one records',
      (tester) async {
        recording.failure = const MicrophoneDenied('refused');
        await openWithSoundBlock(tester);
        await tapVisible(tester, find.text('Record'));

        expect(
          find.text(
            "Can't use the microphone. Allow microphone access in Settings.",
          ),
          findsOneWidget,
        );
        expect(find.text('Stop recording'), findsNothing);

        // Control: allowed, the same button records.
        recording.failure = null;
        await tapVisible(tester, find.text('Record'));
        expect(find.text('Stop recording'), findsOneWidget);
      },
    );

    testWidgets(
      'a picked file is stored, one too long or large says so, and Remove sound leaves the block to fill',
      (tester) async {
        final screens = await openWithSoundBlock(tester);
        pick.failure = const MediaTooLarge('70 s');
        await tapVisible(tester, find.text('Choose a file'));
        expect(
          find.text('Choose a file of up to 60 seconds and 5 MB'),
          findsOneWidget,
        );

        pick.failure = null;
        await tapVisible(tester, find.text('Choose a file'));
        await stored(tester);
        expect(find.text('0:09'), findsWidgets);
        await tapVisible(tester, find.text('Remove sound'));
        await tapVisible(tester, find.text('Save'));
        expect(find.text('Add a sound'), findsOneWidget);
        expect(await screens.cards(), isEmpty);

        await tapVisible(tester, find.text('Choose a file'));
        await stored(tester);
        await save(tester);
        expect(
          (await storedSound(screens)).media,
          const MediaId('sound1'),
          reason: 'the second file picked',
        );
        expect(await released(tester), {'sound0'}, reason: 'removed unsaved');
      },
    );

    testWidgets(
      'while one sound block records, Record is off in every other block, and on again once it has stopped',
      (tester) async {
        await openWithSoundBlock(tester);
        await tapVisible(tester, find.bySemanticsLabel('Add block'));
        await tapVisible(tester, find.text('Sound').last);
        final record = find.widgetWithText(AppButton, 'Record');
        bool enabled(int at) =>
            tester.widget<AppButton>(record.at(at)).onPressed != null;
        expect(record, findsNWidgets(2), reason: 'setup: two sound blocks');
        expect([enabled(0), enabled(1)], [true, true], reason: 'control');

        await tapVisible(tester, record.first);
        expect(recording.starts, 1);
        expect(find.text('Stop recording'), findsOneWidget);
        expect(record, findsOneWidget, reason: 'the other block');
        expect(enabled(0), isFalse);
        await tester.tap(record, warnIfMissed: false);
        await tester.pumpAndSettle();
        expect(recording.starts, 1, reason: 'the other block did not record');

        await tapVisible(tester, find.text('Stop recording'));
        await stored(tester);
        expect(recording.stops, 1);
        expect(enabled(0), isTrue);
        await tapVisible(tester, record.first);
        expect(recording.starts, 2, reason: 'free again once stopped');
      },
    );

    testWidgets('a recording left unsaved goes when the editor is left', (
      tester,
    ) async {
      await openWithSoundBlock(tester);
      await tapVisible(tester, find.text('Record'));
      await tapVisible(tester, find.text('Stop recording'));
      await stored(tester);
      await tapVisible(tester, find.byTooltip('Close'));
      await tapVisible(tester, find.text('Discard'));
      await settleUntil(
        tester,
        'a released sound',
        () async => (await released(tester)).isNotEmpty,
      );

      expect(await released(tester), {'sound0'});
    });

    for (final mode in [ThemeMode.light, ThemeMode.dark]) {
      testWidgets(
        'in the ${mode.name} theme a 음성 block holding a sound meets the tap target, label and contrast guidelines',
        (tester) async {
          await openWithSoundBlock(tester, themeMode: mode);
          await tapVisible(tester, find.text('Choose a file'));
          await stored(tester);
          // The form from its top, where the whole side fits, so no control
          // is left half under the edge of the scroll view.
          tester
              .state<ScrollableState>(find.byType(Scrollable).first)
              .position
              .jumpTo(0);
          await tester.pumpAndSettle();
          expect(find.text('Remove sound').hitTestable(), findsOneWidget);
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
