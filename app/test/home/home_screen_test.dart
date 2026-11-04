import 'dart:async';

import 'package:drift/drift.dart' show driftRuntimeOptions;
import 'package:drift/native.dart';
import 'package:flutter/material.dart' hide Card;
import 'package:flutter/rendering.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:knowno/account/account.dart';
import 'package:knowno/database/database.dart' hide DeckRow;
import 'package:knowno/deck/deck.dart';
import 'package:knowno/design/app_button.dart';
import 'package:knowno/design/mascot.dart';
import 'package:knowno/design/theme.dart';
import 'package:knowno/home/src/deck_screen.dart';
import 'package:knowno/home/src/home_screen.dart';
import 'package:knowno/home/src/progress_bar.dart';
import 'package:knowno/home/src/home_tab.dart';
import 'package:knowno/l10n/app_localizations.dart';
import 'package:knowno/media/media.dart';
import 'package:knowno/photo_import/photo_import.dart';
import 'package:knowno/study/study.dart';

import '../contrast.dart';
import '../media/fakes.dart';
import '../photo_import/fakes.dart';
import '../settle_until.dart';
import 'home_data.dart';
import '../study/minutes_sheet.dart';
import '../study/study_storage.dart';
import '../word_breaks.dart';

/// Opens a screen over 홈 holding the daily study minutes' row, as
/// the account screen holds it (`widget_test.dart` opens that screen itself),
/// and the picker the row opens, waiting for it.
Future<void> _openMinutes(WidgetTester tester) async {
  unawaited(
    Navigator.of(tester.element(find.byType(HomeTab))).push(
      MaterialPageRoute<void>(
        builder: (_) =>
            Scaffold(appBar: AppBar(), body: const DailyMinutesRow()),
      ),
    ),
  );
  await tester.pumpAndSettle();
  await tester.tap(shownText('Daily study time'));
  await waitForPicker(tester);
}

class _List {
  _List(this.tester, this.repository, this.ids)
    : _semantics = tester.ensureSemantics();

  final WidgetTester tester;
  final SemanticsHandle _semantics;
  final DeckRepository repository;

  /// Each deck's id by name.
  final Map<String, DeckId> ids;

  /// The extraction client photo import reads through.
  final extraction = FakeExtractionClient();

  /// The app's photo import jobs, where [_open] was asked for them.
  PhotoImports? imports;

  /// The decks of the study session open on top.
  Set<DeckId> get session =>
      tester.widget<StudyScreen>(find.byType(StudyScreen)).decks.ids;

  Future<void> tap(String text) async {
    // 홈 scrolls where the test font makes it taller than its screen.
    await tester.ensureVisible(shownText(text));
    await tester.pumpAndSettle();
    await tester.tap(shownText(text));
    await tester.pumpAndSettle();
  }

  /// The tab named [name] in the bar.
  Finder tab(String name) => find.descendant(
    of: find.bySemanticsLabel(RegExp(r'^(Tabs|탭)$')),
    matching: shownText(name),
  );

  /// Shows the 노트 tab, named [name] in the bar.
  Future<void> decks([String name = 'Notes']) async {
    await tester.tap(tab(name));
    await tester.pumpAndSettle();
  }

  /// The daily study minutes stored, null while none is.
  Future<int?> storedMinutes() async => (await tester.runAsync<int?>(
    () =>
        // Offstage too, under a screen opened over it.
        ProviderScope.containerOf(
          tester.element(find.byType(HomeScreen, skipOffstage: false)),
        ).read(studyRepositoryProvider).dailyMinutes(),
  ));

  /// Shows the 노트 tab and taps its "새 노트", which opens 새 노트.
  Future<void> newDeck() async {
    await decks();
    await tap('New note');
  }

  /// Unmounts the list. Unmounting cancels drift's stream query, whose
  /// cleanup timer must fire before the test body ends.
  Future<void> close() async {
    await tester.pumpWidget(const SizedBox());
    await tester.pump(const Duration(seconds: 1));
    _semantics.dispose();
  }
}

/// Opens the home screen, with in each deck named in [fresh] that many new
/// cards, in each named in [due] that many cards due today after an interval
/// of [dueDays] days, in each named in [later] that many due tomorrow, and in
/// each named in [answeredToday] that many answered an hour before [homeNow]
/// and due tomorrow, in Alpha for each entry of [answeredBefore] that many
/// answered that many days before and due tomorrow, and in each named in
/// [mastered] that many reviewed after
/// a 30-day interval and due in ten days.
/// [pace] is the time the user's answers took; [unreadable] names the decks
/// whose cards cannot be read. The first-run daily minutes step has shown
/// unless [minutesAsked] is false. The screen is a phone's unless [screen]
/// says otherwise, in the light theme unless [theme] is another, with
/// [dailyMinutes] stored when given. [photoImport] stands in for the photo import
/// when given: a screen it pushes, which pops with what photo import resolves
/// to. With [importing], the app's photo import jobs are [_List.imports].
/// Hands out [photo] on each pick.
final class _OnePhoto implements ImagePick {
  const _OnePhoto(this.photo);

  final PreparedImage photo;

  @override
  Future<PreparedImage?> pick(
    ImageOrigin origin, {
    ImageShape shape = ImageShape.square,
  }) async => photo;
}

Future<_List> _open(
  WidgetTester tester, {
  Map<String, int> fresh = const {},
  Map<String, int> due = const {},
  int dueDays = 1,
  Map<String, int> later = const {},
  Map<String, int> answeredToday = const {},
  Map<int, int> answeredBefore = const {},
  Map<String, int> mastered = const {},
  Duration? pace,
  Set<String> unreadable = const {},
  Widget Function(DeckId? deck, PhotoOrigin origin)? photoImport,
  SpreadsheetPick? spreadsheet,
  List<String> decks = const ['Alpha', 'Beta', 'Gamma'],
  bool minutesAsked = true,
  Locale locale = const Locale('en'),
  Size screen = const Size(390, 844),
  ThemeData? theme,
  int? dailyMinutes,
  PreparedImage? photo,
  bool importing = false,
}) async {
  Future<PhotoImportOutcome?> pushed(
    BuildContext context,
    DeckId? deck,
    PhotoOrigin origin,
  ) => Navigator.of(context).push(
    MaterialPageRoute<PhotoImportOutcome>(
      builder: (_) => photoImport!(deck, origin),
    ),
  );
  // A phone's screen, so the 오늘 tab's decks are on it.
  tester.view.physicalSize = screen;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final db = AppDatabase(NativeDatabase.memory());
  addTearDown(db.close);
  // Tear-downs run last first, so the screen is unmounted before the
  // database closes, even when a test fails before its own close(): closing
  // under a mounted screen leaves its stream queries waiting, and the run
  // hangs until the test times out.
  addTearDown(() async {
    await tester.pumpWidget(const SizedBox());
    await tester.pump(const Duration(seconds: 1));
  });
  var ids = 0;
  final repository = UnreadableDecks(
    db,
    clock: () => DateTime.utc(2026, 10, 15),
    newId: () => 'deck${ids++}',
  );
  final created = (await tester.runAsync(() async {
    if (dailyMinutes != null) {
      await StudyRepository(
        db,
        newId: () => 'setting',
      ).setDailyMinutes(dailyMinutes, at: homeNow);
    }
    final created = {
      for (final name in decks) name: (await repository.createDeck(name)).id,
    };
    Future<CardId> add(String deck, String front) async =>
        switch (await repository.addCard(
          created[deck]!,
          front: [TextContent(front)],
          back: [TextContent(front)],
        )) {
          CardSaved(:final card) => card.id,
          DuplicateFront() => fail('the deck held no duplicate'),
        };
    for (final MapEntry(key: name, value: count) in fresh.entries) {
      for (var i = 0; i < count; i++) {
        await add(name, '$name new $i');
      }
    }
    for (final MapEntry(key: name, value: count) in due.entries) {
      for (var i = 0; i < count; i++) {
        final card = await add(name, '$name due $i');
        await storeState(db, card, due: homeNow, days: dueDays);
        if (pace != null) await storeAnswers(db, card, 20, pace);
      }
    }
    for (final MapEntry(key: name, value: count) in later.entries) {
      for (var i = 0; i < count; i++) {
        final card = await add(name, '$name later $i');
        await storeState(db, card, due: homeNow.add(const Duration(days: 1)));
      }
    }
    for (final MapEntry(key: name, value: count) in answeredToday.entries) {
      for (var i = 0; i < count; i++) {
        final card = await add(name, '$name answered $i');
        await storeState(db, card, due: homeNow.add(const Duration(days: 1)));
        await storeAnswerAt(
          db,
          card,
          homeNow.subtract(const Duration(hours: 1)),
        );
      }
    }
    for (final MapEntry(key: days, value: count) in answeredBefore.entries) {
      for (var i = 0; i < count; i++) {
        final card = await add('Alpha', 'Alpha $days days ago $i');
        await storeState(db, card, due: homeNow.add(const Duration(days: 1)));
        await storeAnswerAt(db, card, homeNow.subtract(Duration(days: days)));
      }
    }
    for (final MapEntry(key: name, value: count) in mastered.entries) {
      for (var i = 0; i < count; i++) {
        final card = await add(name, '$name mastered $i');
        await storeState(
          db,
          card,
          due: homeNow.add(const Duration(days: 10)),
          days: 30,
        );
      }
    }
    return created;
  }))!;
  repository.unreadable.addAll([for (final name in unreadable) created[name]!]);
  final list = _List(tester, repository, created);
  final imports = importing
      ? PhotoImports(
          client: list.extraction,
          photos: FakePhotoSource(),
          preferences: await openPreferences(tester),
          store: MemoryImportJobStore(),
          decks: repository,
        )
      : null;
  await tester.runAsync(() async => imports?.restore());
  list.imports = imports;
  final storage = await openStudyStorage(tester, minutesAsked: minutesAsked);
  // With a [photo], the device's media store and a pick that hands it out.
  final directory = photo == null ? null : newMediaDirectory();
  if (directory != null) addTearDown(() => deleteMediaDirectory(directory));
  final media = directory == null
      ? null
      : MediaStore(
          db,
          FakeMediaServer(),
          directory: directory,
          clock: () => homeNow,
          newId: () => 'media${ids++}',
        );
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        deckRepositoryProvider.overrideWithValue(repository),
        ...homeOverrides(db, storage: storage),
        if (photoImport != null) photoImportProvider.overrideWithValue(pushed),
        if (imports != null) photoImportsProvider.overrideWithValue(imports),
        if (spreadsheet != null)
          spreadsheetPickProvider.overrideWithValue(spreadsheet),
        if (media != null) mediaStoreProvider.overrideWithValue(media),
        if (photo != null)
          imagePickProvider.overrideWithValue(_OnePhoto(photo)),
      ],
      child: MaterialApp(
        theme: theme ?? lightTheme,
        locale: locale,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        // As the app places it, over every screen.
        builder: imports == null
            ? null
            : (context, child) =>
                  PhotoImportFrame(imports: imports, child: child!),
        home: const HomeScreen(),
      ),
    ),
  );
  await tester.pumpAndSettle();
  return list;
}

/// Scrolls every scrollable on screen to its end, so each part lays out.
Future<void> _scrollThrough(WidgetTester tester) async {
  for (final scrollable
      in find.byType(Scrollable).hitTestable().evaluate().toList()) {
    final state = (scrollable as StatefulElement).state as ScrollableState;
    final finder = find.byElementPredicate((element) => element == scrollable);
    while (state.position.pixels < state.position.maxScrollExtent) {
      await tester.drag(finder, const Offset(0, -300), warnIfMissed: false);
      await tester.pumpAndSettle();
    }
  }
}

void main() {
  driftRuntimeOptions.dontWarnAboutMultipleDatabases = true;

  group('tabs', () {
    testWidgets(
      'opens on 홈 between 기록 and 노트, the bar switches tabs, back from another tab returns to 홈, and 홈\'s profile button at the top right holds the account\'s initial',
      (tester) async {
        final list = await _open(tester, fresh: {'Alpha': 1});
        expect(shownText('1 card'), findsOneWidget);
        final record = list.tab('Record');
        final home = list.tab('Home');
        final notes = list.tab('Notes');
        expect(
          tester.getCenter(record).dx,
          lessThan(tester.getCenter(home).dx),
        );
        expect(tester.getCenter(home).dx, lessThan(tester.getCenter(notes).dx));
        expect(
          tester.getSemantics(home),
          isSemantics(isSelected: true, hasSelectedState: true),
        );
        // 설정 is not a tab, and the notes are not on 홈.
        expect(list.tab('Settings'), findsNothing);
        expect(find.byType(DeckRow), findsNothing);

        await tester.tap(record);
        await tester.pumpAndSettle();
        expect(shownText('Correct in reviews'), findsOneWidget);
        expect(await tester.binding.handlePopRoute(), isTrue);
        await tester.pumpAndSettle();
        expect(shownText('1 card'), findsOneWidget);
        await tester.tap(notes);
        await tester.pumpAndSettle();
        expect(find.byType(DeckRow), findsNWidgets(3));
        expect(await tester.binding.handlePopRoute(), isTrue);
        await tester.pumpAndSettle();
        expect(shownText('1 card'), findsOneWidget);

        // The profile button, the account's initial at the top right of the
        // hero, named 설정, which `widget_test.dart` opens; 설정 is built only
        // then.
        expect(find.byType(AccountScreen, skipOffstage: false), findsNothing);
        final profile = find.byTooltip('Settings');
        expect(
          find.descendant(of: profile, matching: shownText('A')),
          findsOneWidget,
        );
        expect(tester.getSize(profile).width, greaterThanOrEqualTo(44));
        expect(tester.getSize(profile).height, greaterThanOrEqualTo(44));
        expect(
          tester.getTopRight(profile).dx,
          greaterThan(tester.getTopRight(shownText('knowno')).dx),
        );
        // Control: back on 홈 is left to the platform, which leaves the app.
        expect(await tester.binding.handlePopRoute(), isFalse);
        await list.close();
      },
    );

    testWidgets(
      'a note opens from the 노트 tab above the menu, back and 노트 again return to its first screen, and study, the editor and 새 노트 cover the menu',
      (tester) async {
        final list = await _open(tester, fresh: {'Alpha': 1});
        await list.decks();
        await list.tap('Alpha');
        expect(find.byType(DeckScreen), findsOneWidget);
        expect(list.tab('Notes'), findsOneWidget);
        // Back closes the note, not the app nor the tab.
        expect(await tester.binding.handlePopRoute(), isTrue);
        await tester.pumpAndSettle();
        expect(find.byType(DeckScreen), findsNothing);
        expect(find.byType(DeckRow), findsNWidgets(3));

        await list.tap('Alpha');
        await tester.tap(list.tab('Notes'));
        await tester.pumpAndSettle();
        expect(find.byType(DeckScreen), findsNothing);
        expect(find.byType(DeckRow), findsNWidgets(3));

        // 홈 keeps the note open on 노트, behind it.
        await list.tap('Alpha');
        await tester.tap(list.tab('Home'));
        await tester.pumpAndSettle();
        expect(shownText('1 card'), findsOneWidget);
        await list.decks();
        expect(find.byType(DeckScreen), findsOneWidget);

        await list.tap('Study this note · 1');
        expect(find.byType(StudyScreen), findsOneWidget);
        expect(list.tab('Notes'), findsNothing);
        await tester.binding.handlePopRoute();
        await tester.pumpAndSettle();
        expect(list.tab('Notes'), findsOneWidget);
        await list.close();
      },
    );
  });

  group('photo import', () {
    for (final (action, opened) in [
      ('Enter by hand', 'New card'),
      ('Excel or CSV file', 'Add cards from a file'),
    ]) {
      testWidgets(
        'reopened from the bar where photo import is unavailable, $action opens its way on the job\'s note in 노트, and back returns to that note',
        (tester) async {
          final list = await _open(tester, importing: true);
          final imports = list.imports!;
          final job = imports.create(list.ids['Beta'], PhotoOrigin.camera);
          imports.attach(job);
          await job.add([() async => testPhoto]);
          await tester.pump();
          list.extraction.fail(const ExtractionUnavailable());
          await tester.pumpAndSettle();
          expect(list.extraction.calls, hasLength(1));

          await tester.tap(find.byType(PhotoImportBar));
          await tester.pumpAndSettle();
          await tester.tap(shownText(action));
          await tester.pumpAndSettle();
          expect(shownText(opened), findsOneWidget);
          expect(imports.job, isNull, reason: 'the job ended');

          await tester.binding.handlePopRoute();
          await tester.pumpAndSettle();
          expect(shownText(opened), findsNothing);
          expect(
            tester.widget<DeckScreen>(find.byType(DeckScreen)).deck.id,
            list.ids['Beta'],
          );
          await list.close();
        },
      );
    }
  });

  group('홈', () {
    testWidgets(
      'today\'s cards fill the sky with Today, the count and the minutes over the thinking mascot, and Start on the ground studies every deck',
      (tester) async {
        final list = await _open(
          tester,
          fresh: {'Alpha': 2, 'Gamma': 1},
          due: {'Alpha': 1, 'Beta': 3},
          pace: const Duration(seconds: 25),
        );
        final colors = AppColors.of(tester.element(find.byType(HomeTab)));
        final sky = tester.widget<DecoratedBox>(
          find
              .ancestor(
                of: shownText('7 cards'),
                matching: find.byWidgetPredicate(
                  (widget) =>
                      widget is DecoratedBox &&
                      widget.decoration is ShapeDecoration,
                ),
              )
              .first,
        );
        expect((sky.decoration as ShapeDecoration).color, colors.hero);
        expect(shownText('Today'), findsWidgets);
        expect(
          tester.getRect(shownText('Today').first).bottom,
          lessThanOrEqualTo(tester.getRect(shownText('7 cards')).top),
        );
        final count = tester.widget<Text>(shownText('7 cards'));
        expect(count.style?.fontSize, AppType.heroFigure.fontSize);
        expect(count.style?.color, colors.onHero);
        // Seven cards at 25 s each take 175 s, about 3 minutes.
        expect(shownText('About 3 min'), findsOneWidget);
        final mascot = tester.widget<Mascot>(find.byType(Mascot).first);
        expect(mascot.size, AppSize.mascotHero);
        expect(mascot.expression, MascotExpression.thinking);
        // Start, the one primary, on the ground under the mascot.
        final start = tester.widget<AppButton>(
          widgetWithShownText(AppButton, 'Start'),
        );
        expect(start.variant, AppButtonVariant.primary);
        expect(start.size, AppButtonSize.cta);
        expect(
          tester.getRect(shownText('Start')).top,
          greaterThan(tester.getRect(find.byType(Mascot).first).bottom),
        );
        // No week chart and no other chart: they are 기록's.
        expect(find.textContaining('Last 7 days'), findsNothing);
        expect(find.textContaining('Retention'), findsNothing);

        await list.tap('Start');
        expect(list.session, list.ids.values.toSet());
        await list.close();
      },
    );

    testWidgets(
      'on the ground, the streak in the accent over a dot a day for the last seven days, a studied day filled in the accent and today outlined in the today mark over its label',
      (tester) async {
        // Studied today and four days before: a streak of one day, with
        // cards still left today.
        final list = await _open(
          tester,
          fresh: {'Alpha': 3},
          answeredToday: {'Alpha': 2},
          answeredBefore: {4: 3},
        );
        final colors = AppColors.of(tester.element(find.byType(HomeTab)));
        final heading = find.text('1-day streak', findRichText: true);
        expect(heading, findsOneWidget);
        // On the ground, under the mascot and over Start.
        expect(
          tester.getRect(heading).top,
          greaterThan(tester.getRect(find.byType(Mascot).first).bottom),
        );
        expect(
          tester.getRect(heading).bottom,
          lessThan(tester.getRect(shownText('Start')).top),
        );
        final spans = <(String, Color?)>[];
        tester.widget<RichText>(heading).text.visitChildren((span) {
          if (span case TextSpan(:final text?)) {
            spans.add((text, span.style?.color));
          }
          return true;
        });
        expect(spans.firstWhere((span) => span.$1 == '1').$2, colors.accent);
        expect(
          spans.firstWhere((span) => span.$1 != '1').$2,
          isNot(colors.accent),
        );
        // Each day is read with its cards, today's last.
        final week = find.bySemanticsLabel(
          RegExp(
            r'^\w+: 0 cards, \w+: 0 cards, \w+: 3 cards, \w+: 0 cards, \w+: 0 cards, \w+: 0 cards, Today: 2 cards$',
          ),
        );
        expect(week, findsOneWidget);
        List<BoxDecoration> dots(Finder week) => [
          for (final box in tester.widgetList<DecoratedBox>(
            find.descendant(of: week, matching: find.byType(DecoratedBox)),
          ))
            box.decoration as BoxDecoration,
        ];
        final days = dots(week);
        expect(days, hasLength(7));
        // The day studied four days ago filled in the accent; the days with
        // no study outlined; today, not yet done, outlined in the today mark.
        expect(
          [for (final day in days) day.color],
          [null, null, colors.accent, null, null, null, null],
        );
        expect(days.first.border?.top.color, colors.outline);
        expect(days.last.border?.top.color, colors.todayMark);
        final today = tester.widget<Text>(
          find.descendant(of: week, matching: shownText('Today')),
        );
        expect(today.style?.color, colors.todayText);
        await list.close();

        // Control: a week with no study fills no day, on no streak.
        final fresh = await _open(tester, fresh: {'Alpha': 1});
        expect(find.text('0-day streak', findRichText: true), findsOneWidget);
        final none = find.bySemanticsLabel(RegExp(r'Today: 0 cards$'));
        expect([
          for (final day in dots(none)) day.color,
        ], List<Color?>.filled(7, null));
        await fresh.close();
      },
    );

    testWidgets('in a backlog the hero says so and Start studies every deck', (
      tester,
    ) async {
      final list = await _open(
        tester,
        fresh: {'Gamma': 1},
        due: {'Alpha': 4, 'Beta': 3},
        dueDays: 30,
      );
      expect(shownText('Pick up where you left off'), findsOneWidget);
      expect(
        shownText(
          '7 overdue reviews, most urgent first. New cards wait for now.',
        ),
        findsOneWidget,
      );
      expect(
        tester.widget<Mascot>(find.byType(Mascot).first).expression,
        MascotExpression.thinking,
      );
      await list.tap('Start');
      expect(list.session, list.ids.values.toSet());
      await list.close();
    });

    testWidgets(
      'once today\'s cards are done the sky says so with the cards done over the sleepy mascot, today\'s dot is filled and Study is secondary',
      (tester) async {
        final list = await _open(tester, answeredToday: {'Alpha': 2});
        final colors = AppColors.of(tester.element(find.byType(HomeTab)));
        expect(shownText('All done'), findsOneWidget);
        expect(shownText('2 cards'), findsOneWidget);
        expect(find.textContaining('Next review'), findsNothing);
        expect(
          tester.widget<Mascot>(find.byType(Mascot).first).expression,
          MascotExpression.sleepy,
        );
        final week = find.bySemanticsLabel(RegExp(r'Today: 2 cards$'));
        final today = tester
            .widgetList<DecoratedBox>(
              find.descendant(of: week, matching: find.byType(DecoratedBox)),
            )
            .last;
        expect((today.decoration as BoxDecoration).color, colors.todayMark);
        final study = tester.widget<AppButton>(
          widgetWithShownText(AppButton, 'Study'),
        );
        expect(study.variant, AppButtonVariant.secondary);
        await list.tap('Study');
        expect(list.session, list.ids.values.toSet());
        await tester.binding.handlePopRoute();
        await tester.pumpAndSettle();
        await list.close();
      },
    );

    testWidgets(
      'with nothing due today and nothing studied, the sky says the day is done with the next review in place of the cards done',
      (tester) async {
        final list = await _open(tester, later: {'Alpha': 2});
        expect(shownText('All done'), findsOneWidget);
        expect(
          shownText('Next review Tomorrow · 2, about 1 min'),
          findsOneWidget,
        );
        // Control: no count of cards done stands in its place.
        expect(shownText('0 cards'), findsNothing);
        expect(
          tester.widget<Mascot>(find.byType(Mascot).first).expression,
          MascotExpression.sleepy,
        );
        await list.close();
      },
    );

    testWidgets(
      'with one deck and no card, the hero\'s one action adds a card to it on the 노트 tab, and no week card is drawn',
      (tester) async {
        final list = await _open(tester, decks: ['Alpha']);
        expect(shownText('Make your first card?'), findsOneWidget);
        expect(find.textContaining('streak', findRichText: true), findsNothing);
        await list.tap('Add card');
        expect(find.byType(DeckScreen), findsOneWidget);
        expect(
          tester.getSemantics(list.tab('Notes')),
          isSemantics(isSelected: true, hasSelectedState: true),
        );
        await list.tap('Enter by hand');
        expect(find.byType(CardEditorScreen), findsOneWidget);
        await list.close();
      },
    );

    testWidgets(
      'with several decks and no card, the hero\'s one action shows the 노트 tab',
      (tester) async {
        final list = await _open(tester);
        expect(shownText('Make your first card?'), findsOneWidget);
        expect(find.byType(DeckRow), findsNothing);
        await list.tap('Add cards in a note');
        expect(
          tester.getSemantics(list.tab('Notes')),
          isSemantics(isSelected: true, hasSelectedState: true),
        );
        expect(find.byType(DeckRow), findsNWidgets(3));
        await list.close();
      },
    );

    testWidgets(
      'a count that cannot be read says why on the ground in the streak\'s place over Start, on the first screen',
      (tester) async {
        final list = await _open(
          tester,
          mastered: {'Alpha': 1},
          unreadable: {'Beta'},
        );
        const why =
            "Couldn't read or write the device's storage. Please try again.";
        final problem = shownText(why);
        expect(problem, findsOneWidget);
        final start = shownText('Start');
        final row = tester.getRect(problem);
        expect(row.bottom, lessThan(tester.getRect(start).top));
        expect(
          row.top,
          greaterThan(tester.getRect(find.byType(Mascot).first).bottom),
        );
        // Whole on the first screen with nothing scrolled.
        final page = tester.getRect(
          find.ancestor(of: start, matching: find.byType(Scrollable)).first,
        );
        expect(row.bottom, lessThanOrEqualTo(page.bottom));
        expect(find.textContaining('About'), findsNothing);
        expect(find.textContaining('streak', findRichText: true), findsNothing);
        await list.close();
      },
    );

    testWidgets(
      'the 노트 tab holds its title, + New note in the tonal fill and no primary, the search field, every deck and no public decks without sharing',
      (tester) async {
        final list = await _open(tester, fresh: {'Alpha': 1});
        await list.decks();
        expect(
          tester.getSemantics(shownText('Notes').first),
          isSemantics(label: 'Notes', isHeader: true),
        );
        final add = tester.widget<AppButton>(
          widgetWithShownText(AppButton, 'New note'),
        );
        expect(add.variant, AppButtonVariant.tonal);
        expect(add.icon, LucideIcons.plus);
        expect(
          tester
              .widgetList<AppButton>(find.byType(AppButton))
              .where((button) => button.variant == AppButtonVariant.primary),
          isEmpty,
        );
        expect(find.byType(DeckRow), findsNWidgets(3));
        expect(
          tester.getTopLeft(shownText('New note')).dy,
          lessThan(tester.getTopLeft(find.byType(EditableText)).dy),
        );
        expect(shownText('Browse public notes'), findsNothing);
        await tester.enterText(find.byType(EditableText), 'ALP');
        await tester.pumpAndSettle();
        expect(shownText('Alpha'), findsOneWidget);
        expect(shownText('Beta'), findsNothing);
        await tester.enterText(find.byType(EditableText), 'zebra');
        await tester.pumpAndSettle();
        expect(shownText('No note matches. Try other words.'), findsOneWidget);
        // Control: an empty search keeps every deck.
        await tester.enterText(find.byType(EditableText), '');
        await tester.pumpAndSettle();
        expect(find.byType(DeckRow), findsNWidgets(3));
        await list.close();
      },
    );

    testWidgets(
      'a deck row shows its mastered of all cards under its name over a bar whose screen reader label breaks them down, and a deck with no card shows 0 cards and no bar',
      (tester) async {
        // Alpha: one mastered, one learning after a day's interval, two new.
        final list = await _open(
          tester,
          fresh: {'Alpha': 2},
          due: {'Alpha': 1},
          mastered: {'Alpha': 1},
          decks: ['Alpha', 'Beta'],
        );
        await list.decks();
        Finder row(String deck) =>
            find.ancestor(of: shownText(deck), matching: find.byType(DeckRow));
        Finder inRow(String deck, Finder finder) =>
            find.descendant(of: row(deck), matching: finder);

        final line = inRow('Alpha', shownText('1 of 4 mastered'));
        final bar = inRow('Alpha', find.byType(ProgressBar));
        expect(line, findsOneWidget);
        expect(tester.getTopLeft(line).dy, lessThan(tester.getTopLeft(bar).dy));
        expect(
          tester.getSemantics(row('Alpha')).getSemanticsData().label,
          contains('1 mastered, 1 learning, 2 new'),
        );
        // Each row carries its count for today.
        expect(inRow('Alpha', shownText('Today 3')), findsOneWidget);
        expect(inRow('Beta', shownText('0 cards')), findsOneWidget);
        expect(inRow('Beta', find.byType(ProgressBar)), findsNothing);
        await list.close();
      },
    );

    testWidgets(
      'before the first deck the first-run home shows over the menu, its primary opening 새 노트',
      (tester) async {
        final list = await _open(tester, decks: []);
        expect(shownText('Shall we make your first note?'), findsOneWidget);
        expect(list.tab('Home'), findsOneWidget);
        // 설정 opens from the profile button here too.
        expect(find.byTooltip('Settings'), findsOneWidget);
        final create = tester.widget<AppButton>(
          widgetWithShownText(AppButton, 'Create a note'),
        );
        expect(create.variant, AppButtonVariant.primary);
        await list.tap('Create a note');
        expect(find.byType(NewDeckScreen), findsOneWidget);
        await list.close();
      },
    );
  });

  group('새 노트', () {
    testWidgets(
      '새 노트 is a screen of the name and four cover colours; Save makes the deck in the colour chosen and opens it above the menu',
      (tester) async {
        final list = await _open(tester, fresh: {'Alpha': 1});
        await list.newDeck();
        expect(find.byType(NewDeckScreen), findsOneWidget);
        expect(find.byType(BottomSheet), findsNothing);
        expect(list.tab('Home'), findsNothing);
        for (final colour in ['Blue', 'Peach', 'Sand', 'Slate']) {
          expect(find.bySemanticsLabel(colour), findsOneWidget, reason: colour);
        }
        for (final gone in ['Sky', 'Amber']) {
          expect(find.bySemanticsLabel(gone), findsNothing, reason: gone);
        }

        await list.tap('Save');
        expect(shownText('Enter a name'), findsOneWidget);
        await tester.enterText(find.byType(EditableText), 'Delta');
        await tester.tap(find.bySemanticsLabel('Sand'));
        await tester.pumpAndSettle();
        await list.tap('Save');

        expect(find.byType(DeckScreen), findsOneWidget);
        expect(shownText('Delta'), findsOneWidget);
        expect(list.tab('Home'), findsOneWidget);
        expect(shownText('Enter by hand'), findsNothing);
        final stored = ProviderScope.containerOf(
          tester.element(find.byType(DeckScreen)),
        ).read(decksProvider).value!.firstWhere((deck) => deck.name == 'Delta');
        expect(stored.color, DeckColor.sand);
        await list.close();
      },
    );

    testWidgets(
      'a note made with a photo shows the photo on its tile in the 노트 tab',
      (tester) async {
        final photo = preparedImage(5);
        final list = await _open(tester, fresh: {'Alpha': 1}, photo: photo);
        await list.newDeck();
        await tester.enterText(find.byType(EditableText), 'Delta');
        await list.tap('Choose from album');
        // The setup picked the photo: 새 노트's preview shows it.
        await settleUntil(
          tester,
          'the preview to show the chosen photo',
          () => shownText('Remove photo').evaluate().isNotEmpty,
        );
        expect(shownText('Remove photo'), findsOneWidget);

        await list.tap('Save');
        // The deck and its photo are stored on the device, which takes real
        // time, before the new deck opens.
        await settleUntil(
          tester,
          'the new deck to open',
          () => find.byType(DeckScreen).evaluate().isNotEmpty,
        );
        expect(find.byType(DeckScreen), findsOneWidget);
        await tester.pageBack();
        await tester.pumpAndSettle();

        Finder onTile(String deck, Finder finder) => find.descendant(
          of: find.ancestor(
            of: shownText(deck),
            matching: find.byType(DeckRow),
          ),
          matching: find.descendant(
            of: find.byType(DeckTile),
            matching: finder,
          ),
        );
        // The tile reads the photo from the device, which takes real time.
        await settleUntil(
          tester,
          'the tile to show the photo',
          () => onTile('Delta', find.byType(Image)).evaluate().isNotEmpty,
        );
        final image = tester.widget<Image>(onTile('Delta', find.byType(Image)));
        expect((image.image as MemoryImage).bytes, photo.bytes);
        // Control: a deck made without a photo draws its icon.
        expect(onTile('Alpha', find.byType(Image)), findsNothing);
        expect(
          onTile('Alpha', find.byIcon(LucideIcons.layers)),
          findsOneWidget,
        );
        await list.close();
      },
    );

    testWidgets(
      'Save and add cards opens the new deck with the add-card sheet up',
      (tester) async {
        final list = await _open(tester, fresh: {'Alpha': 1});
        await list.newDeck();
        await tester.enterText(find.byType(EditableText), 'Delta');
        await list.tap('Save and add cards');
        expect(find.byType(DeckScreen), findsOneWidget);
        expect(shownText('Enter by hand'), findsOneWidget);
        await list.close();
      },
    );
  });

  group('text at twice its size', () {
    final states = <String, Future<_List> Function(WidgetTester)>{
      'today': (tester) => _open(
        tester,
        locale: const Locale('ko'),
        fresh: {'Alpha': 120, 'Gamma': 1},
        due: {'Beta': 3},
        dailyMinutes: 60,
      ),
      'done': (tester) => _open(
        tester,
        locale: const Locale('ko'),
        answeredToday: {'Alpha': 35},
        dailyMinutes: 5,
      ),
      'backlog': (tester) => _open(
        tester,
        locale: const Locale('ko'),
        fresh: {'Gamma': 1},
        due: {'Alpha': 40, 'Beta': 30},
        dueDays: 30,
      ),
    };
    for (final MapEntry(key: state, value: open) in states.entries) {
      testWidgets(
        'at 2.0 in Korean, 홈 $state, the 노트 tab and 새 노트 lay out with nothing clipped',
        (tester) async {
          tester.platformDispatcher.textScaleFactorTestValue = 2;
          addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
          final list = await open(tester);
          final home = tester.element(find.byType(HomeTab));
          expect(MediaQuery.textScalerOf(home).scale(10), 20);
          await _scrollThrough(tester);
          expect(tester.takeException(), isNull);

          await list.decks('노트');
          await _scrollThrough(tester);
          expect(tester.takeException(), isNull);

          // Back up to the title row the scroll left behind.
          await tester.scrollUntilVisible(
            shownText('새 노트'),
            -300,
            scrollable: find.byType(Scrollable).hitTestable().first,
          );
          await list.tap('새 노트');
          expect(find.byType(NewDeckScreen), findsOneWidget);
          await _scrollThrough(tester);
          expect(tester.takeException(), isNull);
          await list.close();
        },
      );
    }
  });

  for (final scale in [1.0, 2.0]) {
    testWidgets(
      'at text scale $scale a note\'s Korean name in the 노트 tab breaks only between words and is read as written, and a one-word name wider than the row still wraps',
      (tester) async {
        tester.platformDispatcher.textScaleFactorTestValue = scale;
        addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
        const name = '토익 영단어 기본 어휘 노트와 필수 표현 모음';
        // The control: one word, so it can break only inside itself.
        const word = '토익영단어기본어휘노트와필수표현모음';
        final list = await _open(
          tester,
          locale: const Locale('ko'),
          decks: [name, word],
        );
        await list.decks('노트');

        expectBreaksBetweenWords(tester, name);
        expect(
          tester.getSemantics(shownText(name)),
          isSemantics(label: '$name\n0장', hasTapAction: true),
        );
        // The rows grow with the text, so the control may lie below the first.
        await tester.scrollUntilVisible(
          shownText(word),
          100,
          scrollable: find.byType(Scrollable).last,
        );
        expectWrapsInsideWord(tester, word);
        await list.close();
      },
    );
  }

  group('daily study minutes', () {
    testWidgets(
      'settings\' screen shows the minutes as one number between − and +, typed in place on the keypad, its tiles following it, and saving updates today\'s count',
      (tester) async {
        final list = await _open(
          tester,
          decks: ['Alpha'],
          fresh: {'Alpha': 150},
          // Wide enough for the three-figure counts in the test font.
          screen: const Size(800, 844),
        );
        // 20 minutes at the unknown pace of 10 s: 120 new cards.
        expect(shownText('120 cards'), findsOneWidget);
        await _openMinutes(tester);
        AppButton save() =>
            tester.widget<AppButton>(widgetWithShownText(AppButton, 'Save'));
        Finder tile(String text) => find.descendant(
          of: find.byWidgetPredicate(
            (widget) =>
                widget is Semantics && widget.properties.liveRegion == true,
          ),
          matching: shownText(text),
        );

        // No choices to pick from: the number, its steps and two tiles.
        expect(shownText('10 min'), findsNothing);
        expect(shownText('Custom'), findsNothing);
        final number = find.bySemanticsLabel('20 minutes a day, tap to type');
        expect(number, findsOneWidget);
        expect(tile('New cards a day'), findsOneWidget);
        expect(tile('About 120'), findsOneWidget);
        // 120 today, the other 30 tomorrow.
        expect(tile('All new cards started'), findsOneWidget);
        expect(tile('In 1 day'), findsOneWidget);

        // The number opens the keypad in its place; the tiles follow what is
        // typed before it is committed.
        await tester.tap(number);
        await tester.pumpAndSettle();
        expect(find.byType(TextField), findsOneWidget);
        await tester.enterText(find.byType(TextField), '10');
        await tester.pumpAndSettle();
        expect(tile('About 60'), findsOneWidget);
        // 60 today, then 60 and 30.
        expect(tile('In 2 days'), findsOneWidget);

        // Outside 5 to 180: a line says so and saving waits for a fix.
        await tester.enterText(find.byType(TextField), '200');
        await tester.testTextInput.receiveAction(TextInputAction.done);
        await tester.pumpAndSettle();
        expect(shownText('Enter 5 to 180 minutes'), findsOneWidget);
        expect(find.byType(TextField), findsOneWidget);
        expect(save().onPressed, isNull);

        // An empty field keeps the minutes as they were.
        await tester.enterText(find.byType(TextField), '');
        await tester.testTextInput.receiveAction(TextInputAction.done);
        await tester.pumpAndSettle();
        expect(find.byType(TextField), findsNothing);
        expect(number, findsOneWidget);
        expect(save().onPressed, isNotNull);

        // Any whole number in the bounds, committed with Done.
        await tester.tap(number);
        await tester.pumpAndSettle();
        await tester.enterText(find.byType(TextField), '5');
        await tester.testTextInput.receiveAction(TextInputAction.done);
        await tester.pumpAndSettle();
        expect(
          find.bySemanticsLabel('5 minutes a day, tap to type'),
          findsOneWidget,
        );
        expect(tile('About 30'), findsOneWidget);
        // Five is the floor.
        expect(
          tester
              .widget<IconButton>(
                find.widgetWithIcon(IconButton, LucideIcons.minus),
              )
              .onPressed,
          isNull,
        );
        // Nothing is stored until Save.
        expect(await list.storedMinutes(), isNull);

        await list.tap('Save');

        // Back on the row's screen, it shows the minutes saved.
        expect(find.byType(DailyMinutesRow), findsOneWidget);
        expect(await list.storedMinutes(), 5);
        expect(shownText('5 min'), findsOneWidget);
        await tester.pageBack();
        await tester.pumpAndSettle();
        expect(shownText('30 cards'), findsOneWidget);
        await list.close();
      },
    );

    testWidgets('leaving the typed number commits it, as Done does', (
      tester,
    ) async {
      final list = await _open(tester, decks: ['Alpha'], fresh: {'Alpha': 3});
      await _openMinutes(tester);
      await tester.tap(find.bySemanticsLabel('20 minutes a day, tap to type'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField), '37');
      await tester.pumpAndSettle();

      FocusManager.instance.primaryFocus?.unfocus();
      await tester.pumpAndSettle();

      expect(find.byType(TextField), findsNothing);
      expect(
        find.bySemanticsLabel('37 minutes a day, tap to type'),
        findsOneWidget,
      );
      await list.close();
    });

    testWidgets(
      'once a deck has cards, the sheet shows once as a first-run step whose Skip keeps the default',
      (tester) async {
        final list = await _open(
          tester,
          decks: ['Alpha'],
          fresh: {'Alpha': 3},
          minutesAsked: false,
        );

        expect(
          shownText('How many minutes a day will you study?'),
          findsOneWidget,
        );
        await waitForPicker(tester);
        await list.tap('Skip');
        expect(find.byType(BottomSheet), findsNothing);
        expect(await list.storedMinutes(), isNull);
        // 20 minutes at 10 s take all three new cards.
        expect(shownText('3 cards'), findsOneWidget);

        // Shown once: back on the tab, it does not show again.
        await list.tap('Record');
        await list.tap('Home');
        expect(find.byType(BottomSheet), findsNothing);
        await list.close();
      },
    );

    for (final (name, theme) in [('light', lightTheme), ('dark', darkTheme)]) {
      testWidgets(
        'in the $name theme the today card, settings\' screen and its typed number meet the tap target and contrast guidelines',
        (tester) async {
          Future<void> meetsGuidelines() async {
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

          final list = await _open(tester, fresh: {'Alpha': 3}, theme: theme);
          await meetsGuidelines();
          await _openMinutes(tester);
          await meetsGuidelines();
          // With the keypad's field and a number outside the bounds.
          await tester.tap(
            find.bySemanticsLabel('20 minutes a day, tap to type'),
          );
          await tester.pumpAndSettle();
          await tester.enterText(find.byType(TextField), '200');
          await tester.pumpAndSettle();
          await meetsGuidelines();
          await list.close();
        },
      );
    }

    testWidgets('without a card the first-run step waits', (tester) async {
      final list = await _open(tester, decks: ['Alpha'], minutesAsked: false);

      expect(shownText('Make your first card?'), findsOneWidget);
      expect(find.byType(BottomSheet), findsNothing);
      await list.close();
    });
  });
}
