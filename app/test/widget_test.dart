import 'dart:convert';

import 'package:drift/drift.dart' show QueryExecutor;
import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:shared_preferences_platform_interface/in_memory_shared_preferences_async.dart';
import 'package:shared_preferences_platform_interface/shared_preferences_async_platform_interface.dart';

import 'package:knowno/account/account.dart';
import 'package:knowno/deck/deck.dart'
    show deckRepositoryProvider, deckStorageKeys;
import 'package:knowno/design/app_chip.dart';
import 'package:knowno/design/app_text_field.dart';
import 'package:knowno/design/theme_choice.dart';
import 'package:knowno/home/home.dart';
import 'package:knowno/home/src/deck_screen.dart';
import 'package:knowno/main.dart';
import 'package:knowno/media/media.dart';
import 'package:knowno/photo_import/photo_import.dart';
import 'package:knowno/sharing/sharing.dart';
import 'package:knowno/study/study.dart';
import 'package:knowno/sync/sync.dart';

import 'contrast.dart';
import 'account/fake_account_service.dart';
import 'photo_import/fakes.dart';
import 'sharing/fakes.dart';
import 'study/minutes_sheet.dart';
import 'sync/fake_sync_server.dart';
import 'media/fakes.dart';
import 'word_breaks.dart';

const _ada = UserId('00000000-0000-4000-8000-00000000000a');

/// An extraction client the test never calls.
final class _NoExtraction implements ExtractionClient {
  @override
  Future<Extracted?> extract(
    JpegPhoto photo, {
    String? cursor,
    required Future<void> cancel,
  }) => throw UnimplementedError('not called');

  @override
  Future<ExtractionAllowance?> allowance() =>
      throw UnimplementedError('not called');
}

/// The labels a device stored, as the label presets are kept: enough to
/// scroll the strip above the keyboard.
final _storedLabels = jsonEncode([
  for (final (label, name) in const [
    ('명', 'noun'),
    ('동', 'verb'),
    ('형', 'adjective'),
    ('부', 'adverb'),
    ('대', 'pronoun'),
    ('전', 'preposition'),
    ('접', 'conjunction'),
    ('감', 'interjection'),
    ('관', 'determiner'),
    ('수', 'numeral'),
    ('조', 'particle'),
    ('보', 'auxiliary'),
    ('양', 'classifier'),
    ('구', 'phrase'),
  ])
    {'label': label, 'name': name},
]);

void main() {
  late Scheduler scheduler;
  late QueryExecutor executor;
  setUpAll(() async => scheduler = await Scheduler.load());

  /// Composes the app over an in-memory database and theme storage holding
  /// [themeMode] when given, signed in through [account] when given and as a
  /// restored session otherwise, extracting cards through [extraction] with
  /// a photo import kept in [jobStore], and sharing decks through [sharing];
  /// the first-run daily minutes step has shown unless [minutesAsked] is
  /// false.
  Future<void> pumpApp(
    WidgetTester tester, {
    String? themeMode,
    AccountService? account,
    ExtractionClient? extraction,
    ImportJobStore? jobStore,
    SharingServer? sharing,
    bool minutesAsked = true,
    bool labelsStored = false,
  }) async {
    SharedPreferencesAsyncPlatform.instance =
        InMemorySharedPreferencesAsync.withData({
          'themeMode': ?themeMode,
          studyCoachShownKey: true,
          if (labelsStored) deckStorageKeys.single: _storedLabels,
          if (minutesAsked) dailyMinutesAskedKey: true,
        });
    final themeStorage = (await tester.runAsync(
      () => SharedPreferencesWithCache.create(
        cacheOptions: const SharedPreferencesWithCacheOptions(
          allowList: {
            ...themeStorageKeys,
            ...photoImportStorageKeys,
            ...studyStorageKeys,
            ...deckStorageKeys,
          },
        ),
      ),
    ))!;
    executor = NativeDatabase.memory();
    await tester.pumpWidget(
      composeApp(
        executor,
        scheduler,
        account ??
            FakeAccountService(
              const SignedIn(userId: _ada, email: 'ada@example.com'),
            ),
        FakeSyncServer(_ada),
        themeStorage,
        extraction,
        jobStore ?? MemoryImportJobStore(),
        sharing,
        FakeReachability(),
        const UnavailableMediaServer(),
        unusedMediaDirectory,
        '1.0.0',
      ),
    );
    await tester.pumpAndSettle();
  }

  /// The brightness the deck list is drawn in.
  Brightness brightness(WidgetTester tester) =>
      Theme.of(tester.element(find.byType(HomeScreen))).brightness;

  // Unmounting the scope cancels drift's stream queries, whose cleanup timer
  // must fire before the test body ends; disposing sync cancels the run a
  // write scheduled.
  Future<void> unmountApp(WidgetTester tester) async {
    ProviderScope.containerOf(
      tester.element(find.byType(AccountGate, skipOffstage: false)),
    ).read(syncControllerProvider).dispose();
    await tester.pumpWidget(const SizedBox());
    await tester.pump(const Duration(seconds: 1));
  }

  Future<void> enterText(WidgetTester tester, String label, String text) =>
      tester.enterText(widgetWithShownText(AppTextField, label), text);

  /// A new card's front field, its first Text block.
  final front = find.byType(TextField).at(0);

  /// A new card's back field, its back's Text block after the front's.
  final back = find.byType(TextField).at(1);

  Future<void> enterFront(WidgetTester tester, String text) =>
      tester.enterText(front, text);

  Future<void> enterBack(WidgetTester tester, String text) =>
      tester.enterText(back, text);

  /// Shows the tab named [label], tapping it in the tab bar.
  Future<void> showTab(WidgetTester tester, String label) async {
    final semantics = tester.ensureSemantics();
    await tester.tap(
      find.descendant(
        of: find.bySemanticsLabel('Tabs'),
        matching: shownText(label),
      ),
    );
    semantics.dispose();
    await tester.pumpAndSettle();
  }

  /// Shows the 노트 tab's first screen, where the decks are listed.
  Future<void> showNotes(WidgetTester tester) => showTab(tester, 'Notes');

  /// Opens 설정 over the menu from 홈's profile button.
  Future<void> showSettings(WidgetTester tester) async {
    await showTab(tester, 'Home');
    await tester.tap(find.byTooltip('Settings'));
    await tester.pumpAndSettle();
  }

  Future<void> createDeckAndOpen(WidgetTester tester, String name) async {
    // The first deck is made from the first-run home's "Create a note",
    // later ones from the 노트 tab's "New note"; each opens 새 노트.
    if (shownText('Create a note').evaluate().isNotEmpty) {
      await tester.tap(shownText('Create a note'));
    } else {
      await showNotes(tester);
      await tester.tap(shownText('New note'));
    }
    await tester.pumpAndSettle();
    await enterText(tester, 'Note name', name);
    // Saving makes the deck and opens it.
    await tester.tap(shownText('Save'));
    await tester.pumpAndSettle();
    expect(find.byType(DeckScreen), findsOneWidget);
    expect(shownText(name), findsOneWidget);
  }

  /// The deck page's "이 노트 학습", with its count or without.
  final studyThisDeck = shownTextContaining('Study this note');

  Future<void> addCard(WidgetTester tester, String front, String back) async {
    await tester.tap(shownText('Add card'));
    await tester.pumpAndSettle();
    await tester.tap(shownText('Enter by hand'));
    await tester.pumpAndSettle();
    await enterFront(tester, front);
    await enterBack(tester, back);
    await tester.tap(shownText('Save'));
    await tester.pumpAndSettle();
  }

  testWidgets('photo import is offered only with an extraction client', (
    tester,
  ) async {
    await pumpApp(tester);
    await createDeckAndOpen(tester, 'French');
    await tester.tap(shownText('Add card'));
    await tester.pumpAndSettle();
    expect(shownText('Enter by hand'), findsOneWidget);
    expect(shownText('Take photo'), findsNothing);
    expect(shownText('Choose from album'), findsNothing);
    await unmountApp(tester);

    await pumpApp(tester, extraction: _NoExtraction());
    await createDeckAndOpen(tester, 'French');
    await tester.tap(shownText('Add card'));
    await tester.pumpAndSettle();
    expect(shownText('Take photo'), findsOneWidget);
    expect(shownText('Choose from album'), findsOneWidget);
    await unmountApp(tester);
  });

  testWidgets(
    'the composed app offers on opening to resume a photo import a closed app left, and reads only its unread photos',
    (tester) async {
      // As a closed app left it: photo p0 read, photo p1 not yet.
      final store = MemoryImportJobStore()
        ..photos.addAll({'p0': testPhoto.bytes, 'p1': testPhoto.bytes})
        ..state = jsonEncode({
          'version': 1,
          'target': null,
          'origin': 'album',
          'photos': [
            {
              'key': 'p0',
              'width': testPhoto.width,
              'height': testPhoto.height,
              'cards': <Object?>[],
            },
            {'key': 'p1', 'width': testPhoto.width, 'height': testPhoto.height},
          ],
        });
      final client = FakeExtractionClient();
      await pumpApp(tester, extraction: client, jobStore: store);

      expect(shownText('Resume reading 1 photo?'), findsOneWidget);
      expect(client.calls, isEmpty, reason: 'nothing read until asked');
      await tester.tap(shownText('Resume'));
      await tester.pumpAndSettle();
      expect(client.calls, hasLength(1), reason: 'the unread photo alone');
      expect(shownText('Reading photos 1/2'), findsOneWidget);
      await unmountApp(tester);
    },
  );

  group('a photo import in the background', () {
    Future<void> frames(WidgetTester tester) async {
      for (var frame = 0; frame < 5; frame++) {
        await tester.pump(const Duration(milliseconds: 200));
      }
    }

    /// Starts a job of [count] photos into the only deck, opens it by the
    /// bar and leaves it by the system back, as a user leaving the import
    /// does; resolves to the app's photo import.
    Future<PhotoImports> startAndLeave(WidgetTester tester, int count) async {
      final container = ProviderScope.containerOf(
        tester.element(find.byType(AccountGate, skipOffstage: false)),
      );
      final imports = container.read(photoImportsProvider)!;
      final deck = (await tester.runAsync(
        () => container.read(deckRepositoryProvider).watchDecks().first,
      ))!.single;
      final job = imports.create(deck.id, PhotoOrigin.album);
      imports.attach(job);
      await job.add([for (var i = 0; i < count; i++) () async => testPhoto]);
      await frames(tester);
      await tester.tap(find.byType(PhotoImportBar));
      // The reading screens animate while they wait, so they never settle.
      await frames(tester);
      expect(
        find.byType(PhotoImportBar),
        findsNothing,
        reason: 'no bar over the import it opens',
      );
      await tester.binding.handlePopRoute();
      await frames(tester);
      expect(imports.job, same(job), reason: 'leaving keeps it reading');
      return imports;
    }

    /// What the bar reads.
    String barText(WidgetTester tester) => tester
        .widget<Text>(
          find.descendant(
            of: find.byType(PhotoImportBar),
            matching: find.byType(Text),
          ),
        )
        .data!;

    testWidgets(
      'reads on while the user studies, counting in a bar over study that covers none of it, changes nothing when it ends, and opens the read cards from the bar',
      (tester) async {
        final client = FakeExtractionClient();
        await pumpApp(tester, extraction: client);
        await createDeckAndOpen(tester, 'French');
        await addCard(tester, 'Chat', 'cat');
        await addCard(tester, 'Chien', 'dog');
        await startAndLeave(tester, 3);

        await showTab(tester, 'Home');
        await tester.ensureVisible(shownText('Start'));
        await tester.pumpAndSettle();
        await tester.tap(shownText('Start'));
        await tester.pumpAndSettle();
        expect(find.byType(StudyScreen), findsOneWidget);
        expect(barText(tester), 'Reading photos 0/3');
        // Study lays out below the bar, so the bar covers none of its
        // controls.
        expect(
          tester.getRect(find.byType(StudyScreen)).top,
          greaterThanOrEqualTo(
            tester.getRect(find.byType(PhotoImportBar)).bottom,
          ),
        );

        // Study goes on: a card answered.
        expect(shownText('0/2'), findsOneWidget);
        final study = tester.getRect(find.byType(StudyScreen));
        await tester.timedDragFrom(
          Offset(study.center.dx, study.top + study.height * 0.6),
          const Offset(200, 0),
          const Duration(seconds: 1),
        );
        await tester.pumpAndSettle();
        expect(shownText('1/2'), findsOneWidget);

        expect(client.calls, hasLength(3));
        client.calls[0].answer.complete([word(front: 'face', meaning: '얼굴')]);
        await tester.pump();
        await tester.pump();
        expect(barText(tester), 'Reading photos 1/3');
        client.calls[1].answer.complete([word(front: 'eye', meaning: '눈')]);
        client.calls[2].answer.complete([word(front: 'ear', meaning: '귀')]);
        await tester.pumpAndSettle();

        // Reading ends with no dialog and no screen opened.
        expect(barText(tester), 'Review 3 cards');
        expect(find.byType(StudyScreen), findsOneWidget);
        expect(find.byType(Dialog), findsNothing);
        expect(shownText('1/2'), findsOneWidget);

        await tester.tap(find.byType(PhotoImportBar));
        await tester.pumpAndSettle();
        // The list of the three photos' cards, the first two rows in view.
        expect(shownText('Words found'), findsOneWidget);
        expect(shownText('Add 3 cards'), findsOneWidget);
        expect(shownText('face'), findsOneWidget);
        expect(shownText('eye'), findsOneWidget);
        expect(find.byType(PhotoImportBar), findsNothing);
        await unmountApp(tester);
      },
    );

    testWidgets(
      'a failure while the user is away shows in the bar, and the bar opens the failure',
      (tester) async {
        final client = FakeExtractionClient();
        await pumpApp(tester, extraction: client);
        await createDeckAndOpen(tester, 'French');
        await startAndLeave(tester, 1);
        expect(barText(tester), 'Reading photos 0/1');

        client.fail(const ModelFailed());
        await tester.pumpAndSettle();
        expect(barText(tester), "Couldn't read 1 photo");

        await tester.tap(find.byType(PhotoImportBar));
        await tester.pumpAndSettle();
        expect(
          shownText("Couldn't read the cards. Please try again in a moment."),
          findsOneWidget,
        );
        await unmountApp(tester);
      },
    );
  });

  testWidgets(
    'the composed app gives every new row a version 7 uuid in canonical lowercase form',
    (tester) async {
      final version7 = RegExp(
        r'^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
      );
      await pumpApp(tester);
      await createDeckAndOpen(tester, 'French');
      await addCard(tester, 'chat', 'cat');
      final container = ProviderScope.containerOf(
        tester.element(find.byType(AccountGate, skipOffstage: false)),
      );
      final decks = container.read(deckRepositoryProvider);

      final ids = (await tester.runAsync(() async {
        final deck = (await decks.watchDecks().first).single;
        final card = (await decks.listCards(deck.id)).single;
        return [
          deck.id.value,
          card.id.value,
          container.read(studyRepositoryProvider).newReviewId().value,
        ];
      }))!;

      expect(ids, everyElement(matches(version7)));
      expect(ids.toSet(), hasLength(3));
      await unmountApp(tester);
    },
  );

  testWidgets('sharing is offered only with a sharing server', (tester) async {
    await pumpApp(tester);
    expect(shownText('Create a note'), findsOneWidget);
    expect(shownText('Browse public notes'), findsNothing);
    await createDeckAndOpen(tester, 'French');
    await tester.tap(find.byTooltip('Note settings'));
    await tester.pumpAndSettle();
    expect(shownText('Rename'), findsOneWidget);
    expect(shownText('Publish'), findsNothing);
    await tester.tapAt(const Offset(20, 300));
    await tester.pumpAndSettle();
    await tester.pageBack();
    await tester.pumpAndSettle();
    await showNotes(tester);
    expect(shownText('New note'), findsOneWidget);
    expect(find.byTooltip('Notes menu'), findsNothing);
    expect(shownText('Browse public notes'), findsNothing);
    await unmountApp(tester);

    await pumpApp(tester, sharing: FakeSharingServer());
    await tester.tap(shownText('Browse public notes'));
    await tester.pumpAndSettle();
    expect(
      shownText('No public notes yet. Publish one of yours to be the first.'),
      findsOneWidget,
    );
    await tester.pageBack();
    await tester.pumpAndSettle();
    await createDeckAndOpen(tester, 'French');
    await tester.tap(find.byTooltip('Note settings'));
    await tester.pumpAndSettle();
    expect(shownText('Publish'), findsOneWidget);
    await tester.tapAt(const Offset(20, 300));
    await tester.pumpAndSettle();
    await tester.pageBack();
    await tester.pumpAndSettle();
    await showNotes(tester);
    await tester.tap(find.byTooltip('Notes menu'));
    await tester.pumpAndSettle();
    expect(shownText('Browse public notes'), findsOneWidget);
    await unmountApp(tester);
  });

  testWidgets(
    'opens on the first-run home, which offers only the ways to start this build has',
    (tester) async {
      await pumpApp(tester);

      expect(find.bySemanticsLabel('knowno'), findsOneWidget);
      expect(shownText('Shall we make your first note?'), findsOneWidget);
      // One sentence and one primary, which opens 새 노트.
      expect(shownText('Create a note'), findsOneWidget);
      expect(shownText('Browse public notes'), findsNothing);
      await tester.tap(shownText('Create a note'));
      await tester.pumpAndSettle();
      expect(widgetWithShownText(AppTextField, 'Note name'), findsOneWidget);
      await unmountApp(tester);

      await pumpApp(
        tester,
        extraction: _NoExtraction(),
        sharing: FakeSharingServer(),
      );
      expect(shownText('Create a note'), findsOneWidget);
      await tester.tap(shownText('Browse public notes'));
      await tester.pumpAndSettle();
      expect(
        shownText('No public notes yet. Publish one of yours to be the first.'),
        findsOneWidget,
      );
      await unmountApp(tester);
    },
  );

  testWidgets('shows Korean when the device locale is not supported', (
    tester,
  ) async {
    tester.platformDispatcher.localesTestValue = const [Locale('fr')];
    addTearDown(tester.platformDispatcher.clearLocalesTestValue);

    await pumpApp(tester);

    expect(shownText('첫 노트를 만들어 볼까요?'), findsOneWidget);
    expect(shownText('새 노트 만들기'), findsOneWidget);
    await unmountApp(tester);
  });

  testWidgets(
    'a duplicate front offers open existing and add anyway, and add anyway stores it',
    (tester) async {
      await pumpApp(tester);
      await createDeckAndOpen(tester, 'French');

      await addCard(tester, 'Chat', 'cat');
      await addCard(tester, 'Chat', 'chat (talk)');

      expect(shownText('This note already has this card'), findsOneWidget);
      expect(shownText('Open existing card'), findsOneWidget);
      await tester.tap(shownText('Add anyway'));
      await tester.pumpAndSettle();

      // The deck holds both cards, each shown whole.
      expect(shownText('Chat'), findsNWidgets(2));
      expect(shownText('cat'), findsOneWidget);
      expect(shownText('chat (talk)'), findsOneWidget);
      await unmountApp(tester);
    },
  );

  testWidgets('a card with an empty side is not saved and says why', (
    tester,
  ) async {
    await pumpApp(tester);
    await createDeckAndOpen(tester, 'French');

    await addCard(tester, 'Chat', '');

    expect(find.bySemanticsLabel('Add a back or a blank'), findsOneWidget);
    expect(shownText('Edit card'), findsNothing);
    expect(widgetWithShownText(AppBar, 'New card'), findsOneWidget);
    await unmountApp(tester);
  });

  group('the keyboard', () {
    /// Opens a new card's editor in a deck named French, on a phone's screen.
    Future<void> openEditor(WidgetTester tester) async {
      tester.view
        ..physicalSize = const Size(390, 844)
        ..devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await pumpApp(tester, labelsStored: true);
      await createDeckAndOpen(tester, 'French');
      await tester.tap(shownText('Add card'));
      await tester.pumpAndSettle();
      await tester.tap(shownText('Enter by hand'));
      await tester.pumpAndSettle();
    }

    /// Adds a Word, whose one meaning has a label field.
    Future<void> addMeanings(WidgetTester tester) async {
      await tester.ensureVisible(find.bySemanticsLabel('Add block'));
      await tester.pumpAndSettle();
      await tester.tap(find.bySemanticsLabel('Add block'));
      await tester.pumpAndSettle();
      await tester.tap(shownText('Word').last);
      await tester.pumpAndSettle();
      await tester.ensureVisible(widgetWithShownText(TextField, 'Label'));
      await tester.pumpAndSettle();
    }

    /// The action key the platform was last asked to show.
    String? actionKey(WidgetTester tester) {
      final client = tester.testTextInput.log.lastWhere(
        (call) => call.method == 'TextInput.setClient',
      );
      final [_, configuration as Map<Object?, Object?>] =
          client.arguments as List<Object?>;
      return configuration['inputAction'] as String?;
    }

    testWidgets(
      'closes on a tap outside a field, while a tap on another field or a button does what it did',
      (tester) async {
        await openEditor(tester);
        await tester.tap(front);
        await tester.pumpAndSettle();
        expect(tester.testTextInput.isVisible, isTrue);

        await tester.tap(back);
        await tester.pumpAndSettle();
        expect(
          tester
              .widget<EditableText>(
                find.descendant(of: back, matching: find.byType(EditableText)),
              )
              .focusNode
              .hasFocus,
          isTrue,
        );
        expect(tester.testTextInput.isVisible, isTrue);

        await tester.tap(find.bySemanticsLabel('Add block'));
        await tester.pumpAndSettle();
        expect(shownText('Word'), findsOneWidget, reason: 'its sheet');
        await tester.tap(shownText('Word'));
        await tester.pumpAndSettle();

        await tester.tap(back);
        await tester.pumpAndSettle();
        expect(tester.testTextInput.isVisible, isTrue);
        // The deck's name over the form handles no tap.
        await tester.tap(shownText('French'));
        await tester.pumpAndSettle();
        expect(tester.testTextInput.isVisible, isFalse);
        expect(FocusManager.instance.primaryFocus, isA<FocusScopeNode>());
        await unmountApp(tester);
      },
    );

    testWidgets(
      'closes on a drag that scrolls the form, and stays up for a drag across the label strip',
      (tester) async {
        await openEditor(tester);
        await addMeanings(tester);
        await tester.tap(widgetWithShownText(TextField, 'Label'));
        await tester.pumpAndSettle();
        expect(tester.testTextInput.isVisible, isTrue);
        final strip = find.ancestor(
          of: widgetWithShownText(AppChip, '명'),
          matching: find.byType(Scrollable),
        );

        await tester.drag(strip, const Offset(-200, 0));
        await tester.pumpAndSettle();
        expect(tester.testTextInput.isVisible, isTrue);

        // From the Word's heading, which handles no drag.
        // The keyboard's 336 over the form, which then holds more than fits.
        tester.view.viewInsets = const FakeViewPadding(bottom: 336);
        addTearDown(tester.view.resetViewInsets);
        await tester.pumpAndSettle();
        final form = tester.state<ScrollableState>(
          find
              .ancestor(
                of: shownText('Word').first,
                matching: find.byType(Scrollable),
              )
              .first,
        );
        expect(form.position.maxScrollExtent, greaterThan(0), reason: 'setup');
        await tester.drag(shownText('Word').first, const Offset(0, 200));
        await tester.pumpAndSettle();
        expect(tester.testTextInput.isVisible, isFalse);
        await unmountApp(tester);
      },
    );

    testWidgets(
      "keeps a multi-line field's newline key, and a single-line field's action closes it",
      (tester) async {
        await openEditor(tester);
        await tester.tap(front);
        await tester.pumpAndSettle();
        expect(actionKey(tester), 'TextInputAction.newline');

        await addMeanings(tester);
        await tester.tap(widgetWithShownText(TextField, 'Label'));
        await tester.pumpAndSettle();
        expect(actionKey(tester), 'TextInputAction.done');
        await tester.testTextInput.receiveAction(TextInputAction.done);
        await tester.pumpAndSettle();
        expect(tester.testTextInput.isVisible, isFalse);
        await unmountApp(tester);
      },
    );
  });

  testWidgets('a storage failure is shown to the user', (tester) async {
    await pumpApp(tester);
    await createDeckAndOpen(tester, 'French');
    // The database now refuses every write.
    await tester.runAsync(() => executor.runCustom('PRAGMA query_only = ON'));

    await addCard(tester, 'Chat', 'cat');

    expect(
      shownText(
        "Couldn't read or write the device's storage. Please try again.",
      ),
      findsOneWidget,
    );
    await unmountApp(tester);
  });

  testWidgets("a deck's Study this note opens a session on its cards", (
    tester,
  ) async {
    await pumpApp(tester);
    await createDeckAndOpen(tester, 'French');
    await addCard(tester, 'Chat', 'cat');

    await tester.tap(studyThisDeck);
    await tester.pumpAndSettle();

    expect(shownText('Chat'), findsOneWidget);
    expect(find.byTooltip('Close'), findsOneWidget);
    expect(shownText('0/1'), findsOneWidget);
    await unmountApp(tester);
  });

  testWidgets(
    "홈's hero counts today's cards across every deck, and Start studies them in one session",
    (tester) async {
      await pumpApp(tester);
      await createDeckAndOpen(tester, 'French');
      await addCard(tester, 'Chat', 'cat');
      await addCard(tester, 'Chien', 'dog');
      await tester.pageBack();
      await tester.pumpAndSettle();
      await createDeckAndOpen(tester, 'German');
      await addCard(tester, 'Hund', 'dog');
      await showTab(tester, 'Home');

      expect(shownText('3 cards'), findsOneWidget);
      await tester.ensureVisible(shownText('Start'));
      await tester.pumpAndSettle();
      await tester.tap(shownText('Start'));
      await tester.pumpAndSettle();

      expect(shownText('0/3'), findsOneWidget);
      await unmountApp(tester);
    },
  );

  testWidgets(
    'a deck made by hand opens empty, offering a card to add and no Study this note, and 홈 shows how to start until a card is added',
    (tester) async {
      await pumpApp(tester);
      await createDeckAndOpen(tester, 'French');

      expect(studyThisDeck, findsNothing);
      await showTab(tester, 'Home');
      expect(shownText('Make your first card?'), findsOneWidget);
      expect(shownText('All done'), findsNothing);

      // Its one primary opens the deck with its add sheet up; with a card
      // added, 홈 shows the day.
      await tester.ensureVisible(shownText('Add card'));
      await tester.pumpAndSettle();
      await tester.tap(shownText('Add card'));
      await tester.pumpAndSettle();
      await tester.tap(shownText('Enter by hand'));
      await tester.pumpAndSettle();
      await enterFront(tester, 'Chat');
      await enterBack(tester, 'cat');
      await tester.tap(shownText('Save'));
      await tester.pumpAndSettle();
      await showTab(tester, 'Home');
      expect(shownText('Make your first card?'), findsNothing);
      expect(shownText('1 card'), findsOneWidget);
      expect(shownText('Start'), findsOneWidget);
      await unmountApp(tester);
    },
  );

  testWidgets(
    "the first-run daily minutes step waits for 홈: none over the deck screen or on 기록 when a deck gets its first card, then once on 홈",
    (tester) async {
      await pumpApp(tester, minutesAsked: false);
      await createDeckAndOpen(tester, 'French');
      await addCard(tester, 'Chat', 'cat');
      expect(find.byType(BottomSheet), findsNothing);

      // On 기록, 홈 behind it now has a card.
      await showTab(tester, 'Record');
      expect(find.byType(BottomSheet), findsNothing);
      // 노트 again shows the deck it opened, over its first screen.
      await showNotes(tester);
      expect(find.byType(DeckScreen), findsOneWidget);
      expect(find.byType(BottomSheet), findsNothing);

      await showTab(tester, 'Home');
      await waitForPicker(tester);
      expect(
        shownText('How many minutes a day will you study?'),
        findsOneWidget,
      );
      await unmountApp(tester);
    },
  );

  testWidgets(
    'with no card left and one answered today, the deck\'s Study this note and 홈\'s Study open the completion sheet',
    (tester) async {
      await pumpApp(tester);
      await createDeckAndOpen(tester, 'French');
      await addCard(tester, 'Chat', 'cat');
      await tester.tap(studyThisDeck);
      await tester.pumpAndSettle();
      // Answered "Know" by a swipe of the current card.
      await tester.timedDrag(
        shownText('Chat'),
        const Offset(200, 0),
        const Duration(seconds: 1),
      );
      await tester.pumpAndSettle();
      // The deck page reads its count again when the session closes, so wait
      // until the answer's review row is stored: its write runs on real time,
      // and its continuations on frames.
      for (var tries = 0; ; tries++) {
        final rows = await tester.runAsync(
          () => executor.runSelect('SELECT COUNT(*) AS n FROM reviews', []),
        );
        if (rows!.single['n'] == 1) break;
        if (tries == 100) fail('the answer was never stored');
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 10)),
        );
        await tester.pump();
      }
      await tester.tap(shownText('Done'));
      await tester.pumpAndSettle();

      await tester.tap(studyThisDeck);
      await tester.pumpAndSettle();
      expect(shownText('Done for today'), findsOneWidget);
      await tester.tap(shownText('Done'));
      await tester.pumpAndSettle();
      await showTab(tester, 'Home');

      expect(shownText('All done'), findsOneWidget);
      // 홈 scrolls where the test font makes it taller than its screen.
      await tester.ensureVisible(shownText('Study'));
      await tester.pumpAndSettle();
      await tester.tap(shownText('Study'));
      await tester.pumpAndSettle();
      expect(shownText('Done for today'), findsOneWidget);
      await unmountApp(tester);
    },
  );

  testWidgets(
    "홈's profile button opens 설정, the account screen, signed in, over the menu, and back returns to 홈",
    (tester) async {
      await pumpApp(tester);

      await showSettings(tester);

      expect(find.byType(AccountScreen), findsOneWidget);
      expect(shownText('ada@example.com'), findsOneWidget);
      expect(find.bySemanticsLabel('Tabs'), findsNothing);
      expect(await tester.binding.handlePopRoute(), isTrue);
      await tester.pumpAndSettle();
      expect(find.byType(AccountScreen), findsNothing);
      expect(find.bySemanticsLabel('Tabs'), findsOneWidget);
      await unmountApp(tester);
    },
  );

  testWidgets(
    "the account screen's 하루 학습 시간 row opens the minutes picker as a screen, whose Save the row then shows",
    (tester) async {
      await pumpApp(tester);

      await showSettings(tester);
      expect(shownText('Study'), findsOneWidget);
      await tester.tap(shownText('Daily study time'));
      await waitForPicker(tester);
      expect(find.byType(BottomSheet), findsNothing);
      await tester.tap(find.byTooltip('5 minutes less'));
      await tester.pumpAndSettle();
      await tester.tap(shownText('Save'));
      await tester.pumpAndSettle();

      expect(find.byType(AccountScreen), findsOneWidget);
      expect(shownText('15 min'), findsOneWidget);
      await unmountApp(tester);
    },
  );

  testWidgets(
    "the account screen's 품사 표시 row, under Study beside the minutes, opens the labels the card editor offers",
    (tester) async {
      await pumpApp(tester, labelsStored: true);

      await showSettings(tester);
      expect(
        tester.getRect(shownText('Labels')).top,
        greaterThan(tester.getRect(shownText('Daily study time')).bottom),
      );
      await tester.tap(shownText('Labels'));
      await tester.pumpAndSettle();
      expect(find.byType(AccountScreen), findsNothing);
      expect(find.bySemanticsLabel('Edit 명 noun'), findsOneWidget);
      await unmountApp(tester);
    },
  );

  testWidgets('the theme follows the system until a choice overrides it', (
    tester,
  ) async {
    tester.platformDispatcher.platformBrightnessTestValue = Brightness.dark;
    addTearDown(tester.platformDispatcher.clearPlatformBrightnessTestValue);
    await pumpApp(tester);
    expect(brightness(tester), Brightness.dark);

    tester.platformDispatcher.platformBrightnessTestValue = Brightness.light;
    await tester.pumpAndSettle();
    expect(brightness(tester), Brightness.light);

    await showSettings(tester);
    await tester.ensureVisible(shownText('Theme'));
    await tester.pumpAndSettle();
    await tester.tap(shownText('Theme'));
    await tester.pumpAndSettle();
    await tester.tap(shownText('Dark'));
    await tester.pumpAndSettle();
    await tester.pageBack();
    await tester.pumpAndSettle();
    expect(brightness(tester), Brightness.dark);

    await showSettings(tester);
    await tester.tap(shownText('Theme'));
    await tester.pumpAndSettle();
    await tester.tap(shownText('Light'));
    await tester.pumpAndSettle();
    tester.platformDispatcher.platformBrightnessTestValue = Brightness.dark;
    await tester.pageBack();
    await tester.pumpAndSettle();
    expect(brightness(tester), Brightness.light);
    await unmountApp(tester);
  });

  testWidgets('a stored choice applies from the first frame', (tester) async {
    tester.platformDispatcher.platformBrightnessTestValue = Brightness.light;
    addTearDown(tester.platformDispatcher.clearPlatformBrightnessTestValue);

    await pumpApp(tester, themeMode: 'dark');

    expect(brightness(tester), Brightness.dark);
    await unmountApp(tester);
  });

  for (final (mode, onGround) in [
    ('light', Brightness.dark),
    ('dark', Brightness.light),
  ]) {
    testWidgets(
      "in the $mode theme the status bar's glyphs are light over 홈's sky and ${onGround.name} over the 기록 tab's ground",
      (tester) async {
        Brightness? glyphs() =>
            SystemChrome.latestStyle?.statusBarIconBrightness;

        await pumpApp(tester, themeMode: mode);
        await createDeckAndOpen(tester, 'French');
        await addCard(tester, 'Chat', 'cat');
        await showTab(tester, 'Home');
        expect(shownText('Start'), findsOneWidget);
        expect(glyphs(), Brightness.light);
        await showTab(tester, 'Record');
        expect(glyphs(), onGround);
        await showTab(tester, 'Home');
        expect(glyphs(), Brightness.light);
        await unmountApp(tester);
      },
    );
  }

  for (final mode in ['light', 'dark']) {
    testWidgets(
      'in the $mode theme the sign-in screen, every tab, every deck screen and the account screen meet the tap target and contrast guidelines',
      (tester) async {
        Future<void> meetsGuidelines() async {
          await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
          await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
          await expectLater(tester, meetsGuideline(textContrastGuideline));
          expectScreenTextReadable(tester);
        }

        await pumpApp(tester, themeMode: mode, account: FakeAccountService());
        expect(
          Theme.of(tester.element(shownText('Continue with Google')))
              .brightness,
          Brightness.values.byName(mode),
        );
        await meetsGuidelines();
        await tester.tap(shownText('Continue with Google'));
        await tester.pumpAndSettle();
        expect(brightness(tester).name, mode);
        await meetsGuidelines();
        await tester.tap(shownText('Create a note'));
        await tester.pumpAndSettle();
        // 새 노트, its name field and the four colours.
        expect(shownText('New note'), findsOneWidget);
        await meetsGuidelines();
        await enterText(tester, 'Note name', 'French');
        await tester.tap(shownText('Save'));
        await tester.pumpAndSettle();
        // The new deck, empty, then the 노트 tab, 홈 showing how to start,
        // and the 기록 tab.
        await meetsGuidelines();
        await tester.pageBack();
        await tester.pumpAndSettle();
        await meetsGuidelines();
        await showTab(tester, 'Home');
        await meetsGuidelines();
        await showTab(tester, 'Record');
        await meetsGuidelines();
        await showNotes(tester);
        await tester.tap(shownText('French'));
        await tester.pumpAndSettle();
        await meetsGuidelines();
        await addCard(tester, 'Chat', 'cat');
        await meetsGuidelines();

        // 노트 꾸미기, from the menu.
        await tester.tap(find.byTooltip('Note settings'));
        await tester.pumpAndSettle();
        await tester.tap(shownText('Customize note'));
        await tester.pumpAndSettle();
        expect(shownText('Customize note'), findsOneWidget);
        await meetsGuidelines();
        await tester.tapAt(const Offset(20, 20));
        await tester.pumpAndSettle();

        await tester.tap(find.byTooltip('Note settings'));
        await tester.pumpAndSettle();
        await tester.tap(shownText('Rename'));
        await tester.pumpAndSettle();
        expect(shownText('Rename note'), findsOneWidget);
        await meetsGuidelines();
        await tester.tapAt(const Offset(20, 20));
        await tester.pumpAndSettle();
        await tester.tap(find.byTooltip('Note settings'));
        await tester.pumpAndSettle();
        // The menu, its "Delete note" in the destructive text colour.
        await meetsGuidelines();
        await tester.tap(shownText('Delete note'));
        await tester.pumpAndSettle();
        expect(shownText('Delete "French"?'), findsOneWidget);
        await meetsGuidelines();
        await tester.tap(shownText('Cancel'));
        await tester.pumpAndSettle();

        // The add sheet, then by hand.
        await tester.tap(shownText('Add card'));
        await tester.pumpAndSettle();
        await meetsGuidelines();
        await tester.tap(shownText('Enter by hand'));
        await tester.pumpAndSettle();
        await enterFront(tester, 'Chien');
        await meetsGuidelines();
        await enterFront(tester, 'chat');
        await enterBack(tester, 'chat (talk)');
        await tester.tap(shownText('Save'));
        await tester.pumpAndSettle();
        expect(shownText('This note already has this card'), findsOneWidget);
        await meetsGuidelines();
        await tester.tapAt(const Offset(20, 20));
        await tester.pumpAndSettle();
        // Leaving with the typed card asks first.
        await tester.tap(find.byTooltip('Close'));
        await tester.pumpAndSettle();
        expect(shownText('Discard this card?'), findsOneWidget);
        await meetsGuidelines();
        await tester.tap(shownText('Discard'));
        await tester.pumpAndSettle();

        // A search typed in the field under the top bar.
        await tester.enterText(
          widgetWithShownText(AppTextField, 'Search'),
          'ch',
        );
        await tester.pumpAndSettle();
        await meetsGuidelines();
        await tester.enterText(find.byType(AppTextField), '');
        await tester.testTextInput.receiveAction(TextInputAction.done);
        await tester.pumpAndSettle();
        await tester.tap(shownText('Chat'));
        await tester.pumpAndSettle();
        await meetsGuidelines();
        // Red text at the end of the form.
        await tester.ensureVisible(shownText('Delete card'));
        await tester.pumpAndSettle();
        await meetsGuidelines();
        await tester.tap(shownText('Delete card'));
        await tester.pumpAndSettle();
        expect(shownText('Delete this card?'), findsOneWidget);
        await meetsGuidelines();
        await tester.tap(shownText('Cancel'));
        await tester.pumpAndSettle();
        await tester.tap(find.byTooltip('Close'));
        await tester.pumpAndSettle();
        await tester.pageBack();
        await tester.pumpAndSettle();
        // The 노트 tab with a deck row and its progress, then 홈 with today
        // on its hero over the week card.
        await meetsGuidelines();
        await showTab(tester, 'Home');
        expect(find.text('0-day streak', findRichText: true), findsOneWidget);
        await meetsGuidelines();

        await showSettings(tester);
        await meetsGuidelines();
        // The foot is below the rows the screen builds first.
        await tester.scrollUntilVisible(
          shownText('Terms of Service'),
          100,
          scrollable: find.byType(Scrollable).first,
        );
        await tester.pumpAndSettle();
        await meetsGuidelines();
        await unmountApp(tester);
      },
    );
  }
}
