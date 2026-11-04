import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:drift/drift.dart' show driftRuntimeOptions;
import 'package:drift/native.dart';
import 'package:flutter/material.dart' hide Card;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:shared_preferences_platform_interface/in_memory_shared_preferences_async.dart';
import 'package:shared_preferences_platform_interface/shared_preferences_async_platform_interface.dart';
import 'package:knowno/account/account.dart';
import 'package:knowno/database/database.dart';
import 'package:knowno/deck/deck.dart';
import 'package:knowno/design/app_chip.dart';
import 'package:knowno/design/app_text_field.dart';
import 'package:knowno/design/keyboard_dismissal.dart';
import 'package:knowno/design/theme.dart';
import 'package:knowno/design/theme_choice.dart';
import 'package:knowno/home/home.dart';
import 'package:knowno/l10n/app_localizations.dart';
import 'package:knowno/main.dart';
import 'package:knowno/media/media.dart';
import 'package:knowno/photo_import/photo_import.dart';
import 'package:knowno/sharing/sharing.dart';
import 'package:knowno/study/study.dart';
import 'package:knowno/sync/sync.dart';

import '../account/fake_account_service.dart';
import '../app_fonts.dart';
import '../home/hero_states.dart';
import '../home/home_data.dart';
import '../photo_import/fakes.dart';
import '../sharing/fakes.dart';
import '../sharing/sharing_service_test.dart' show publicCard, publicDeck;
import '../sync/fake_sync_server.dart';
import '../study/minutes_sheet.dart';
import '../study/study_storage.dart';
import '../media/fakes.dart';
import '../word_breaks.dart';

/// Screenshots of every screen and sheet in both themes, for review. They are
/// written, not compared, and only when asked for:
///
/// `flutter test --update-goldens --dart-define=SCREENSHOTS=true --dart-define-from-file=config/dev.json test/screenshots`
///
/// run in `app/`, writes them to `app/build/screenshots/<theme>/`.
const _capture = bool.fromEnvironment('SCREENSHOTS');

/// Hands out [photo] on each pick.
final class _OnePick implements ImagePick {
  const _OnePick(this.photo);

  final PreparedImage photo;

  @override
  Future<PreparedImage?> pick(
    ImageOrigin origin, {
    ImageShape shape = ImageShape.square,
  }) async => photo;
}

/// Hands out [file] as the file picked.
final class _FileToPick implements SpreadsheetPick {
  _FileToPick(this.file);

  OpenedFile file;

  @override
  Future<OpenedFile?> pick() async => file;
}

/// The preview `home/` hands the card editor: study's.
Widget _preview(List<Cell> cells) => CardPreviewScreen(cells: cells);

const _ada = UserId('00000000-0000-4000-8000-00000000000a');

/// A phone's screen: 390 × 844 logical pixels at twice the density.
const _phone = Size(780, 1688);

/// Swipes the current card [dx] to the side from inside it, the lower of the
/// study screen's two cards, then lets the answer land.
Future<void> _swipeCurrent(WidgetTester tester, double dx) async {
  final screen = _phone / _density;
  await tester.timedDragFrom(
    Offset(screen.width / 2, screen.height * 0.72),
    Offset(dx, 0),
    const Duration(seconds: 1),
  );
  await tester.pumpAndSettle();
}

const _density = 2.0;

/// The widgets whose text a screen's three sizes leave out: a card's own
/// content on the study and preview cards, which `design/principles.md` §One visual language leaves
/// out, and Google's button, drawn to Google's guidelines.
const _uncounted = {
  'CardText',
  'CardPreview',
  'PreviousCardView',
  'EarlierCardView',
  'PreviousCardDemo',
  'CardFace',
  'GradedCard',
  'GoogleSignInButton',
};

/// The large figures' sizes: a count's, and today's on 홈's hero.
final _figureSizes = {AppType.figure.fontSize, AppType.heroFigure.fontSize};

/// Whether [element] draws text at a large figure's size: a figure's
/// paragraph, or the field it is typed in.
bool _isFigure(Element element) => switch (element.widget) {
  RichText(:final text) => _figureSizes.contains(text.style?.fontSize),
  EditableText(:final style) => _figureSizes.contains(style.fontSize),
  _ => false,
};

/// Whether the paragraph [element] is a figure's unit: in the row the figure
/// is drawn in, the nearest row or column above it being that row.
bool _isFigureUnit(Element element) {
  Element? flex;
  element.visitAncestorElements((ancestor) {
    if (ancestor.widget is Flex) flex = ancestor;
    return flex == null;
  });
  final row = flex;
  if (row == null || (row.widget as Flex).direction != Axis.horizontal) {
    return false;
  }
  var found = false;
  void visit(Element child) {
    if (found) return;
    if (child != element && _isFigure(child)) {
      found = true;
      return;
    }
    child.visitChildElements(visit);
  }

  row.visitChildElements(visit);
  return found;
}

/// The font sizes of the text the current route draws, a sheet's alone while
/// one is open, leaving out a card's own content on the study and preview
/// cards and a large figure with its unit, as `design/principles.md` §One visual language counts a
/// screen's three sizes.
List<double> _chromeSizes(WidgetTester tester) {
  final sizes = <double>{};
  // Under 노트's own navigator, a route is current only while the route that
  // holds that navigator is too.
  bool current(Element element) {
    var current = ModalRoute.of(element)?.isCurrent ?? true;
    element.visitAncestorElements((ancestor) {
      if (ancestor.widget is Navigator) {
        current &= ModalRoute.of(ancestor)?.isCurrent ?? true;
      }
      return current;
    });
    return current;
  }

  for (final element in find.byType(RichText).evaluate()) {
    if (!current(element)) continue;
    var onCard = false;
    element.visitAncestorElements((ancestor) {
      onCard = _uncounted.contains(ancestor.widget.runtimeType.toString());
      return !onCard;
    });
    if (onCard || _isFigure(element) || _isFigureUnit(element)) continue;
    final own = <double>{};
    void walk(InlineSpan span, double? size, String? family) {
      final ownSize = span.style?.fontSize ?? size;
      final ownFamily = span.style?.fontFamily ?? family;
      if (span is! TextSpan) return;
      // Icons are glyphs of their own font, not text.
      if (ownSize != null &&
          const [appFontFamily, appDisplayFontFamily].contains(ownFamily) &&
          ownSize != AppType.button.fontSize &&
          (span.text ?? '').trim().isNotEmpty) {
        own.add(ownSize);
      }
      for (final child in span.children ?? const <InlineSpan>[]) {
        walk(child, ownSize, ownFamily);
      }
    }

    walk((element.widget as RichText).text, null, null);
    // A figure's unit is drawn beside it in the same paragraph.
    if (own.contains(AppType.figure.fontSize)) continue;
    sizes.addAll(own);
  }
  return sizes.toList()..sort();
}

void main() {
  late Scheduler scheduler;
  setUpAll(() async {
    if (!_capture) return;
    driftRuntimeOptions.dontWarnAboutMultipleDatabases = true;
    await loadAppFonts();
    scheduler = await Scheduler.load();
    for (final mode in ['light', 'dark']) {
      File('build/screenshots/$mode/type-sizes.txt')
        ..createSync(recursive: true)
        ..writeAsStringSync('');
    }
  });

  final ko = lookupAppLocalizations(const Locale('ko'));

  for (final mode in ['light', 'dark']) {
    /// Decodes the images on screen, which a test otherwise draws blank.
    Future<void> loadImages(WidgetTester tester) async {
      await tester.runAsync(() async {
        for (final element in find.byType(Image).evaluate()) {
          await precacheImage((element.widget as Image).image, element);
        }
      });
      await tester.pump();
    }

    Future<void> shot(WidgetTester tester, String name) async {
      await loadImages(tester);
      await expectLater(
        find.byType(MaterialApp).first,
        matchesGoldenFile('../../build/screenshots/$mode/$name.png'),
      );
      final sizes = _chromeSizes(tester);
      File('build/screenshots/$mode/type-sizes.txt').writeAsStringSync(
        '$name: ${sizes.join(', ')}\n',
        mode: FileMode.append,
      );
      expect(sizes.length, lessThanOrEqualTo(3), reason: '$name: $sizes');
    }

    /// Shoots the screen as it is at the largest text size too, as
    /// "[name]-largest-text", then goes back to the text size before. An
    /// overflow there fails the test.
    Future<void> largest(WidgetTester tester, String name) async {
      tester.platformDispatcher.textScaleFactorTestValue = 3.12;
      await tester.pumpAndSettle();
      await shot(tester, '$name-largest-text');
      tester.platformDispatcher.clearTextScaleFactorTestValue();
      await tester.pumpAndSettle();
    }

    void phone(WidgetTester tester) {
      // Release builds draw neither the debug banner nor flat shadows;
      // [unmount] restores both before the test's own checks run.
      WidgetsApp.debugAllowBannerOverride = false;
      debugDisableShadows = false;
      tester.view.physicalSize = _phone;
      tester.view.devicePixelRatio = _density;
      tester.platformDispatcher.localesTestValue = const [Locale('ko')];
      addTearDown(tester.view.reset);
      addTearDown(tester.platformDispatcher.clearLocalesTestValue);
    }

    Future<void> unmount(WidgetTester tester) async {
      await tester.pumpWidget(const SizedBox());
      await tester.pump(const Duration(seconds: 1));
      WidgetsApp.debugAllowBannerOverride = true;
      debugDisableShadows = true;
    }

    Future<void> tap(WidgetTester tester, Finder finder) async {
      await tester.tap(finder);
      await tester.pumpAndSettle();
    }

    /// Shows the 기록 tab once its read is done: the read awaits the
    /// engine call by call, each finishing in real time and resuming on a
    /// pump.
    // Shows the 노트 tab: the bar's 노트, the last, below the tab's title.
    Future<void> showNotes(WidgetTester tester) =>
        tap(tester, find.text(ko.tabNotes).last);

    // Shows 홈.
    Future<void> showHome(WidgetTester tester) =>
        tap(tester, find.text(ko.tabHome));

    /// Lets the answers a closed study screen is still writing land: a read
    /// of the study store waits for them, each engine call finishing in real
    /// time and resuming on a pump.
    Future<void> untilWritten(WidgetTester tester) async {
      var read = false;
      unawaited(
        ProviderScope.containerOf(tester.element(find.byType(Navigator).first))
            .read(studyRepositoryProvider)
            .allStates()
            .then((_) => read = true),
      );
      for (var tries = 0; tries < 20000 && !read; tries++) {
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 1)),
        );
        await tester.pump();
      }
      expect(read, isTrue);
    }

    Future<void> showRecord(WidgetTester tester) async {
      await tester.tap(shownText(ko.tabRecord));
      for (
        var tries = 0;
        tries < 20000 && shownText(ko.retentionTitle).evaluate().isEmpty;
        tries++
      ) {
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 1)),
        );
        await tester.pump();
      }
      expect(shownText(ko.retentionTitle), findsOneWidget);
      await tester.pumpAndSettle();
    }

    Future<void> dismissSheet(WidgetTester tester) =>
        tap(tester, find.byType(ModalBarrier).last);

    testWidgets('the app in $mode', skip: !_capture, (tester) async {
      phone(tester);
      SharedPreferencesAsyncPlatform.instance =
          InMemorySharedPreferencesAsync.withData({'themeMode': mode});
      final storage = (await tester.runAsync(
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
      final server = FakeSyncServer(_ada);
      final account = FakeAccountService();
      await tester.pumpWidget(
        composeApp(
          NativeDatabase.memory(),
          scheduler,
          account,
          server,
          storage,
          // The first-run home shows every way to start.
          FakeExtractionClient(),
          MemoryImportJobStore(),
          FakeSharingServer(),
          FakeReachability(),
          const UnavailableMediaServer(),
          unusedMediaDirectory,
          '1.0.0',
        ),
      );
      await tester.pumpAndSettle();
      await shot(tester, '01-sign-in');
      await largest(tester, '01-sign-in');

      await tap(tester, find.text(ko.signInWithGoogle));
      await shot(tester, '02-deck-list-empty');
      await largest(tester, '02-deck-list-empty');
      // Its second action, reached by scrolling at the largest text size.
      tester.platformDispatcher.textScaleFactorTestValue = 3.12;
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(
        shownText(ko.browsePublicDecks),
        100,
        scrollable: find.byType(Scrollable).first,
      );
      await shot(tester, '02-deck-list-empty-largest-text-below');
      tester.platformDispatcher.clearTextScaleFactorTestValue();
      await tester.pumpAndSettle();

      // Types a new card's [front] and [back] into its two 글, the editor's only
      // fields: the front's first, then the back's.
      Future<void> enterSides(String front, String back) async {
        for (final (index, text) in [front, back].indexed) {
          await tester.enterText(find.byType(EditableText).at(index), text);
          await tester.pumpAndSettle();
        }
      }

      // The first-run home's one primary opens 새 노트.
      await tap(tester, shownText(ko.newDeckTitle));
      await tester.enterText(find.byType(EditableText), '영단어 기본');
      await tester.pumpAndSettle();
      await tap(tester, find.bySemanticsLabel(ko.deckColorName('blue')));
      await shot(tester, '03-new-deck');
      // Saving opens the deck, empty, adding a card its one primary.
      await tap(tester, shownText(ko.save));
      await shot(tester, '04-card-list-empty');
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      // 홈 while no deck holds a card: how to start.
      await showHome(tester);
      await shot(tester, '16-today-no-cards');
      await largest(tester, '16-today-no-cards');
      await showNotes(tester);
      await tap(tester, shownText(ko.newDeck));
      await tester.enterText(find.byType(EditableText), '일본어 N3 한자');
      await tester.pumpAndSettle();
      await tap(tester, find.bySemanticsLabel(ko.deckColorName('violet')));
      await tap(tester, shownText(ko.save));
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();

      await tap(tester, shownText('영단어 기본'));
      const cards = {
        'ephemeral': '덧없는, 순간적인',
        'meticulous': '꼼꼼한, 세심한',
        'ubiquitous': '어디에나 있는',
        'resilient': '회복력 있는',
      };
      for (final (index, MapEntry(key: front, value: back))
          in cards.entries.indexed) {
        await tap(tester, shownText(ko.newCard));
        if (index == 0) await shot(tester, '04b-add-card-sheet');
        await tap(tester, shownText(ko.createManually));
        await enterSides(front, back);
        if (index == 0) {
          await shot(tester, '05-card-editor');
          await largest(tester, '05-card-editor');
        }
        await tap(tester, shownText(ko.save));
      }
      await tap(tester, shownText(ko.newCard));
      await tap(tester, shownText(ko.createManually));
      await enterSides('Ephemeral', '순간의');
      await tap(tester, shownText(ko.save));
      await shot(tester, '06-duplicate-sheet');
      // Above a tall sheet, where the barrier's centre is not.
      await tester.tapAt(const Offset(20, 100));
      await tester.pumpAndSettle();
      // Leaving the typed card asks first.
      await tap(tester, find.byTooltip(ko.close));
      await tap(tester, shownText(ko.discardCard));
      await shot(tester, '07-card-list');
      // The bar and the name under it at the largest text size.
      tester.platformDispatcher.textScaleFactorTestValue = 3.12;
      await tester.pumpAndSettle();
      await shot(tester, '07e-card-list-largest-text');
      tester.platformDispatcher.clearTextScaleFactorTestValue();
      await tester.pumpAndSettle();
      final cardSearch = widgetWithShownText(AppTextField, ko.searchCards);
      await tester.enterText(cardSearch, 'ent');
      await tester.pumpAndSettle();
      await shot(tester, '07c-card-search');
      await tester.enterText(cardSearch, '');
      await tester.testTextInput.receiveAction(TextInputAction.done);
      await tester.pumpAndSettle();

      await tap(tester, find.byTooltip(ko.deckActions));
      await tap(tester, find.text(ko.rename));
      await shot(tester, '08-rename-sheet');
      await dismissSheet(tester);
      await tap(tester, find.byTooltip(ko.deckActions));
      await shot(tester, '08b-deck-menu');
      await largest(tester, '08b-deck-menu');
      await tap(tester, find.text(ko.deckAppearance));
      await tap(tester, find.bySemanticsLabel(ko.deckIconName('languages')));
      await shot(tester, '03c-deck-appearance');
      await tap(tester, shownText(ko.save));
      await tap(tester, find.byTooltip(ko.deckActions));
      await tap(tester, find.text(ko.deleteDeck));
      await shot(tester, '09-delete-deck-confirm');
      await tap(tester, shownText(ko.cancel));

      await tap(tester, shownText('meticulous'));
      await shot(tester, '10-card-editor-existing');
      await tester.ensureVisible(shownText(ko.deleteCard));
      await tester.pumpAndSettle();
      await tap(tester, shownText(ko.deleteCard));
      await shot(tester, '11-delete-card-confirm');
      await tap(tester, shownText(ko.cancel));
      await tap(tester, find.byTooltip(ko.close));

      // The tabs before any study: four new cards for today.
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      // Once 홈 shows a deck with cards, the first-run step asks for the
      // daily minutes.
      await showHome(tester);
      await waitForPicker(tester, more: ko.dailyMinutesMore);
      await shot(tester, '16a0-daily-minutes-first');
      await tap(tester, shownText(ko.dailyMinutesSkip));
      await shot(tester, '16a-today');
      await showNotes(tester);
      await shot(tester, '16a2-notes');
      await tap(tester, shownText('영단어 기본'));

      await tester.tap(shownTextContaining(ko.studyThisDeckPlain));
      // The device's first session: the coach. Its demonstration repeats, so
      // the screen is pumped a fixed time into its cycle rather than settled.
      for (
        var tries = 0;
        tries < 20 && shownText(ko.coachNext).evaluate().isEmpty;
        tries++
      ) {
        await tester.pump(const Duration(milliseconds: 100));
      }
      await tester.pump(const Duration(milliseconds: 1500));
      await shot(tester, '12-study-coach');
      await tester.tap(shownText(ko.coachNext));
      await tester.pump(const Duration(milliseconds: 2800));
      await shot(tester, '12a-study-coach-dont-know');
      await tester.tap(shownText(ko.coachNext));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 2800));
      await shot(tester, '12b-study-coach-change');
      await tap(tester, shownText(ko.coachStart));
      // A day's first session: the empty previous card's place.
      await shot(tester, '12c-study-start');
      // Answers by a swipe of the current card, right for 안다.
      Future<void> answer(String label) =>
          _swipeCurrent(tester, label == ko.know ? 200 : -200);

      for (final label in [ko.know, ko.dontKnow, ko.know, ko.know]) {
        await answer(label);
      }
      // At rest: the previous card above the current one.
      await shot(tester, '13-study-session');
      // The previous card, above the current one.
      final previous = find
          .bySemanticsLabel(
            RegExp(
              '^방금 본 카드, (안다|모른다)\\. '
              '앞면: (ephemeral|meticulous|ubiquitous|resilient)\\. ',
            ),
          )
          .first;
      final gesture = await tester.startGesture(tester.getCenter(previous));
      for (var moved = 0; moved < 8; moved++) {
        await gesture.moveBy(const Offset(-15, 0));
        await tester.pump(const Duration(milliseconds: 50));
      }
      // Re-deciding the previous card, its new answer shown behind it.
      await shot(tester, '13c-study-redecide');
      await gesture.up();
      await tester.pumpAndSettle();
      await tester.tap(previous);
      await tester.pumpAndSettle();
      await shot(tester, '14-whole-card-sheet');
      await dismissSheet(tester);
      // The today card once some of the day's cards are done.
      await tap(tester, find.byTooltip(ko.close));
      await untilWritten(tester);
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      await showHome(tester);
      await shot(tester, '16a1-today-started');
      await showNotes(tester);
      await tap(tester, shownText('영단어 기본'));
      // Reopened the same day: the day's last card from the earlier session,
      // and for a moment the notice that the session goes on with the day.
      await tap(tester, shownTextContaining(ko.studyThisDeckPlain));
      await shot(tester, '13d-study-resumed');
      await tester.pump(const Duration(seconds: 3));
      await tester.pumpAndSettle();
      for (
        var tries = 0;
        tries < 10 && find.text(ko.studyComplete).evaluate().isEmpty;
        tries++
      ) {
        await answer(ko.know);
      }
      // No new card is left past today's, so the card says so.
      await shot(tester, '15-study-complete');
      await tap(tester, find.byTooltip(ko.close));
      await untilWritten(tester);

      // The empty deck has nothing to study today.
      final container = ProviderScope.containerOf(
        tester.element(find.byType(Navigator).first),
      );
      final decks = (await tester.runAsync(
        () => container.read(deckRepositoryProvider).watchDecks().first,
      ))!;
      final empty = decks.firstWhere((deck) => deck.name == '일본어 N3 한자');
      unawaited(
        Navigator.of(tester.element(find.byType(Navigator).first)).push(
          MaterialPageRoute<void>(
            builder: (_) => StudyScreen(decks: DeckSelection(empty.id)),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await shot(tester, '15c-study-nothing-today');
      await tap(tester, find.byTooltip(ko.close));
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();

      await shot(tester, '16-deck-list');
      await showRecord(tester);
      await shot(tester, '16c-record');
      // 홈 after the sessions, with today's cards done.
      await showHome(tester);
      await shot(tester, '16b-today-done');

      // 설정, from 홈's profile button.
      await tap(tester, find.byTooltip(ko.accountTitle));
      await shot(tester, '18-account');
      await tap(tester, find.text(ko.themeTitle));
      await shot(tester, '18e-theme-sheet');
      await dismissSheet(tester);
      // Its 하루 학습 시간 row opens the minutes picker as a screen; + moves
      // the number and the tiles follow.
      await tap(tester, find.text(ko.dailyMinutesTitle));
      await waitForPicker(tester, more: ko.dailyMinutesMore);
      await tap(tester, find.byTooltip(ko.dailyMinutesMore));
      await shot(tester, '18c-daily-minutes-screen');
      // The number typed in place, out of range, above the keypad's space:
      // the test renderer draws no system keyboard, so its inset stands in.
      await tap(
        tester,
        find.bySemanticsLabel(ko.dailyMinutesNumberSemantics(25)),
      );
      await tester.enterText(find.byType(TextField), '200');
      tester.view.viewInsets = const FakeViewPadding(bottom: 690);
      addTearDown(tester.view.resetViewInsets);
      await tester.pumpAndSettle();
      await shot(tester, '18d-daily-minutes-keypad');
      tester.view.resetViewInsets();
      await tester.enterText(find.byType(TextField), '');
      await tester.testTextInput.receiveAction(TextInputAction.done);
      await tester.pumpAndSettle();
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(
        find.text(ko.termsOfService),
        100,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.pumpAndSettle();
      await shot(tester, '18b-account-footer');
      server.failure = const SyncOffline('no route to host');
      await tester.tap(find.text(ko.signOut));
      await tester.pump();
      await tester.pump(const Duration(seconds: 1));
      await shot(tester, '19-sign-out-warning');
      await tester.tap(shownText(ko.cancel));
      await tester.pump(const Duration(seconds: 1));
      await tester.tap(find.text(ko.deleteAccount));
      await tester.pump();
      await tester.pump(const Duration(seconds: 1));
      await shot(tester, '19b-delete-account-confirm');
      await tester.tap(shownText(ko.cancel));
      await tester.pump(const Duration(seconds: 1));

      // Disposing sync cancels the run a write scheduled.
      ProviderScope.containerOf(
        tester.element(find.byType(AccountGate, skipOffstage: false)),
      ).read(syncControllerProvider).dispose();
      await unmount(tester);
    });

    testWidgets('the today tab in a backlog in $mode', skip: !_capture, (
      tester,
    ) async {
      phone(tester);
      final db = AppDatabase(NativeDatabase.memory());
      addTearDown(db.close);
      var ids = 0;
      final repository = DeckRepository(
        db,
        clock: () => homeNow.subtract(const Duration(days: 90)),
        newId: () => 'id${ids++}',
      );
      await tester.runAsync(() async {
        for (final (name, count) in [('영단어 기본', 52), ('토익 빈출', 32)]) {
          final deck = await repository.createDeck(name);
          for (var i = 0; i < count; i++) {
            final saved = await repository.addCard(
              deck.id,
              front: [TextContent('$name $i')],
              back: [TextContent('$i')],
            );
            if (saved case CardSaved(:final card)) {
              // Overdue after a month's interval: far more than three days'
              // load.
              await storeState(db, card.id, due: homeNow, days: 30);
            }
          }
        }
      });
      final storage = await openStudyStorage(tester);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            deckRepositoryProvider.overrideWithValue(repository),
            ...homeOverrides(db, storage: storage),
          ],
          child: MaterialApp(
            theme: lightTheme,
            darkTheme: darkTheme,
            themeMode: ThemeMode.values.byName(mode),
            locale: const Locale('ko'),
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: const HomeScreen(),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await shot(tester, '16d-today-backlog');
      await unmount(tester);
    });

    for (final device in heroPhones) {
      for (final MapEntry(key: state, value: (_, setup))
          in heroStates.entries) {
        testWidgets('홈 $state on a ${device.name} in $mode', skip: !_capture, (
          tester,
        ) async {
          phone(tester);
          tester.view.physicalSize = device.size * _density;
          tester.view.padding = FakeViewPadding(
            top: device.top * _density,
            bottom: device.bottom * _density,
          );
          tester.view.viewPadding = tester.view.padding;
          final db = AppDatabase(NativeDatabase.memory());
          addTearDown(db.close);
          var ids = 0;
          final repository = DeckRepository(
            db,
            clock: () => homeNow.subtract(const Duration(days: 5)),
            newId: () => 'id${ids++}',
          );
          await tester.runAsync(() async {
            final decks = [
              for (final name in heroNotes)
                (await repository.createDeck(name)).id,
            ];
            final minutes = await setup(db, repository, decks);
            if (minutes != null) {
              await StudyRepository(
                db,
                newId: () => 'setting',
              ).setDailyMinutes(minutes, at: homeNow);
            }
          });
          final storage = await openStudyStorage(tester);
          await tester.pumpWidget(
            ProviderScope(
              overrides: [
                deckRepositoryProvider.overrideWithValue(repository),
                ...homeOverrides(db, storage: storage),
              ],
              child: MaterialApp(
                theme: lightTheme,
                darkTheme: darkTheme,
                themeMode: ThemeMode.values.byName(mode),
                locale: const Locale('ko'),
                localizationsDelegates: AppLocalizations.localizationsDelegates,
                supportedLocales: AppLocalizations.supportedLocales,
                home: const HomeScreen(),
              ),
            ),
          );
          await tester.pumpAndSettle();
          final name = '16m-home-$state-${device.size.height.toInt()}'
              .replaceAll(' ', '-');
          // The first screen, then scrolled to the foot, at the text size
          // before and at the largest.
          Future<void> shoot(String name) async {
            final page = tester
                .state<ScrollableState>(
                  find
                      .ancestor(
                        of: find.text(ko.appTitle),
                        matching: find.byType(Scrollable),
                      )
                      .first,
                )
                .position;
            page.jumpTo(0);
            await tester.pumpAndSettle();
            await shot(tester, name);
            page.jumpTo(page.maxScrollExtent);
            await tester.pumpAndSettle();
            await shot(tester, '$name-scrolled');
          }

          await shoot(name);
          tester.platformDispatcher.textScaleFactorTestValue = 3.12;
          addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
          await tester.pumpAndSettle();
          await shoot('$name-largest-text');
          tester.platformDispatcher.clearTextScaleFactorTestValue();
          await tester.pumpAndSettle();
          // The owner's four notes, on the 노트 tab.
          if (state == 'today') {
            await showNotes(tester);
            await shot(tester, '16n-notes-${device.size.height.toInt()}');
          }
          await unmount(tester);
        });
      }
    }

    testWidgets(
      'the today tab at twice the text size in $mode',
      skip: !_capture,
      (tester) async {
        phone(tester);
        tester.platformDispatcher.textScaleFactorTestValue = 2;
        addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
        final db = AppDatabase(NativeDatabase.memory());
        addTearDown(db.close);
        var ids = 0;
        final repository = DeckRepository(
          db,
          clock: () => homeNow.subtract(const Duration(days: 2)),
          newId: () => 'id${ids++}',
        );
        await tester.runAsync(() async {
          final deck = await repository.createDeck('영단어 기본');
          for (var i = 0; i < 30; i++) {
            final saved = await repository.addCard(
              deck.id,
              front: [TextContent('word $i')],
              back: [TextContent('$i')],
            );
            if (saved case CardSaved(:final card) when i < 12) {
              // Due today after a day's interval, answered the day before.
              await storeState(db, card.id, due: homeNow);
              await storeAnswers(db, card.id, 1, const Duration(seconds: 10));
            }
          }
        });
        final storage = await openStudyStorage(tester);
        await tester.pumpWidget(
          ProviderScope(
            overrides: [
              deckRepositoryProvider.overrideWithValue(repository),
              ...homeOverrides(db, storage: storage),
            ],
            child: MaterialApp(
              theme: lightTheme,
              darkTheme: darkTheme,
              themeMode: ThemeMode.values.byName(mode),
              locale: const Locale('ko'),
              localizationsDelegates: AppLocalizations.localizationsDelegates,
              supportedLocales: AppLocalizations.supportedLocales,
              home: const HomeScreen(),
            ),
          ),
        );
        await tester.pumpAndSettle();
        await shot(tester, '16j-today-text-2x');
        await tester.drag(find.byType(Scrollable).first, const Offset(0, -600));
        await tester.pumpAndSettle();
        await shot(tester, '16k-today-text-2x-below');
        await unmount(tester);
      },
    );

    testWidgets('study past the day\'s plan in $mode', skip: !_capture, (
      tester,
    ) async {
      phone(tester);
      final db = AppDatabase(NativeDatabase.memory());
      addTearDown(db.close);
      var ids = 0;
      final repository = DeckRepository(
        db,
        clock: () => homeNow.subtract(const Duration(days: 1)),
        newId: () => 'id${ids++}',
      );
      await tester.runAsync(() async {
        // 5 minutes a day at 10 s: 30 new cards, so of the 35 answered today
        // five are past the plan, and five more are left to study on.
        await StudyRepository(
          db,
          newId: () => 'setting',
        ).setDailyMinutes(5, at: homeNow);
        final deck = await repository.createDeck('영단어 기본');
        for (var i = 0; i < 40; i++) {
          final saved = await repository.addCard(
            deck.id,
            front: [TextContent('word $i')],
            back: [TextContent('$i')],
          );
          if (saved case CardSaved(:final card) when i < 35) {
            await storeState(
              db,
              card.id,
              due: homeNow.add(const Duration(days: 1)),
            );
            await storeAnswerAt(
              db,
              card.id,
              homeNow.subtract(Duration(minutes: 60 - i)),
            );
          }
        }
      });
      final storage = await openStudyStorage(tester);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            deckRepositoryProvider.overrideWithValue(repository),
            ...homeOverrides(db, storage: storage),
          ],
          child: MaterialApp(
            theme: lightTheme,
            darkTheme: darkTheme,
            themeMode: ThemeMode.values.byName(mode),
            locale: const Locale('ko'),
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: const HomeScreen(),
          ),
        ),
      );
      await tester.pumpAndSettle();
      // The day's plan done: its title, the next review and 학습하기.
      expect(shownText(ko.todayDone), findsOneWidget);
      expect(shownText(ko.nextReview(ko.dayTomorrow, 35, 6)), findsOneWidget);
      expect(shownText(ko.todayStudy), findsOneWidget);
      await shot(tester, '16i-today-done-extra');
      await tester.scrollUntilVisible(
        shownText(ko.todayStudy),
        100,
        scrollable: find.byType(Scrollable).first,
      );
      await tap(tester, shownText(ko.todayStudy));
      await shot(tester, '15d-study-extra');
      await largest(tester, '15d-study-extra');
      await unmount(tester);
    });

    testWidgets('whole cards in $mode', skip: !_capture, (tester) async {
      phone(tester);
      final db = AppDatabase(NativeDatabase.memory());
      addTearDown(db.close);
      var ids = 0;
      final repository = DeckRepository(
        db,
        clock: () => homeNow.subtract(const Duration(days: 1)),
        newId: () => 'id${ids++}',
      );
      await tester.runAsync(() async {
        final deck = await repository.createDeck('국어 문법');
        for (final front in [
          [
            const ClozeContent('3인칭 재귀칭: 높임 ___ · 예사 ___ · 낮춤 저', ['당신', '자기']),
          ],
          [
            const TextContent('불규칙 활용'),
            const TableContent(
              columns: ['불규칙', '기본형', '활용'],
              rows: [
                ['ㄷ 불규칙', '듣다', '들어'],
                ['ㅂ 불규칙', '돕다', '도와'],
                ['ㅅ 불규칙', '낫다', '나아'],
              ],
              blanks: [
                (row: 0, column: 2),
                (row: 1, column: 2),
                (row: 2, column: 2),
              ],
            ),
          ],
        ]) {
          await repository.addCard(
            deck.id,
            front: front,
            back: [TextContent(plainText(front))],
          );
        }
      });
      final storage = await openStudyStorage(tester);
      await tester.pumpWidget(
        ProviderScope(
          // The real scheduler, as answering a card reviews it.
          overrides: [
            deckRepositoryProvider.overrideWithValue(repository),
            accountServiceProvider.overrideWithValue(
              FakeAccountService(
                const SignedIn(userId: _ada, email: 'ada@example.com'),
              ),
            ),
            studyRepositoryProvider.overrideWithValue(
              StudyRepository(db, newId: () => 'review${ids++}'),
            ),
            schedulerProvider.overrideWithValue(scheduler),
            studyClockProvider.overrideWithValue(() => homeNow),
            studyZoneProvider.overrideWithValue((_) => Duration.zero),
            studyRandomProvider.overrideWithValue((_) => Random(0)),
            studyStorageProvider.overrideWithValue(storage),
          ],
          child: MaterialApp(
            theme: lightTheme,
            darkTheme: darkTheme,
            themeMode: ThemeMode.values.byName(mode),
            locale: const Locale('ko'),
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: const HomeScreen(),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await showNotes(tester);
      await tap(tester, shownText('국어 문법'));
      await shot(tester, '31-whole-card-list');

      await tap(tester, shownTextContaining(ko.studyThisDeckPlain));
      await shot(tester, '32-whole-card-study');
      for (final name in [
        '32b-whole-card-answered',
        '32c-whole-card-answered',
      ]) {
        await _swipeCurrent(tester, 200);
        await shot(tester, name);
      }
      // The answers' writes land before the database closes.
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 100)),
      );
      await unmount(tester);
    });

    testWidgets('long cards in $mode', skip: !_capture, (tester) async {
      phone(tester);
      final db = AppDatabase(NativeDatabase.memory());
      addTearDown(db.close);
      var ids = 0;
      final repository = DeckRepository(
        db,
        clock: () => homeNow.subtract(const Duration(days: 1)),
        newId: () => 'id${ids++}',
      );
      await tester.runAsync(() async {
        final deck = await repository.createDeck('생명과학');
        for (final (front, back) in [
          ([TextContent(_longKorean(100))], [const TextContent('광합성')]),
          ([TextContent(_longKorean(200))], [TextContent(_longKorean(100))]),
          ([TextContent(_longKorean(400))], [TextContent(_longKorean(200))]),
          ([const TextContent('run')], [_runSenses]),
        ]) {
          await repository.addCard(deck.id, front: front, back: back);
        }
      });
      final storage = await openStudyStorage(tester);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            deckRepositoryProvider.overrideWithValue(repository),
            accountServiceProvider.overrideWithValue(
              FakeAccountService(
                const SignedIn(userId: _ada, email: 'ada@example.com'),
              ),
            ),
            studyRepositoryProvider.overrideWithValue(
              StudyRepository(db, newId: () => 'review${ids++}'),
            ),
            schedulerProvider.overrideWithValue(scheduler),
            studyClockProvider.overrideWithValue(() => homeNow),
            studyZoneProvider.overrideWithValue((_) => Duration.zero),
            studyRandomProvider.overrideWithValue((_) => Random(0)),
            studyStorageProvider.overrideWithValue(storage),
            deckStorageProvider.overrideWithValue(storage),
          ],
          child: MaterialApp(
            theme: lightTheme,
            darkTheme: darkTheme,
            themeMode: ThemeMode.values.byName(mode),
            locale: const Locale('ko'),
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: const HomeScreen(),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await showNotes(tester);
      await tap(tester, shownText('생명과학'));
      await tap(tester, shownTextContaining(ko.studyThisDeckPlain));
      await shot(tester, '34-long-study-1');
      for (final name in [
        '34b-long-study-2',
        '34c-long-study-3',
        '34d-long-study-4',
        '34e-long-study-done',
      ]) {
        await _swipeCurrent(tester, 200);
        await shot(tester, name);
      }
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 100)),
      );
      await unmount(tester);
    });

    testWidgets('a long card\'s preview in $mode', skip: !_capture, (
      tester,
    ) async {
      phone(tester);
      final db = AppDatabase(NativeDatabase.memory());
      addTearDown(db.close);
      var ids = 0;
      final repository = DeckRepository(
        db,
        clock: () => homeNow,
        newId: () => 'id${ids++}',
      );
      final deck = (await tester.runAsync(
        () => repository.createDeck('생명과학'),
      ))!;
      final storage = await openStudyStorage(tester);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            deckRepositoryProvider.overrideWithValue(repository),
            deckStorageProvider.overrideWithValue(storage),
          ],
          child: MaterialApp(
            theme: lightTheme,
            darkTheme: darkTheme,
            themeMode: ThemeMode.values.byName(mode),
            locale: const Locale('ko'),
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: CardEditorScreen(preview: _preview, deck: deck),
          ),
        ),
      );
      await tester.pumpAndSettle();
      final fields = find.byType(TextField);
      await tester.enterText(fields.at(0), _longKorean(400));
      await tester.enterText(fields.at(1), _longKorean(200));
      await tester.pumpAndSettle();
      await tap(tester, shownText(ko.previewCard));
      await shot(tester, '35-long-preview-front');
      await tap(tester, find.byType(Scaffold).last);
      await shot(tester, '35b-long-preview-back');
      await unmount(tester);
    });

    testWidgets('the senses block in $mode', skip: !_capture, (tester) async {
      phone(tester);
      final db = AppDatabase(NativeDatabase.memory());
      addTearDown(db.close);
      var ids = 0;
      final repository = DeckRepository(
        db,
        clock: () => homeNow,
        newId: () => 'id${ids++}',
      );
      final deck = (await tester.runAsync(
        () => repository.createDeck('영단어 기본'),
      ))!;
      final storage = await openStudyStorage(tester);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            deckRepositoryProvider.overrideWithValue(repository),
            deckStorageProvider.overrideWithValue(storage),
          ],
          child: MaterialApp(
            theme: lightTheme,
            darkTheme: darkTheme,
            themeMode: ThemeMode.values.byName(mode),
            locale: const Locale('ko'),
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: CardEditorScreen(preview: _preview, deck: deck),
          ),
        ),
      );
      await tester.pumpAndSettle();
      Future<void> reveal(Finder finder) async {
        await tester.ensureVisible(finder);
        await tester.pumpAndSettle();
      }

      Future<void> fill(String label, String text, [int index = 0]) async {
        final field = widgetWithShownText(AppTextField, label).at(index);
        await reveal(field);
        await tester.enterText(field, text);
        await tester.pumpAndSettle();
      }

      // The [index]th sense's label field.
      Finder label([int index = 0]) => find
          .byWidgetPredicate(
            (widget) =>
                widget is TextField && widget.textAlign == TextAlign.center,
          )
          .at(index);

      await tap(tester, shownText(ko.save));
      await shot(tester, '05b-card-editor-basic-errors');
      // The card's Text, made a Word.
      await reveal(find.byTooltip(ko.blockMenu(1)));
      await tap(tester, find.byTooltip(ko.blockMenu(1)));
      await tap(tester, shownText(ko.deleteBlock).last);
      await reveal(find.bySemanticsLabel(ko.addBlock));
      await tap(tester, find.bySemanticsLabel(ko.addBlock));
      await tap(tester, find.text(ko.blockSenses).last);

      await reveal(find.byType(TextField).first);
      await tester.enterText(find.byType(TextField).first, 'present');
      await tester.pumpAndSettle();
      // A phone keyboard 336 points high, given in physical pixels, under
      // the presets a label field shows.
      await reveal(label());
      tester.widget<TextField>(label()).focusNode!.requestFocus();
      await tester.pumpAndSettle();
      tester.view.viewInsets = const FakeViewPadding(bottom: 336 * _density);
      addTearDown(tester.view.resetViewInsets);
      await tester.pumpAndSettle();
      await tap(tester, find.widgetWithText(AppChip, '명'));
      await shot(tester, '05c-card-editor-label-presets');
      await largest(tester, '05c-card-editor-label-presets');
      tester.view.resetViewInsets();
      await tester.pumpAndSettle();
      await fill(ko.senseMeaning, '선물');
      await reveal(find.bySemanticsLabel(ko.addSense));
      await tap(tester, find.bySemanticsLabel(ko.addSense));
      await reveal(label(1));
      await tester.enterText(label(1), '동');
      await fill(ko.senseHeading(2), '주다, 제시하다');
      await reveal(find.text('영단어 기본'));
      await shot(tester, '05d-card-editor-senses');
      // The second sense's menu: up, down and delete.
      await reveal(find.byTooltip(ko.senseMenu(2)));
      await tap(tester, find.byTooltip(ko.senseMenu(2)));
      await shot(tester, '05e-card-editor-senses-buttons');
      await dismissSheet(tester);

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            deckRepositoryProvider.overrideWithValue(repository),
            deckStorageProvider.overrideWithValue(storage),
          ],
          child: MaterialApp(
            theme: lightTheme,
            darkTheme: darkTheme,
            themeMode: ThemeMode.values.byName(mode),
            locale: const Locale('ko'),
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: const Scaffold(body: PartOfSpeechPresetsRow()),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tap(tester, find.text(ko.labelPresetsTitle));
      await shot(tester, '05o-label-presets');
      await tap(tester, find.bySemanticsLabel(ko.editLabelPreset('명', '명사')));
      await shot(tester, '05p-label-presets-edit');
      await largest(tester, '05p-label-presets-edit');
      await unmount(tester);
    });

    testWidgets(
      'the card editor with the keyboard up in $mode',
      skip: !_capture,
      (tester) async {
        phone(tester);
        final db = AppDatabase(NativeDatabase.memory());
        addTearDown(db.close);
        var ids = 0;
        final repository = DeckRepository(
          db,
          clock: () => homeNow,
          newId: () => 'id${ids++}',
        );
        final deck = (await tester.runAsync(
          () => repository.createDeck('영단어 기본'),
        ))!;
        final storage = await openStudyStorage(tester);
        await tester.pumpWidget(
          ProviderScope(
            overrides: [
              deckRepositoryProvider.overrideWithValue(repository),
              deckStorageProvider.overrideWithValue(storage),
            ],
            child: MaterialApp(
              theme: lightTheme,
              darkTheme: darkTheme,
              themeMode: ThemeMode.values.byName(mode),
              locale: const Locale('ko'),
              localizationsDelegates: AppLocalizations.localizationsDelegates,
              supportedLocales: AppLocalizations.supportedLocales,
              home: CardEditorScreen(preview: _preview, deck: deck),
            ),
          ),
        );
        await tester.pumpAndSettle();
        // A phone keyboard 336 points high, given in physical pixels.
        tester.view.viewInsets = const FakeViewPadding(bottom: 336 * _density);
        addTearDown(tester.view.resetViewInsets);
        await tester.enterText(find.byType(TextField).first, 'ephemeral');
        await tester.pumpAndSettle();
        await shot(tester, '05k-card-editor-keyboard');
        tester.view.resetViewInsets();
        await tap(tester, find.byTooltip(ko.close));
        await shot(tester, '05l-card-editor-discard');
        await unmount(tester);
      },
    );

    testWidgets('a back of senses with extras in $mode', skip: !_capture, (
      tester,
    ) async {
      phone(tester);
      final db = AppDatabase(NativeDatabase.memory());
      addTearDown(db.close);
      var ids = 0;
      final repository = DeckRepository(
        db,
        clock: () => homeNow,
        newId: () => 'id${ids++}',
      );
      final deck = (await tester.runAsync(
        () => repository.createDeck('영단어 기본'),
      ))!;
      final card = (await tester.runAsync(() async {
        final saved = await repository.addCard(
          deck.id,
          front: [const TextContent('present')],
          back: [
            const SensesContent([
              CardSense(
                labels: [PartOfSpeechLabel(PartOfSpeech.noun, '명')],
                meaning: '선물',
              ),
            ]),
            const TextContent('유의어 gift'),
          ],
        );
        return (saved as CardSaved).card;
      }))!;
      final storage = await openStudyStorage(tester);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            deckRepositoryProvider.overrideWithValue(repository),
            deckStorageProvider.overrideWithValue(storage),
          ],
          child: MaterialApp(
            theme: lightTheme,
            darkTheme: darkTheme,
            themeMode: ThemeMode.values.byName(mode),
            locale: const Locale('ko'),
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: CardEditorScreen(preview: _preview, deck: deck, card: card),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('유의어 gift'));
      await tester.pumpAndSettle();
      await shot(tester, '05n-card-editor-senses-extras');
      await unmount(tester);
    });

    testWidgets('the block editor in $mode', skip: !_capture, (tester) async {
      phone(tester);
      final db = AppDatabase(NativeDatabase.memory());
      addTearDown(db.close);
      var ids = 0;
      final repository = DeckRepository(
        db,
        clock: () => homeNow,
        newId: () => 'id${ids++}',
      );
      final deck = (await tester.runAsync(
        () => repository.createDeck('영단어 기본'),
      ))!;
      final storage = await openStudyStorage(tester);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            deckRepositoryProvider.overrideWithValue(repository),
            deckStorageProvider.overrideWithValue(storage),
          ],
          child: MaterialApp(
            theme: lightTheme,
            darkTheme: darkTheme,
            themeMode: ThemeMode.values.byName(mode),
            locale: const Locale('ko'),
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: CardEditorScreen(preview: _preview, deck: deck),
          ),
        ),
      );
      await tester.pumpAndSettle();
      final fields = find.byType(TextField);
      await tester.enterText(fields.at(0), '이 근처에 약국이 있나요?');
      await tester.enterText(fields.at(1), 'Is there a pharmacy near here?');
      await tester.pumpAndSettle();
      await shot(tester, '05r-card-editor-free');
      // The card as study draws it, its front, then answered after a tap.
      await tap(tester, shownText(ko.previewCard));
      await shot(tester, '05v-card-preview-front');
      // The card fills the screen's middle.
      await tap(tester, find.byType(Scaffold).last);
      await shot(tester, '05w-card-preview-back');
      await tap(tester, find.byTooltip(ko.close));
      await tester.ensureVisible(find.bySemanticsLabel(ko.addBlock));
      await tester.pumpAndSettle();
      await tap(tester, find.bySemanticsLabel(ko.addBlock));
      await shot(tester, '05s-card-editor-add-sheet');
      await tap(tester, find.text(ko.blockSenses).last);
      await tester.ensureVisible(find.bySemanticsLabel(ko.addBlock));
      await tester.pumpAndSettle();
      await shot(tester, '05t-card-editor-free-senses');
      await unmount(tester);
    });

    testWidgets('each 칸 type in $mode', skip: !_capture, (tester) async {
      phone(tester);
      final db = AppDatabase(NativeDatabase.memory());
      addTearDown(db.close);
      var ids = 0;
      final repository = DeckRepository(
        db,
        clock: () => homeNow,
        newId: () => 'id${ids++}',
      );
      final deck = (await tester.runAsync(
        () => repository.createDeck('영단어 기본'),
      ))!;
      const cells = <Cell>[
        TextCell(front: 'ephemeral', back: '덧없는, 순간적인'),
        WordCell(
          term: 'present',
          senses: [
            CardSense(
              labels: [PartOfSpeechLabel(PartOfSpeech.noun, '명')],
              meaning: '선물',
              examples: ['a birthday present'],
            ),
            CardSense(
              labels: [PartOfSpeechLabel(PartOfSpeech.verb, '동')],
              meaning: '주다',
            ),
          ],
          ask: WordAsk.term,
        ),
        BlankCell(ClozeContent('The capital of France is ___.', ['Paris'])),
        BlankCell(
          TableContent(
            columns: ['나라', '수도'],
            rows: [
              ['프랑스', '파리'],
              ['일본', '도쿄'],
            ],
            blanks: [(row: 0, column: 1)],
          ),
        ),
        PlacedCell(
          ImageContent(media: MediaId('photo'), width: 1600, height: 900),
          CellSide.back,
        ),
        PlacedCell(
          AudioContent(media: MediaId('sound'), duration: Duration(seconds: 7)),
          CellSide.front,
        ),
      ];
      final sides = sidesOf(cells);
      final saved = await tester.runAsync(
        () => repository.addCard(
          deck.id,
          front: sides.front,
          back: sides.back,
          cells: cells,
        ),
      );
      final card = (saved! as CardSaved).card;
      final storage = await openStudyStorage(tester);
      Future<void> open(Card? card) async {
        await tester.pumpWidget(
          ProviderScope(
            key: UniqueKey(),
            overrides: [
              deckRepositoryProvider.overrideWithValue(repository),
              deckStorageProvider.overrideWithValue(storage),
              mediaStoreProvider.overrideWithValue(
                MediaStore(
                  db,
                  FakeMediaServer(),
                  directory: unusedMediaDirectory,
                  clock: () => homeNow,
                  newId: () => 'media',
                ),
              ),
            ],
            child: MaterialApp(
              theme: lightTheme,
              darkTheme: darkTheme,
              themeMode: ThemeMode.values.byName(mode),
              locale: const Locale('ko'),
              localizationsDelegates: AppLocalizations.localizationsDelegates,
              supportedLocales: AppLocalizations.supportedLocales,
              home: CardEditorScreen(preview: _preview, deck: deck, card: card),
            ),
          ),
        );
        await tester.pumpAndSettle();
      }

      // Tall enough to show every group at once.
      final size = tester.view.physicalSize;
      tester.view.physicalSize = Size(size.width, size.height * 2.6);
      await open(card);
      await shot(tester, '05x-card-editor-each-kan');
      tester.view.physicalSize = size;
      // A 칸 deleted, with its undo above the actions (ADR 0174).
      await open(card);
      await tap(tester, find.byTooltip(ko.blockMenu(1)));
      await tap(tester, shownText(ko.deleteBlock).last);
      await shot(tester, '05zb-card-editor-undo');
      await largest(tester, '05zb-card-editor-undo');
      await open(null);
      await shot(tester, '05y-card-editor-new');
      await tap(tester, shownText(ko.save));
      await shot(tester, '05z-card-editor-nothing-before');
      await tester.enterText(find.byType(TextField).first, 'ephemeral');
      await tap(tester, shownText(ko.save));
      await shot(tester, '05za-card-editor-nothing-added');
      await unmount(tester);
    });

    testWidgets('the cloze sentence block in $mode', skip: !_capture, (
      tester,
    ) async {
      phone(tester);
      final db = AppDatabase(NativeDatabase.memory());
      addTearDown(db.close);
      var ids = 0;
      final repository = DeckRepository(
        db,
        clock: () => homeNow,
        newId: () => 'id${ids++}',
      );
      final deck = (await tester.runAsync(
        () => repository.createDeck('영단어 기본'),
      ))!;
      final storage = await openStudyStorage(tester);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            deckRepositoryProvider.overrideWithValue(repository),
            deckStorageProvider.overrideWithValue(storage),
          ],
          child: MaterialApp(
            theme: lightTheme,
            darkTheme: darkTheme,
            themeMode: ThemeMode.values.byName(mode),
            locale: const Locale('ko'),
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: CardEditorScreen(preview: _preview, deck: deck),
          ),
        ),
      );
      await tester.pumpAndSettle();
      // One Cloze sentence.
      await tester.ensureVisible(find.byTooltip(ko.blockMenu(1)));
      await tester.pumpAndSettle();
      await tap(tester, find.byTooltip(ko.blockMenu(1)));
      await tap(tester, shownText(ko.deleteBlock).last);
      await tester.ensureVisible(find.bySemanticsLabel(ko.addBlock));
      await tester.pumpAndSettle();
      await tap(tester, find.bySemanticsLabel(ko.addBlock));
      await tap(tester, find.text(ko.blockCloze).last);
      final line = find.byType(TextField).first;
      await tester.enterText(line, 'She gave me a present for my birthday');
      await tester.pumpAndSettle();
      await tester.ensureVisible(shownText(ko.save));
      await tap(tester, shownText(ko.save));
      await shot(tester, '05f-card-editor-cloze-error');
      await tester.showKeyboard(line);
      final controller = tester.widget<TextField>(line).controller!;
      // "a" and "present", each selected and made a blank.
      for (final (start, end) in [(12, 13), (14, 21)]) {
        controller.selection = TextSelection(
          baseOffset: start,
          extentOffset: end,
        );
        await tester.pump();
        await tap(tester, find.text(ko.clozeInsertBlank));
      }
      await tester.ensureVisible(find.text('영단어 기본'));
      await tester.pumpAndSettle();
      await shot(tester, '05g-card-editor-cloze');
      // The caret in "present": the one action turns it back into text.
      controller.selection = const TextSelection.collapsed(offset: 17);
      await tester.pumpAndSettle();
      await shot(tester, '05q-card-editor-cloze-undo');
      // An empty blank at the cursor, over a phone keyboard 336 points high.
      controller.selection = const TextSelection.collapsed(offset: 4);
      await tester.pump();
      await tap(tester, find.text(ko.clozeInsertBlank));
      tester.view.viewInsets = const FakeViewPadding(bottom: 336 * _density);
      addTearDown(tester.view.resetViewInsets);
      await tester.pumpAndSettle();
      await shot(tester, '05m-card-editor-cloze-insert');
      tester.view.resetViewInsets();
      await tester.pumpAndSettle();
      // The card on its one face, its blanks empty until a tap.
      await tap(tester, shownText(ko.previewCard));
      await shot(tester, '05x-card-preview-cloze');
      await unmount(tester);
    });

    testWidgets('a cloze selection scrolled past in $mode', skip: !_capture, (
      tester,
    ) async {
      phone(tester);
      final db = AppDatabase(NativeDatabase.memory());
      addTearDown(db.close);
      var ids = 0;
      final repository = DeckRepository(
        db,
        clock: () => homeNow,
        newId: () => 'id${ids++}',
      );
      final deck = (await tester.runAsync(
        () => repository.createDeck('영단어 기본'),
      ))!;
      final storage = await openStudyStorage(tester);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            deckRepositoryProvider.overrideWithValue(repository),
            deckStorageProvider.overrideWithValue(storage),
          ],
          child: MaterialApp(
            theme: lightTheme,
            darkTheme: darkTheme,
            themeMode: ThemeMode.values.byName(mode),
            locale: const Locale('ko'),
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            // As the app root wraps every route.
            builder: (context, child) => KeyboardDismissal(child: child),
            home: CardEditorScreen(preview: _preview, deck: deck),
          ),
        ),
      );
      await tester.pumpAndSettle();
      // A 빈칸 문장 first, then a 글 under it.
      await tap(tester, find.byTooltip(ko.blockMenu(1)));
      await tap(tester, shownText(ko.deleteBlock).last);
      for (final type in [ko.blockCloze, ko.blockText]) {
        await tester.ensureVisible(find.bySemanticsLabel(ko.addBlock));
        await tester.pumpAndSettle();
        await tap(tester, find.bySemanticsLabel(ko.addBlock));
        await tap(tester, find.text(type).last);
      }
      final line = find.byType(TextField).first;
      await tester.enterText(line, 'She gave me a present for my birthday');
      await tester.showKeyboard(line);
      tester.view.viewInsets = const FakeViewPadding(bottom: 336 * _density);
      addTearDown(tester.view.resetViewInsets);
      await tester.pumpAndSettle();
      // "present" selected, then the form dragged by the row after the 칸.
      tester.widget<TextField>(line).controller!.selection =
          const TextSelection(baseOffset: 14, extentOffset: 21);
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.bySemanticsLabel(ko.addBlock));
      await tester.pumpAndSettle();
      await tester.timedDragFrom(
        tester.getCenter(find.bySemanticsLabel(ko.addBlock)),
        const Offset(0, 120),
        const Duration(milliseconds: 400),
      );
      await tester.pumpAndSettle();
      await shot(tester, '05y-card-editor-cloze-scrolled');
      tester.view.resetViewInsets();
      await unmount(tester);
    });

    testWidgets('the table block in $mode', skip: !_capture, (tester) async {
      phone(tester);
      final db = AppDatabase(NativeDatabase.memory());
      addTearDown(db.close);
      var ids = 0;
      final repository = DeckRepository(
        db,
        clock: () => homeNow,
        newId: () => 'id${ids++}',
      );
      final deck = (await tester.runAsync(
        () => repository.createDeck('영단어 기본'),
      ))!;
      final storage = await openStudyStorage(tester);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            deckRepositoryProvider.overrideWithValue(repository),
            deckStorageProvider.overrideWithValue(storage),
          ],
          child: MaterialApp(
            theme: lightTheme,
            darkTheme: darkTheme,
            themeMode: ThemeMode.values.byName(mode),
            locale: const Locale('ko'),
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: CardEditorScreen(preview: _preview, deck: deck),
          ),
        ),
      );
      await tester.pumpAndSettle();
      // A Text, the table's name, and a Table.
      await tester.ensureVisible(find.bySemanticsLabel(ko.addBlock));
      await tester.pumpAndSettle();
      await tap(tester, find.bySemanticsLabel(ko.addBlock));
      await tap(tester, find.text(ko.blockTable).last);
      await tester.enterText(find.byType(TextField).first, '불규칙 동사');
      // The table's fields follow the Text's two: its headers, then its cells.
      Finder cell(int index) => find.byType(TextField).at(index + 2);
      for (final (index, text) in [
        '원형',
        '과거형',
        'go',
        'went',
        'see',
        'saw',
      ].indexed) {
        await tester.ensureVisible(cell(index));
        await tester.enterText(cell(index), text);
      }
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text(ko.addRow));
      await tester.pumpAndSettle();
      await shot(tester, '05h-card-editor-table');
      // "went" and "saw", each selected and made a blank by the toolbar.
      for (final index in [3, 5]) {
        await tester.ensureVisible(cell(index));
        await tester.pumpAndSettle();
        await tap(tester, cell(index));
        await tap(tester, find.widgetWithText(AppChip, ko.tableBlankToggle));
      }
      await tester.ensureVisible(find.text('영단어 기본'));
      await tester.pumpAndSettle();
      await shot(tester, '05i-card-editor-table-blanks');
      await unmount(tester);
    });

    testWidgets('the record tab over twelve weeks in $mode', skip: !_capture, (
      tester,
    ) async {
      phone(tester);
      final db = AppDatabase(NativeDatabase.memory());
      addTearDown(db.close);
      var ids = 0;
      final repository = DeckRepository(
        db,
        clock: () => homeNow.subtract(const Duration(days: 90)),
        newId: () => 'id${ids++}',
      );
      final study = StudyRepository(db, newId: () => 'review${ids++}');
      await tester.runAsync(() async {
        final deck = await repository.createDeck('영단어 기본');
        final cards = <CardId>[];
        for (var i = 0; i < 60; i++) {
          if (await repository.addCard(
                deck.id,
                front: [TextContent('word $i')],
                back: [TextContent('$i')],
              )
              case CardSaved(:final card)) {
            cards.add(card.id);
          }
        }
        // Four new cards a study day and every card due, answered "Don't
        // know" one time in nine, over 84 days with a few rest days.
        final states = <CardId, CardState>{};
        final random = Random(7);
        var next = 0;
        for (var day = 83; day >= 0; day--) {
          if (day > 6 && day % 9 == 4) continue;
          final at = DateTime.utc(
            2026,
            10,
            15,
            6,
          ).subtract(Duration(days: day));
          final end = at.add(const Duration(hours: 22));
          final today = [
            for (final card in cards)
              if (states[card]?.due.isBefore(end) ?? false) card,
            ...cards.skip(next).take(4),
          ];
          next = min(cards.length, next + 4);
          for (final (index, card) in today.indexed) {
            final answer = (index * 7 + day) % 9 == 0
                ? Answer.dontKnow
                : Answer.know;
            final time = at.add(Duration(minutes: index));
            final fuzz = FuzzFactor.draw(random);
            final state = await scheduler.review(
              states[card],
              answer,
              time,
              fuzz: fuzz,
            );
            states[card] = state;
            await study.record(
              card,
              [
                Review(
                  id: study.newReviewId(),
                  cardId: card,
                  answer: answer,
                  reviewedAt: time,
                  duration: const Duration(seconds: 6),
                  fuzzFactor: fuzz,
                ),
              ],
              state,
              at: time,
            );
          }
        }
      });
      // The 오늘 tab behind 기록 reads whether the minutes' step has shown.
      final storage = await openStudyStorage(tester);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            deckRepositoryProvider.overrideWithValue(repository),
            accountServiceProvider.overrideWithValue(
              FakeAccountService(
                const SignedIn(userId: _ada, email: 'ada@example.com'),
              ),
            ),
            studyStorageProvider.overrideWithValue(storage),
            studyRepositoryProvider.overrideWithValue(study),
            schedulerProvider.overrideWithValue(scheduler),
            studyClockProvider.overrideWithValue(() => homeNow),
            studyZoneProvider.overrideWithValue((_) => Duration.zero),
            studyRandomProvider.overrideWithValue((_) => Random(0)),
          ],
          child: MaterialApp(
            theme: lightTheme,
            darkTheme: darkTheme,
            themeMode: ThemeMode.values.byName(mode),
            locale: const Locale('ko'),
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: const HomeScreen(),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await showRecord(tester);
      await shot(tester, '16e-record-history');
      await largest(tester, '16e-record-history');
      await tester.drag(find.byType(ListView), const Offset(0, -600));
      await tester.pumpAndSettle();
      await shot(tester, '16f-record-history-scrolled');
      // The recall bands' tiles at the largest text size.
      tester.platformDispatcher.textScaleFactorTestValue = 3.12;
      await tester.pumpAndSettle();
      await tester.ensureVisible(shownText(ko.recallTitle));
      await tester.pumpAndSettle();
      await shot(tester, '16g-record-recall-largest-text');
      tester.platformDispatcher.clearTextScaleFactorTestValue();
      await tester.pumpAndSettle();
      await unmount(tester);
    });

    testWidgets('photo import in $mode', skip: !_capture, (tester) async {
      final semantics = tester.ensureSemantics();
      phone(tester);
      final db = AppDatabase(NativeDatabase.memory());
      addTearDown(db.close);
      var ids = 0;
      final repository = DeckRepository(
        db,
        clock: DateTime.now,
        newId: () => 'id${ids++}',
      );
      final deck = (await tester.runAsync(() async {
        final deck = await repository.createDeck('영단어 기본');
        await repository.createDeck('일본어 N3 한자');
        await repository.addCard(
          deck.id,
          front: [const TextContent('lucid')],
          back: [const TextContent('명쾌한')],
        );
        return deck;
      }))!;
      final client = FakeExtractionClient();
      final photos = FakePhotoSource();
      final preferences = await openPreferences(tester);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [deckRepositoryProvider.overrideWithValue(repository)],
          child: MaterialApp(
            theme: lightTheme,
            darkTheme: darkTheme,
            themeMode: ThemeMode.values.byName(mode),
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: Builder(
              builder: (context) => Scaffold(
                body: Center(
                  child: TextButton(
                    onPressed: () => importFromPhoto(
                      context,
                      imports: PhotoImports(
                        client: client,
                        photos: photos,
                        preferences: preferences,
                        store: MemoryImportJobStore(),
                        decks: repository,
                      ),
                      deck: deck.id,
                      origin: PhotoOrigin.camera,
                    ),
                    child: const Text('open'),
                  ),
                ),
              ),
            ),
          ),
        ),
      );

      /// Taps [finder], which takes a photo with the camera, through to the
      /// extraction.
      Future<void> shoot(Finder finder) async {
        await tester.tap(finder);
        for (var frame = 0; frame < 5; frame++) {
          await tester.pump(const Duration(milliseconds: 200));
        }
      }

      await shoot(shownText('open'));
      await shot(tester, '22-photo-extracting');
      client.answerCards([
        const CandidateCard(
          front: 'face',
          answer: '[동] 직면하다, 마주하다\n[명] 표면, 겉면\n[명] 얼굴, 생김새',
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
            CardSense(
              labels: [PartOfSpeechLabel(PartOfSpeech.noun, '명')],
              meaning: '얼굴, 생김새',
            ),
          ],
          pronunciation: "['feis]",
          extras: [Extra(label: '유의어', text: 'confront')],
          topic: '최빈출 단어',
        ),
        word(
          front: 'include',
          meaning: '포함하다, 포괄하다',
          partOfSpeech: '[동]',
          topic: '최빈출 단어',
        ),
        word(
          front: 'strategy',
          meaning: '전략, 계획',
          partOfSpeech: '[명]',
          topic: '최빈출 단어',
        ),
        word(
          front: 'lucid',
          meaning: '맑은, 또렷한',
          partOfSpeech: '[형]',
          topic: '최빈출 단어',
        ),
        word(front: 'in addition', meaning: '~뿐만 아니라, 또한', topic: '빈출 숙어'),
        word(front: 'be ready to', meaning: '~할 준비가 되다', topic: '빈출 숙어'),
      ]);
      await tester.pumpAndSettle();
      await shot(tester, '22a-photo-list');
      await tap(tester, find.bySemanticsLabel(RegExp('^최빈출 단어 카드 모양')));
      await shot(tester, '22b-photo-list-menu');
      await largest(tester, '22b-photo-list-menu');
      await tap(tester, find.widgetWithText(MenuItemButton, ko.importBoth));
      await tap(tester, shownText('face'));
      await shot(tester, '22c-photo-edit');
      await tap(tester, shownText(ko.editDone));
      await tap(tester, shownText('영단어 기본'));
      await shot(tester, '21-photo-deck-sheet');
      await dismissSheet(tester);

      // The retake waits in the top bar's ⋯.
      await tap(tester, find.byTooltip(ko.importActions));
      await shot(tester, '22e-photo-list-actions');
      await tap(tester, shownText(ko.retake));
      await shot(tester, '22d-photo-discard');
      await shoot(shownText(ko.discardImport));
      client.answerCards(const [
        CandidateCard(
          front: '양성모음',
          answer: 'ㅏ ㅗ ㅑ ㅛ. 밝고 가벼운 느낌의 모음',
          topic: '모음조화',
        ),
        CandidateCard(
          front: '음성모음',
          answer: 'ㅓ ㅜ ㅡ ㅕ ㅠ. 어둡고 무거운 느낌의 모음',
          topic: '모음조화',
        ),
        CandidateCard(
          front: 'ㅗ + ㅏ 축약',
          answer: 'ㅗ와 ㅏ가 만나면 ㅘ로 줄어듦',
          topic: '축약·탈락',
        ),
        CandidateCard(
          front: "'잡아라'의 '아'",
          answer: '양성모음 어간 뒤 — ㅏ',
          type: CardType.identify,
          topic: '모음조화',
        ),
      ]);
      await tester.pumpAndSettle();
      await shot(tester, '23-photo-notes');

      await tap(tester, find.byTooltip(ko.importActions));
      await tap(tester, shownText(ko.retake));
      await shoot(shownText(ko.discardImport));
      client.fail(const ModelFailed());
      await tester.pumpAndSettle();
      await shot(tester, '24-photo-failure');

      photos.cameraFailure = const PhotoAccessDenied('denied');
      await tap(tester, shownText(ko.retake));
      await shot(tester, '25-photo-refused');

      await unmount(tester);
      semantics.dispose();
    });

    testWidgets('spreadsheet import in $mode', skip: !_capture, (tester) async {
      final semantics = tester.ensureSemantics();
      phone(tester);
      final db = AppDatabase(NativeDatabase.memory());
      addTearDown(db.close);
      var ids = 0;
      final repository = DeckRepository(
        db,
        clock: DateTime.now,
        newId: () => 'id${ids++}',
      );
      await tester.runAsync(() async {
        await repository.createDeck('영단어 기본');
        await repository.createDeck('일본어 N3 한자');
      });
      final long = '가' * 501;
      final pick = _FileToPick(
        parseSpreadsheet(
          '토익 필수 단어.csv',
          utf8.encode(
            '단어,뜻,품사,예문\n'
            'lucid,명쾌한,형,"a lucid explanation"\n'
            'candid,솔직한,형,"a candid answer"\n'
            ',앞면이 빈 행,,\n'
            'mitigate,완화하다,동,"mitigate the risk\nmitigate a loss"\n'
            'Lucid,맑은,형,\n'
            'ephemeral,$long,형,\n'
            'tenacious,끈질긴,형,\n'
            'prudent,신중한,형,\n'
            'scrutiny,면밀한 조사,명,\n',
          ),
        ),
      );
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            deckRepositoryProvider.overrideWithValue(repository),
            spreadsheetPickProvider.overrideWithValue(pick),
          ],
          child: MaterialApp(
            theme: lightTheme,
            darkTheme: darkTheme,
            themeMode: ThemeMode.values.byName(mode),
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: Builder(
              builder: (context) => Scaffold(
                body: Center(
                  child: TextButton(
                    onPressed: () => importFromSpreadsheet(context, null),
                    child: const Text('open'),
                  ),
                ),
              ),
            ),
          ),
        ),
      );
      await tap(tester, shownText('open'));
      await shot(tester, '34-spreadsheet-start');

      final picked = pick.file;
      pick.file = const RefusedFile(SpreadsheetRefusal.notUtf8);
      await tap(tester, shownText(ko.spreadsheetChoose));
      await shot(tester, '34a-spreadsheet-refused');

      pick.file = picked;
      await tap(tester, shownText(ko.spreadsheetChoose));
      await shot(tester, '35-spreadsheet-columns');

      await tap(tester, find.text(ko.spreadsheetLabelColumn));
      await shot(tester, '35a-spreadsheet-column-sheet');
      await tap(tester, find.text('C · 품사').last);
      await tap(tester, find.text(ko.spreadsheetExampleColumn));
      await tap(tester, find.text('D · 예문').last);

      await tester.drag(find.byType(CustomScrollView), const Offset(0, -420));
      await tester.pumpAndSettle();
      await shot(tester, '36-spreadsheet-review');

      await tester.tap(shownText(ko.importAdd(7)));
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 50)),
      );
      await tester.pumpAndSettle();
      await shot(tester, '36a-spreadsheet-duplicate');

      await tap(tester, find.byTooltip(ko.close));
      await shot(tester, '36b-spreadsheet-discard');

      await unmount(tester);
      semantics.dispose();
    });

    for (final (scale, suffix) in [(1.0, ''), (3.12, '-largest-text')]) {
      testWidgets('새 노트 at text scale $scale in $mode', skip: !_capture, (
        tester,
      ) async {
        phone(tester);
        tester.platformDispatcher.textScaleFactorTestValue = scale;
        addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
        final db = AppDatabase(NativeDatabase.memory());
        addTearDown(db.close);
        final directory = newMediaDirectory();
        addTearDown(() => deleteMediaDirectory(directory));
        var ids = 0;
        final media = MediaStore(
          db,
          FakeMediaServer(),
          directory: directory,
          clock: DateTime.now,
          newId: () => 'media${ids++}',
        );
        final repository = DeckRepository(
          db,
          clock: DateTime.now,
          newId: () => 'id${ids++}',
          media: media,
        );
        await tester.pumpWidget(
          ProviderScope(
            overrides: [
              deckRepositoryProvider.overrideWithValue(repository),
              mediaStoreProvider.overrideWithValue(media),
              imagePickProvider.overrideWithValue(_OnePick(preparedImage(4))),
            ],
            child: MaterialApp(
              theme: lightTheme,
              darkTheme: darkTheme,
              themeMode: ThemeMode.values.byName(mode),
              locale: const Locale('ko'),
              localizationsDelegates: AppLocalizations.localizationsDelegates,
              supportedLocales: AppLocalizations.supportedLocales,
              home: const NewDeckScreen(),
            ),
          ),
        );
        await tester.pumpAndSettle();
        await shot(tester, '03d-new-deck-open$suffix');
        if (scale > 1) {
          await tester.drag(
            find.byType(Scrollable).first,
            const Offset(0, -900),
          );
          await tester.pumpAndSettle();
          await shot(tester, '03d-new-deck-open$suffix-below');
          await unmount(tester);
          return;
        }
        await tester.enterText(find.byType(EditableText), '화학 기초');
        await tap(tester, find.bySemanticsLabel(ko.deckIconName('flask')));
        await tester.ensureVisible(
          find.bySemanticsLabel(ko.deckColorName('violet')),
        );
        await tester.pumpAndSettle();
        await tap(tester, find.bySemanticsLabel(ko.deckColorName('violet')));
        await tester.drag(find.byType(Scrollable).first, const Offset(0, 900));
        await tester.pumpAndSettle();
        await shot(tester, '03e-new-deck-chosen');
        await tester.ensureVisible(shownText(ko.deckImageFromAlbum));
        await tester.pumpAndSettle();
        await tester.tap(shownText(ko.deckImageFromAlbum));
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 50)),
        );
        await tester.pumpAndSettle();
        await tester.drag(find.byType(Scrollable).first, const Offset(0, 900));
        await tester.pumpAndSettle();
        await shot(tester, '03f-new-deck-photo');
        await unmount(tester);
      });
    }

    testWidgets('several photos in $mode', skip: !_capture, (tester) async {
      final semantics = tester.ensureSemantics();
      phone(tester);
      final db = AppDatabase(NativeDatabase.memory());
      addTearDown(db.close);
      var ids = 0;
      final repository = DeckRepository(
        db,
        clock: DateTime.now,
        newId: () => 'id${ids++}',
      );
      final deck = (await tester.runAsync(
        () => repository.createDeck('영단어 기본'),
      ))!;
      final client = FakeExtractionClient()
        ..todayAllowance = (limit: 30, period: LimitPeriod.day, used: 27);
      final photos = FakePhotoSource()
        ..libraryPhotos = [for (var i = 0; i < 4; i++) Future.value(testPhoto)];
      final preferences = await openPreferences(tester);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [deckRepositoryProvider.overrideWithValue(repository)],
          child: MaterialApp(
            theme: lightTheme,
            darkTheme: darkTheme,
            themeMode: ThemeMode.values.byName(mode),
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: Builder(
              builder: (context) => Scaffold(
                body: Center(
                  child: TextButton(
                    onPressed: () => importFromPhoto(
                      context,
                      imports: PhotoImports(
                        client: client,
                        photos: photos,
                        preferences: preferences,
                        store: MemoryImportJobStore(),
                        decks: repository,
                      ),
                      deck: deck.id,
                      origin: PhotoOrigin.album,
                    ),
                    child: const Text('open'),
                  ),
                ),
              ),
            ),
          ),
        ),
      );

      /// Pumps frames past what a read changes, as the bar never settles.
      Future<void> frames() async {
        for (var frame = 0; frame < 5; frame++) {
          await tester.pump(const Duration(milliseconds: 200));
        }
      }

      await tester.tap(shownText('open'));
      await frames();
      client.calls[0].answer.complete([
        word(front: 'face', meaning: '직면하다', partOfSpeech: '[동]'),
        word(front: 'include', meaning: '포함하다', partOfSpeech: '[동]'),
      ]);
      await frames();
      client.calls[1].answer.completeError(const ModelFailed());
      await frames();
      await shot(tester, '26-photo-reading');

      client.calls[2].answer.complete([
        word(front: 'strategy', meaning: '전략, 계획', partOfSpeech: '[명]'),
        word(front: 'in addition', meaning: '~뿐만 아니라', topic: '빈출 숙어'),
      ]);
      await frames();
      await tester.tap(shownText(ko.photoDrop));
      await tester.pumpAndSettle();
      await shot(tester, '26a-photo-groups');
      await tap(tester, find.bySemanticsLabel(ko.photoView(1)));
      await shot(tester, '26b-photo-viewer');

      await unmount(tester);
      semantics.dispose();
    });

    testWidgets('photo import unavailable in $mode', skip: !_capture, (
      tester,
    ) async {
      final semantics = tester.ensureSemantics();
      phone(tester);
      final db = AppDatabase(NativeDatabase.memory());
      addTearDown(db.close);
      var ids = 0;
      final repository = DeckRepository(
        db,
        clock: DateTime.now,
        newId: () => 'id${ids++}',
      );
      final deck = (await tester.runAsync(
        () => repository.createDeck('영단어 기본'),
      ))!;
      final client = FakeExtractionClient();
      final photos = FakePhotoSource()
        ..libraryPhotos = [for (var i = 0; i < 3; i++) Future.value(testPhoto)];
      final preferences = await openPreferences(tester);
      Widget start(PhotoOrigin origin) => Builder(
        builder: (context) => TextButton(
          onPressed: () => importFromPhoto(
            context,
            imports: PhotoImports(
              client: client,
              photos: photos,
              preferences: preferences,
              store: MemoryImportJobStore(),
              decks: repository,
            ),
            deck: deck.id,
            origin: origin,
          ),
          child: Text(origin.name),
        ),
      );
      Future<void> frames() async {
        for (var frame = 0; frame < 5; frame++) {
          await tester.pump(const Duration(milliseconds: 200));
        }
      }

      for (final origin in [PhotoOrigin.camera, PhotoOrigin.album]) {
        await tester.pumpWidget(
          ProviderScope(
            overrides: [deckRepositoryProvider.overrideWithValue(repository)],
            child: MaterialApp(
              key: ValueKey(origin),
              theme: lightTheme,
              darkTheme: darkTheme,
              themeMode: ThemeMode.values.byName(mode),
              localizationsDelegates: AppLocalizations.localizationsDelegates,
              supportedLocales: AppLocalizations.supportedLocales,
              home: Scaffold(body: Center(child: start(origin))),
            ),
          ),
        );
        client.calls.clear();
        await tester.tap(find.text(origin.name));
        await frames();
        // Each photo read in its turn fails as the function answers 503.
        while (client.open.isNotEmpty) {
          client.open.first.answer.completeError(const ExtractionUnavailable());
          await frames();
        }
        await tester.pumpAndSettle();
        await shot(
          tester,
          origin == PhotoOrigin.camera
              ? '24a-photo-unavailable'
              : '26c-photo-all-unavailable',
        );
        if (origin == PhotoOrigin.camera) {
          await largest(tester, '24a-photo-unavailable');
        }
      }
      await unmount(tester);
      semantics.dispose();
    });

    testWidgets('the photo import bar in $mode', skip: !_capture, (
      tester,
    ) async {
      phone(tester);
      SharedPreferencesAsyncPlatform.instance =
          InMemorySharedPreferencesAsync.withData({
            'themeMode': mode,
            studyCoachShownKey: true,
            dailyMinutesAskedKey: true,
          });
      final storage = (await tester.runAsync(
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
      // As a closed app left it: the first of three photos read.
      final store = MemoryImportJobStore()
        ..photos.addAll({
          for (final key in ['p0', 'p1', 'p2']) key: testPhoto.bytes,
        })
        ..state = jsonEncode({
          'version': 1,
          'target': null,
          'origin': 'album',
          'photos': [
            for (final key in ['p0', 'p1', 'p2'])
              {
                'key': key,
                'width': testPhoto.width,
                'height': testPhoto.height,
                if (key == 'p0') 'cards': <Object?>[],
              },
          ],
        });
      final client = FakeExtractionClient();
      await tester.pumpWidget(
        composeApp(
          NativeDatabase.memory(),
          scheduler,
          FakeAccountService(
            const SignedIn(userId: _ada, email: 'ada@example.com'),
          ),
          FakeSyncServer(_ada),
          storage,
          client,
          store,
          FakeSharingServer(),
          FakeReachability(),
          const UnavailableMediaServer(),
          unusedMediaDirectory,
          '1.0.0',
        ),
      );
      await tester.pumpAndSettle();
      await shot(tester, '27-photo-resume');

      // A deck, so the bar shows above the tab bar.
      await dismissSheet(tester);
      await tap(tester, shownText(ko.newDeckTitle));
      await tester.enterText(find.byType(EditableText), '영단어 기본');
      // Saving opens the deck, which back leaves.
      await tap(tester, shownText(ko.save));
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      await shot(tester, '27a-photo-bar-paused');

      await tap(tester, find.text(ko.importBarPaused(2)));
      await tap(tester, shownText(ko.resumeImport));
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      await shot(tester, '27b-photo-bar-reading');

      client.calls[0].answer.complete([
        word(front: 'face', meaning: '직면하다', partOfSpeech: '[동]'),
        word(front: 'include', meaning: '포함하다', partOfSpeech: '[동]'),
      ]);
      client.calls[1].answer.complete([
        word(front: 'strategy', meaning: '전략, 계획', partOfSpeech: '[명]'),
      ]);
      await tester.pumpAndSettle();
      await shot(tester, '27c-photo-bar-ready');

      // Disposing sync cancels the run the deck's write scheduled.
      ProviderScope.containerOf(
        tester.element(find.byType(AccountGate, skipOffstage: false)),
      ).read(syncControllerProvider).dispose();
      await unmount(tester);
    });

    testWidgets('sharing in $mode', skip: !_capture, (tester) async {
      phone(tester);
      final db = AppDatabase(NativeDatabase.memory());
      addTearDown(db.close);
      var ids = 0;
      final repository = DeckRepository(
        db,
        clock: DateTime.now,
        newId: () => 'id${ids++}',
      );
      await tester.runAsync(() async {
        final deck = await repository.createDeck('영단어 기본');
        await repository.addCard(
          deck.id,
          front: [const TextContent('lucid')],
          back: [const TextContent('명쾌한')],
        );
      });
      final spanish = publicDeck(
        'spanish',
        name: '스페인어 동물',
        ownerName: '보라',
        description: '자주 쓰는 동물 이름',
        cards: 3,
        copies: 12,
      );
      final server = FakeSharingServer(
        decks: [
          spanish,
          publicDeck(
            'jlpt',
            name: 'JLPT N3 한자',
            ownerName: '민준',
            owner: '00000000-0000-4000-8000-00000000000c',
            cards: 240,
            copies: 3,
            publishedAt: DateTime.utc(2026, 10, 14),
          ),
        ],
        cards: {
          spanish.id: [
            publicCard('perro', '개'),
            publicCard('gato', '고양이'),
            publicCard('pez', '물고기'),
          ],
        },
      );
      final sharing = SharingService(
        server: server,
        decks: repository,
        reachability: FakeReachability(),
        clock: DateTime.now,
      );
      final storage = await openStudyStorage(tester);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            deckRepositoryProvider.overrideWithValue(repository),
            sharingServiceProvider.overrideWithValue(sharing),
            ...homeOverrides(db, storage: storage),
          ],
          child: MaterialApp(
            theme: lightTheme,
            darkTheme: darkTheme,
            themeMode: ThemeMode.values.byName(mode),
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: const HomeScreen(),
          ),
        ),
      );
      await tester.pumpAndSettle();

      await showNotes(tester);
      await tap(tester, shownText('영단어 기본'));
      await tap(tester, find.byTooltip(ko.deckActions));
      await shot(tester, '25-deck-menu-publish');
      await tap(tester, shownText(ko.publish));
      await shot(tester, '26-publish-sheet');
      await tester.enterText(
        widgetWithShownText(AppTextField, ko.displayName),
        '아다',
      );
      await tap(
        tester,
        find.byWidgetPredicate(
          (widget) =>
              widget is Text &&
              widget.data?.replaceAll('\u2060', '') == ko.publishAgreement,
        ),
      );
      await tap(tester, shownText(ko.publishConfirm));
      await tester.pump(const Duration(seconds: 5));
      await tester.pumpAndSettle();
      await shot(tester, '27-card-list-public');
      // The note is on 노트's own navigator, under the app's.
      tester.state<NavigatorState>(find.byType(Navigator).last).pop();
      await tester.pumpAndSettle();
      await shot(tester, '28-deck-list-public');

      await tap(tester, find.byTooltip(ko.notesActions));
      await shot(tester, '28b-notes-menu');
      await largest(tester, '28b-notes-menu');
      await tap(tester, shownText(ko.browsePublicDecks));
      await shot(tester, '29-browse');
      await tap(tester, find.text('스페인어 동물'));
      await shot(tester, '30-public-deck');
      await largest(tester, '30-public-deck');
      // Its cards, reached by scrolling at the largest text size.
      tester.platformDispatcher.textScaleFactorTestValue = 3.12;
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(
        shownText('물고기'),
        100,
        scrollable: find.byType(Scrollable).first,
      );
      await shot(tester, '30-public-deck-largest-text-below');
      tester.platformDispatcher.clearTextScaleFactorTestValue();
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(
        find.text('스페인어 동물'),
        -100,
        scrollable: find.byType(Scrollable).first,
      );
      await tap(tester, shownText(ko.copyToMyDecks));
      await tap(tester, find.text(ko.copyIntoExistingDeck));
      await shot(tester, '31-import-sheet');
      // Above a tall sheet, where the barrier's centre is not.
      await tester.tapAt(const Offset(20, 100));
      await tester.pumpAndSettle();
      await tap(tester, find.byTooltip(ko.deckActions));
      await tap(tester, find.text(ko.reportDeck));
      await shot(tester, '32-report-sheet');
      // Above a tall sheet, where the barrier's centre is not.
      await tester.tapAt(const Offset(20, 100));
      await tester.pumpAndSettle();
      await tap(tester, find.byTooltip(ko.deckActions));
      await tap(tester, find.text(ko.blockUser));
      await shot(tester, '33-block-confirm');
      // Above a tall sheet, where the barrier's centre is not.
      await tester.tapAt(const Offset(20, 100));
      await tester.pumpAndSettle();

      await unmount(tester);
    });
  }
}

/// A Korean paragraph of at least [length] characters, ending at a word.
String _longKorean(int length) {
  const text =
      '광합성은 식물이 빛 에너지를 이용해 이산화탄소와 물로부터 포도당을 만드는 과정이다. '
      '엽록체의 틸라코이드 막에서 일어나는 명반응은 빛을 흡수해 물을 분해하고 산소를 내보내며 '
      'ATP와 NADPH를 만든다. 스트로마에서 일어나는 캘빈 회로는 이 에너지를 써서 이산화탄소를 '
      '고정하고 포도당을 합성한다. 빛의 세기, 이산화탄소 농도, 온도는 광합성 속도를 결정하는 '
      '주요 요인이며, 이 중 가장 부족한 요인이 전체 속도를 제한한다. 이를 최소량의 법칙이라고 '
      '부른다. 따라서 온실에서 작물을 키울 때는 빛을 충분히 비추는 것만으로는 부족하고, '
      '이산화탄소를 공급하고 온도를 알맞게 유지해야 수확량이 늘어난다. 또한 식물은 낮에 만든 '
      '포도당을 녹말로 바꾸어 저장하고, 밤에는 이를 다시 분해해 호흡에 쓴다. '
      '잎의 기공은 이산화탄소를 들이고 수증기를 내보내는 통로인데, 날이 가물면 기공이 닫혀 '
      '광합성이 줄어든다.';
  final end = text.indexOf(' ', length);
  return end < 0 ? text : text.substring(0, end);
}

/// A vocabulary card's back of several senses, each with its examples.
const _runSenses = SensesContent([
  CardSense(
    labels: [PartOfSpeechLabel(PartOfSpeech.verb, '동')],
    meaning: '달리다, 뛰다',
    examples: ['She runs every morning.', 'He ran to catch the bus.'],
  ),
  CardSense(
    labels: [PartOfSpeechLabel(PartOfSpeech.verb, '동')],
    meaning: '운영하다, 경영하다',
    examples: ['They run a small bakery downtown.'],
  ),
  CardSense(
    labels: [PartOfSpeechLabel(PartOfSpeech.verb, '동')],
    meaning: '(기계가) 작동하다, 돌아가다',
    examples: ['The engine is running smoothly.'],
  ),
  CardSense(
    labels: [PartOfSpeechLabel(PartOfSpeech.noun, '명')],
    meaning: '달리기, 뛰기; 연속, 연이은 기간',
    examples: ['I go for a run after work.', 'a run of bad luck'],
  ),
]);
