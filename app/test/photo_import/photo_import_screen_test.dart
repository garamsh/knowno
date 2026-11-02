import 'package:drift/drift.dart' show driftRuntimeOptions;
import 'package:drift/native.dart';
import 'package:flutter/material.dart' hide Card;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:knowno/database/database.dart';
import 'package:knowno/deck/deck.dart';
import 'package:knowno/design/app_list_row.dart';
import 'package:knowno/design/app_sheet.dart';
import 'package:knowno/design/mascot.dart';
import 'package:knowno/design/theme.dart';
import 'package:knowno/l10n/app_localizations.dart';
import 'package:knowno/photo_import/photo_import.dart';
import 'package:knowno/photo_import/src/import_job.dart' show PhotoRead;
import 'package:knowno/photo_import/src/photo_viewer.dart' show PhotoViewer;
import 'package:knowno/photo_import/src/round_check.dart';

import '../contrast.dart';
import '../home/home_data.dart';

import '../deck/whole_cards.dart';
import 'fakes.dart';

/// Photo import over decks "French" (holding [french]) and "Spanish", with a
/// substitute camera, library and extraction client, started from a button
/// as the home and deck screens start it.
class _Import {
  _Import._(
    this.tester,
    this.repository,
    this.french,
    this.spanish,
    this.preferences,
    this.store,
  );

  final WidgetTester tester;
  final _CountingDecks repository;
  final Deck french;
  final Deck spanish;
  final SharedPreferencesWithCache preferences;
  final photos = FakePhotoSource();
  final client = FakeExtractionClient();

  /// Where the job is kept, which a later [open] given it restores from, as
  /// the app's next open does.
  final MemoryImportJobStore store;

  /// The app's photo import jobs, as the composition site makes them.
  late final imports = PhotoImports(
    client: client,
    photos: photos,
    preferences: preferences,
    store: store,
    decks: repository,
  );

  /// Semantics, on for the import's life, so rows are found by what a
  /// screen reader hears.
  late final SemanticsHandle _semantics = tester.ensureSemantics();

  /// Where the import's photo is taken from, which the source sheets choose.
  PhotoOrigin origin = PhotoOrigin.camera;

  /// What photo import resolved to, once it has.
  Object? popped = _notPopped;
  static const _notPopped = Object();

  static Future<_Import> open(
    WidgetTester tester, {
    DeckId? Function(_Import import)? deck,
    Map<String, String> french = const {},
    ThemeMode themeMode = ThemeMode.light,
    bool disableAnimations = false,
    bool refuseWrites = false,
    MemoryImportJobStore? restoring,
    void Function(_Import import)? before,
  }) async {
    final db = AppDatabase(NativeDatabase.memory());
    addTearDown(db.close);
    var ids = 0;
    var tick = 0;
    final repository = _CountingDecks(
      db,
      clock: () => DateTime.utc(2026, 10, 15).add(Duration(seconds: tick++)),
      newId: () => 'id${ids++}',
    );
    final (frenchDeck, spanishDeck) = (await tester.runAsync(() async {
      final frenchDeck = await repository.createDeck('French');
      final spanishDeck = await repository.createDeck('Spanish');
      for (final MapEntry(key: front, value: back) in french.entries) {
        await repository.addCard(
          frenchDeck.id,
          front: [TextContent(front)],
          back: [TextContent(back)],
        );
      }
      return (frenchDeck, spanishDeck);
    }))!;
    final preferences = await openPreferences(tester, const {}, refuseWrites);
    final import = _Import._(
      tester,
      repository,
      frenchDeck,
      spanishDeck,
      preferences,
      restoring ?? MemoryImportJobStore(),
    );
    import._semantics;
    if (restoring != null) await import.imports.restore();
    before?.call(import);
    final target = deck == null ? frenchDeck.id : deck(import);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [deckRepositoryProvider.overrideWithValue(repository)],
        child: MaterialApp(
          theme: lightTheme,
          darkTheme: darkTheme,
          themeMode: themeMode,
          locale: const Locale('en'),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(context)
                .copyWith(disableAnimations: disableAnimations),
            child: child!,
          ),
          home: Builder(
            builder: (context) => Scaffold(
              body: TextButton(
                onPressed: () async {
                  import.popped = await importFromPhoto(
                    context,
                    imports: import.imports,
                    deck: target,
                    origin: import.origin,
                  );
                },
                child: const Text('open'),
              ),
              bottomNavigationBar: PhotoImportBar(
                imports: import.imports,
                onOpen: () async {
                  import.popped = await openPhotoImport(
                    context,
                    import.imports,
                  );
                },
              ),
            ),
          ),
        ),
      ),
    );
    return import;
  }

  bool get hasPopped => !identical(popped, _notPopped);

  /// Starts the import with [count] photos picked from the album, each read
  /// in its turn, and pumps frames, as [shoot] does.
  Future<void> pickSeveral(int count) async {
    photos.libraryPhotos = [
      for (var i = 0; i < count; i++) Future.value(testPhoto),
    ];
    await _from(PhotoOrigin.album);
  }

  /// Pumps a few frames, for what the reads change.
  Future<void> frames() async {
    for (var frame = 0; frame < 5; frame++) {
      await tester.pump(const Duration(milliseconds: 200));
    }
  }

  /// Answers the open call reading the photo numbered [index] from 0 in the
  /// order the calls started, with one word, and a [cursor] to read on from
  /// when given, and pumps.
  Future<void> answerCall(
    int index,
    Map<String, String> cards, {
    String? cursor,
  }) async {
    calls(index).nextCursor = cursor;
    calls(index).answer.complete([
      for (final MapEntry(key: front, value: meaning) in cards.entries)
        word(front: front, meaning: meaning),
    ]);
    await frames();
  }

  PendingExtraction calls(int index) => client.calls[index];

  Future<void> tap(Finder finder) async {
    await tester.tap(finder);
    await tester.pumpAndSettle();
  }

  /// Starts the import with a photo taken by the camera; the extraction then
  /// waits for [client]'s answer, so this pumps frames rather than settling
  /// the progress bar.
  Future<void> shoot() => _from(PhotoOrigin.camera);

  /// Starts the import with a photo picked from the album, as [shoot] does.
  Future<void> pick() => _from(PhotoOrigin.album);

  /// Starts the import with a photo by [origin] whose taking fails or is
  /// cancelled, and settles.
  Future<void> start(PhotoOrigin origin) async {
    this.origin = origin;
    await tap(_shown('open'));
  }

  Future<void> _from(PhotoOrigin origin) async {
    this.origin = origin;
    await _pumpPast(_shown('open'));
  }

  /// Taps the retake, named [label], from the list's ⋯ where it waits there,
  /// confirms discarding the list's cards where it asks, and takes the next
  /// photo at once, as [shoot] does.
  Future<void> retake([String label = 'Retake']) async {
    if (find.byTooltip('Photo actions').evaluate().isNotEmpty) {
      await openActions();
    }
    await _pumpPast(_shown(label));
    if (_shown('Discard').evaluate().isNotEmpty) {
      await _pumpPast(_shown('Discard'));
    }
  }

  /// Opens the ⋯ menu in the list's top bar, which holds the retake.
  Future<void> openActions() => tap(find.byTooltip('Photo actions'));

  /// Lets every write [store] holds land, the newest first each time, so
  /// writes under way at once would land oldest last.
  Future<void> releaseWritesNewestFirst() async {
    while (store.heldWrites.isNotEmpty) {
      store.heldWrites.removeLast().release.complete();
      await tester.pump();
    }
  }

  /// Opens the job again by the bar over the tab bar.
  Future<void> reopen() async {
    popped = _notPopped;
    await tester.tap(find.byType(PhotoImportBar));
    await frames();
  }

  /// What the bar over the tab bar reads; null while it draws nothing.
  String? get bar => switch ([
    for (final text in tester.widgetList<Text>(
      find.descendant(
        of: find.byType(PhotoImportBar),
        matching: find.byType(Text),
      ),
    ))
      text.data,
  ]) {
    [] => null,
    [final label] => label,
    final labels => throw StateError('The bar reads $labels.'),
  };

  /// Presses the system back, as Android's back button does.
  Future<void> back() async {
    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
  }

  /// Edits the front of the row reading [front] to [to] in its edit sheet.
  Future<void> editFront(String front, String to) async {
    await tap(_shown(front));
    await tester.enterText(find.byType(TextField).first, to);
    await tap(_shown('Done'));
  }

  Future<void> _pumpPast(Finder finder) async {
    await tester.tap(finder);
    for (var frame = 0; frame < 5; frame++) {
      await tester.pump(const Duration(milliseconds: 200));
    }
  }

  /// Takes a photo and answers its extraction with vocabulary cards of one
  /// sense, front → meaning.
  Future<void> extract(Map<String, String> cards) async {
    await shoot();
    client.answer(cards);
    await tester.pumpAndSettle();
  }

  /// Takes a photo and answers its extraction with [cards].
  Future<void> extractCards(List<CandidateCard> cards) async {
    await shoot();
    client.answerCards(cards);
    await tester.pumpAndSettle();
  }

  /// The list row showing [text], which a drag moves.
  Finder row(String text) =>
      find.ancestor(of: _shown(text), matching: find.byType(Dismissible)).first;

  /// Drags the row showing [text] by [dx], left when negative.
  Future<void> swipe(String text, double dx) async {
    await tester.drag(row(text), Offset(dx, 0));
    await tester.pumpAndSettle();
  }

  /// The check of the row whose front reads [front].
  Finder check(String front) => find.bySemanticsLabel('Include $front');

  /// Whether the row whose front reads [front] is included.
  bool included(String front) =>
      isSemantics(isChecked: true)
          .matches(tester.getSemantics(check(front)), {});

  /// Opens the form menu of the section titled [title].
  Future<void> menu(String title) =>
      tap(find.bySemanticsLabel(RegExp('^${RegExp.escape(title)} card form')));

  /// Picks the menu item reading [label].
  Future<void> pickItem(String label) =>
      tap(find.widgetWithText(MenuItemButton, label));

  /// Each card of [deck], as front → back with back lines joined by " / ".
  Future<List<(String, String, CardSource)>> cards(Deck deck) async => [
    for (final card in (await tester.runAsync(
      () => repository.listCards(deck.id),
    ))!)
      (
        plainText(card.front),
        plainText(card.back).replaceAll('\n', ' / '),
        card.source,
      ),
  ];

  Future<List<String>> deckNames() async => [
    for (final deck in (await tester.runAsync(
      () => repository.watchDecks().first,
    ))!)
      deck.name,
  ];

  /// The stored deck named [name].
  Future<Deck> deck(String name) async =>
      (await tester.runAsync(() => repository.watchDecks().first))!
          .singleWhere((deck) => deck.name == name);

  Future<void> close() async {
    await tester.pumpWidget(const SizedBox());
    await tester.pump(const Duration(seconds: 1));
    _semantics.dispose();
  }
}

/// The decks, counting each [addCards], so a test sees one write per save.
class _CountingDecks extends UnreadableDecks {
  _CountingDecks(super.db, {required super.clock, required super.newId});

  int addCalls = 0;

  @override
  Future<CardsAdded> addCards(
    AddTarget target,
    List<IncomingCard> cards, {
    AddSource source = const FromPhoto(),
  }) {
    addCalls++;
    return super.addCards(target, cards, source: source);
  }
}

/// What a photo's row says when the device could not keep it, as a pattern.
final _notKept = RegExp.escape(
  "Couldn't keep this photo on the device. Check the free space and choose it again.",
);

void main() {
  driftRuntimeOptions.dontWarnAboutMultipleDatabases = true;

  group('the job', () {
    testWidgets(
      'the bar reads the photos read of all while they are read, then the cards to review, opens the list, and goes once the job is discarded',
      (tester) async {
        final import = await _Import.open(tester);
        expect(import.bar, isNull, reason: 'no job, no bar');
        await import.pickSeveral(3);
        await import.back();

        expect(import.bar, 'Reading photos 0/3');
        // Its words lead, and its one icon is the chevron at its end.
        final icons = find.descendant(
          of: find.byType(PhotoImportBar),
          matching: find.byType(Icon),
        );
        expect(icons, findsOneWidget);
        expect(tester.widget<Icon>(icons).icon, LucideIcons.chevronRight);
        await import.answerCall(0, {'chat': 'cat'});
        expect(import.bar, 'Reading photos 1/3');
        await import.answerCall(1, {'chien': 'dog'});
        await import.answerCall(2, {'oiseau': 'bird', 'cheval': 'horse'});
        expect(import.bar, 'Review 4 cards');

        await import.reopen();
        expect(_shown('Words found'), findsOneWidget);
        await import.tap(find.byTooltip('Close'));
        await import.tap(_shown('Discard'));
        expect(import.bar, isNull);
        await import.close();
      },
    );

    testWidgets(
      'a job a closed app left keeps its read cards, offers to resume its unread photos, and sends none read before again',
      (tester) async {
        final first = await _Import.open(tester);
        await first.pickSeveral(3);
        await first.answerCall(0, {'chat': 'cat'});
        expect(first.client.calls, hasLength(3));
        await first.close();

        final next = await _Import.open(tester, restoring: first.store);
        expect(next.imports.job?.photos, hasLength(3), reason: 'restored');
        expect(next.bar, 'Resume reading 2 photos');
        expect(next.client.calls, isEmpty, reason: 'nothing read until asked');

        await next.reopen();
        expect(_shown('Resume reading 2 photos?'), findsOneWidget);
        await next.tap(_shown('Resume'));
        expect(next.client.calls, hasLength(2), reason: 'the unread alone');
        expect(find.bySemanticsLabel('Read 1 of 3 photos'), findsOneWidget);
        await next.answerCall(0, {'chien': 'dog'});
        await next.answerCall(1, {'oiseau': 'bird'});
        await tester.pumpAndSettle();
        expect(_shown('Words found'), findsOneWidget);
        expect(_shown('chat'), findsOneWidget, reason: 'read before the close');
        expect(next.client.calls, hasLength(2), reason: 'nothing resent');
        await next.close();
      },
    );

    testWidgets(
      'a page left unread goes on through two cursors with the same photo, reading all the while, its cards appended without repeats and the photo counted once',
      (tester) async {
        final import = await _Import.open(tester);
        import.photos.libraryPhotos = [
          for (final width in [10, 20]) Future.value(photoOfWidth(width)),
        ];
        await import.pick();
        await import.answerCall(1, {'oiseau': 'bird'});

        await import.answerCall(0, {'chat': 'cat'}, cursor: 'first');
        expect(import.client.calls, hasLength(3), reason: 'no user action');
        expect(import.calls(2).cursor, 'first');
        expect(import.calls(2).photo.bytes, import.calls(0).photo.bytes);
        expect(find.bySemanticsLabel(RegExp(r'^Photo 1\nReading')), findsOne);

        await import.answerCall(2, {
          'Chat ': 'cat again',
          'chien': 'dog',
        }, cursor: 'second');
        expect(import.calls(3).cursor, 'second');
        expect(find.bySemanticsLabel(RegExp(r'^Photo 1\nReading')), findsOne);
        expect(find.bySemanticsLabel('Read 1 of 2 photos'), findsOneWidget);

        await import.answerCall(3, {});
        await tester.pumpAndSettle();
        expect(_shown('Words found'), findsOneWidget);
        expect(import.client.calls, hasLength(4), reason: 'none after the end');
        expect(
          switch (import.imports.job?.photos.first.state) {
            PhotoRead(:final cards) => [for (final card in cards) card.answer],
            final state => state,
          },
          ['cat', 'dog'],
          reason: 'the repeated front left out',
        );
        expect(
          [
            for (final call in import.client.calls)
              if (call.photo.width == 10 && call.cursor == null) call,
          ],
          hasLength(1),
          reason: 'the first photo counted once',
        );
        expect(import.client.usages, 2, reason: 'one usage a photo');
        await import.close();
      },
    );

    testWidgets(
      'a cursor the function no longer takes ends the reading with the retryable failure, and a retry reads the photo from the start, keeping the cards read so far',
      (tester) async {
        final import = await _Import.open(tester);
        import.photos.libraryPhotos = [
          for (final width in [10, 20]) Future.value(photoOfWidth(width)),
        ];
        await import.pick();
        await import.answerCall(1, {'oiseau': 'bird'});
        await import.answerCall(0, {'chat': 'cat'}, cursor: 'stale');
        import
            .calls(2)
            .answer
            .completeError(const ServiceFailed('HTTP 410 cursor_expired'));
        await import.frames();
        expect(find.bySemanticsLabel("Couldn't read 1 photo"), findsOneWidget);
        expect(import.client.calls, hasLength(3), reason: 'nothing sent on');

        await import.tap(_shown('Try again'));
        expect(import.client.calls, hasLength(4));
        expect(import.calls(3).cursor, isNull, reason: 'from the start');
        await import.answerCall(3, {'chien': 'dog'});
        await tester.pumpAndSettle();
        expect(_shown('Words found'), findsOneWidget);
        expect(_shown('chat'), findsOneWidget, reason: 'read before the 410');
        expect(import.imports.job?.list?.cardCount, 3);
        await import.close();
      },
    );

    testWidgets(
      'a closed app resumes a page left unread from its cursor, keeping the cards read so far and counting the photo no more',
      (tester) async {
        final first = await _Import.open(tester);
        await first.pickSeveral(2);
        await first.answerCall(1, {'oiseau': 'bird'});
        await first.answerCall(0, {'chat': 'cat'}, cursor: 'kept');
        expect(first.client.calls, hasLength(3), reason: 'reading on');
        await first.close();

        final next = await _Import.open(tester, restoring: first.store);
        await next.reopen();
        await next.tap(_shown('Resume'));
        expect(next.client.calls, hasLength(1));
        expect(next.calls(0).cursor, 'kept');
        await next.answerCall(0, {'chien': 'dog'});
        await tester.pumpAndSettle();
        expect(_shown('Words found'), findsOneWidget);
        expect(_shown('chat'), findsOneWidget, reason: 'read before the close');
        expect(next.imports.job?.list?.cardCount, 3);
        expect(next.client.usages, 0, reason: 'not counted again');
        await next.close();
      },
    );

    testWidgets(
      'discarding a job a closed app left forgets it and its photos and reads nothing',
      (tester) async {
        final first = await _Import.open(tester);
        await first.pickSeveral(2);
        await first.close();
        expect(first.store.photos, hasLength(2), reason: 'kept on the device');

        final next = await _Import.open(tester, restoring: first.store);
        await next.reopen();
        await next.tap(_shown('Discard'));
        expect(next.imports.job, isNull);
        expect(next.store.state, isNull);
        expect(next.store.photos, isEmpty);
        expect(next.bar, isNull);
        expect(next.client.calls, isEmpty);
        await next.close();
      },
    );

    testWidgets(
      'a list a closed app left waits in the bar, and opening it reads nothing',
      (tester) async {
        final first = await _Import.open(tester);
        await first.pickSeveral(2);
        await first.answerCall(0, {'chat': 'cat'});
        await first.answerCall(1, {'chien': 'dog'});
        await first.close();

        final next = await _Import.open(tester, restoring: first.store);
        expect(next.bar, 'Review 2 cards');
        await next.reopen();
        expect(_shown('Resume'), findsNothing, reason: 'nothing to resume');
        expect(_shown('Words found'), findsOneWidget);
        expect(next.client.calls, isEmpty);
        await next.close();
      },
    );

    testWidgets(
      'the state kept is the latest whatever order the writes finish in, so a resume sends no photo read before',
      (tester) async {
        final first = await _Import.open(
          tester,
          before: (import) => import.store.holdWrites = true,
        );
        await first.pickSeveral(3);
        await first.answerCall(0, {'chat': 'cat'});
        await first.answerCall(1, {'chien': 'dog'});
        await first.answerCall(2, {'oiseau': 'bird'});
        expect(first.store.heldWrites, isNotEmpty, reason: 'writes held');
        await first.releaseWritesNewestFirst();
        expect(first.store.heldWrites, isEmpty);
        await first.close();

        first.store.holdWrites = false;
        final next = await _Import.open(tester, restoring: first.store);
        expect(next.bar, 'Review 3 cards');
        await next.reopen();
        expect(_shown('Words found'), findsOneWidget);
        expect(next.client.calls, isEmpty, reason: 'nothing resent');
        await next.close();
      },
    );

    testWidgets(
      'a job discarded while its state is being written leaves nothing kept',
      (tester) async {
        final import = await _Import.open(
          tester,
          before: (import) => import.store.holdWrites = true,
        );
        await import.pickSeveral(2);
        await import.answerCall(0, {'chat': 'cat'});
        expect(import.store.heldWrites, isNotEmpty, reason: 'a write held');

        await import.tap(_shown('Cancel'));
        await import.tap(_shown('Discard'));
        await import.releaseWritesNewestFirst();
        await tester.pumpAndSettle();
        expect(import.hasPopped, isTrue);
        expect(import.imports.job, isNull);
        expect(import.store.state, isNull);
        await import.close();
      },
    );

    testWidgets(
      'a photo the device cannot keep fails on its row, offering only to remove it, and the others go on',
      (tester) async {
        final import = await _Import.open(
          tester,
          before: (import) => import.store.refusePutsFrom = 1,
        );
        await import.pickSeveral(2);

        expect(import.client.calls, hasLength(1), reason: 'the first kept');
        expect(
          find.bySemanticsLabel(RegExp('^Photo 2\\n$_notKept')),
          findsOneWidget,
        );
        expect(_shown('Try again'), findsNothing);
        expect(_shown('Remove'), findsOneWidget);
        await import.answerCall(0, {'chat': 'cat'});
        await import.tap(_shown('Remove'));
        expect(_shown('Words found'), findsOneWidget);
        await import.close();
      },
    );

    testWidgets(
      'a photo whose kept file is gone fails on its row, offering only to remove it',
      (tester) async {
        final import = await _Import.open(
          tester,
          before: (import) => import.store.goneFrom = 1,
        );
        await import.pickSeveral(2);

        expect(import.client.calls, hasLength(1), reason: 'the first read');
        expect(
          find.bySemanticsLabel(RegExp('^Photo 2\\n$_notKept')),
          findsOneWidget,
        );
        expect(_shown('Try again'), findsNothing);
        expect(_shown('Remove'), findsOneWidget);
        await import.answerCall(0, {'chat': 'cat'});
        await import.tap(_shown('Remove'));
        expect(_shown('Words found'), findsOneWidget);
        await import.close();
      },
    );

    testWidgets(
      'more photos are added to a list until it holds 50, and then none',
      (tester) async {
        final import = await _Import.open(tester);

        /// Scrolls the list to its end, where "Add more photos" is drawn
        /// when it is offered.
        Future<void> toEnd() async {
          final list = tester.state<ScrollableState>(
            find
                .descendant(
                  of: find.byType(ListView),
                  matching: find.byType(Scrollable),
                )
                .first,
          );
          while (list.position.pixels < list.position.maxScrollExtent) {
            list.position.jumpTo(list.position.maxScrollExtent);
            await tester.pump();
          }
        }

        await import.pickSeveral(49);
        for (var i = 0; i < 49; i++) {
          await import.answerCall(i, {'w$i': 'm$i'});
        }
        await tester.pumpAndSettle();
        expect(_shown('Words found'), findsOneWidget);
        await toEnd();
        expect(_shown('Add more photos'), findsOneWidget, reason: 'under 50');

        import.photos.libraryPhotos = [Future.value(testPhoto)];
        await import.tap(_shown('Add more photos'));
        // The sources are their words alone.
        expect(find.byType(AppListRow), findsNWidgets(2));
        expect(
          find.descendant(
            of: find.byType(AppListRow),
            matching: find.byType(Icon),
          ),
          findsNothing,
        );
        await tester.tap(_shown('Choose from album'));
        await import.frames();
        expect(import.photos.libraryLimits, [50, 1]);
        await import.answerCall(49, {'w49': 'm49'});
        await tester.pumpAndSettle();
        expect(import.imports.job?.photos, hasLength(50));
        expect(import.imports.job?.list?.cardCount, 50);
        await toEnd();
        expect(_shown('w49'), findsOneWidget, reason: 'at the end');
        expect(_shown('Add more photos'), findsNothing);
        await import.close();
      },
    );
  });

  group('several photos', () {
    testWidgets(
      'up to 50 photos are picked from the album and read at most 3 at a time, in the order picked',
      (tester) async {
        final import = await _Import.open(tester);
        await import.pickSeveral(4);

        expect(import.photos.libraryLimits, [50]);
        expect(import.client.calls, hasLength(3), reason: 'three read at once');
        await import.answerCall(0, {'chat': 'cat'});
        expect(import.client.calls, hasLength(4), reason: 'the fourth starts');
        await import.answerCall(1, {'chien': 'dog'});
        await import.answerCall(2, {'oiseau': 'bird'});
        await import.answerCall(3, {'cheval': 'horse'});
        await tester.pumpAndSettle();
        expect(_shown('Words found'), findsOneWidget);
        await import.close();
      },
    );

    testWidgets(
      'each photo shows its state, and the heading is read as the photo being read of all',
      (tester) async {
        tester.view.physicalSize = const Size(1170, 2532);
        addTearDown(tester.view.reset);
        final import = await _Import.open(tester);
        await import.pickSeveral(4);

        expect(find.bySemanticsLabel('Read 0 of 4 photos'), findsOneWidget);
        expect(find.bySemanticsLabel(RegExp(r'^Photo 1\nReading')), findsOne);
        expect(find.bySemanticsLabel(RegExp(r'^Photo 4\nWaiting')), findsOne);
        await import.answerCall(0, {'chat': 'cat'});
        expect(find.bySemanticsLabel(RegExp(r'^Photo 1\n1 card')), findsOne);
        expect(find.bySemanticsLabel(RegExp(r'^Photo 4\nReading')), findsOne);
        expect(find.bySemanticsLabel('Read 1 of 4 photos'), findsOneWidget);
        // A photo read is ink, not the green that means 안다 alone (#454).
        final read = tester.widget<Icon>(find.byIcon(LucideIcons.check));
        expect(read.color, AppColors.light.ink);
        expect(read.color, isNot(AppColors.light.know));
        await import.close();
      },
    );

    testWidgets(
      'with a failure among photos still reading, the heading and the bar count the same photos read',
      (tester) async {
        final import = await _Import.open(tester);
        await import.pickSeveral(3);
        double? bar() => tester
            .widget<LinearProgressIndicator>(
              find.byType(LinearProgressIndicator),
            )
            .value;

        // The thinking mascot reads along until a row shows a failure's red.
        expect(
          tester.widget<Mascot>(find.byType(Mascot)).expression,
          MascotExpression.thinking,
        );

        import.calls(0).answer.completeError(const ModelFailed());
        await import.frames();
        expect(find.bySemanticsLabel('Read 0 of 3 photos'), findsOneWidget);
        expect(bar(), 0);
        expect(find.byType(Mascot), findsNothing);

        await import.answerCall(1, {'chien': 'dog'});
        expect(find.bySemanticsLabel('Read 1 of 3 photos'), findsOneWidget);
        expect(bar(), closeTo(1 / 3, 1e-9));

        await import.answerCall(2, {'oiseau': 'bird'});
        expect(find.bySemanticsLabel("Couldn't read 1 photo"), findsOneWidget);
        expect(bar(), closeTo(2 / 3, 1e-9));
        await import.close();
      },
    );

    testWidgets(
      'one photo that fails waits for a retry while the others go on, and a retry reads it again',
      (tester) async {
        final import = await _Import.open(tester);
        await import.pickSeveral(3);
        import.calls(0).answer.completeError(const ModelFailed());
        await import.frames();
        expect(import.client.calls, hasLength(3), reason: 'the rest go on');
        await import.answerCall(1, {'chien': 'dog'});
        await import.answerCall(2, {'oiseau': 'bird'});
        expect(find.bySemanticsLabel("Couldn't read 1 photo"), findsOneWidget);
        expect(_shownContaining("Couldn't read the cards"), findsOneWidget);

        await tester.tap(_shown('Try again'));
        await import.frames();
        expect(import.client.calls, hasLength(4));
        await import.answerCall(3, {'chat': 'cat'});
        await tester.pumpAndSettle();
        expect(_shown('Words found'), findsOneWidget);
        expect(find.bySemanticsLabel(RegExp('^Photo 1, ')), findsOne);
        await import.close();
      },
    );

    testWidgets(
      '"Retry failed photos" sends again the two photos that failed, in order, and not the one read',
      (tester) async {
        final import = await _Import.open(tester);
        import.photos.libraryPhotos = [
          for (final width in [10, 20, 30]) Future.value(photoOfWidth(width)),
        ];
        await import.pick();
        expect(
          [for (final call in import.client.calls) call.photo.width],
          [10, 20, 30],
          reason: 'each photo told apart by its width',
        );
        expect(
          _shown('Retry failed photos'),
          findsNothing,
          reason: 'none failed',
        );

        import.calls(0).answer.completeError(const ModelFailed());
        await import.answerCall(1, {'chien': 'dog'});
        import
            .calls(2)
            .answer
            .completeError(ExtractionOffline(Exception('down')));
        await import.frames();
        expect(find.bySemanticsLabel("Couldn't read 2 photos"), findsOneWidget);

        await import.tap(_shown('Retry failed photos'));
        expect(
          [for (final call in import.client.calls.skip(3)) call.photo.width],
          [10, 30],
        );
        expect(_shown('Retry failed photos'), findsNothing);
        await import.answerCall(3, {'chat': 'cat'});
        await import.answerCall(4, {'oiseau': 'bird'});
        await tester.pumpAndSettle();
        expect(_shown('Words found'), findsOneWidget);
        expect(import.client.calls, hasLength(5), reason: 'none sent again');
        expect(import.imports.job?.list?.cardCount, 3);
        await import.close();
      },
    );

    testWidgets(
      '"Retry failed photos" leaves a failure no retry can help, and is not offered for it alone',
      (tester) async {
        final import = await _Import.open(tester);
        import.photos.libraryPhotos = [
          for (final width in [10, 20, 30]) Future.value(photoOfWidth(width)),
        ];
        await import.pick();
        import.calls(0).answer.completeError(const NoCardsFound());
        import.calls(1).answer.completeError(const ModelFailed());
        await import.answerCall(2, {'oiseau': 'bird'});
        expect(find.bySemanticsLabel("Couldn't read 2 photos"), findsOneWidget);

        await import.tap(_shown('Retry failed photos'));
        expect(
          [for (final call in import.client.calls.skip(3)) call.photo.width],
          [20],
          reason: 'the 502 alone',
        );
        import.calls(3).answer.completeError(const ModelFailed());
        await import.frames();
        expect(_shown('Retry failed photos'), findsOneWidget);

        await import.tap(_shown('Remove').at(1));
        expect(find.bySemanticsLabel("Couldn't read 1 photo"), findsOneWidget);
        expect(_shownContaining('No cards found'), findsOneWidget);
        expect(_shown('Retry failed photos'), findsNothing);
        await import.close();
      },
    );

    testWidgets(
      'a photo that fails can be left out, and the others make the list',
      (tester) async {
        final import = await _Import.open(tester);
        await import.pickSeveral(2);
        import.calls(0).answer.completeError(const ModelFailed());
        await import.frames();
        await import.answerCall(1, {'chien': 'dog'});

        await tester.tap(_shown('Remove'));
        await tester.pumpAndSettle();
        expect(_shown('Words found'), findsOneWidget);
        expect(_shown('chien'), findsOneWidget);
        await import.close();
      },
    );

    testWidgets(
      'cancel stops every read in progress, starts no other and closes the screen',
      (tester) async {
        final import = await _Import.open(tester);
        await import.pickSeveral(4);

        await tester.tap(_shown('Cancel'));
        await tester.pumpAndSettle();
        expect(import.hasPopped, isTrue);
        expect(
          [for (final call in import.client.calls) call.cancelled],
          [true, true, true],
        );
        expect(import.client.calls, hasLength(3), reason: 'no fourth read');
        expect(import.imports.job, isNull, reason: 'the job ended');
        expect(import.store.state, isNull, reason: 'and nothing is kept');
        await import.close();
      },
    );

    testWidgets(
      "past today's limit only the photos it leaves are read, as a note says first, and with none left the limit shows",
      (tester) async {
        final import = await _Import.open(
          tester,
          before: (import) => import.client.todayAllowance = (
            limit: 30,
            period: LimitPeriod.day,
            used: 28,
          ),
        );
        await import.pickSeveral(3);
        expect(
          _shown(
            'You can read 2 more today, so only the first 2 will be read.',
          ),
          findsOneWidget,
        );
        expect(find.bySemanticsLabel('Read 0 of 2 photos'), findsOneWidget);
        await import.answerCall(0, {'chat': 'cat'});
        await import.answerCall(1, {'chien': 'dog'});
        expect(import.client.calls, hasLength(2));
        await import.close();

        final full = await _Import.open(
          tester,
          before: (import) => import.client.todayAllowance = (
            limit: 30,
            period: LimitPeriod.day,
            used: 30,
          ),
        );
        await full.pickSeveral(3);
        await tester.pumpAndSettle();
        expect(full.client.calls, isEmpty);
        expect(
          _shown("You've used today's 30 photos. Try again tomorrow."),
          findsOneWidget,
        );
        await full.close();

        final monthly = await _Import.open(
          tester,
          before: (import) => import.client.todayAllowance = (
            limit: 10,
            period: LimitPeriod.month,
            used: 8,
          ),
        );
        await monthly.pickSeveral(3);
        expect(
          _shown(
            'You can read 2 more this month, so only the first 2 will be read.',
          ),
          findsOneWidget,
          reason: 'a plan counted by the month says so',
        );
        expect(monthly.client.calls, hasLength(2));
        await monthly.close();
      },
    );

    testWidgets(
      "with no limit every photo is read past the plan's count, and no note shows",
      (tester) async {
        final import = await _Import.open(
          tester,
          before: (import) => import.client.todayAllowance = (
            limit: null,
            period: LimitPeriod.month,
            used: 40,
          ),
        );
        await import.pickSeveral(3);
        expect(find.textContaining('more this month'), findsNothing);
        expect(find.bySemanticsLabel('Read 0 of 3 photos'), findsOneWidget);
        await import.answerCall(0, {'chat': 'cat'});
        await import.answerCall(1, {'chien': 'dog'});
        await import.answerCall(2, {'gato': 'cat'});
        expect(import.client.calls, hasLength(3));
        await import.close();

        final control = await _Import.open(
          tester,
          before: (import) => import.client.todayAllowance = (
            limit: 40,
            period: LimitPeriod.month,
            used: 40,
          ),
        );
        await control.pickSeveral(3);
        await tester.pumpAndSettle();
        expect(
          control.client.calls,
          isEmpty,
          reason: 'control: the same count against a limit reads none',
        );
        await control.close();
      },
    );

    testWidgets(
      "with today's allowance unknown, every photo is read and each refusal shows on its photo",
      (tester) async {
        final import = await _Import.open(tester);
        await import.pickSeveral(2);
        expect(find.textContaining('more today'), findsNothing);
        import
            .calls(0)
            .answer
            .completeError(
              const PhotoLimitReached(limit: 30, period: LimitPeriod.day),
            );
        await import.frames();
        expect(
          _shownContaining("You've used today's 30 photos."),
          findsOneWidget,
        );
        expect(_shown('Try again'), findsNothing, reason: 'no retry past it');
        expect(_shown('Remove'), findsOneWidget);
        await import.close();
      },
    );

    testWidgets(
      'the list groups the cards by photo, each group a heading that collapses and expands, and one save writes every card',
      (tester) async {
        final import = await _Import.open(tester);
        await import.pickSeveral(2);
        await import.answerCall(0, {'chat': 'cat'});
        await import.answerCall(1, {'chien': 'dog', 'oiseau': 'bird'});
        await tester.pumpAndSettle();

        final first = find.bySemanticsLabel('Photo 1, 1 card');
        expect(
          tester.getSemantics(first),
          isSemantics(isHeader: true, isButton: true, isExpanded: true),
        );
        expect(_shown('Photo 2'), findsOneWidget);
        expect(_shown('chat'), findsOneWidget);
        await import.tap(first);
        expect(_shown('chat'), findsNothing, reason: 'its rows are hidden');
        expect(
          tester.getSemantics(find.bySemanticsLabel('Photo 1, 1 card')),
          isSemantics(isExpanded: false),
        );
        expect(_shown('chien'), findsOneWidget, reason: 'the other stays');
        await import.tap(find.bySemanticsLabel('Photo 1, 1 card'));

        await import.tap(_shown('Add 3 cards'));
        expect(import.repository.addCalls, 1);
        expect([
          for (final (front, _, _) in await import.cards(import.french)) front,
        ], unorderedEquals(['chat', 'chien', 'oiseau']));
        await import.close();
      },
    );

    testWidgets("the list's title is drawn as a pushed screen's title", (
      tester,
    ) async {
      final import = await _Import.open(tester);
      await import.extract({'chat': 'cat'});
      final title = tester.widget<Text>(_shown('Words found'));
      expect(title.style?.fontSize, AppType.title.fontSize);
      expect(title.style?.height, AppType.title.height);
      await import.close();
    });

    testWidgets(
      'one photo keeps its list as before: no photo groups, and the retake in place of adding photos only',
      (tester) async {
        final import = await _Import.open(tester);
        await import.extract({'chat': 'cat'});
        expect(_shown('Photo 1'), findsNothing);
        // The top bar holds × and ⋯, no words; the retake is in ⋯.
        expect(_shown('Cancel'), findsNothing);
        expect(_shown('Retake'), findsNothing);
        expect(find.byTooltip('Close'), findsOneWidget);
        await import.openActions();
        expect(_shown('Retake'), findsOneWidget);
        await tester.tapAt(Offset.zero);
        await tester.pumpAndSettle();
        expect(_shown('Add more photos'), findsOneWidget);
        await import.close();
      },
    );

    testWidgets(
      'adding photos reads them into the same list, keeping what was set on the earlier rows',
      (tester) async {
        final import = await _Import.open(tester);
        await import.extract({'chat': 'cat', 'chien': 'dog'});
        await import.tap(import.check('chien'));
        expect(import.included('chien'), isFalse);

        import.photos.libraryPhotos = [Future.value(testPhoto)];
        await import.tap(_shown('Add more photos'));
        await tester.tap(_shown('Choose from album'));
        await import.frames();
        expect(import.photos.libraryLimits, [49], reason: 'up to 50 in all');
        await import.answerCall(1, {'oiseau': 'bird'});
        await tester.pumpAndSettle();

        expect(_shown('Photo 2'), findsOneWidget);
        expect(_shown('oiseau'), findsOneWidget);
        expect(import.included('chien'), isFalse);
        expect(find.byTooltip('Photo actions'), findsNothing);
        await import.close();
      },
    );
  });

  group('photo viewer', () {
    testWidgets(
      "a reading row's thumbnail opens its photo full screen, a swipe turns to the next, and the close returns to the reading, which went on underneath",
      (tester) async {
        final import = await _Import.open(tester);
        await import.pickSeveral(3);

        await import.tap(find.bySemanticsLabel('View photo 1'));
        expect(find.bySemanticsLabel('Photo 1 of 3'), findsOneWidget);
        await import.answerCall(0, {'chat': 'cat'});
        expect(import.client.calls, hasLength(3), reason: 'reading goes on');

        await tester.fling(find.byType(PageView), const Offset(-300, 0), 1000);
        await tester.pumpAndSettle();
        expect(find.bySemanticsLabel('Photo 2 of 3'), findsOneWidget);

        await import.tap(find.byTooltip('Close'));
        expect(find.byType(PhotoViewer), findsNothing);
        expect(find.bySemanticsLabel(RegExp(r'^Photo 1\n1 card')), findsOne);
        await import.close();
      },
    );

    testWidgets(
      "a photo group's thumbnail opens its photo, and the system back or a swipe down closes the viewer and keeps the list",
      (tester) async {
        final import = await _Import.open(tester);
        await import.pickSeveral(2);
        await import.answerCall(0, {'chat': 'cat'});
        await import.answerCall(1, {'chien': 'dog'});
        await tester.pumpAndSettle();

        await import.tap(find.bySemanticsLabel('View photo 2'));
        expect(find.bySemanticsLabel('Photo 2 of 2'), findsOneWidget);
        await import.back();
        expect(find.byType(PhotoViewer), findsNothing);
        expect(import.hasPopped, isFalse);
        expect(_shown('Photo 2'), findsOneWidget);

        await import.tap(find.bySemanticsLabel('View photo 1'));
        await tester.fling(find.byType(PageView), const Offset(0, 400), 1500);
        await tester.pumpAndSettle();
        expect(find.byType(PhotoViewer), findsNothing);
        expect(_shown('chat'), findsOneWidget);
        await import.close();
      },
    );

    testWidgets(
      'a pinch zooms the photo, and a drag then pans it rather than turning the page',
      (tester) async {
        final import = await _Import.open(tester);
        await import.pickSeveral(2);
        await import.tap(find.bySemanticsLabel('View photo 1'));

        final centre = tester.getCenter(find.byType(PageView));
        final one = await tester.startGesture(centre - const Offset(20, 0));
        final two = await tester.startGesture(
          centre + const Offset(20, 0),
          pointer: 2,
        );
        for (var step = 1; step <= 10; step++) {
          await one.moveTo(centre - Offset(20.0 + step * 10, 0));
          await two.moveTo(centre + Offset(20.0 + step * 10, 0));
          await tester.pump();
        }
        await one.up();
        await two.up();
        await tester.pumpAndSettle();
        final scale = tester
            .widget<InteractiveViewer>(find.byType(InteractiveViewer).first)
            .transformationController!
            .value
            .getMaxScaleOnAxis();
        expect(scale, greaterThan(1.5));

        await tester.fling(find.byType(PageView), const Offset(-300, 0), 1000);
        await tester.pumpAndSettle();
        expect(find.bySemanticsLabel('Photo 1 of 2'), findsOneWidget);
        await import.close();
      },
    );
  });

  group('photo source', () {
    testWidgets(
      'nothing is taken before the import starts, and its retake goes back to where the photo came from, named for it',
      (tester) async {
        final import = await _Import.open(tester);
        expect((import.photos.cameraCalls, import.photos.libraryCalls), (0, 0));

        // From the camera, "Retake" takes another with it.
        await import.extract({'a': '1'});
        expect(_shown('Pick another photo'), findsNothing);
        await import.retake('Retake');
        expect((import.photos.cameraCalls, import.photos.libraryCalls), (2, 0));
        await import.close();
      },
    );

    testWidgets(
      'from the album, the retake reads "Pick another photo" and picks from it again',
      (tester) async {
        final import = await _Import.open(tester);
        await import.pick();
        import.client.answer({'a': '1'});
        await tester.pumpAndSettle();

        expect(_shown('Retake'), findsNothing);
        await import.retake('Pick another photo');
        expect((import.photos.cameraCalls, import.photos.libraryCalls), (0, 2));
        expect(_shown('Finding cards'), findsOneWidget);
        await import.close();
      },
    );

    for (final (source, calls) in [
      ('Take photo', (1, 0)),
      ('Choose from album', (0, 1)),
    ]) {
      testWidgets('"$source" sends its photo, then reviews the cards', (
        tester,
      ) async {
        final import = await _Import.open(tester);

        await (source == 'Take photo' ? import.shoot() : import.pick());

        expect((import.photos.cameraCalls, import.photos.libraryCalls), calls);
        expect(_shown('Finding cards'), findsOneWidget);
        expect(import.client.calls.single.photo.bytes, testPhoto.bytes);
        import.client.answer({'chien': 'dog'});
        await tester.pumpAndSettle();
        expect(_shown('Words found'), findsOneWidget);
        await import.close();
      });
    }

    for (final cancel in ['the camera', 'the album']) {
      testWidgets(
        'cancelling $cancel returns to where the user was, with nothing opened or sent',
        (tester) async {
          final import = await _Import.open(
            tester,
            before: (import) => import.photos
              ..cameraPhoto = null
              ..libraryPhoto = null,
          );

          switch (cancel) {
            case 'the camera':
              await import.start(PhotoOrigin.camera);
              expect(import.photos.cameraCalls, 1);
            case _:
              await import.start(PhotoOrigin.album);
              expect(import.photos.libraryCalls, 1);
          }

          expect(import.hasPopped, isTrue);
          expect(import.popped, isNull);
          expect(_shown('open'), findsOneWidget);
          expect(find.byType(FilledButton), findsNothing, reason: 'no failure');
          expect(import.client.calls, isEmpty);
          await import.close();
        },
      );
    }

    for (final (source, origin, retake) in [
      ('the camera', PhotoOrigin.camera, 'Retake'),
      ('the album', PhotoOrigin.album, 'Pick another photo'),
    ]) {
      testWidgets(
        'a refused permission behind $source says so with a way to Settings, where an unreadable photo has none',
        (tester) async {
          final import = await _Import.open(
            tester,
            before: (import) => import.photos
              ..cameraFailure = const PhotoAccessDenied('denied')
              ..libraryFailure = const PhotoAccessDenied('denied'),
          );

          await import.start(origin);

          expect(
            _shown(
              "The app isn't allowed to use the camera or your photos. Allow it in Settings.",
            ),
            findsOneWidget,
          );
          expect(_shown('Try again'), findsNothing);
          await import.tap(_shown('Open Settings'));
          expect(import.photos.settingsCalls, 1);
          expect(
            _shown("Couldn't open Settings. Allow it in the Settings app."),
            findsNothing,
          );

          // Control: a failure other than a refusal, through the same retake.
          import.photos
            ..cameraFailure = const PhotoUnreadable('heic')
            ..libraryFailure = const PhotoUnreadable('heic');
          await import.tap(_shown(retake));
          expect(
            _shown("Couldn't read this photo. Choose another one."),
            findsOneWidget,
          );
          expect(_shown('Open Settings'), findsNothing);
          expect(_shown(retake), findsOneWidget);
          expect(import.client.calls, isEmpty);
          await import.close();
        },
      );
    }

    testWidgets('Settings that do not open say so in a snack bar', (
      tester,
    ) async {
      final import = await _Import.open(
        tester,
        before: (import) => import.photos
          ..cameraFailure = const PhotoAccessDenied('denied')
          ..settingsOpen = false,
      );
      await import.start(PhotoOrigin.camera);

      await import.tap(_shown('Open Settings'));

      expect(
        _shown("Couldn't open Settings. Allow it in the Settings app."),
        findsOneWidget,
      );
      await import.close();
    });

    testWidgets(
      'a device without a camera says so, and its retake picks from the album, as later retakes do',
      (tester) async {
        final import = await _Import.open(
          tester,
          before: (import) =>
              import.photos.cameraFailure = const CameraUnavailable('none'),
        );

        await import.start(PhotoOrigin.camera);
        expect(
          _shown("Couldn't open the camera. Choose a photo from your album."),
          findsOneWidget,
        );
        expect(_shown('Open Settings'), findsNothing);
        expect(_shown('Retake'), findsNothing);
        await import.retake('Choose from album');

        expect(import.photos.libraryCalls, 1);
        expect(import.client.calls.single.photo.bytes, testPhoto.bytes);
        import.client.answer({'a': '1'});
        await tester.pumpAndSettle();
        await import.openActions();
        expect(_shown('Pick another photo'), findsOneWidget);
        await import.close();
      },
    );
  });

  group('extracting', () {
    testWidgets(
      'shows the photo, the progress, skeleton rows and the privacy note',
      (tester) async {
        final import = await _Import.open(tester);

        await import.shoot();

        expect(_shown('Finding cards'), findsOneWidget);
        expect(
          tester.widget<Mascot>(find.byType(Mascot)).expression,
          MascotExpression.thinking,
        );
        expect(find.bySemanticsLabel('Your photo'), findsOneWidget);
        expect(find.byType(LinearProgressIndicator), findsOneWidget);
        expect(
          _shown(
            "Your photo is used only to make cards and isn't kept on the server",
          ),
          findsOneWidget,
        );
        await import.close();
      },
    );

    testWidgets('cancel aborts the request and returns to where the user was', (
      tester,
    ) async {
      final import = await _Import.open(tester);
      await import.shoot();
      final call = import.client.calls.single;

      await import.tap(_shown('Cancel'));

      expect(call.cancelled, isTrue);
      expect(import.hasPopped, isTrue);
      expect(import.popped, isNull);
      expect(_shown('open'), findsOneWidget);
      // A late answer to the cancelled request is ignored.
      call.answer.complete([
        const CandidateCard(front: 'a', answer: 'b', topic: 'Page'),
      ]);
      await tester.pumpAndSettle();
      expect(_shown('Made 1 card'), findsNothing);
      expect(_shown('open'), findsOneWidget);
      await import.close();
    });

    testWidgets(
      'leaving the screen while extracting keeps reading, and its cards wait in the job',
      (tester) async {
        final import = await _Import.open(tester);
        await import.shoot();
        final call = import.client.calls.single;

        await import.back();
        expect(import.hasPopped, isTrue);
        expect(call.cancelled, isFalse);
        import.client.answer({'chat': 'cat'});
        await tester.pumpAndSettle();
        expect(import.imports.job?.list?.cardCount, 1);
        await import.close();
      },
    );

    for (final (reduceMotion, moves) in [(true, false), (false, true)]) {
      testWidgets(
        'with reduce motion ${reduceMotion ? 'on' : 'off'}, the skeleton rows ${moves ? 'shimmer' : 'hold still'}',
        (tester) async {
          final import = await _Import.open(
            tester,
            disableAnimations: reduceMotion,
          );
          await import.shoot();
          final shimmer = find.descendant(
            of: find.byType(ListView),
            matching: find.byType(FadeTransition),
          );
          expect(shimmer, findsWidgets);
          double opacity() =>
              tester.widget<FadeTransition>(shimmer.first).opacity.value;

          final before = opacity();
          await tester.pump(const Duration(milliseconds: 600));

          expect(opacity() != before, moves);
          await import.close();
        },
      );
    }
  });

  group('list', () {
    /// A word-book page of two topics: a word of two senses with its
    /// pronunciation and a synonym, a word of one, and a phrase with no part
    /// of speech.
    final words = [
      const CandidateCard(
        front: 'face',
        answer: '[동] 직면하다, 마주하다\n[명] 표면, 겉면',
        kind: CardKind.vocabulary,
        senses: [
          CardSense(
            labels: [PartOfSpeechLabel(PartOfSpeech.verb, '동')],
            meaning: '직면하다, 마주하다',
          ),
          CardSense(
            labels: [PartOfSpeechLabel(PartOfSpeech.noun, '명')],
            meaning: '표면, 겉면',
          ),
        ],
        pronunciation: "['feis]",
        extras: [Extra(label: '유의어', text: 'confront')],
        topic: '최빈출 단어',
      ),
      word(
        front: 'include',
        meaning: '포함하다',
        partOfSpeech: '[동]',
        topic: '최빈출 단어',
      ),
      word(front: 'in addition', meaning: '~뿐만 아니라', topic: '빈출 숙어'),
    ];

    /// A notes page: two rules and an identify card of their topic.
    const notes = [
      CandidateCard(front: '양성모음', answer: 'ㅏ ㅗ ㅑ ㅛ', topic: '모음조화'),
      CandidateCard(front: '음성모음', answer: 'ㅓ ㅜ ㅡ', topic: '모음조화'),
      CandidateCard(
        front: "'아름다운 꽃'의 '아'",
        answer: '양성모음 — ㅏ',
        type: CardType.identify,
        topic: '모음조화',
      ),
    ];

    testWidgets(
      'a word page shows the words found, the deck, each topic with its count and form, and each row checked with its senses one per line',
      (tester) async {
        final import = await _Import.open(tester);
        await import.extractCards(words);

        expect(_shown('Words found'), findsOneWidget);
        expect(_shown("Adds to the note '"), findsOneWidget);
        expect(_shown('French'), findsOneWidget);
        expect(_shown('최빈출 단어 2'), findsOneWidget);
        expect(_shown('빈출 숙어 1'), findsOneWidget);
        expect(_shown('Word on the front'), findsNWidgets(2));
        expect(_shown('face'), findsOneWidget);
        expect(_shown('[동]직면하다, 마주하다\n[명]표면, 겉면'), findsOneWidget);
        expect(_shown('~뿐만 아니라'), findsOneWidget, reason: 'no label');
        for (final front in ['face', 'include', 'in addition']) {
          expect(import.included(front), isTrue, reason: front);
        }
        expect(_shown('Add 3 cards'), findsOneWidget);
        expect(find.byType(Switch), findsNothing);
        expect(_shown('Next'), findsNothing, reason: 'no choice screen');
        await import.close();
      },
    );

    testWidgets(
      'a notes page counts the cards made, its rules front to back and its identify cards in their own section, left out',
      (tester) async {
        final import = await _Import.open(tester);
        await import.extractCards(notes);

        expect(_shown('Made 3 cards'), findsOneWidget);
        expect(_shown('모음조화 2'), findsOneWidget);
        expect(_shown('Identify · 모음조화 1'), findsOneWidget);
        expect(_shown('Question on the front'), findsNWidgets(2));
        expect(import.included('양성모음'), isTrue);
        expect(import.included("'아름다운 꽃'의 '아'"), isFalse);
        expect(_shown('Add 2 cards'), findsOneWidget);

        await import.tap(import.check("'아름다운 꽃'의 '아'"));
        await import.tap(_shown('Add 3 cards'));
        expect(await import.cards(import.french), [
          ('양성모음', 'ㅏ ㅗ ㅑ ㅛ', CardSource.import),
          ('음성모음', 'ㅓ ㅜ ㅡ', CardSource.import),
          ("'아름다운 꽃'의 '아'", '양성모음 — ㅏ', CardSource.import),
        ]);
        await import.close();
      },
    );

    testWidgets(
      'a check leaves a row out and puts it back, and only the rows checked are added',
      (tester) async {
        final import = await _Import.open(tester);
        await import.extractCards(words);

        await import.tap(import.check('include'));
        expect(import.included('include'), isFalse);
        expect(_shown('Add 2 cards'), findsOneWidget);
        await import.tap(import.check('in addition'));
        await import.tap(import.check('in addition'));
        expect(import.included('in addition'), isTrue, reason: 'put back');

        await import.tap(_shown('Add 2 cards'));
        expect(await import.cards(import.french), [
          ('face', '[동] 직면하다, 마주하다 / [명] 표면, 겉면', CardSource.import),
          ('in addition', '~뿐만 아니라', CardSource.import),
        ]);
        await import.close();
      },
    );

    testWidgets('a swipe left leaves a row out, and a short drag does not', (
      tester,
    ) async {
      final import = await _Import.open(tester);
      await import.extract({'chien': 'dog', 'chat': 'cat'});

      await import.swipe('chien', -30);
      expect(import.included('chien'), isTrue, reason: 'control: short');
      await import.swipe('chien', -600);
      expect(import.included('chien'), isFalse);
      expect(_shown('chien'), findsOneWidget, reason: 'still listed');
      expect(_shown('Add 1 card'), findsOneWidget);
      // A swipe does not put it back; its check does.
      await import.swipe('chien', -600);
      expect(import.included('chien'), isFalse);
      await import.tap(import.check('chien'));
      expect(import.included('chien'), isTrue);
      await import.close();
    });

    testWidgets(
      "the menu's direction turns a section's cards to meaning → word, or makes both, counting each card",
      (tester) async {
        final import = await _Import.open(tester);
        await import.extractCards(words);

        await import.menu('빈출 숙어');
        expect(find.byType(MenuItemButton), findsNWidgets(6));
        await import.pickItem('Meaning on the front');
        expect(
          _shown('Meaning on the front'),
          findsOneWidget,
          reason: 'header',
        );
        expect(_shown('Add 3 cards'), findsOneWidget);

        await import.menu('최빈출 단어');
        await import.pickItem('Both ways');
        expect(_shown('Both ways'), findsOneWidget, reason: 'header');
        expect(_shown('Add 5 cards'), findsOneWidget);

        await import.tap(_shown('Add 5 cards'));
        expect(await import.cards(import.french), [
          ('face', '[동] 직면하다, 마주하다 / [명] 표면, 겉면', CardSource.import),
          ('[동] 직면하다, 마주하다\n[명] 표면, 겉면', 'face', CardSource.import),
          ('include', '[동] 포함하다', CardSource.import),
          ('[동] 포함하다', 'include', CardSource.import),
          ('~뿐만 아니라', 'in addition', CardSource.import),
        ]);
        await import.close();
      },
    );

    testWidgets(
      'first meaning only and the part of speech change what a section shows and saves',
      (tester) async {
        final import = await _Import.open(tester);
        await import.extractCards(words);

        await import.menu('최빈출 단어');
        await import.pickItem('First meaning only');
        expect(_shown('[동]직면하다, 마주하다'), findsOneWidget);
        await import.menu('최빈출 단어');
        await import.pickItem('Show labels');
        expect(_shown('직면하다, 마주하다'), findsOneWidget);
        expect(_shown('[동]직면하다, 마주하다'), findsNothing);

        await import.tap(_shown('Add 3 cards'));
        expect((await import.cards(import.french)).take(2).toList(), [
          ('face', '직면하다, 마주하다', CardSource.import),
          ('include', '포함하다', CardSource.import),
        ]);
        await import.close();
      },
    );

    testWidgets(
      'pronunciation and extras are offered only where the page prints them, and off until chosen',
      (tester) async {
        final import = await _Import.open(tester);
        await import.extractCards(words);
        const pronunciation = "[동]직면하다, 마주하다\n[명]표면, 겉면\n['feis]";
        expect(_shown(pronunciation), findsNothing);

        await import.menu('빈출 숙어');
        expect(
          find.widgetWithText(MenuItemButton, 'Show pronunciation'),
          findsNothing,
        );
        expect(
          find.widgetWithText(MenuItemButton, 'Show synonyms and more'),
          findsNothing,
        );
        await tester.tapAt(Offset.zero);
        await tester.pumpAndSettle();

        await import.menu('최빈출 단어');
        await import.pickItem('Show pronunciation');
        expect(_shown(pronunciation), findsOneWidget);
        await import.menu('최빈출 단어');
        await import.pickItem('Show synonyms and more');
        expect(_shown('$pronunciation\n유의어 confront'), findsOneWidget);
        await import.close();
      },
    );

    testWidgets("a note section's menu swaps front and back", (tester) async {
      final import = await _Import.open(tester);
      await import.extractCards(notes);

      await import.menu('모음조화');
      expect(
        find.widgetWithText(MenuItemButton, 'Meaning on the front'),
        findsNothing,
      );
      await import.pickItem('Swap front and back');
      expect(_shown('Answer on the front'), findsOneWidget);

      await import.tap(_shown('Add 2 cards'));
      expect(await import.cards(import.french), [
        ('ㅏ ㅗ ㅑ ㅛ', '양성모음', CardSource.import),
        ('ㅓ ㅜ ㅡ', '음성모음', CardSource.import),
      ]);
      await import.close();
    });

    testWidgets(
      'a table row shows it whole and filled, opens no edit sheet, saves a 글 of its name and its 표 with no filled-text back, and its section offers no swap',
      (tester) async {
        const table = TableContent(
          columns: ['구분', '높임', '낮춤'],
          rows: [
            ['2인칭', '당신', '너'],
          ],
          blanks: [(row: 0, column: 1), (row: 0, column: 2)],
        );
        final import = await _Import.open(tester);
        await import.extractCards(const [
          CandidateCard(
            front: '인칭 대명사',
            answer: '구분 | 높임 | 낮춤\n2인칭 | 당신 | 너',
            type: CardType.table,
            topic: '대명사',
            wholeFront: [TextContent('인칭 대명사'), table],
          ),
          CandidateCard(front: '양성모음', answer: 'ㅏ ㅗ', topic: '모음조화'),
        ]);

        final whole = import.row('인칭 대명사');
        expect(blanksUnder(whole), {'당신': true, '너': true});
        expect(
          import.check('인칭 대명사. 구분, 높임, 낮춤. 2인칭, blank, blank'),
          findsOneWidget,
        );
        await import.tap(_shown('인칭 대명사'));
        expect(_shown('Edit card'), findsNothing);
        // Control: the plain note's row opens the sheet.
        await import.tap(_shown('양성모음'));
        expect(_shown('Edit card'), findsOneWidget);
        await tester.tapAt(Offset.zero);
        await tester.pumpAndSettle();

        await import.menu('대명사');
        expect(
          find.widgetWithText(MenuItemButton, 'Swap front and back'),
          findsNothing,
        );
        // Control: the menu is open, with its other item.
        expect(
          find.widgetWithText(MenuItemButton, 'Leave out this group'),
          findsOneWidget,
        );
        await tester.tapAt(Offset.zero);
        await tester.pumpAndSettle();

        await import.tap(_shown('Add 2 cards'));
        final saved = (await tester.runAsync(
          () => import.repository.listCards(import.french.id),
        ))!;
        final card = saved.firstWhere(
          (card) => card.front.any((block) => block is TableContent),
        );
        expect(card.front, [const TextContent('인칭 대명사'), table]);
        expect(card.back, isEmpty);
        expect(card.cells, const [TextCell(front: '인칭 대명사'), BlankCell(table)]);
        await import.close();
      },
    );

    testWidgets(
      "the menu's last item leaves out every row of a section, then includes them",
      (tester) async {
        final import = await _Import.open(tester);
        await import.extractCards(words);

        await import.menu('최빈출 단어');
        await import.pickItem('Leave out this group');
        expect(import.included('face'), isFalse);
        expect(import.included('include'), isFalse);
        expect(import.included('in addition'), isTrue, reason: 'control');
        expect(_shown('Add 1 card'), findsOneWidget);

        await import.menu('최빈출 단어');
        await import.pickItem('Include this group');
        expect(import.included('face'), isTrue);
        expect(_shown('Add 3 cards'), findsOneWidget);
        await import.close();
      },
    );

    testWidgets(
      'a row the deck holds starts left out, marked, and merges into its card when checked',
      (tester) async {
        final import = await _Import.open(tester, french: {'chat': 'cat'});
        await import.extract({'chat': 'talk', 'chien': 'dog'});

        expect(import.included('chat'), isFalse);
        expect(_shown('Already in the note'), findsOneWidget);
        expect(import.included('chien'), isTrue, reason: 'control');

        await import.tap(import.check('chat'));
        await import.tap(_shown('Add 2 cards'));
        expect(await import.cards(import.french), [
          ('chat', 'cat / talk', CardSource.manual),
          ('chien', 'dog', CardSource.import),
        ]);
        await import.close();
      },
    );

    testWidgets(
      'the deck name opens the deck chooser, and another deck decides again which rows it holds',
      (tester) async {
        final import = await _Import.open(tester, french: {'chat': 'cat'});
        await import.extract({'chat': 'talk', 'chien': 'dog'});
        expect(import.included('chat'), isFalse);

        await import.tap(_shown('French'));
        expect(_shown('Add to'), findsOneWidget);
        // Each row is a name alone; the one icon is the chosen deck's check.
        expect(
          find.descendant(
            of: find.byType(AppListRow),
            matching: find.byType(Icon),
          ),
          findsOneWidget,
        );
        expect(
          find.descendant(
            of: find.widgetWithText(AppListRow, 'French'),
            matching: find.byType(Icon),
          ),
          findsOneWidget,
        );
        expect(find.widgetWithText(AppListRow, 'New note'), findsOneWidget);
        await import.tap(_shown('Spanish'));
        expect(import.included('chat'), isTrue);
        expect(_shown('Already in the note'), findsNothing);
        await import.tap(_shown('Add 2 cards'));

        expect(await import.cards(import.spanish), [
          ('chat', 'talk', CardSource.import),
          ('chien', 'dog', CardSource.import),
        ]);
        expect((import.popped! as Deck).id, import.spanish.id);
        // An existing deck keeps its look: no 노트 꾸미기 on the way.
        expect(_shown('Customize note'), findsNothing);
        await import.close();
      },
    );

    testWidgets('a new deck is named when saving, and created only then', (
      tester,
    ) async {
      final import = await _Import.open(tester, deck: (_) => null);
      await import.extract({'chien': 'dog', 'chat': 'cat'});
      expect(_shown('New note'), findsOneWidget);
      // The line says a new deck, not a deck named "New note", as it says
      // a chosen deck's name in quotes.
      expect(_shown('Adds to '), findsOneWidget);
      expect(_shown("Adds to the note '"), findsNothing);
      expect(await import.deckNames(), ['French', 'Spanish']);

      await import.tap(_shown('Add 2 cards'));
      await tester.enterText(find.byType(TextField), 'Page 12');
      await import.tap(_shown('Create'));

      // 노트 꾸미기 follows the naming, as for a deck made by hand, and the
      // pair it saves is stored on the new deck.
      expect(_shown('Customize note'), findsOneWidget);
      expect(import.hasPopped, isFalse);
      await import.tap(find.bySemanticsLabel('Star'));
      await import.tap(_shown('Save'));

      expect(await import.deckNames(), ['French', 'Page 12', 'Spanish']);
      expect((await import.deck('Page 12')).icon, DeckIcon.star);
      expect(await import.cards(import.popped! as Deck), [
        ('chien', 'dog', CardSource.import),
        ('chat', 'cat', CardSource.import),
      ]);
      await import.close();
    });

    testWidgets(
      'dismissing 노트 꾸미기 after a new deck is named keeps its default look, and the cards are saved',
      (tester) async {
        final import = await _Import.open(tester, deck: (_) => null);
        await import.extract({'chien': 'dog'});
        await import.tap(_shown('Add 1 card'));
        await tester.enterText(find.byType(TextField), 'Page 13');
        await import.tap(_shown('Create'));
        expect(_shown('Customize note'), findsOneWidget);

        await tester.tapAt(const Offset(20, 20));
        await tester.pumpAndSettle();

        expect(_shown('Customize note'), findsNothing);
        final deck = await import.deck('Page 13');
        expect((deck.icon, deck.color), (null, null));
        expect((import.popped! as Deck).id, deck.id);
        expect(await import.cards(deck), [('chien', 'dog', CardSource.import)]);
        await import.close();
      },
    );

    testWidgets(
      "a section's form is remembered for its deck and topic, and not for another deck or topic",
      (tester) async {
        final import = await _Import.open(tester);
        await import.extractCards(words);
        await import.menu('빈출 숙어');
        await import.pickItem('Meaning on the front');
        await import.tap(_shown('Add 3 cards'));

        await import.extractCards(words);
        expect(_shown('Meaning on the front'), findsOneWidget, reason: '빈출 숙어');
        expect(_shown('Word on the front'), findsOneWidget, reason: '최빈출 단어');

        // Saved into Spanish, a form is Spanish's alone.
        await import.menu('최빈출 단어');
        await import.pickItem('Both ways');
        await import.tap(_shown('French'));
        await import.tap(_shown('Spanish'));
        await import.tap(_shown('Add 5 cards'));

        await import.extractCards(words);
        expect(_shown('Both ways'), findsNothing, reason: "French's forms");
        expect(_shown('Meaning on the front'), findsOneWidget);
        await import.tap(_shown('French'));
        await import.tap(_shown('Spanish'));
        expect(_shown('Both ways'), findsOneWidget, reason: "Spanish's forms");
        await import.close();
      },
    );

    testWidgets(
      'candidates of one card key on the photo are one row with their senses, and a card with no topic goes under This page',
      (tester) async {
        final import = await _Import.open(tester);
        await import.extractCards([
          word(front: 'run', meaning: '달리다', partOfSpeech: '[동]'),
          word(front: 'Run', meaning: '경영하다', partOfSpeech: '[동]'),
        ]);

        expect(_shown('Words found'), findsOneWidget);
        expect(_shown('Page 1'), findsOneWidget);
        expect(_shown('[동]달리다\n[동]경영하다'), findsOneWidget);
        await import.close();
      },
    );

    testWidgets('with nothing to add, the add button is disabled', (
      tester,
    ) async {
      final import = await _Import.open(tester);
      await import.extract({'a': '1'});

      await import.tap(import.check('a'));

      final button = tester.widget<FilledButton>(
        find.widgetWithText(FilledButton, 'Add 0 cards'),
      );
      expect(button.onPressed, isNull);
      await import.close();
    });

    testWidgets(
      'retake takes another photo; a cancel keeps the list, a photo replaces it',
      (tester) async {
        final import = await _Import.open(tester);
        await import.extract({'a': '1'});
        await import.tap(import.check('a'));

        import.photos.cameraPhoto = null;
        await import.openActions();
        await import.tap(_shown('Retake'));
        expect(_shown('Words found'), findsOneWidget);
        expect(import.included('a'), isFalse, reason: 'kept as it was');
        expect(import.client.calls, hasLength(1));

        import.photos.cameraPhoto = testPhoto;
        await import.retake();
        import.client.answer({'b': '2', 'c': '3'});
        await tester.pumpAndSettle();
        expect(_shown('Words found'), findsOneWidget);
        expect(_shown('a'), findsNothing);
        expect(await import.cards(import.french), isEmpty);
        await import.close();
      },
    );

    group('leaving a list that holds cards', () {
      const prompt = 'Discard the cards found?';
      const consequence =
          'The 2 cards found will be lost. Reading the photos again uses '
          "today's photo limit again.";

      /// A list of three words, one left out and one edited, so a kept list
      /// shows both.
      Future<_Import> edited(WidgetTester tester) async {
        final import = await _Import.open(tester);
        await import.extract({
          'chat': 'cat',
          'chien': 'dog',
          'cheval': 'horse',
        });
        await import.tap(import.check('cheval'));
        await import.editFront('chien', 'chiot');
        expect(import.included('cheval'), isFalse);
        expect(_shown('chiot'), findsOneWidget);
        return import;
      }

      Future<void> expectKept(_Import import) async {
        expect(_shown(prompt), findsNothing);
        expect(import.hasPopped, isFalse);
        expect(import.included('cheval'), isFalse, reason: 'its check kept');
        expect(_shown('chiot'), findsOneWidget, reason: 'its edit kept');
      }

      testWidgets(
        '"Cancel" asks first, its cancel keeps every check and edit, and discarding closes the screen with nothing written',
        (tester) async {
          final import = await edited(tester);

          await import.tap(find.byTooltip('Close'));
          expect(_shown(prompt), findsOneWidget);
          expect(_shown(consequence), findsOneWidget);
          await import.tap(_shown('Cancel').last);
          await expectKept(import);
          expect(import.client.calls, hasLength(1));

          await import.tap(find.byTooltip('Close'));
          await import.tap(_shown('Discard'));
          expect(import.hasPopped, isTrue);
          expect(import.popped, isNull);
          expect(await import.cards(import.french), isEmpty);
          expect(import.imports.job, isNull);
          await import.close();
        },
      );

      testWidgets(
        'the system back leaves without asking, and reopening shows the list with every check and edit',
        (tester) async {
          final import = await edited(tester);

          await import.back();
          expect(_shown(prompt), findsNothing);
          expect(import.hasPopped, isTrue);
          expect(import.imports.job?.list, isNotNull, reason: 'the job stays');

          await import.reopen();
          await expectKept(import);
          expect(import.client.calls, hasLength(1), reason: 'nothing resent');
          await import.close();
        },
      );

      testWidgets(
        'the retake asks first, and its cancel keeps the list and takes no photo',
        (tester) async {
          final import = await edited(tester);

          await import.openActions();
          await import.tap(_shown('Retake'));
          expect(_shown(prompt), findsOneWidget);
          await import.tap(_shown('Cancel').last);
          await expectKept(import);
          expect(import.photos.cameraCalls, 1);

          await import.retake();
          expect(import.photos.cameraCalls, 2);
          expect(import.client.calls, hasLength(2));
          await import.close();
        },
      );

      testWidgets(
        'with every row left out, "Cancel" and the system back close at once',
        (tester) async {
          final import = await _Import.open(tester);
          await import.extract({'chat': 'cat'});
          await import.tap(import.check('chat'));
          await import.tap(find.byTooltip('Close'));
          expect(_shown(prompt), findsNothing);
          expect(import.hasPopped, isTrue);
          await import.close();

          final other = await _Import.open(tester);
          await other.extract({'chat': 'cat'});
          await other.tap(other.check('chat'));
          await other.back();
          expect(other.hasPopped, isTrue);
          await other.close();
        },
      );

      testWidgets(
        'a back while photos are added, while the first are read or while one is extracted leaves the screen and the photos go on being read',
        (tester) async {
          tester.view.physicalSize = const Size(1170, 2532);
          addTearDown(tester.view.reset);
          final import = await edited(tester);
          import.photos.libraryPhotos = [Future.value(testPhoto)];
          await import.tap(_shown('Add more photos'));
          await tester.tap(_shown('Choose from album'));
          await import.frames();
          expect(find.bySemanticsLabel('Read 0 of 1 photo'), findsOneWidget);

          await tester.binding.handlePopRoute();
          await import.frames();
          expect(import.hasPopped, isTrue);
          expect(import.calls(1).cancelled, isFalse);
          await import.answerCall(1, {'oiseau': 'bird'});
          await import.reopen();
          expect(_shown('oiseau'), findsOneWidget);
          await expectKept(import);
          await import.close();

          final first = await _Import.open(tester);
          await first.pickSeveral(2);
          await tester.tap(find.byTooltip('Back'));
          await first.frames();
          expect(first.hasPopped, isTrue);
          expect(first.client.calls.map((call) => call.cancelled), [
            false,
            false,
          ]);
          await first.close();

          final one = await _Import.open(tester);
          await one.shoot();
          expect(_shown('Finding cards'), findsOneWidget);
          await tester.binding.handlePopRoute();
          await one.frames();
          expect(one.hasPopped, isTrue);
          expect(one.client.calls.single.cancelled, isFalse);
          await one.close();
        },
      );
    });

    testWidgets(
      'cancel closes the list, writes nothing and pops with nothing',
      (tester) async {
        final import = await _Import.open(tester, deck: (_) => null);
        await import.extract({'a': '1'});

        await import.tap(find.byTooltip('Close'));
        await import.tap(_shown('Discard'));

        expect(import.hasPopped, isTrue);
        expect(import.popped, isNull);
        expect(await import.deckNames(), ['French', 'Spanish']);
        await import.close();
      },
    );

    testWidgets(
      'a deck that cannot be read says so in a snack bar, and the list opens with no row marked as held',
      (tester) async {
        final import = await _Import.open(
          tester,
          french: {'chat': 'cat'},
          before: (import) =>
              import.repository.unreadable.add(import.french.id),
        );
        await import.extract({'chat': 'talk'});

        expect(
          _shown(
            "Couldn't read or write the device's storage. Please try again.",
          ),
          findsOneWidget,
        );
        expect(_shown('Words found'), findsOneWidget);
        expect(import.included('chat'), isTrue);
        await import.close();
      },
    );

    testWidgets(
      "the menu's last item is read as an action, not as an option left unchecked, and a choice with its state",
      (tester) async {
        final import = await _Import.open(tester);
        await import.extractCards(words);
        await import.menu('최빈출 단어');

        expect(
          tester.getSemantics(_shown('Leave out this group')),
          isSemantics(
            label: 'Leave out this group',
            hasTapAction: true,
            hasCheckedState: false,
          ),
        );
        // Control: a choice is read with its state.
        expect(
          tester.getSemantics(_shown('Show labels')),
          isSemantics(
            label: 'Show labels',
            hasTapAction: true,
            hasCheckedState: true,
            isChecked: true,
          ),
        );
        await import.close();
      },
    );

    testWidgets(
      'forms that cannot be stored say so in a snack bar, and the cards are still added',
      (tester) async {
        final import = await _Import.open(tester, refuseWrites: true);
        await import.extract({'chien': 'dog'});

        await import.tap(_shown('Add 1 card'));

        expect(
          _shown(
            "Couldn't read or write the device's storage. Please try again.",
          ),
          findsOneWidget,
        );
        expect((import.popped! as Deck).id, import.french.id);
        expect(await import.cards(import.french), [
          ('chien', 'dog', CardSource.import),
        ]);
        await import.close();
      },
    );

    testWidgets(
      "양쪽 다 over a deck that holds a word's meaning keeps the row, counts its cards by key, and merges the reversed card",
      (tester) async {
        final import = await _Import.open(tester, french: {'강': 'river'});
        await import.extractCards([
          word(front: 'stream', meaning: '강'),
          word(front: 'creek', meaning: '강'),
        ]);
        await import.menu('Page');
        await import.pickItem('Both ways');

        expect(import.included('stream'), isTrue);
        expect(_shown('Add 3 cards'), findsOneWidget, reason: "'강' twice");
        await import.tap(_shown('Add 3 cards'));
        expect(await import.cards(import.french), [
          ('강', 'river / stream / creek', CardSource.manual),
          ('stream', '강', CardSource.import),
          ('creek', '강', CardSource.import),
        ]);
        await import.close();
      },
    );
  });

  group('edit sheet', () {
    final face = [
      const CandidateCard(
        front: 'face',
        answer: '[동] 직면하다\n[명] 표면\n[명] 얼굴',
        topic: 'Page',
        kind: CardKind.vocabulary,
        senses: [
          CardSense(
            labels: [PartOfSpeechLabel(PartOfSpeech.verb, '동')],
            meaning: '직면하다',
          ),
          CardSense(
            labels: [PartOfSpeechLabel(PartOfSpeech.noun, '명')],
            meaning: '표면',
          ),
          CardSense(
            labels: [PartOfSpeechLabel(PartOfSpeech.noun, '명')],
            meaning: '얼굴',
          ),
        ],
      ),
    ];

    testWidgets(
      "a tap opens the sheet with the front and each sense; Done applies the edits and a dismissal none",
      (tester) async {
        final import = await _Import.open(tester);
        await import.extractCards(face);

        await import.tap(_shown('face'));
        expect(_shown('Edit card'), findsOneWidget);
        expect(find.byType(TextField), findsNWidgets(4));
        await tester.enterText(find.byType(TextField).at(2), '겉면');
        await tester.tapAt(Offset.zero);
        await tester.pumpAndSettle();
        expect(
          _shown('[동]직면하다\n[명]표면\n[명]얼굴'),
          findsOneWidget,
          reason: 'dismissed',
        );

        await import.tap(_shown('face'));
        await tester.enterText(find.byType(TextField).first, 'faces');
        await tester.enterText(find.byType(TextField).at(2), '겉면');
        await import.tap(_shown('Done'));
        expect(_shown('faces'), findsOneWidget);
        expect(_shown('[동]직면하다\n[명]겉면\n[명]얼굴'), findsOneWidget);
        await import.close();
      },
    );

    testWidgets(
      'a sense dropped leaves the card, and with every sense dropped Done is disabled',
      (tester) async {
        final import = await _Import.open(tester);
        await import.extractCards(face);

        await import.tap(_shown('face'));
        // One selection control: the list's round check, no square box.
        expect(find.byType(Checkbox), findsNothing);
        expect(
          find.descendant(
            of: find.byType(AppSheet),
            matching: find.byType(RoundCheck),
          ),
          findsNWidgets(3),
        );
        await import.tap(find.bySemanticsLabel('Include meaning 2'));
        await import.tap(_shown('Done'));
        expect(_shown('[동]직면하다\n[명]얼굴'), findsOneWidget);

        await import.tap(_shown('face'));
        for (final i in [1, 3]) {
          await import.tap(find.bySemanticsLabel('Include meaning $i'));
        }
        final done = tester.widget<FilledButton>(
          find.widgetWithText(FilledButton, 'Done'),
        );
        expect(done.onPressed, isNull);
        // Control: one sense kept again.
        await import.tap(find.bySemanticsLabel('Include meaning 3'));
        expect(
          tester
              .widget<FilledButton>(find.widgetWithText(FilledButton, 'Done'))
              .onPressed,
          isNotNull,
        );
        await import.close();
      },
    );

    testWidgets('a sense moved up through its ⋯ menu moves, and the card '
        'follows; nothing is dragged', (tester) async {
      final import = await _Import.open(tester);
      await import.extractCards(face);

      await import.tap(_shown('face'));
      expect(find.byType(ReorderableDragStartListener), findsNothing);
      expect(find.byIcon(LucideIcons.gripVertical), findsNothing);
      // The first meaning cannot move up; the last cannot move down.
      await import.tap(find.byTooltip('Meaning 1 menu'));
      expect(
        tester
            .widget<PopupMenuItem<int>>(
              find.widgetWithText(PopupMenuItem<int>, 'Move up'),
            )
            .enabled,
        isFalse,
      );
      await tester.tapAt(Offset.zero);
      await tester.pumpAndSettle();
      await import.tap(find.byTooltip('Meaning 3 menu'));
      expect(
        tester
            .widget<PopupMenuItem<int>>(
              find.widgetWithText(PopupMenuItem<int>, 'Move down'),
            )
            .enabled,
        isFalse,
      );
      await tester.tapAt(Offset.zero);
      await tester.pumpAndSettle();
      for (final number in [3, 2]) {
        await import.tap(find.byTooltip('Meaning $number menu'));
        await import.tap(_shown('Move up'));
      }
      await import.tap(_shown('Done'));

      expect(_shown('[명]얼굴\n[동]직면하다\n[명]표면'), findsOneWidget);
      await import.tap(_shown('Add 1 card'));
      expect(await import.cards(import.french), [
        ('face', '[명] 얼굴 / [동] 직면하다 / [명] 표면', CardSource.import),
      ]);
      await import.close();
    });

    testWidgets("a note's sheet edits its back", (tester) async {
      final import = await _Import.open(tester);
      await import.extractCards(const [
        CandidateCard(front: '양성모음', answer: 'ㅏ ㅗ', topic: '모음조화'),
      ]);

      await import.tap(_shown('양성모음'));
      expect(find.byType(Checkbox), findsNothing);
      await tester.enterText(find.byType(TextField).last, 'ㅏ ㅗ ㅑ ㅛ');
      await import.tap(_shown('Done'));

      expect(_shown('ㅏ ㅗ ㅑ ㅛ'), findsOneWidget);
      await import.close();
    });

    testWidgets(
      "an edit whose front the deck holds keeps the row, marked, and merges it into the deck's card",
      (tester) async {
        final import = await _Import.open(tester, french: {'chat': 'cat'});
        await import.extract({'chien': 'dog'});

        await import.tap(_shown('chien'));
        await tester.enterText(find.byType(TextField).first, 'chat');
        await import.tap(_shown('Done'));

        expect(import.included('chat'), isTrue);
        expect(_shown('Already in the note'), findsOneWidget);
        await import.tap(_shown('Add 1 card'));
        expect(await import.cards(import.french), [
          ('chat', 'cat / dog', CardSource.manual),
        ]);
        await import.close();
      },
    );
  });

  group('failures', () {
    final cases = <(PhotoImportFailure, String, bool, bool)>[
      (
        ExtractionOffline(Exception('offline')),
        "You're offline. Check your connection and try again.",
        true,
        true,
      ),
      (
        const PhotoRefused(413),
        "This photo can't be sent. Retake it or choose another.",
        false,
        true,
      ),
      (
        const PhotoRefused(415),
        "This photo can't be sent. Retake it or choose another.",
        false,
        true,
      ),
      (
        const NoCardsFound(),
        'No cards found. Try a brighter, straighter photo.',
        false,
        true,
      ),
      (
        const PhotoLimitReached(limit: 30, period: LimitPeriod.day),
        "You've used today's 30 photos. Try again tomorrow.",
        false,
        false,
      ),
      (
        const AccountSuspendedFailure(),
        'This account is suspended. Write to sauce@garam.sh with any questions.',
        false,
        false,
      ),
      (
        const PhotoLimitReached(limit: 50, period: LimitPeriod.day),
        "You've used today's 50 photos. Try again tomorrow.",
        false,
        false,
      ),
      (
        const PhotoLimitReached(limit: 10, period: LimitPeriod.month),
        "You've used this month's 10 photos. Try again on the 1st of next month.",
        false,
        false,
      ),
      (
        const ModelFailed(),
        "Couldn't read the cards. Please try again in a moment.",
        true,
        true,
      ),
      (
        const SignInRequired(),
        'You need to sign in. Sign in again from Settings.',
        false,
        false,
      ),
      (
        const ServiceFailed('HTTP 503'),
        "Can't make cards from photos right now. Please try again in a moment.",
        true,
        true,
      ),
    ];
    for (final (failure, message, retry, retake) in cases) {
      testWidgets(
        '$failure is shown${retry ? ' with a retry' : ''}${retake ? ' with a retake' : ''}',
        (tester) async {
          final import = await _Import.open(tester);
          await import.shoot();

          import.client.fail(failure);
          await tester.pumpAndSettle();

          expect(_shown(message), findsOneWidget);
          expect(_shown('Try again'), retry ? findsOneWidget : findsNothing);
          expect(_shown('Retake'), retake ? findsOneWidget : findsNothing);
          if (retry) {
            await tester.tap(_shown('Try again'));
            await tester.pump();
            expect(import.client.calls, hasLength(2));
            expect(import.client.calls.last.photo.bytes, testPhoto.bytes);
            expect(_shown('Finding cards'), findsOneWidget);
          } else if (retake) {
            await import.retake();
            expect(import.photos.cameraCalls, 2);
            expect(_shown('Finding cards'), findsOneWidget);
          } else {
            // The top bar's close is the one way out.
            expect(_shown('Close'), findsNothing);
            await import.tap(find.byTooltip('Close'));
            expect(import.popped, isNull);
          }
          expect(await import.cards(import.french), isEmpty);
          await import.close();
        },
      );
    }

    testWidgets('an unreadable album photo is shown with a retake', (
      tester,
    ) async {
      final import = await _Import.open(tester);
      import.photos.libraryFailure = const PhotoUnreadable('heic');

      await import.start(PhotoOrigin.album);

      expect(
        _shown("Couldn't read this photo. Choose another one."),
        findsOneWidget,
      );
      expect(_shown('Try again'), findsNothing);
      await import.tap(_shown('Pick another photo'));
      expect(import.photos.libraryCalls, 2);
      expect(import.client.calls, isEmpty);
      await import.close();
    });
  });

  group('accessibility', () {
    for (final mode in [ThemeMode.light, ThemeMode.dark]) {
      testWidgets(
        'the photo viewer and the thumbnails that open it meet the guidelines in ${mode.name}',
        (tester) async {
          final import = await _Import.open(tester, themeMode: mode);
          Future<void> check() async {
            await expectLater(
              tester,
              meetsGuideline(labeledTapTargetGuideline),
            );
            await expectLater(
              tester,
              meetsGuideline(androidTapTargetGuideline),
            );
            await expectLater(tester, meetsGuideline(textContrastGuideline));
            expectScreenTextReadable(tester);
          }

          await import.pickSeveral(2);
          await check();
          await import.tap(find.bySemanticsLabel('View photo 2'));
          expect(find.bySemanticsLabel('Photo 2 of 2'), findsOneWidget);
          await check();
          await import.close();
        },
      );

      testWidgets(
        'several photos being read, one failed, and their grouped list meet the guidelines in ${mode.name}',
        (tester) async {
          final import = await _Import.open(
            tester,
            themeMode: mode,
            before: (import) => import.client.todayAllowance = (
              limit: 30,
              period: LimitPeriod.day,
              used: 28,
            ),
          );
          Future<void> check() async {
            await expectLater(
              tester,
              meetsGuideline(labeledTapTargetGuideline),
            );
            await expectLater(
              tester,
              meetsGuideline(androidTapTargetGuideline),
            );
            await expectLater(tester, meetsGuideline(textContrastGuideline));
            expectScreenTextReadable(tester);
          }

          await import.pickSeveral(3);
          import.calls(0).answer.completeError(const ModelFailed());
          await import.frames();
          await check();
          await tester.tap(_shown('Remove'));
          await import.frames();
          import.photos.libraryPhotos = [Future.value(testPhoto)];
          await import.answerCall(1, {'chien': 'dog'});
          await tester.pumpAndSettle();
          await import.tap(_shown('Add more photos'));
          await check();
          await tester.tap(_shown('Choose from album'));
          await import.frames();
          await import.answerCall(2, {'chat': 'cat'});
          await tester.pumpAndSettle();
          expect(_shown('Photo 2'), findsOneWidget);
          await check();
          await import.close();
        },
      );

      testWidgets(
        'extracting, the list with a row left out and a row held, its form menu, the edit sheet, the deck sheet, a failure and a refusal meet the guidelines in ${mode.name}',
        (tester) async {
          final import = await _Import.open(
            tester,
            themeMode: mode,
            french: {'chat': 'cat'},
          );
          Future<void> check() async {
            await expectLater(
              tester,
              meetsGuideline(labeledTapTargetGuideline),
            );
            await expectLater(
              tester,
              meetsGuideline(androidTapTargetGuideline),
            );
            await expectLater(tester, meetsGuideline(textContrastGuideline));
            expectScreenTextReadable(tester);
          }

          await import.shoot();
          await check();
          import.client.answer({
            'chat': 'talk',
            'chien': 'dog',
            'cheval': 'horse',
          });
          await tester.pumpAndSettle();
          await import.tap(import.check('cheval'));
          expect(_shown('Already in the note'), findsOneWidget);
          expect(_shown('Add 1 card'), findsOneWidget);
          await check();
          await import.menu('Page');
          expect(find.byType(MenuItemButton), findsWidgets);
          await check();
          await tester.tapAt(Offset.zero);
          await tester.pumpAndSettle();
          await import.tap(_shown('dog'));
          expect(_shown('Edit card'), findsOneWidget);
          await check();
          await import.tap(_shown('Done'));
          await import.tap(_shown('French'));
          expect(_shown('Add to'), findsOneWidget);
          await check();
          await import.tap(_shown('Spanish'));
          await import.retake();
          import.client.fail(const ModelFailed());
          await tester.pumpAndSettle();
          expect(_shown('Try again'), findsOneWidget);
          await check();
          import.photos.cameraFailure = const PhotoAccessDenied('denied');
          await import.tap(_shown('Retake'));
          expect(_shown('Open Settings'), findsOneWidget);
          await check();
          await import.close();
        },
      );
    }

    testWidgets(
      "a screen reader hears each row's sides and its check's state, and taps either",
      (tester) async {
        final import = await _Import.open(tester);
        await import.extract({'chien': 'dog'});

        expect(
          tester.getSemantics(find.bySemanticsLabel('chien, dog. Tap to edit')),
          matchesSemantics(
            label: 'chien, dog. Tap to edit',
            isButton: true,
            hasTapAction: true,
          ),
        );
        expect(
          tester.getSemantics(import.check('chien')),
          matchesSemantics(
            label: 'Include chien',
            hasCheckedState: true,
            isChecked: true,
            hasTapAction: true,
          ),
        );
        tester.semantics.tap(find.semantics.byLabel('Include chien'));
        await tester.pumpAndSettle();
        expect(import.included('chien'), isFalse);
        tester.semantics.tap(find.semantics.byLabel('chien, dog. Tap to edit'));
        await tester.pumpAndSettle();
        expect(_shown('Edit card'), findsOneWidget);
        await import.close();
      },
    );
  });
}

/// The text on screen that reads [text] once its word joiners are left out.
Finder _shown(String text) => find.byWidgetPredicate(
  (widget) =>
      widget is Text &&
      (widget.data ?? widget.textSpan?.toPlainText())?.replaceAll(
            '\u2060',
            '',
          ) ==
          text,
);

/// The text on screen that holds [part] once the word joiners `keepWords`
/// sets are left out.
Finder _shownContaining(String part) => find.byWidgetPredicate(
  (widget) =>
      widget is Text &&
      ((widget.data ?? widget.textSpan?.toPlainText())
              ?.replaceAll('\u2060', '')
              .contains(part) ??
          false),
);
