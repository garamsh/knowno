import 'dart:math';
import 'dart:async';

import 'package:drift/drift.dart' show driftRuntimeOptions;
import 'package:drift/native.dart';
import 'package:flutter/material.dart' hide Card;
import 'package:flutter/rendering.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:knowno/database/database.dart';
import 'package:knowno/deck/deck.dart';
import 'package:knowno/design/app_button.dart';
import 'package:knowno/design/app_section_label.dart';
import 'package:knowno/study/src/card_preview_screen.dart';
import 'package:knowno/study/src/completion_card.dart';
import 'package:knowno/study/src/coach_hand_drawing.dart';
import 'package:knowno/study/src/study_coach.dart';
import 'package:knowno/design/mascot.dart';
import 'package:knowno/design/theme.dart';
import 'package:knowno/design/word_break.dart';
import 'package:knowno/l10n/app_localizations.dart';
import 'package:knowno/media/media.dart';
import 'package:knowno/study/src/current_card.dart';
import 'package:knowno/study/src/model.dart';
import 'package:knowno/study/src/previous_card.dart';
import 'package:knowno/study/src/previous_placeholder.dart';
import 'package:knowno/study/src/providers.dart';
import 'package:knowno/study/src/queue.dart';
import 'package:knowno/study/src/rust/api/engine.dart';
import 'package:knowno/study/src/scheduler.dart';
import 'package:knowno/study/src/study_repository.dart';
import 'package:knowno/study/src/study_screen.dart';
import 'package:knowno/study/src/study_style.dart';
import 'package:knowno/study/src/today_overview.dart';

import '../contrast.dart';
import '../deck/whole_cards.dart';
import '../media/fakes.dart';
import '../word_breaks.dart';
import 'fixtures.dart';
import 'study_storage.dart';

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

/// Reads no state and never finishes a write.
class _StalledRepository implements StudyRepository {
  var _ids = 0;
  final records = <CardId>[];

  @override
  ReviewId newReviewId() => ReviewId('review${_ids++}');

  Future<void> _writes = Future.value();

  @override
  Future<void> queueWrite(Future<void> Function() write) =>
      _writes = _writes.then((_) => write());

  @override
  Future<Map<CardId, CardState>> statesOf(List<CardId> cards) async => {};

  @override
  Future<void> record(
    CardId card,
    List<Review> reviews,
    CardState state, {
    required DateTime at,
  }) {
    records.add(card);
    return Completer<void>().future;
  }

  @override
  Future<int?> dailyMinutes() async => defaultDailyMinutes;

  @override
  Future<void> setDailyMinutes(int minutes, {required DateTime at}) async {}

  @override
  Future<Map<CardId, CardState>> allStates() async => {};

  @override
  Future<Map<CardId, DateTime>> latestAnswersBefore(
    List<CardId> cards,
    DateTime end,
  ) async => {};

  @override
  Future<List<TimedAnswer>> answersBetween(DateTime from, DateTime to) async =>
      [];

  @override
  Future<List<StoredAnswer>> answersSince(DateTime since) async => [];

  @override
  Future<DateTime?> latestAnswerBefore(DateTime end) async => null;

  @override
  Future<List<ReviewRow>> reviews() async => [];
}

/// Schedules as [_InstantScheduler] does, and keeps every answer it is asked
/// to schedule, in order.
class _RecordingScheduler extends _InstantScheduler {
  final answers = <Answer>[];

  @override
  Future<CardState> review(
    CardState? state,
    Answer answer,
    DateTime at, {
    required FuzzFactor fuzz,
  }) {
    answers.add(answer);
    return super.review(state, answer, at, fuzz: fuzz);
  }
}

/// A phone in portrait: 390 by 844 logical pixels.
const _phone = Size(390, 844);

class _Study {
  _Study(this.tester, this.db, this.navigator, this.decks, this.storage);

  final WidgetTester tester;
  final AppDatabase db;
  final GlobalKey<NavigatorState> navigator;
  final DeckSelection decks;

  /// The device storage the screen keeps whether its coach has shown in.
  final SharedPreferencesWithCache storage;
  DateTime now = DateTime.utc(2026, 10, 14, 9);

  /// Drags the current card [dx] to the side over [duration], slowly enough
  /// that the release is no fling, then lets every animation finish.
  Future<void> swipe(
    double dx, {
    Duration elapsed = Duration.zero,
    Duration duration = const Duration(seconds: 1),
  }) async {
    now = now.add(elapsed);
    await tester.timedDrag(_currentCard, Offset(dx, 0), duration);
    await tester.pumpAndSettle();
  }

  Future<void> know({Duration elapsed = Duration.zero}) =>
      swipe(200, elapsed: elapsed);

  Future<void> dontKnow({Duration elapsed = Duration.zero}) =>
      swipe(-200, elapsed: elapsed);

  /// Closes the screen and lets the answers it queued land.
  Future<void> close() async {
    navigator.currentState!.pop();
    await tester.pumpAndSettle();
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(milliseconds: 50)),
    );
  }

  /// The 오늘 tab's overview of the same decks, read as it reads it.
  Future<TodayOverview> overview() async {
    TodayOverview? read;
    unawaited(
      navigator.currentState!.push(
        MaterialPageRoute<void>(
          builder: (_) => TodayOverviewReader(
            decks: decks,
            builder: (context, overview) {
              if (overview is TodayOverview) read = overview;
              return const SizedBox();
            },
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    navigator.currentState!.pop();
    await tester.pumpAndSettle();
    return read!;
  }

  /// Closes the screen, lets the answers it queued land, and opens a new
  /// session over the same decks.
  Future<void> reopen() async {
    await close();
    unawaited(
      navigator.currentState!.push(
        MaterialPageRoute<void>(builder: (_) => StudyScreen(decks: decks)),
      ),
    );
    await tester.pumpAndSettle();
  }

  /// The front of the card under study, or null when none is.
  String? get current {
    // The text as written, without the joiners `keepWords` draws it with.
    String? shown(Widget widget) => widget is Text
        ? (widget.data ?? widget.textSpan?.toPlainText())?.replaceAll('⁠', '')
        : null;
    final fronts = find.descendant(
      of: _currentCard,
      matching: find.byWidgetPredicate(
        (widget) => RegExp(r'^\w+ front$').hasMatch(shown(widget) ?? ''),
      ),
    );
    return fronts.evaluate().isEmpty
        ? null
        : shown(fronts.evaluate().single.widget);
  }
}

final _currentCard = find.byType(CurrentCard);

/// The current card's semantics, without the guide's row's.
final _cardNode = find
    .descendant(of: _currentCard, matching: find.byType(Semantics))
    .first;

/// The current card's face, without the guide's row under it.
final _face = find
    .descendant(of: _currentCard, matching: find.byType(GestureDetector))
    .first;

/// Opens a study session over a deck holding a card for each of [cards],
/// created oldest first, with "name front" and "name back" as its sides unless
/// [sides] gives them.
Future<_Study> _open(
  WidgetTester tester,
  List<String> cards, {
  Map<String, (List<Content>, List<Content>)> sides = const {},
  StudyRepository Function(AppDatabase db)? repository,
  Scheduler? scheduler,
  Map<String, CardState> states = const {},
  Size size = _phone,
  double textScale = 1,
  bool disableAnimations = false,
  Locale locale = const Locale('en'),
  ThemeMode themeMode = ThemeMode.light,
  bool coachShown = true,
  bool? autoplay,
  AudioPlayback? playback,
  int answeredElsewhere = 0,
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final db = AppDatabase(NativeDatabase.memory());
  var created = DateTime.utc(2026, 9, 1);
  var ids = 0;
  var blockIds = 0;
  final deckRepository = DeckRepository(
    db,
    clock: () => created = created.add(const Duration(minutes: 1)),
    newId: () => 'id${ids++}',
    newBlockId: () => 'block${blockIds++}',
  );
  final studyRepository =
      (repository ??
      (db) => StudyRepository(db, newId: () => 'review${ids++}'))(db);
  final seeding = StudyRepository(db, newId: () => 'seed${ids++}');
  final deck = (await tester.runAsync(() async {
    final deck = await deckRepository.createDeck('French');
    // 5 minutes at 10 s a card, the pace while too few answers are stored:
    // [_quota] new cards a day.
    await seeding.setDailyMinutes(5, at: created);
    // Cards of another deck answered today, which take the day's new cards.
    if (answeredElsewhere > 0) {
      final other = await deckRepository.createDeck('Spanish');
      for (var i = 0; i < answeredElsewhere; i++) {
        final saved = await deckRepository.addCard(
          other.id,
          front: [TextContent('s$i front')],
          back: [TextContent('s$i back')],
        );
        if (saved case CardSaved(:final card)) {
          await seeding.record(
            card.id,
            [
              Review(
                id: seeding.newReviewId(),
                cardId: card.id,
                answer: Answer.know,
                reviewedAt: _answeredToday.lastReview,
                duration: Duration.zero,
                fuzzFactor: FuzzFactor.draw(FirstDraw()),
              ),
            ],
            _answeredToday,
            at: DateTime.utc(2026, 9, 1),
          );
        }
      }
    }
    for (final name in cards) {
      final (front, back) =
          sides[name] ??
          ([TextContent('$name front')], [TextContent('$name back')]);
      final saved = await deckRepository.addCard(
        deck.id,
        front: front,
        back: back,
      );
      if (saved case CardSaved(:final card) when states.containsKey(name)) {
        await seeding.record(
          card.id,
          [
            Review(
              id: seeding.newReviewId(),
              cardId: card.id,
              answer: Answer.know,
              reviewedAt: states[name]!.lastReview,
              duration: Duration.zero,
              fuzzFactor: FuzzFactor.draw(FirstDraw()),
            ),
          ],
          states[name]!,
          at: DateTime.utc(2026, 9, 1),
        );
      }
    }
    return deck;
  }))!;
  final storage = await openStudyStorage(
    tester,
    coachShown: coachShown,
    autoplay: autoplay,
  );
  final navigator = GlobalKey<NavigatorState>();
  final study = _Study(tester, db, navigator, DeckSelection(deck.id), storage);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        deckRepositoryProvider.overrideWithValue(deckRepository),
        studyRepositoryProvider.overrideWithValue(studyRepository),
        schedulerProvider.overrideWithValue(scheduler ?? _InstantScheduler()),
        studyClockProvider.overrideWithValue(() => study.now),
        studyZoneProvider.overrideWithValue((_) => Duration.zero),
        studyRandomProvider.overrideWithValue((_) => FirstDraw()),
        studyStorageProvider.overrideWithValue(storage),
        if (playback != null) audioPlaybackProvider.overrideWithValue(playback),
        // No photo is stored, so a card's photo is drawn as its fallback.
        mediaStoreProvider.overrideWithValue(
          MediaStore(
            db,
            FakeMediaServer(),
            directory: unusedMediaDirectory,
            clock: () => study.now,
            newId: () => 'media${ids++}',
          ),
        ),
      ],
      child: MaterialApp(
        navigatorKey: navigator,
        theme: lightTheme,
        darkTheme: darkTheme,
        themeMode: themeMode,
        locale: locale,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(context).copyWith(
            textScaler: TextScaler.linear(textScale),
            disableAnimations: disableAnimations,
          ),
          child: child!,
        ),
        home: const Scaffold(),
      ),
    ),
  );
  unawaited(
    navigator.currentState!.push(
      MaterialPageRoute<void>(
        builder: (_) => StudyScreen(decks: DeckSelection(deck.id)),
      ),
    ),
  );
  if (coachShown) {
    await tester.pumpAndSettle();
  } else {
    // The coach's demonstration repeats, so the screen never settles: it is
    // pumped until the session has loaded and the route is in.
    for (var i = 0; i < 20 && find.byType(StudyCoach).evaluate().isEmpty; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }
    await tester.pump(const Duration(milliseconds: 500));
  }
  return study;
}

/// The previous card whose front reads [front].
Finder _previous(String front) => find.byWidgetPredicate(
  (widget) =>
      widget is Semantics &&
      (widget.properties.label?.startsWith(_justSeen) ?? false) &&
      widget.properties.label!.contains('. Front: $front. Back:'),
  skipOffstage: false,
);

/// How the previous card's label begins, before its grade (ADR 0151).
const _justSeen = 'Card just seen, ';

/// A previous card's label naming [answer] first, and "Changed" last when
/// [changed].
Matcher _gradedAs(String answer, {bool changed = false}) => allOf(
  startsWith('$_justSeen$answer. Front: '),
  changed ? endsWith('. Changed') : isNot(endsWith('. Changed')),
);

String? _label(WidgetTester tester, Finder finder) =>
    tester.widget<Semantics>(finder).properties.label;

/// The card's horizontal offset from its place.
double _dragOffset(WidgetTester tester, Finder card) => tester
    .widget<Transform>(
      find.descendant(of: card, matching: find.byType(Transform)).first,
    )
    .transform
    .getTranslation()
    .x;

/// The previous card on screen.
final _previousCard = find.byType(PreviousCardView);

/// The fronts of every previous card built, and "current" when the current
/// card is.
List<String> _built(WidgetTester tester) => [
  for (final element
      in find
          .byWidgetPredicate(
            (widget) =>
                widget is Semantics &&
                ((widget.properties.label?.startsWith(_justSeen) ?? false) ||
                    (widget.properties.label?.contains('. Response: ') ??
                        false)),
            skipOffstage: false,
          )
          .evaluate())
    RegExp(r'Front: (.*?)\. Back:')
        .firstMatch((element.widget as Semantics).properties.label!)![1]!,
  if (_currentCard.evaluate().isNotEmpty) 'current',
];

/// The height each card takes on a 390 by 844 screen with no insets: half
/// the space between the top bar and the guide's row, less the gaps.
final _cardHeight =
    (_phone.height -
        StudyStyle.topBarHeight -
        StudyStyle.topGap -
        StudyStyle.cardGap -
        StudyStyle.guideRow -
        StudyStyle.currentBottomGap) /
    2;

/// Performs the screen reader's custom action [label] on [finder]'s node.
Future<void> _act(WidgetTester tester, Finder finder, String label) async {
  final node = tester.getSemantics(finder);
  node.owner!.performAction(
    node.id,
    SemanticsAction.customAction,
    CustomSemanticsAction.getIdentifier(CustomSemanticsAction(label: label)),
  );
  await tester.pumpAndSettle();
}

const _sentence =
    'This sentence is long enough to wrap across the width of half a card. ';

void main() {
  driftRuntimeOptions.dontWarnAboutMultipleDatabases = true;

  testWidgets(
    'the screen shows the top bar, the current card in the lower of the two card places and the guide\'s replay alone, centred under it, with no answer button',
    (tester) async {
      final study = await _open(tester, ['a', 'b']);

      expect(find.byTooltip('Close'), findsOneWidget);
      expect(find.byType(LinearProgressIndicator), findsOneWidget);
      final card = tester.getRect(_face);
      expect(card.width, _phone.width - 2 * StudyStyle.cardMargin);
      expect(card.height, closeTo(_cardHeight, 0.01));
      expect(
        card.top,
        closeTo(
          StudyStyle.topBarHeight +
              StudyStyle.topGap +
              _cardHeight +
              StudyStyle.cardGap,
          0.01,
        ),
      );
      // Every text on screen: the card's front alone, the count, the coach's
      // replay and the empty previous card's place's line. No answer button,
      // back, deck name or next card.
      expect(
        {
          for (final element in find.byType(Text).evaluate())
            ((element.widget as Text).data ??
                    (element.widget as Text).textSpan?.toPlainText())
                ?.replaceAll(_wordJoiner, ''),
        },
        {'a front', '0/2', 'Show the guide again', _placeholder},
      );
      // No half, divider or eye on the card.
      expect(
        find.descendant(of: _face, matching: find.byType(VerticalDivider)),
        findsNothing,
      );
      expect(
        find.descendant(of: _face, matching: find.byType(Icon)),
        findsNothing,
      );
      // The replay is the one button under the card, centred, at a tap
      // target's size.
      expect(find.byType(TextButton), findsOneWidget);
      final replay = tester.getRect(
        widgetWithShownText(TextButton, 'Show the guide again'),
      );
      expect(replay.top, greaterThan(card.bottom));
      expect(replay.center.dx, closeTo(card.center.dx, 0.01));
      expect(replay.height, greaterThanOrEqualTo(AppSize.tapTarget));
      expect(study.current, 'a front');
    },
  );

  testWidgets(
    'a day\'s first session holds the previous card\'s place with a dashed outline, an up arrow and one line, read as one block, until its first answer',
    (tester) async {
      final study = await _open(tester, ['a', 'b', 'c']);

      expect(find.byType(PreviousPlaceholder), findsOneWidget);
      expect(
        find.descendant(
          of: find.byType(PreviousPlaceholder),
          matching: find.byIcon(LucideIcons.arrowUp),
        ),
        findsOneWidget,
      );
      expect(
        tester.getRect(shownText(_placeholder)).bottom,
        lessThan(tester.getRect(_currentCard).top),
      );
      expect(find.bySemanticsLabel(_placeholder), findsOneWidget);
      // No card, label or notice of an earlier session.
      expect(shownText(_earlier), findsNothing);
      expect(find.textContaining('Picking up'), findsNothing);

      await study.know();
      expect(find.byType(PreviousPlaceholder), findsNothing);
      expect(_previous('a front'), findsOneWidget);
      // A "Don't know", which puts its card back, leaves it gone too.
      await study.dontKnow();
      expect(find.byType(PreviousPlaceholder), findsNothing);
    },
  );

  testWidgets(
    'on a 390 wide phone the coach\'s Korean lines break only between words',
    (tester) async {
      await _open(
        tester,
        ['a', 'b', 'c'],
        locale: const Locale('ko'),
        coachShown: false,
      );
      await tester.tap(shownText('다음'));
      await tester.pump();
      await tester.tap(shownText('다음'));
      await tester.pump();
      const rise = '응답한 카드는 위로 올라와요. 밀어서 응답을 바꿀 수 있어요';
      final paragraph = tester.renderObject<RenderParagraph>(
        find.descendant(of: shownText(rise), matching: find.byType(RichText)),
      );
      final plain = paragraph.text.toPlainText();
      // The paragraph's own text laid out at its width, to read its lines.
      final lines = TextPainter(
        text: paragraph.text,
        textDirection: paragraph.textDirection,
        textScaler: paragraph.textScaler,
      )..layout(maxWidth: paragraph.size.width);
      addTearDown(lines.dispose);
      final ends = <int>[];
      for (var offset = 0; offset < plain.length;) {
        offset = lines.getLineBoundary(TextPosition(offset: offset)).end;
        ends.add(offset);
      }

      // The line wraps at this width, so where it breaks is tested.
      expect(ends.length, greaterThan(1));
      for (final end in ends.take(ends.length - 1)) {
        expect(
          plain[end - 1] == ' ' || plain[end] == ' ',
          isTrue,
          reason: 'a break at $end in "$plain"',
        );
      }
    },
  );

  testWidgets(
    'a session opened with no card left today starts on the next new card, under the day\'s last card from an earlier session, until its first answer',
    (tester) async {
      // The day's new cards all answered today, and two more.
      final (names, states) = _deck(_quota + 2, today: _quota);
      final study = await _open(tester, names, states: states);

      expect(shownText('Done for today'), findsNothing);
      expect(study.current, 'c30 front');
      // The day's count stays at the cards answered today; the new cards
      // past them count apart once answered.
      expect(shownText('30/30'), findsOneWidget);
      expect(shownText('+1 extra'), findsNothing);
      expect(shownText(_earlier), findsOneWidget);
      expect(find.byType(PreviousPlaceholder), findsNothing);
      // No card is left of the day's, so nothing goes on to announce.
      expect(find.textContaining('Picking up'), findsNothing);

      await study.know();
      expect(study.current, 'c31 front');
      expect(shownText('30/30'), findsOneWidget);
      expect(shownText('+1 extra'), findsOneWidget);
      expect(shownText(_earlier), findsNothing);
      expect(_previous('c30 front'), findsOneWidget);
    },
  );

  for (final scale in [1.0, 3.12]) {
    testWidgets(
      'at text scale $scale the day\'s last card from an earlier session '
      'names itself at its foot, under its sides and never over them',
      (tester) async {
        final (names, states) = _deck(_quota + 2, today: _quota);
        await _open(tester, names, states: states, textScale: scale);
        final label = find.descendant(
          of: shownText(_earlier),
          matching: find.byType(RichText),
        );
        expect(label, findsOneWidget, reason: 'setup');

        // The sides scroll inside the card where they are taller than it,
        // so what shows of them is the scroll's viewport.
        final face = find.descendant(
          of: find.byType(EarlierCardView),
          matching: find.byType(Scrollable),
        );
        expect(face, findsOneWidget, reason: 'setup: the sides are drawn');
        expect(tester.getRect(face).overlaps(tester.getRect(label)), isFalse);
      },
    );

    testWidgets(
      'at text scale $scale the top bar holds the close, the bar and both '
      'counts on the screen, the counts shrunk only where they do not fit',
      (tester) async {
        final (names, states) = _deck(_quota + 2, today: _quota);
        final study = await _open(
          tester,
          names,
          states: states,
          textScale: scale,
        );
        await study.know();
        expect(shownText('+1 extra'), findsOneWidget, reason: 'setup');

        expect(tester.takeException(), isNull);
        for (final count in ['30/30', '+1 extra']) {
          expect(
            tester.getRect(shownText(count)).right,
            lessThanOrEqualTo(_phone.width),
            reason: count,
          );
        }
        expect(
          tester.getSize(find.byType(LinearProgressIndicator)).width,
          greaterThan(0),
        );
      },
    );
  }

  testWidgets(
    "the day's bar is full when another deck's answers took the day's new cards, as the web draws it",
    (tester) async {
      final study = await _open(tester, ['n'], answeredElsewhere: _quota);
      // The setup's case: no card of this deck in the day's plan, and its
      // new card past it on screen.
      expect(study.current, 'n front');
      expect(shownText('0/0'), findsOneWidget);
      expect(
        tester
            .widget<LinearProgressIndicator>(
              find.byType(LinearProgressIndicator),
            )
            .value,
        1,
      );
    },
  );

  testWidgets('a tap on the current card shows no answer', (tester) async {
    final study = await _open(tester, ['a', 'b']);

    await tester.tap(_face);
    await tester.pumpAndSettle();
    expect(shownText('a front'), findsOneWidget);
    expect(shownText('a back'), findsNothing);
    expect(study.current, 'a front', reason: 'a tap answers nothing');

    // Control: the back shows once answered, on the previous card.
    await study.know();
    expect(
      find.descendant(of: _previousCard, matching: shownText('a back')),
      findsOneWidget,
    );
  });

  testWidgets(
    "a swipe right past the threshold answers Know and a swipe left Don't know",
    (tester) async {
      final study = await _open(tester, ['a', 'b', 'c']);

      await study.swipe(StudyStyle.commitDistance + 10);
      expect(study.current, 'b front');
      expect(_label(tester, _previous('a front')), _gradedAs('Know'));

      await study.swipe(-(StudyStyle.commitDistance + 10));
      expect(study.current, 'c front');
      expect(_label(tester, _previous('b front')), _gradedAs("Don't know"));
      // Done counts the cards whose latest answer today is "Know".
      expect(shownText('1/3'), findsOneWidget);
    },
  );

  testWidgets(
    'a drag short of the threshold springs back in both directions and answers nothing',
    (tester) async {
      final study = await _open(tester, ['a', 'b']);

      for (final dx in [
        StudyStyle.commitDistance - 10,
        -(StudyStyle.commitDistance - 10),
      ]) {
        final gesture = await tester.startGesture(
          tester.getCenter(_currentCard),
        );
        for (var moved = 0; moved < 10; moved++) {
          await gesture.moveBy(Offset(dx / 10, 0), timeStamp: Duration.zero);
          await tester.pump(const Duration(milliseconds: 100));
        }
        // The card follows the finger and shows the answer it would give.
        expect(_dragOffset(tester, _currentCard), closeTo(dx, 0.01));
        expect(
          find.descendant(
            of: _face,
            matching: shownText(dx > 0 ? 'Know' : "Don't know"),
          ),
          findsOneWidget,
        );
        await tester.pump(const Duration(milliseconds: 300));
        await gesture.up();
        await tester.pumpAndSettle();

        expect(_dragOffset(tester, _currentCard), 0);
        expect(study.current, 'a front');
        expect(_previous('a front'), findsNothing);
      }
    },
  );

  testWidgets('a short fling commits in its direction', (tester) async {
    final study = await _open(tester, ['a', 'b', 'c']);

    await tester.fling(_currentCard, const Offset(-60, 0), 1500);
    await tester.pumpAndSettle();
    expect(study.current, 'b front');
    expect(_label(tester, _previous('a front')), _gradedAs("Don't know"));

    // Control: the same distance without the speed springs back.
    await study.swipe(60);
    expect(study.current, 'b front');
  });

  testWidgets(
    'long content scrolls inside the current card, which keeps its size whatever its content',
    (tester) async {
      final long = [TextContent(_sentence * 12)];
      // A few lines at the front's size, which fit the card.
      final medium = [
        const TextContent('This line wraps across a few lines here and there.'),
      ];
      await _open(
        tester,
        ['long', 'medium'],
        sides: {'long': (long, long), 'medium': (medium, medium)},
      );

      expect(tester.getSize(_face).height, closeTo(_cardHeight, 0.01));
      final scroll = find.descendant(
        of: _currentCard,
        matching: find.byType(Scrollable),
      );
      expect(scroll, findsOneWidget);
      ScrollPosition position() =>
          (tester.state(scroll) as ScrollableState).position;
      expect(position().maxScrollExtent, greaterThan(0));
      // Long text starts at the top of the card, below the padding.
      final text = find.descendant(
        of: _currentCard,
        matching: shownText(_sentence * 12),
      );
      expect(
        tester.getRect(text).top,
        closeTo(tester.getRect(_face).top + StudyStyle.cardPadding, 1),
      );

      await tester.timedDrag(
        _currentCard,
        const Offset(200, 0),
        const Duration(seconds: 1),
      );
      await tester.pumpAndSettle();
      // Control: a few lines fit, at the same size, and scroll nothing.
      expect(tester.getSize(_face).height, closeTo(_cardHeight, 0.01));
      expect(position().maxScrollExtent, 0);
    },
  );

  for (final (name, size, textScale) in [
    ('a narrow screen', const Size(320, 700), 1.0),
    ('a large text scale', _phone, 1.5),
  ]) {
    testWidgets(
      'on $name the current card shows its front alone, centred, with no divider',
      (tester) async {
        await _open(tester, ['a'], size: size, textScale: textScale);

        for (final divider in [Divider, VerticalDivider]) {
          expect(
            find.descendant(of: _face, matching: find.byType(divider)),
            findsNothing,
          );
        }
        final front = shownText('a front');
        expect(
          tester.getCenter(front).dx,
          closeTo(tester.getCenter(_face).dx, 1),
        );
        expect(
          tester.getCenter(front).dy,
          closeTo(tester.getCenter(_face).dy, 1),
        );
      },
    );
  }

  testWidgets(
    'a previous card holds long sides whole, front over back, scrolling inside from its top: a vertical drag scrolls it and neither answers nor re-decides, a horizontal drag re-decides, and a tap shows the whole card in a sheet titled as the card, its front and back under labels of one rank, with no action',
    (tester) async {
      final long = _sentence * 12;
      final scheduler = _RecordingScheduler();
      final study = await _open(
        tester,
        ['long', 'b', 'c'],
        scheduler: scheduler,
        sides: {
          'long': ([TextContent('long front $long')], [TextContent(long)]),
        },
      );
      await study.know();
      scheduler.answers.clear();

      // The two sides, whole and uncut, the front over the back, the front's
      // top inside the card: the card scrolls to show the rest.
      final front = find.descendant(
        of: find.descendant(
          of: _previousCard,
          matching: shownText('long front $long'),
        ),
        matching: find.byType(RichText),
      );
      final back = find.descendant(
        of: find.descendant(of: _previousCard, matching: shownText(long)),
        matching: find.byType(RichText),
      );
      for (final side in [front, back]) {
        expect(
          tester.renderObject<RenderParagraph>(side).didExceedMaxLines,
          isFalse,
        );
      }
      expect(tester.getRect(back).top, greaterThan(tester.getRect(front).top));
      final card = tester.getRect(_previousCard);
      expect(tester.getRect(front).top, greaterThanOrEqualTo(card.top));
      final scroll = find.descendant(
        of: _previousCard,
        matching: find.byType(Scrollable),
      );
      final position = tester.state<ScrollableState>(scroll).position;
      expect(position.maxScrollExtent, greaterThan(0));
      expect(position.pixels, 0);

      // A vertical drag scrolls the card, and changes nothing.
      final at = tester.getCenter(_previousCard);
      await tester.dragFrom(at, const Offset(0, -150));
      await tester.pumpAndSettle();
      expect(position.pixels, greaterThan(0));
      expect(_dragOffset(tester, _previousCard), 0);
      expect(_label(tester, _previous('long front $long')), _gradedAs('Know'));
      expect(study.current, 'b front', reason: 'a scroll answers nothing');
      expect(scheduler.answers, isEmpty);

      // Control: a horizontal drag on the same card re-decides it.
      await tester.dragFrom(at, const Offset(-200, 0));
      await tester.pumpAndSettle();
      expect(
        _label(tester, _previous('long front $long')),
        _gradedAs("Don't know", changed: true),
      );
      expect(study.current, 'b front');
      expect(scheduler.answers, [Answer.dontKnow]);

      await tester.tap(_previous('long front $long'));
      await tester.pumpAndSettle();
      final sheet = find.byType(BottomSheet);
      // Titled as the card; 앞면 and 뒷면 each a label of the same rank.
      expect(
        tester.getSemantics(
          find.descendant(of: sheet, matching: shownText('Card')),
        ),
        isSemantics(isHeader: true),
      );
      for (final side in ['Front', 'Back']) {
        expect(
          find.descendant(
            of: find.descendant(
              of: sheet,
              matching: find.byType(AppSectionLabel),
            ),
            matching: shownText(side),
          ),
          findsOneWidget,
          reason: side,
        );
      }
      expect(
        find.descendant(of: sheet, matching: shownText('long front $long')),
        findsOneWidget,
      );
      expect(
        find.descendant(of: sheet, matching: shownText(long)),
        findsOneWidget,
      );
      // The answer is changed by a swipe, not from the sheet.
      expect(
        find.descendant(of: sheet, matching: find.byType(ButtonStyleButton)),
        findsNothing,
      );
      expect(study.current, 'b front', reason: 'a tap changes nothing');
      expect(
        _label(tester, _previous('long front $long')),
        _gradedAs("Don't know", changed: true),
      );
    },
  );

  testWidgets(
    'short text keeps its full size, centred on the current card, and on the previous card the front over the back, centred both ways',
    (tester) async {
      // Words narrow enough for each half at full size in the test font.
      final study = await _open(
        tester,
        ['a', 'b'],
        sides: {
          'a': ([const TextContent('cat')], [const TextContent('chat')]),
          'b': ([const TextContent('dog')], [const TextContent('chien')]),
        },
      );
      await study.know();

      final dog = find.descendant(
        of: find.descendant(of: _currentCard, matching: shownText('dog')),
        matching: find.byType(RichText),
      );
      expect(
        tester.getCenter(dog),
        offsetMoreOrLessEquals(tester.getCenter(_face), epsilon: 1),
      );
      expect(
        tester.renderObject<RenderParagraph>(dog).text.style!.fontSize,
        AppType.front.fontSize,
      );
      // The previous card: its front over its back, in one column centred
      // both ways.
      final [cat, chat] = [
        for (final side in ['cat', 'chat'])
          find.descendant(
            of: find.descendant(of: _previousCard, matching: shownText(side)),
            matching: find.byType(RichText),
          ),
      ];
      final card = tester.getRect(_previousCard);
      for (final (text, size) in [
        (cat, StudyStyle.previousFront.fontSize),
        (chat, StudyStyle.previousBack.fontSize),
      ]) {
        expect(tester.getCenter(text).dx, closeTo(card.center.dx, 1));
        expect(
          tester.renderObject<RenderParagraph>(text).text.style!.fontSize,
          size,
        );
      }
      expect(tester.getRect(chat).top, greaterThan(tester.getRect(cat).bottom));
      expect(
        (tester.getRect(cat).top + tester.getRect(chat).bottom) / 2,
        closeTo(card.center.dy, 1),
      );
    },
  );

  testWidgets(
    'the screen holds exactly the previous card and the current card, the same size, and a vertical drag reaches no earlier card',
    (tester) async {
      final names = ['a', 'b', 'c', 'd', 'e', 'f'];
      final study = await _open(tester, [...names, 'g', 'h']);
      for (final _ in names) {
        await study.know();
      }

      expect(_built(tester), ['f front', 'current']);
      final previous = tester.getRect(_previousCard);
      final current = tester.getRect(_face);
      expect(previous.size, current.size);
      expect(current.height, closeTo(_cardHeight, 0.01));
      expect(previous.bottom, lessThan(current.top));
      expect(
        find.descendant(of: _previousCard, matching: shownText('f back')),
        findsOneWidget,
      );

      // Control: the screen took the answers, which a pull down would once
      // have reached.
      for (final dy in [300.0, -300.0]) {
        await tester.drag(_previousCard, Offset(0, dy));
        await tester.pumpAndSettle();
        expect(_built(tester), ['f front', 'current']);
        expect(tester.getRect(_previousCard), previous);
        expect(tester.getRect(_face), current);
      }
      expect(study.current, 'g front');
    },
  );

  testWidgets(
    'a horizontal drag on the previous card changes its answer and writes the corrected replay, and neither card moves with a drag on the other',
    (tester) async {
      final scheduler = _RecordingScheduler();
      final study = await _open(tester, [
        'a',
        'b',
        'c',
        'd',
      ], scheduler: scheduler);
      await study.know();
      await study.know();
      scheduler.answers.clear();

      // Toward "Know", the answer it has: it follows a quarter as far and
      // nothing changes.
      var gesture = await tester.startGesture(tester.getCenter(_previousCard));
      for (var moved = 0; moved < 10; moved++) {
        await gesture.moveBy(const Offset(20, 0));
        await tester.pump(const Duration(milliseconds: 50));
      }
      expect(
        _dragOffset(tester, _previousCard),
        closeTo(200 * StudyStyle.sameAnswerResistance, 0.01),
      );
      expect(shownText("Change to Don't know"), findsNothing);
      await tester.pump(const Duration(milliseconds: 300));
      await gesture.up();
      await tester.pumpAndSettle();
      expect(_label(tester, _previous('b front')), _gradedAs('Know'));
      expect(scheduler.answers, isEmpty);

      // Dragged left, it shows what it would become behind it, and the
      // current card stays where it is.
      gesture = await tester.startGesture(tester.getCenter(_previousCard));
      for (var moved = 0; moved < 10; moved++) {
        await gesture.moveBy(const Offset(-15, 0));
        await tester.pump(const Duration(milliseconds: 50));
      }
      expect(_dragOffset(tester, _previousCard), closeTo(-150, 0.01));
      expect(_dragOffset(tester, _currentCard), 0);
      expect(shownText("Change to Don't know"), findsOneWidget);
      await tester.pump(const Duration(milliseconds: 300));
      await gesture.up();
      await tester.pumpAndSettle();

      expect(
        _label(tester, _previous('b front')),
        _gradedAs("Don't know", changed: true),
      );
      expect(shownText("Change to Don't know"), findsNothing);
      expect(_dragOffset(tester, _previousCard), 0);
      expect(study.current, 'c front');
      // The card's session answers, replayed as they stand, are written.
      expect(scheduler.answers, [Answer.dontKnow]);
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 50)),
      );
      final reviews = await tester.runAsync(
        () => study.db.select(study.db.reviews).get(),
      );
      expect(
        {for (final review in reviews!) review.cardId: review.rating},
        {'id1': 'good', 'id2': 'again'},
      );

      // Control: a drag on the current card moves it alone, and answers it.
      gesture = await tester.startGesture(tester.getCenter(_face));
      for (var moved = 0; moved < 10; moved++) {
        await gesture.moveBy(const Offset(15, 0));
        await tester.pump(const Duration(milliseconds: 50));
      }
      expect(_dragOffset(tester, _currentCard), closeTo(150, 0.01));
      expect(_dragOffset(tester, _previousCard), 0);
      await tester.pump(const Duration(milliseconds: 300));
      await gesture.up();
      await tester.pumpAndSettle();
      expect(_label(tester, _previous('c front')), _gradedAs('Know'));
    },
  );

  testWidgets(
    'a screen reader changes a previous answer through the card\'s action',
    (tester) async {
      final semantics = tester.ensureSemantics();
      final study = await _open(tester, ['a', 'b', 'c']);
      await study.know();
      await _act(tester, _previous('a front'), "Change to Don't know");
      expect(
        _label(tester, _previous('a front')),
        _gradedAs("Don't know", changed: true),
      );

      await study.dontKnow();
      await _act(tester, _previous('b front'), 'Change to Know');
      expect(
        _label(tester, _previous('b front')),
        _gradedAs('Know', changed: true),
      );
      semantics.dispose();
    },
  );
  testWidgets('a block this version cannot show renders as its placeholder', (
    tester,
  ) async {
    await _open(
      tester,
      ['a'],
      sides: {
        'a': (
          const [TextContent('a front'), UnsupportedContent('video', null)],
          const [TextContent('a back')],
        ),
      },
    );

    expect(
      find.descendant(
        of: _currentCard,
        matching: shownText('[Content this version cannot show: video]'),
      ),
      findsOneWidget,
    );
  });

  testWidgets(
    'a card of mixed blocks is drawn in order: the current card stacks its front\'s blocks, and once answered each side runs in its half',
    (tester) async {
      final study = await _open(
        tester,
        ['mixed'],
        sides: {
          'mixed': (
            const [
              TextContent('apple'),
              SensesContent([CardSense(meaning: 'fruit')]),
            ],
            const [
              TextContent('사과'),
              SensesContent([CardSense(meaning: '능금')]),
            ],
          ),
        },
      );
      // Where [text] starts on screen, inside the paragraph under [card]
      // that draws it.
      Offset at(Finder card, String text) {
        final drawn = keepWords(text);
        final paragraph = tester.renderObject<RenderParagraph>(
          find
              .descendant(
                of: card,
                matching: find.byWidgetPredicate(
                  (widget) =>
                      widget is RichText &&
                      widget.text.toPlainText().contains(drawn),
                ),
              )
              .first,
        );
        final offset = paragraph.text.toPlainText().indexOf(drawn);
        return paragraph.localToGlobal(
          paragraph.getOffsetForCaret(TextPosition(offset: offset), Rect.zero),
        );
      }

      expect(
        at(_currentCard, 'fruit').dy,
        greaterThan(at(_currentCard, 'apple').dy),
      );

      await study.know();
      expect(
        at(_previousCard, '능금').dx,
        greaterThan(at(_previousCard, 'fruit').dx),
        reason: 'the back on the right',
      );
    },
  );

  testWidgets(
    'a card whose back alone holds a blank is drawn whole, its front as the prompt above the table, its back text after the answer (O3)',
    (tester) async {
      final study = await _open(
        tester,
        ['back'],
        sides: {
          'back': (
            const [TextContent('Capitals')],
            const [
              TextContent('Capitals of Europe'),
              TableContent(
                columns: ['Capital', 'Country'],
                rows: [
                  ['Paris', 'France'],
                ],
                blanks: [(row: 0, column: 0)],
              ),
            ],
          ),
        },
      );
      expect(
        find.descendant(of: _currentCard, matching: find.byType(Table)),
        findsOneWidget,
      );
      final prompt = find.descendant(
        of: _currentCard,
        matching: shownText('Capitals'),
      );
      expect(prompt, findsOneWidget, reason: 'the front stays the prompt');
      expect(
        find.descendant(
          of: _currentCard,
          matching: shownText('Capitals of Europe'),
        ),
        findsNothing,
      );

      await study.know();
      final back = find.descendant(
        of: _previousCard,
        matching: shownText('Capitals of Europe'),
      );
      expect(back, findsOneWidget);
      expect(
        tester
            .getRect(
              find.descendant(
                of: _previousCard,
                matching: shownText('Capitals'),
              ),
            )
            .bottom,
        lessThanOrEqualTo(tester.getRect(back).top),
        reason: 'the front first',
      );
    },
  );

  testWidgets(
    'a card with an empty front and a blank on its back is drawn whole, its table the prompt, its back text after the answer (O3)',
    (tester) async {
      final study = await _open(
        tester,
        ['empty'],
        sides: {
          'empty': (
            const <Content>[],
            const [
              TextContent('Capitals of Europe'),
              TableContent(
                columns: ['Capital', 'Country'],
                rows: [
                  ['Paris', 'France'],
                ],
                blanks: [(row: 0, column: 0)],
              ),
            ],
          ),
        },
      );
      expect(
        find.descendant(of: _currentCard, matching: find.byType(Table)),
        findsOneWidget,
      );
      expect(
        find.descendant(
          of: _currentCard,
          matching: shownText('Capitals of Europe'),
        ),
        findsNothing,
      );

      await study.know();
      expect(
        find.descendant(
          of: _previousCard,
          matching: shownText('Capitals of Europe'),
        ),
        findsOneWidget,
      );
    },
  );

  for (final (mode, colors) in [
    (ThemeMode.light, AppColors.light),
    (ThemeMode.dark, AppColors.dark),
  ]) {
    testWidgets(
      'in ${mode.name} each previous card shows its grade by a 3 px line alone on the surface, Know green and Don\'t know red, which a re-decide changes, with no word or chip, and its label names it first',
      (tester) async {
        final study = await _open(tester, ['a', 'b', 'c'], themeMode: mode);
        BoxDecoration faceOf(Finder card) =>
            tester
                    .widget<DecoratedBox>(
                      find
                          .descendant(
                            of: card,
                            matching: find.byType(DecoratedBox),
                          )
                          .first,
                    )
                    .decoration
                as BoxDecoration;

        for (final (name, answer, line) in [
          ('a', 'Know', colors.know),
          ('b', "Don't know", colors.dontKnowText),
        ]) {
          await (answer == 'Know' ? study.know() : study.dontKnow());
          final card = _previous('$name front');
          expect(
            _label(tester, card),
            '$_justSeen$answer. Front: $name front. Back: $name back',
          );
          final face = faceOf(card);
          expect(face.color, colors.surface, reason: name);
          final border = face.border! as Border;
          expect(border.top.color, line, reason: name);
          expect(border.top.width, 3, reason: name);
          // Nothing on the card but its sides: no word or icon of the grade.
          expect(
            find.descendant(of: card, matching: shownText(answer)),
            findsNothing,
            reason: name,
          );
          expect(
            find.descendant(of: card, matching: find.byType(Icon)),
            findsNothing,
            reason: name,
          );
        }

        // Re-decided to Know, its line turns green.
        await tester.dragFrom(
          tester.getCenter(_previousCard),
          const Offset(200, 0),
        );
        await tester.pumpAndSettle();
        expect(
          (faceOf(_previous('b front')).border! as Border).top.color,
          colors.know,
        );
      },
    );
  }

  for (final textScale in [1.0, 2.0]) {
    testWidgets(
      'at text scale $textScale the previous and the current card keep one size over the guide\'s row, with no overflow',
      (tester) async {
        final study = await _open(tester, ['a', 'b'], textScale: textScale);
        await study.know();

        expect(tester.takeException(), isNull);
        expect(
          tester.getSize(_previousCard).height,
          closeTo(_cardHeight, 0.01),
        );
        expect(tester.getSize(_face).height, closeTo(_cardHeight, 0.01));
        final replay = tester.getRect(
          widgetWithShownText(TextButton, 'Show the guide again'),
        );
        expect(replay.top, greaterThan(tester.getRect(_face).bottom));
        expect(replay.bottom, lessThanOrEqualTo(_phone.height));
      },
    );

    testWidgets(
      'at text scale $textScale the completion panel keeps its place under the previous card, with no overflow, scrolling inside to its last action',
      (tester) async {
        final study = await _open(tester, ['a'], textScale: textScale);
        await study.know();
        expect(find.byType(CompletionCard), findsOneWidget);

        expect(tester.takeException(), isNull);
        final panel = tester.getRect(find.byType(CompletionCard));
        expect(panel.top, greaterThan(tester.getRect(_previousCard).bottom));
        expect(panel.bottom, lessThanOrEqualTo(_phone.height));
        // Every word of its own whole: the heading and the tiles' names.
        for (final text in ['Done for today', 'Know', "Don't know", 'Time']) {
          final paragraph = tester.renderObject<RenderParagraph>(
            find
                .descendant(
                  of: find.descendant(
                    of: find.byType(CompletionCard),
                    matching: find.text(text),
                  ),
                  matching: find.byType(RichText),
                )
                .first,
          );
          expect(paragraph.didExceedMaxLines, isFalse, reason: text);
        }
        // A finger on the panel's heading scrolls it to its last action,
        // inside its place.
        for (
          var drags = 0;
          drags < 8 && tester.getRect(shownText('Stop')).bottom > panel.bottom;
          drags++
        ) {
          await tester.dragFrom(
            Offset(panel.center.dx, panel.top + 40),
            const Offset(0, -100),
          );
          await tester.pumpAndSettle();
        }
        expect(
          tester.getRect(shownText('Stop')).bottom,
          lessThanOrEqualTo(panel.bottom),
        );
      },
    );
  }

  testWidgets(
    'no mascot is drawn while a card is studied, at rest or while either card is dragged toward either answer',
    (tester) async {
      final study = await _open(tester, ['a', 'b', 'c']);
      await study.know();
      // Control: the setup is a session studying, both cards on screen.
      expect(_currentCard, findsOneWidget);
      expect(_previousCard, findsOneWidget);
      expect(find.byType(Mascot), findsNothing);

      for (final (card, dx) in [
        (_face, 60.0),
        (_face, -60.0),
        (_previousCard, -60.0),
        (_previousCard, 60.0),
      ]) {
        final gesture = await tester.startGesture(tester.getCenter(card));
        for (var moved = 0; moved < 6; moved++) {
          await gesture.moveBy(Offset(dx / 6, 0));
          await tester.pump(const Duration(milliseconds: 16));
        }
        expect(find.byType(Mascot), findsNothing, reason: '$card by $dx');
        await gesture.up();
        await tester.pumpAndSettle();
      }
      // Control: no drag answered or re-decided anything.
      expect(study.current, 'b front');
      expect(_label(tester, _previous('a front')), _gradedAs('Know'));
    },
  );

  testWidgets(
    'with reduce motion the card does not fly off and the next one cross-fades in',
    (tester) async {
      final study = await _open(tester, ['a', 'b'], disableAnimations: true);

      await tester.timedDrag(
        _currentCard,
        const Offset(200, 0),
        const Duration(seconds: 1),
      );
      await tester.pump();

      // Both cards are on screen, fading, neither moved nor scaled by the
      // transition.
      expect(_currentCard, findsNWidgets(2));
      for (final card in _currentCard.evaluate()) {
        expect(
          find.ancestor(
            of: find.byWidget(card.widget),
            matching: find.byType(FadeTransition),
          ),
          findsWidgets,
        );
        expect(
          find.ancestor(
            of: find.byWidget(card.widget),
            matching: find.byWidgetPredicate(
              (widget) =>
                  widget is Transform &&
                  !widget.transform.isIdentity() &&
                  widget is! RotatedBox,
            ),
          ),
          findsNothing,
        );
      }
      await tester.pumpAndSettle();
      expect(study.current, 'b front');
    },
  );

  for (final reduceMotion in [true, false]) {
    testWidgets(
      '${reduceMotion ? 'with' : 'without'} reduce motion a re-decided card ${reduceMotion ? 'settles at once' : 'springs back over time'}, and the card answered just now ${reduceMotion ? 'fades' : 'rises'} into the previous card\'s place',
      (tester) async {
        final study = await _open(tester, [
          'a',
          'b',
          'c',
        ], disableAnimations: reduceMotion);
        await study.know();

        await tester.timedDrag(
          _previousCard,
          const Offset(-200, 0),
          const Duration(seconds: 1),
        );
        await tester.pump();
        final moved = _dragOffset(tester, _previousCard);
        expect(moved, reduceMotion ? 0 : lessThan(0));
        await tester.pumpAndSettle();
        expect(
          _label(tester, _previous('a front')),
          _gradedAs("Don't know", changed: true),
        );

        await tester.timedDrag(
          _face,
          const Offset(200, 0),
          const Duration(seconds: 1),
        );
        await tester.pump();
        // Past the answered card's flight, into the next cards' entrance.
        await tester.pump(
          reduceMotion ? Duration.zero : StudyStyle.flyDuration,
        );
        await tester.pump(StudyStyle.fadeDuration ~/ 2);
        final rising = find.ancestor(
          of: _previous('b front'),
          matching: find.byWidgetPredicate(
            (widget) =>
                widget is Transform && widget.transform.getTranslation().y > 0,
          ),
        );
        expect(rising, reduceMotion ? findsNothing : findsOneWidget);
        expect(
          find.ancestor(
            of: _previous('b front'),
            matching: find.byType(FadeTransition),
          ),
          findsWidgets,
        );
        await tester.pumpAndSettle();
        expect(_built(tester), ['b front', 'current']);
      },
    );
  }
  testWidgets(
    'without reduce motion the answered card flies off before the next one emerges',
    (tester) async {
      final study = await _open(tester, ['a', 'b']);

      await tester.timedDrag(
        _currentCard,
        const Offset(200, 0),
        const Duration(seconds: 1),
      );
      await tester.pump(StudyStyle.flyDuration ~/ 2);

      expect(_currentCard, findsOneWidget);
      expect(_dragOffset(tester, _currentCard), greaterThan(200));
      await tester.pumpAndSettle();
      expect(study.current, 'b front');
    },
  );

  testWidgets(
    'a screen reader answers the current card through its actions and reads its labels',
    (tester) async {
      final semantics = tester.ensureSemantics();
      await _open(tester, ['a', 'b', 'c'], locale: const Locale('ko'));

      expect(
        tester.getSemantics(_cardNode),
        isSemantics(label: '앞면: a front', hasTapAction: false),
      );
      expect([
        for (final id
            in tester
                .getSemantics(_cardNode)
                .getSemanticsData()
                .customSemanticsActionIds!)
          CustomSemanticsAction.getAction(id)!.label,
      ], containsAll(['안다', '모른다']));

      Future<void> act(String action) async {
        final node = tester.getSemantics(_cardNode);
        node.owner!.performAction(
          node.id,
          SemanticsAction.customAction,
          CustomSemanticsAction.getIdentifier(
            CustomSemanticsAction(label: action),
          ),
        );
        await tester.pumpAndSettle();
      }

      String actions(String label) => [
        for (final id
            in find.semantics
                    .byLabel(label)
                    .evaluate()
                    .single
                    .getSemanticsData()
                    .customSemanticsActionIds ??
                <int>[])
          // The tap hint rides as an action with no label of its own.
          ?CustomSemanticsAction.getAction(id)!.label,
      ].join(', ');

      await act('모른다');
      expect(
        find.semantics
            .byLabel('방금 본 카드, 모른다. 앞면: a front. 뒷면: a back')
            .evaluate()
            .single,
        isSemantics(isButton: true, hasTapAction: true),
      );
      expect(actions('방금 본 카드, 모른다. 앞면: a front. 뒷면: a back'), '안다로 바꾸기');
      await act('안다');
      expect(actions('방금 본 카드, 안다. 앞면: b front. 뒷면: b back'), '모른다로 바꾸기');
      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
      await expectLater(tester, meetsGuideline(textContrastGuideline));
      expectScreenTextReadable(tester);
      semantics.dispose();
    },
  );

  testWidgets(
    'the next card is on screen once the answer is given, while its write is still running',
    (tester) async {
      final stalled = _StalledRepository();
      final study = await _open(tester, [
        'a',
        'b',
        'c',
      ], repository: (_) => stalled);

      await study.know();

      expect(study.current, 'b front');
      expect(stalled.records, [const CardId('id1')]);
      await study.know();
      expect(study.current, 'c front');
    },
  );

  testWidgets(
    'once no card is left the completion panel takes the current card\'s place on the hero surface, below the stack, with today\'s streak as a run and three tiles of its answers and time, and with no new card left past today\'s, stopping as its one primary',
    (tester) async {
      final study = await _open(tester, ['a', 'b']);

      // While studying, no mascot is drawn.
      expect(study.current, 'a front');
      expect(find.byType(Mascot), findsNothing);
      await study.dontKnow(elapsed: const Duration(seconds: 10));
      await study.know(elapsed: const Duration(seconds: 10));
      expect(study.current, 'a front');
      await study.know(elapsed: const Duration(seconds: 45));

      expect(shownText('Done for today'), findsOneWidget);
      expect(_currentCard, findsNothing);
      // The happy mascot over the heading, the screen's one.
      expect(
        tester
            .widget<Mascot>(
              find.descendant(
                of: find.byType(CompletionCard),
                matching: find.byType(Mascot),
              ),
            )
            .expression,
        MascotExpression.happy,
      );
      expect(find.byType(Mascot), findsOneWidget);
      expect(
        find.bySemanticsLabel("Know 2, don't know 1, 2 min, 1-day streak"),
        findsOneWidget,
      );
      // The streak reads as a run, as on 오늘 and 기록, not as a duration.
      expect(
        find.descendant(
          of: find.byType(CompletionCard),
          matching: find.text('1-day streak', findRichText: true),
        ),
        findsOneWidget,
      );
      // On the hero the streak is in the hero's text colour.
      expect(
        tester
            .widget<Text>(
              find.descendant(
                of: find.byType(CompletionCard),
                matching: find.text('1-day streak'),
              ),
            )
            .style!
            .color,
        AppColors.light.onHero,
      );
      expect(shownText('2/2'), findsOneWidget);
      // On the hero surface, in the place the current card had.
      expect(
        tester
            .widgetList<DecoratedBox>(
              find.descendant(
                of: find.byType(CompletionCard),
                matching: find.byType(DecoratedBox),
              ),
            )
            .map((box) => (box.decoration as BoxDecoration).color)
            .first,
        AppColors.light.hero,
      );
      expect(
        tester.getSize(find.byType(CompletionCard)).height,
        greaterThan(_cardHeight),
      );
      // Three tiles: the answers known in green, not known in red, and the
      // time, each over its name.
      for (final (count, colour, name) in [
        ('2', AppColors.light.know, 'Know'),
        ('1', AppColors.light.dontKnowText, "Don't know"),
        ('2 min', AppColors.light.ink, 'Time'),
      ]) {
        final shown = find.descendant(
          of: find.byType(CompletionCard),
          matching: find.text(count),
        );
        expect(shown, findsOneWidget, reason: name);
        expect(tester.widget<Text>(shown).style!.color, colour, reason: name);
        expect(
          tester.getRect(shown).bottom,
          lessThanOrEqualTo(
            tester
                .getRect(
                  find.descendant(
                    of: find.byType(CompletionCard),
                    matching: find.text(name),
                  ),
                )
                .top,
          ),
          reason: name,
        );
      }
      // The previous card stays above the completion card.
      expect(
        tester.getRect(_previous('a front').last).bottom,
        lessThan(tester.getRect(shownText('Done for today')).top),
      );
      // No new card is left past today's, so nothing to go on with.
      expect(shownText('No more cards to study'), findsOneWidget);
      expect(widgetWithShownText(AppButton, 'Study'), findsNothing);
      // Stopping is the one thing left, so it is the panel's primary, the
      // fill a button takes on the hero.
      final stop = tester.widget<AppButton>(
        widgetWithShownText(AppButton, 'Stop'),
      );
      expect(stop.variant, AppButtonVariant.onHero);
      expect(stop.size, AppButtonSize.cta);

      // Changing the last answer to "Don't know" studies the card again.
      final semantics = tester.ensureSemantics();
      await _act(tester, _previous('a front').last, "Change to Don't know");
      semantics.dispose();
      expect(shownText('Done for today'), findsNothing);
      expect(study.current, 'a front');
    },
  );

  testWidgets(
    'the completion card offers no change of the daily minutes, which settings holds',
    (tester) async {
      final study = await _open(tester, ['a']);
      await study.know();
      expect(shownText('Done for today'), findsOneWidget);

      // The minutes' line was the card's one button labelled by hand; its
      // other buttons take their labels from their text.
      final labelled = find
          .descendant(
            of: find.byType(CompletionCard),
            matching: find.byWidgetPredicate(
              (widget) =>
                  widget is Semantics && widget.properties.button == true,
            ),
          )
          .evaluate()
          .map((element) => (element.widget as Semantics).properties.label)
          .nonNulls;
      expect(labelled, isEmpty);
      expect(find.textContaining('tomorrow'), findsNothing);
    },
  );

  testWidgets(
    "a session reopened the same day counts the day's cards from today's list, done being those answered Know last today",
    (tester) async {
      final study = await _open(tester, ['a', 'b', 'c', 'd', 'e', 'f']);
      expect(shownText('0/6'), findsOneWidget);
      await study.know();
      await study.dontKnow();
      await study.know();
      await study.know();
      expect(shownText('3/6'), findsOneWidget);

      await study.reopen();
      // a, c and d are done; b, answered Don't know, is left with e and f:
      // the count goes on at 3 of the same 6, not 0 of 3, and a notice says
      // the session goes on with the day.
      expect(shownText('3/6'), findsOneWidget);
      final notice = shownText('Picking up · 3 left · about 1 min');
      expect(notice, findsOneWidget);
      // In the top bar's row, in the progress bar's place, clear of the card
      // above the current one and its chip; the count stays beside it.
      final close = tester.getRect(find.byTooltip('Close'));
      expect(
        (tester.getRect(notice).center.dy - close.center.dy).abs(),
        lessThan(1),
      );
      expect(find.byType(LinearProgressIndicator), findsNothing);
      final above = find.byType(EarlierCardView);
      expect(above, findsOneWidget);
      expect(
        tester.getRect(notice).bottom,
        lessThanOrEqualTo(tester.getRect(above).top),
      );
      expect(study.current, 'e front');
      await study.know();
      expect(shownText('4/6'), findsOneWidget);

      // Changing that answer to Don't know makes the card left again.
      final semantics = tester.ensureSemantics();
      await _act(tester, _previous('e front').last, "Change to Don't know");
      semantics.dispose();
      expect(shownText('3/6'), findsOneWidget);
    },
  );

  testWidgets(
    "a card answered Don't know stays in today's list across a reopen until it is answered Know",
    (tester) async {
      final study = await _open(tester, ['a', 'b']);
      await study.dontKnow();
      expect(study.current, 'b front');

      await study.reopen();
      // a falls due tomorrow by its state, and today's list keeps it.
      expect(shownText('0/2'), findsOneWidget);
      final shown = <String?>[];
      while (study.current != null) {
        shown.add(study.current);
        await study.know();
      }
      expect(shown, containsAll(['a front', 'b front']));
      expect(shownText('2/2'), findsOneWidget);

      // Answered Know, it leaves today's list: a reopen finds nothing left.
      await study.reopen();
      expect(study.current, isNull);
      expect(shownText('Done for today'), findsOneWidget);
      expect(shownText('2/2'), findsOneWidget);
    },
  );

  testWidgets(
    "홈's count agrees with the study bar, a card on Don't know left in it",
    (tester) async {
      final study = await _open(
        tester,
        ['a', 'b'],
        states: {'a': _dueToday, 'b': _dueToday},
      );
      expect(shownText('0/2'), findsOneWidget);
      await study.know();
      await study.dontKnow();
      expect(shownText('1/2'), findsOneWidget);

      await study.close();
      final overview = await study.overview();
      // a is done; b, answered Don't know, is left in the count.
      expect(overview.count.total, 1);

      await study.reopen();
      expect(shownText('1/2'), findsOneWidget);
      expect(study.current, 'b front');
      await study.know();
      expect(shownText('2/2'), findsOneWidget);
      await study.close();
      final after = await study.overview();
      expect(after.count.total, 0);
    },
  );

  testWidgets(
    "on a reopen, a card on Don't know comes back after a re-show's gap, in a backlog too",
    (tester) async {
      // Eight cards overdue, a backlog, and x among them, which the first
      // session answers Don't know.
      final names = ['x', for (var i = 0; i < 7; i++) 'o$i'];
      final study = await _open(
        tester,
        names,
        states: {for (final name in names) name: _overdue},
      );
      expect(study.current, 'x front');
      await study.dontKnow();
      await study.close();
      expect((await study.overview()).count.backlog, isTrue);
      await study.reopen();
      // The first draw puts x after reshowGapMin cards, not after every
      // overdue card.
      final shown = <String?>[];
      for (var i = 0; i <= reshowGapMin; i++) {
        shown.add(study.current);
        await study.know();
      }
      expect(shown.last, 'x front');
      expect(shown.take(reshowGapMin), everyElement(isNot('x front')));
    },
  );

  testWidgets(
    'a session open across 04:00 keeps its day: answers after 04:00 still count',
    (tester) async {
      final study = await _open(tester, ['a', 'b', 'c']);
      study.now = DateTime.utc(2026, 10, 15, 3, 59);
      await study.know();
      expect(shownText('1/3'), findsOneWidget);
      study.now = DateTime.utc(2026, 10, 15, 4, 1);
      await study.know();
      expect(shownText('2/3'), findsOneWidget);
      await study.know();
      expect(shownText('3/3'), findsOneWidget);

      // The next open, after 04:00, starts the new day's list: b and c,
      // answered after 04:00, are its done cards; a, answered at 03:59 the
      // day before, falls due again within it on its one-day interval.
      await study.reopen();
      expect(shownText('2/3'), findsOneWidget);
      expect(study.current, 'a front');
    },
  );

  testWidgets(
    'a session reopened on the next study day, after 04:00, counts from 0',
    (tester) async {
      final study = await _open(tester, ['a', 'b', 'c']);
      await study.know();
      await study.reopen();
      // Control: the same day, the count goes on.
      expect(shownText('1/3'), findsOneWidget);

      study.now = DateTime.utc(2026, 10, 15, 4, 30);
      await study.reopen();
      // a, due again a day after its answer, and b and c, new.
      expect(shownText('0/3'), findsOneWidget);
      expect(find.byType(PreviousPlaceholder), findsOneWidget);
      expect(shownText(_earlier), findsNothing);
      expect(find.textContaining('Picking up'), findsNothing);
    },
  );

  testWidgets(
    'Study goes on with the next new cards in the same screen and route, each answer written, and stop closes it',
    (tester) async {
      // All but two of the day's new cards answered today: two are left
      // today, and two more past them.
      final (names, states) = _deck(_quota + 2, today: _quota - 2);
      final study = await _open(tester, names, states: states);
      await study.know();
      await study.know();
      expect(shownText('Done for today'), findsOneWidget);
      // Control: with new cards left, going on is the primary and stopping
      // quiet.
      expect(
        tester
            .widget<AppButton>(widgetWithShownText(AppButton, 'Study'))
            .variant,
        AppButtonVariant.onHero,
      );
      expect(
        tester
            .widget<AppButton>(widgetWithShownText(AppButton, 'Stop'))
            .variant,
        AppButtonVariant.onHeroText,
      );
      final screen = tester.state(find.byType(StudyScreen));
      final route = ModalRoute.of(tester.element(find.byType(StudyScreen)));

      await tester.tap(widgetWithShownText(AppButton, 'Study'));
      await tester.pumpAndSettle();

      expect(study.current, 'c30 front');
      expect(tester.state(find.byType(StudyScreen)), same(screen));
      expect(
        ModalRoute.of(tester.element(find.byType(StudyScreen))),
        same(route),
      );
      expect(route!.isCurrent, isTrue);
      expect(shownText('30/30'), findsOneWidget);
      await study.know();
      expect(study.current, 'c31 front');
      await study.know();
      // The day's bar stays full; the two past it are counted apart.
      expect(shownText('30/30'), findsOneWidget);
      expect(shownText('+2 extra'), findsOneWidget);
      expect(
        find.bySemanticsLabel('2 more cards studied past today\'s plan'),
        findsOneWidget,
      );
      expect(shownText('No more cards to study'), findsOneWidget);
      final reviews = await tester.runAsync(
        () => study.db.select(study.db.reviews).get(),
      );
      // The seeded answers and the session's four.
      expect(reviews, hasLength(_quota - 2 + 4));

      // Control: the completion card's other choice closes the screen.
      await tester.ensureVisible(shownText('Stop'));
      await tester.tap(shownText('Stop'));
      await tester.pumpAndSettle();
      expect(find.byType(StudyScreen), findsNothing);
    },
  );

  testWidgets(
    'a deck with no card left today and none answered today says there is nothing to study',
    (tester) async {
      final study = await _open(
        tester,
        ['later'],
        states: {'later': dueTomorrow},
      );

      // The card exists and was left out because it is not due today.
      final stored = await tester.runAsync(
        () => study.db.select(study.db.cardStates).get(),
      );
      expect(stored, hasLength(1));
      expect(shownText('No cards to study today'), findsOneWidget);
      expect(
        tester.widget<Mascot>(find.byType(Mascot)).expression,
        MascotExpression.sleepy,
      );
      expect(shownText('Done for today'), findsNothing);
      expect(shownText('Study'), findsNothing);
      expect(study.current, isNull);

      // Its way back is a button as well as the ✕, the one primary.
      final back = widgetWithShownText(AppButton, 'Close');
      expect(tester.widget<AppButton>(back).variant, AppButtonVariant.primary);
      await tester.tap(back);
      await tester.pumpAndSettle();
      expect(find.byType(StudyScreen), findsNothing);
    },
  );

  testWidgets('an answer the storage fails to write is reported to the user', (
    tester,
  ) async {
    final study = await _open(tester, ['a', 'b']);
    // Deleting the card makes the review's foreign key fail on write.
    final deleted = await tester.runAsync(
      () => (study.db.delete(
        study.db.cards,
      )..where((card) => card.id.equals('id1'))).go(),
    );
    expect(deleted, 1);

    await study.know();
    expect(study.current, 'b front');
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(milliseconds: 50)),
    );
    await tester.pump();

    expect(
      shownText(
        "Couldn't save your response on this device. This card's schedule did not change.",
      ),
      findsOneWidget,
    );
  });

  for (final mode in [ThemeMode.light, ThemeMode.dark]) {
    testWidgets(
      'in the ${mode.name} theme the current card, the stack and the summary meet the contrast and tap target guidelines',
      (tester) async {
        final study = await _open(tester, ['a', 'b', 'c'], themeMode: mode);
        expect(
          Theme.of(tester.element(_currentCard)).brightness,
          mode == ThemeMode.dark ? Brightness.dark : Brightness.light,
        );
        // The empty previous card's place.
        expect(shownText(_placeholder), findsOneWidget);
        await expectLater(tester, meetsGuideline(textContrastGuideline));
        expectScreenTextReadable(tester);
        await study.know();
        await study.dontKnow();
        await tester.tap(_currentCard);
        await tester.pumpAndSettle();

        await expectLater(tester, meetsGuideline(textContrastGuideline));

        expectScreenTextReadable(tester);
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));

        await tester.tap(_previous('b front'));
        await tester.pumpAndSettle();
        expect(find.byType(BottomSheet), findsOneWidget);
        await expectLater(tester, meetsGuideline(textContrastGuideline));
        expectScreenTextReadable(tester);
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await tester.tapAt(const Offset(20, 20));
        await tester.pumpAndSettle();
        expect(find.byType(BottomSheet), findsNothing);

        await study.know();
        await study.know();
        expect(shownText('Done for today'), findsOneWidget);
        await expectLater(tester, meetsGuideline(textContrastGuideline));
        expectScreenTextReadable(tester);
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      },
    );
  }

  for (final (name, leave) in [
    ('going back', (WidgetTester tester) => tester.binding.handlePopRoute()),
    (
      'the close button',
      (WidgetTester tester) => tester.tap(find.byTooltip('Close')),
    ),
  ]) {
    testWidgets(
      '$name mid-session closes the screen, and the answers given are still written',
      (tester) async {
        final study = await _open(tester, ['a', 'b', 'c']);
        await study.know();
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));

        await leave(tester);
        await tester.pumpAndSettle();

        expect(find.byType(StudyScreen), findsNothing);
        expect(shownText('Done for today'), findsNothing);
        final reviews = await tester.runAsync(
          () => study.db.select(study.db.reviews).get(),
        );
        expect(reviews, hasLength(1));
      },
    );
  }

  group('the coach', () {
    /// The horizontal offsets of the text reading [text] from [place] over
    /// one cycle of the coach's demonstration, and whether [seen] showed in
    /// that time.
    Future<({double right, double left, bool shown})> sweep(
      WidgetTester tester,
      String text, {
      required double place,
      String? seen,
    }) async {
      var right = 0.0;
      var left = 0.0;
      var shown = false;
      for (var i = 0; i < 30; i++) {
        await tester.pump(const Duration(milliseconds: 100));
        final dx = tester.getCenter(shownText(text)).dx - place;
        right = max(right, dx);
        left = min(left, dx);
        if (seen != null && shownText(seen).evaluate().isNotEmpty) {
          shown = true;
        }
      }
      return (right: right, left: left, shown: shown);
    }

    final centre = _phone.width / 2;

    testWidgets(
      "on a device's first session it moves the cards through three steps under a caption in the guide's row's place, stored as shown once it shows",
      (tester) async {
        final study = await _open(tester, ['a', 'b', 'c'], coachShown: false);
        // Stored as shown as soon as it shows, before any step is taken.
        expect(study.storage.getBool(studyCoachShownKey), isTrue);
        expect(shownText('Swipe right if you know it'), findsOneWidget);
        // The caption takes the guide's row's place under the card.
        expect(
          widgetWithShownText(TextButton, 'Show the guide again'),
          findsNothing,
        );
        expect(
          tester.getRect(find.byType(StudyCoach)).top,
          greaterThan(tester.getRect(_face).bottom),
        );
        // Presented by the mascot in its own face, 56 across, beside its bubble.
        final mascot = find.descendant(
          of: find.byType(StudyCoach),
          matching: find.byType(Mascot),
        );
        expect(
          tester.widget<Mascot>(mascot).expression,
          MascotExpression.thinking,
        );
        expect(tester.getSize(mascot), const Size.square(56));
        expect(find.byType(Mascot), findsOneWidget);
        expect(
          tester.getRect(mascot).right,
          lessThan(
            tester.getRect(shownText('Swipe right if you know it')).left,
          ),
        );
        // "Back" is off on the first step; "Next" leads on.
        expect(
          tester
              .widget<TextButton>(widgetWithShownText(TextButton, 'Back'))
              .onPressed,
          isNull,
        );
        expect(widgetWithShownText(AppButton, 'Next'), findsOneWidget);
        expect(shownText('Skip'), findsNothing);
        final semantics = tester.ensureSemantics();
        final caption = tester.getSemantics(find.byType(StudyCoach));
        expect(caption, isSemantics(isLiveRegion: true));
        expect(caption.label, startsWith('How to use, step 1 of 3'));
        semantics.dispose();
        await expectLater(tester, meetsGuideline(textContrastGuideline));
        expectScreenTextReadable(tester);

        // The current card moves right over "Know" and back.
        final know = await sweep(
          tester,
          'a front',
          place: centre,
          seen: 'Know',
        );
        expect(know.right, greaterThan(StudyStyle.coachCurrentPeek * 0.95));
        expect(know.left, greaterThan(-StudyStyle.coachCurrentPeek / 2));
        expect(know.shown, isTrue);

        await tester.tap(widgetWithShownText(AppButton, 'Next'));
        await tester.pump();
        expect(shownText("Swipe left if you don't"), findsOneWidget);
        // "Back" returns a step, and "Next" leads on again.
        await tester.tap(widgetWithShownText(TextButton, 'Back'));
        await tester.pump();
        expect(shownText('Swipe right if you know it'), findsOneWidget);
        await tester.tap(widgetWithShownText(AppButton, 'Next'));
        await tester.pump();
        expect(shownText("Swipe left if you don't"), findsOneWidget);
        final dontKnow = await sweep(
          tester,
          'a front',
          place: centre,
          seen: "Don't know",
        );
        expect(dontKnow.left, lessThan(-StudyStyle.coachCurrentPeek * 0.95));
        expect(dontKnow.right, lessThan(StudyStyle.coachCurrentPeek / 2));
        expect(dontKnow.shown, isTrue);

        await tester.tap(widgetWithShownText(AppButton, 'Next'));
        await tester.pump();
        expect(
          shownText(
            'Cards you responded to come up here. Swipe one to change its response',
          ),
          findsOneWidget,
        );
        // A sample answered card in the previous card's place, dragged
        // toward "Don't know".
        final at = tester.getCenter(shownText('deadline')).dx;
        final change = await sweep(
          tester,
          'deadline',
          place: at,
          seen: "Change to Don't know",
        );
        expect(
          change.right - change.left,
          greaterThan(StudyStyle.coachPreviousPeek * 0.95),
        );
        expect(change.shown, isTrue);
        expect(find.byType(PreviousPlaceholder), findsNothing);

        await tester.tap(widgetWithShownText(AppButton, 'Start'));
        await tester.pumpAndSettle();
        expect(find.byType(StudyCoach), findsNothing);
        // The mascot leaves with the coach.
        expect(find.byType(Mascot), findsNothing);
        expect(shownText('deadline'), findsNothing);
        expect(
          widgetWithShownText(TextButton, 'Show the guide again'),
          findsOneWidget,
        );
        expect(find.byType(PreviousPlaceholder), findsOneWidget);
        expect(study.current, 'a front');
      },
    );

    testWidgets(
      'its last step\'s "Start" ends it, and a later session on the device shows none',
      (tester) async {
        final study = await _open(tester, ['a', 'b', 'c'], coachShown: false);
        expect(find.byType(StudyCoach), findsOneWidget);

        for (final step in ['Next', 'Next', 'Start']) {
          await tester.tap(widgetWithShownText(AppButton, step));
          await tester.pump();
        }
        await tester.pumpAndSettle();
        expect(find.byType(StudyCoach), findsNothing);
        expect(
          widgetWithShownText(TextButton, 'Show the guide again'),
          findsOneWidget,
        );

        await study.reopen();
        expect(find.byType(StudyCoach), findsNothing);
        expect(
          widgetWithShownText(TextButton, 'Show the guide again'),
          findsOneWidget,
        );
      },
    );

    testWidgets(
      'only a drag of the current card or an answer ends the coach: a drag or a tap of the previous card leaves a replay running',
      (tester) async {
        final study = await _open(tester, ['a', 'b', 'c'], coachShown: false);
        await study.know();
        expect(find.byType(StudyCoach), findsNothing);
        expect(_label(tester, _previous('a front')), _gradedAs('Know'));

        // "Show the guide again" starts it again at its first step.
        await tester.tap(
          widgetWithShownText(TextButton, 'Show the guide again'),
        );
        await tester.pump();
        expect(shownText('Swipe right if you know it'), findsOneWidget);
        // A drag of the previous card changes its answer, and the coach runs on.
        await tester.timedDrag(
          _previous('a front'),
          const Offset(-200, 0),
          const Duration(seconds: 1),
        );
        await tester.pump(const Duration(seconds: 1));
        expect(
          _label(tester, _previous('a front')),
          _gradedAs("Don't know", changed: true),
        );
        expect(shownText('Swipe right if you know it'), findsOneWidget);
        // A tap opens it whole, and the coach runs on.
        await tester.tap(_previous('a front'));
        await tester.pump(const Duration(seconds: 1));
        expect(find.byType(BottomSheet), findsOneWidget);
        await tester.tapAt(const Offset(20, 20));
        await tester.pump(const Duration(seconds: 1));
        expect(shownText('Swipe right if you know it'), findsOneWidget);

        // A drag of the current card answers it and ends the coach.
        await study.know();
        expect(find.byType(StudyCoach), findsNothing);
        expect(_previous('b front'), findsOneWidget);
      },
    );

    testWidgets(
      'its mascot and bubble rise in as it starts, and under reduce motion show at once',
      (tester) async {
        for (final reduce in [false, true]) {
          await _open(tester, ['a', 'b'], disableAnimations: reduce);
          await tester.tap(
            widgetWithShownText(TextButton, 'Show the guide again'),
          );
          await tester.pump();
          final shown = tester.widget<Opacity>(
            find
                .ancestor(
                  of: find.descendant(
                    of: find.byType(StudyCoach),
                    matching: find.byType(Mascot),
                  ),
                  matching: find.byType(Opacity),
                )
                .first,
          );
          // The first frame: still hidden with motion, whole under reduce motion.
          expect(
            shown.opacity,
            reduce ? 1 : 0,
            reason: 'reduce motion $reduce',
          );
          await tester.pumpWidget(const SizedBox());
        }
      },
    );

    testWidgets(
      'a replay shows the sample in the previous card\'s place for its last step, and the card answered last once it ends',
      (tester) async {
        final study = await _open(tester, ['a', 'b', 'c']);
        expect(find.byType(StudyCoach), findsNothing);
        await study.know();

        await tester.tap(
          widgetWithShownText(TextButton, 'Show the guide again'),
        );
        await tester.pump();
        expect(find.byType(StudyCoach), findsOneWidget);
        await tester.tap(widgetWithShownText(AppButton, 'Next'));
        await tester.pump();
        await tester.tap(widgetWithShownText(AppButton, 'Next'));
        // The sample takes the place as the card answered last leaves it.
        for (var i = 0; i < 10; i++) {
          await tester.pump(const Duration(milliseconds: 100));
        }
        expect(shownText('deadline'), findsOneWidget);
        expect(_previous('a front'), findsNothing);

        await tester.tap(widgetWithShownText(AppButton, 'Start'));
        await tester.pumpAndSettle();
        expect(shownText('deadline'), findsNothing);
        expect(_previous('a front'), findsOneWidget);
      },
    );

    testWidgets(
      'under reduce motion each step is a still image, the card held out under the touch and its trail, and the mascot and its bubble show at once',
      (tester) async {
        await _open(
          tester,
          ['a', 'b', 'c'],
          coachShown: false,
          disableAnimations: true,
        );
        expect(find.byType(StudyCoach), findsOneWidget);
        // Shown at once: no rise and no fade.
        final bubble = find.ancestor(
          of: find.descendant(
            of: find.byType(StudyCoach),
            matching: find.byType(Mascot),
          ),
          matching: find.byType(Opacity),
        );
        expect(tester.widget<Opacity>(bubble.first).opacity, 1);
        final held =
            StudyStyle.coachCurrentPeek * coachPeek(StudyStyle.coachStill);
        expect(
          tester.getCenter(shownText('a front')).dx - centre,
          closeTo(held, 0.5),
        );
        final touch = tester.widget<StudyCoachTouch>(
          find.byType(StudyCoachTouch),
        );
        expect(touch.shown, isTrue);
        expect(touch.travel, closeTo(held, 0.5));
        // The hand, its fingertip pinned on the ring's centre.
        final hand = find.descendant(
          of: find.byType(StudyCoachTouch),
          matching: find.byWidgetPredicate(
            (widget) =>
                widget is CustomPaint &&
                widget.size == const Size.square(StudyStyle.coachHand),
          ),
        );
        expect(hand, findsOneWidget);
        expect(
          tester.getTopLeft(hand) +
              CoachHandDrawing.tip *
                  (StudyStyle.coachHand / CoachHandDrawing.box),
          offsetMoreOrLessEquals(
            tester.getCenter(find.byType(StudyCoachTouch)),
            epsilon: 0.5,
          ),
        );
        // It stays there: nothing repeats, so the screen settles.
        await tester.pumpAndSettle();
        expect(
          tester.getCenter(shownText('a front')).dx - centre,
          closeTo(held, 0.5),
        );

        await tester.tap(widgetWithShownText(AppButton, 'Next'));
        await tester.pump();
        expect(
          tester.getCenter(shownText('a front')).dx - centre,
          closeTo(-held, 0.5),
        );
        await tester.tap(widgetWithShownText(AppButton, 'Next'));
        await tester.pump();
        await tester.pumpAndSettle();
        expect(shownText("Change to Don't know"), findsOneWidget);
      },
    );
  });

  testWidgets(
    "a session reopened the same day shows the day's last card from an earlier session, graded, under its label, opened by a tap and not changed by a drag, and says it goes on for 3 s",
    (tester) async {
      final study = await _open(tester, ['a', 'b', 'c']);
      await study.know(elapsed: const Duration(seconds: 5));
      await study.know(elapsed: const Duration(seconds: 5));
      await study.reopen();

      final card = find.bySemanticsLabel(
        "$_earlier. Front: b front. Back: b back. Response: Know",
      );
      expect(card, findsOneWidget);
      expect(shownText(_earlier), findsOneWidget);
      expect(
        tester.getRect(shownText(_earlier)).bottom,
        lessThan(tester.getRect(_currentCard).top),
      );
      expect(find.byType(PreviousPlaceholder), findsNothing);
      await expectLater(tester, meetsGuideline(textContrastGuideline));
      expectScreenTextReadable(tester);

      // The notice, a status a screen reader announces as it shows.
      const notice = 'Picking up · 1 left · about 1 min';
      expect(shownText(notice), findsOneWidget);
      final semantics = tester.ensureSemantics();
      expect(
        tester.getSemantics(
          find
              .ancestor(of: shownText(notice), matching: find.byType(Semantics))
              .first,
        ),
        isSemantics(isLiveRegion: true),
      );
      semantics.dispose();

      // A drag does not change it, and writes nothing.
      await tester.timedDrag(
        shownText('b front'),
        const Offset(-200, 0),
        const Duration(seconds: 1),
      );
      await tester.pumpAndSettle();
      expect(card, findsOneWidget);
      expect(shownText("Change to Don't know"), findsNothing);
      final reviews = await tester.runAsync(
        () => study.db.select(study.db.reviews).get(),
      );
      expect([for (final row in reviews!) row.rating], ['good', 'good']);

      // A tap opens it whole.
      await tester.tap(shownText('b front'));
      await tester.pumpAndSettle();
      expect(find.byType(BottomSheet), findsOneWidget);
      await tester.tapAt(const Offset(20, 20));
      await tester.pumpAndSettle();

      await tester.pump(const Duration(seconds: 3));
      await tester.pumpAndSettle();
      expect(shownText(notice), findsNothing);

      // The first answer takes its place.
      await study.know();
      expect(shownText(_earlier), findsNothing);
      expect(_previous('c front'), findsOneWidget);
    },
  );

  group('a whole card', () {
    const cloze = [
      ClozeContent('The capital of France is ___', ['Paris']),
    ];
    const table = [
      TextContent('Capitals'),
      TableContent(
        columns: ['Capital', 'Country'],
        rows: [
          ['Paris', 'France'],
          ['Berlin', 'Germany'],
        ],
        blanks: [(row: 0, column: 0), (row: 1, column: 0)],
      ),
    ];
    const spans = [
      TextContent('초기 국가'),
      TableContent(
        columns: ['', '정치'],
        rows: [
          ['부여', '5부족 연맹체, 왕 아래 마가'],
        ],
        blanks: [],
        spans: [(row: 0, column: 1, start: 0, end: 7)],
      ),
    ];

    Future<_Study> openWhole(
      WidgetTester tester,
      List<Content> front, {
      ThemeMode themeMode = ThemeMode.light,
    }) => _open(
      tester,
      ['whole'],
      sides: {
        'whole': (front, [TextContent(plainText(front))]),
      },
      themeMode: themeMode,
    );

    testWidgets(
      'a photo card hides each box on the current card, and once answered the previous card reveals it in place with its answer, as one face even with the photo on its back alone (ADR 0109)',
      (tester) async {
        const photo = ImageContent(
          media: MediaId('photo'),
          width: 400,
          height: 300,
          boxes: [
            ImageBox(id: '1', x: 0.1, y: 0.1, w: 0.4, h: 0.3, answer: 'Paris'),
          ],
        );
        final study = await _open(
          tester,
          ['front photo', 'back photo'],
          sides: {
            'front photo': ([photo], [const TextContent('France')]),
            'back photo': ([const TextContent('Where is it?')], [photo]),
          },
        );
        final current = study.tester.widget<CurrentCard>(_currentCard).card;
        final first = current.front.contains(photo)
            ? 'front photo'
            : 'back photo';
        Finder under(Finder card, Finder what) =>
            find.descendant(of: card, matching: what);

        for (final name in [
          first,
          first == 'front photo' ? 'back photo' : 'front photo',
        ]) {
          expect(
            under(_currentCard, find.byType(MediaImage)),
            findsOneWidget,
            reason: '$name: one face, the photo on it',
          );
          expect(
            under(_currentCard, shownText('Paris')),
            findsNothing,
            reason: '$name: the box hides its answer',
          );
          expect(
            tester
                .widget<DecoratedBox>(
                  under(
                    find.byKey(const ValueKey(('studied box', '1'))),
                    find.byType(DecoratedBox),
                  ).first,
                )
                .decoration,
            isA<HatchDecoration>(),
            reason: '$name: the box is on the hatch (#635)',
          );
          if (name == 'back photo') {
            expect(
              under(_currentCard, shownText('Where is it?')),
              findsOneWidget,
              reason: 'the front stays the prompt',
            );
          }

          await study.know();

          expect(
            under(_previousCard, shownText('Paris')),
            findsOneWidget,
            reason: '$name: revealed in place',
          );
          expect(
            under(
              find.descendant(
                of: _previousCard,
                matching: find.byKey(const ValueKey(('studied box', '1'))),
              ),
              find.byWidgetPredicate(
                (widget) =>
                    widget is DecoratedBox &&
                    widget.decoration is HatchDecoration,
              ),
            ),
            findsOneWidget,
            reason: '$name: its answer on the same hatch (#635)',
          );
          expect(
            under(_previousCard, find.byType(VerticalDivider)),
            findsNothing,
            reason: '$name: one face, not split',
          );
        }
      },
    );

    testWidgets(
      'a cloze card shows its sentence on the current card with its blank empty, and once answered, as one card, the previous card and its sheet fill it in place',
      (tester) async {
        final study = await openWhole(tester, cloze);
        expect(
          _label(tester, _cardNode),
          'Front: The capital of France is blank',
        );
        // A box on the hatch, its answer nowhere on the card (#635).
        expect(boxedBlanksUnder(_currentCard), 1);
        expect(blanksUnder(_currentCard), isEmpty);
        expect(
          find.descendant(of: _currentCard, matching: shownText('Paris')),
          findsNothing,
        );
        expect(shownText('0/1'), findsOneWidget);

        await study.know();

        expect(shownText('1/1'), findsOneWidget);
        expect(hatchedBlanksUnder(_previousCard), ['Paris']);
        expect(
          find.descendant(
            of: _previousCard,
            matching: find.byType(VerticalDivider),
          ),
          findsNothing,
        );
        expect(
          _label(tester, _previous('The capital of France is blank')),
          '${_justSeen}Know. Front: The capital of France is blank. '
          'Back: The capital of France is Paris',
        );

        await tester.tap(_previousCard);
        await tester.pumpAndSettle();
        expect(shownText('Card'), findsOneWidget);
        expect(shownText('Back'), findsNothing);
        expect(hatchedBlanksUnder(find.byType(BottomSheet)), ['Paris']);
      },
    );

    for (final (name, back, read) in [
      (
        'a new cloze card, with no back,',
        const <Content>[],
        'The capital of France is Paris',
      ),
      (
        'a former cloze card whose stored back no longer matches its front',
        const [TextContent('The capital of France is Lyon')],
        'The capital of France is Paris. The capital of France is Lyon',
      ),
    ]) {
      testWidgets(
        '$name is read on the previous card as its 칸 revealed, its kept back after them',
        (tester) async {
          final study = await _open(
            tester,
            ['whole', 'next'],
            sides: {'whole': (cloze, back)},
          );
          // The setup stored the card with the back asked for.
          expect(tester.widget<CurrentCard>(_currentCard).card.back, back);
          await study.know();
          expect(
            _label(tester, _previous('The capital of France is blank')),
            '${_justSeen}Know. Front: The capital of France is blank. '
            'Back: $read',
          );

          // Reopened, it is the day's last card from an earlier session.
          await study.reopen();
          expect(
            find.bySemanticsLabel(
              '$_earlier. Front: The capital of France is blank. '
              'Back: $read. Response: Know',
            ),
            findsOneWidget,
          );
        },
      );
    }

    testWidgets(
      'a table card shows the whole table with its headers and its cells to recall empty, and once answered, as one card, fills every one in place',
      (tester) async {
        final study = await openWhole(tester, table);
        expect(
          find.descendant(of: _currentCard, matching: find.byType(Table)),
          findsOneWidget,
        );
        for (final header in ['Capital', 'Country', 'France', 'Germany']) {
          expect(
            find.descendant(of: _currentCard, matching: shownText(header)),
            findsOneWidget,
          );
        }
        expect(boxedBlanksUnder(_currentCard), 2);
        expect(blanksUnder(_currentCard), isEmpty);
        expect(
          _label(tester, _cardNode),
          'Front: Capitals. Capital, Country. blank, France. blank, Germany',
        );
        expect(shownText('0/1'), findsOneWidget);

        await study.know();

        expect(shownText('1/1'), findsOneWidget);
        expect(
          find.descendant(of: _previousCard, matching: find.byType(Table)),
          findsOneWidget,
        );
        expect(hatchedBlanksUnder(_previousCard), ['Paris', 'Berlin']);
      },
    );

    testWidgets(
      'a table card with a span blank draws it empty inside its cell\'s text, read as "blank", and once answered fills it in place, the rest of the cell the cue (ADR 0110)',
      (tester) async {
        final study = await openWhole(tester, spans);
        // The cell's one line of text, the blank inside it.
        Finder cellUnder(Finder card) => find.descendant(
          of: card,
          matching: find.byWidgetPredicate(
            (widget) =>
                widget is RichText &&
                RegExp(r'^\s*(5부족 연맹체|\uFFFC)\s*, 왕 아래 마가$').hasMatch(
                  widget.text.toPlainText().replaceAll(_wordJoiner, ''),
                ),
          ),
        );
        expect(boxedBlanksUnder(_currentCard), 1);
        expect(blanksUnder(_currentCard), isEmpty);
        expect(
          cellUnder(_currentCard),
          findsOneWidget,
          reason: 'empty inside the cell, the rest of it the cue',
        );
        expect(
          _label(tester, _cardNode),
          'Front: 초기 국가. , 정치. 부여, blank, 왕 아래 마가',
        );

        await study.know();

        expect(hatchedBlanksUnder(_previousCard), ['5부족 연맹체']);
        expect(
          cellUnder(_previousCard),
          findsOneWidget,
          reason: 'filled in place, inside its cell',
        );
      },
    );

    for (final mode in [ThemeMode.light, ThemeMode.dark]) {
      testWidgets(
        'in the ${mode.name} theme a cloze and a table card, whole cells and spans, meet the contrast guideline before and after the answer',
        (tester) async {
          for (final front in [cloze, table, spans]) {
            final study = await openWhole(tester, front, themeMode: mode);
            await expectLater(tester, meetsGuideline(textContrastGuideline));
            expectScreenTextReadable(tester);
            await study.know();
            await expectLater(tester, meetsGuideline(textContrastGuideline));
            expectScreenTextReadable(tester);
            await study.close();
          }
        },
      );
    }
  });

  group("a card's sound (ADR 0112)", () {
    const frontSound = AudioContent(
      media: MediaId('front sound'),
      duration: Duration(seconds: 2),
    );
    const backSound = AudioContent(
      media: MediaId('back sound'),
      duration: Duration(seconds: 3),
    );
    // A sound on the front of one card, on the back of another, and a card
    // with none.
    const sides = {
      'heard': ([TextContent('listen'), frontSound], [TextContent('cat')]),
      'said': ([TextContent('dog')], [backSound]),
      'silent': ([TextContent('bird')], [TextContent('새')]),
    };
    const names = ['heard', 'said', 'silent'];

    /// The current card's name among [sides].
    String current(WidgetTester tester) {
      final front = tester.widget<CurrentCard>(_currentCard).card.front;
      return sides.entries
          .firstWhere((side) => side.value.$1.first == front.first)
          .key;
    }

    /// Answers every card "Know"; returns the cards in the order shown.
    Future<List<String>> studyAll(_Study study) async {
      final shown = <String>[];
      for (var at = 0; at < names.length; at++) {
        shown.add(current(study.tester));
        await study.know();
      }
      return shown;
    }

    testWidgets(
      'the front sound plays once as its card appears, and no other card plays one, while the setting is left as it starts',
      (tester) async {
        final played = FakeAudioPlayback();
        final study = await _open(
          tester,
          names,
          sides: sides,
          playback: played,
        );
        final heardFirst = current(tester) == 'heard';
        expect(played.plays, heardFirst ? [frontSound.media] : isEmpty);

        final shown = await studyAll(study);

        expect(shown, containsAll(names), reason: 'setup: each card shown');
        expect(played.plays, [
          frontSound.media,
        ], reason: 'once, for the front holding a sound');
      },
    );

    testWidgets(
      'with the setting off nothing plays on its own, and the control and the screen reader play the sound',
      (tester) async {
        final played = FakeAudioPlayback();
        final semantics = tester.ensureSemantics();
        final study = await _open(
          tester,
          names,
          sides: sides,
          playback: played,
          autoplay: false,
        );
        while (current(tester) != 'heard') {
          await study.know();
        }
        expect(played.plays, isEmpty);

        await _act(tester, _cardNode, 'Play sound');
        expect(played.plays, [frontSound.media]);
        await tester.tap(
          find.descendant(
            of: _currentCard,
            matching: find.byTooltip('Play sound'),
          ),
        );
        await tester.pump();
        expect(played.plays, [frontSound.media, frontSound.media]);
        semantics.dispose();
      },
    );

    testWidgets(
      "the current card offers Play sound only for a front holding a sound, and the previous card plays its back's",
      (tester) async {
        final played = FakeAudioPlayback();
        final semantics = tester.ensureSemantics();
        final study = await _open(
          tester,
          names,
          sides: sides,
          playback: played,
          autoplay: false,
        );
        List<String> actions(Finder finder) => [
          for (final id
              in tester
                      .getSemantics(finder)
                      .getSemanticsData()
                      .customSemanticsActionIds ??
                  <int>[])
            ?CustomSemanticsAction.getAction(id)!.label,
        ];
        while (current(tester) != 'said') {
          expect(
            actions(_cardNode).contains('Play sound'),
            current(tester) == 'heard',
            reason: current(tester),
          );
          await study.know();
        }
        // Control: a front with no sound offers the answers alone.
        expect(actions(_cardNode), isNot(contains('Play sound')));
        await study.know();

        final previous = _previous('dog');
        expect(actions(previous), contains('Play sound'));
        await _act(tester, previous, 'Play sound');
        expect(played.plays, [backSound.media]);
        semantics.dispose();
      },
    );

    testWidgets('closing the screen stops a sound still playing', (
      tester,
    ) async {
      final played = FakeAudioPlayback();
      final study = await _open(tester, names, sides: sides, playback: played);
      while (current(tester) != 'heard') {
        await study.know();
      }
      await tester.pump();
      expect(played.playing, isTrue, reason: 'setup: the front sound plays');

      await study.close();

      expect(played.playing, isFalse);
    });

    testWidgets(
      'answering onto a card with no sound stops the sound of the card that left',
      (tester) async {
        final played = FakeAudioPlayback();
        final study = await _open(
          tester,
          ['heard', 'silent'],
          sides: sides,
          playback: played,
        );
        while (current(tester) != 'heard') {
          await study.know();
        }
        await tester.pump();
        expect(played.playing, isTrue, reason: 'setup: the front sound plays');

        await study.know();

        expect(played.plays, [frontSound.media], reason: 'nothing else played');
        expect(played.playing, isFalse);
      },
    );

    testWidgets('the app pausing stops a sound still playing', (tester) async {
      final played = FakeAudioPlayback();
      final study = await _open(tester, names, sides: sides, playback: played);
      while (current(tester) != 'heard') {
        await study.know();
      }
      await tester.pump();
      expect(played.playing, isTrue, reason: 'setup: the front sound plays');

      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);

      expect(played.playing, isFalse);
      // Control: coming back plays nothing by itself.
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      expect(played.playing, isFalse);
      await study.close();
    });
  });

  group('the card editor\'s preview draws the card as study does (ADR 0168)', () {
    const photo = ImageContent(
      media: MediaId('photo'),
      width: 400,
      height: 300,
      boxes: [
        ImageBox(id: '1', x: 0.1, y: 0.1, w: 0.4, h: 0.3, answer: 'Paris'),
      ],
    );
    final kinds = <String, (List<Content>, List<Content>)>{
      // Long enough to step down from the front size.
      '글': ([TextContent(_sentence * 3)], [const TextContent('사과')]),
      '단어': (
        [const TextContent('apple')],
        [
          const SensesContent([
            CardSense(meaning: 'fruit'),
            CardSense(meaning: 'a tree'),
          ]),
        ],
      ),
      '빈칸': (
        [
          const ClozeContent('___ is red.', ['Rose']),
        ],
        [const TextContent('A flower.')],
      ),
      '표': (
        [const TextContent('Capitals')],
        [
          const TableContent(
            columns: ['Capital', 'Country'],
            rows: [
              ['Paris', 'France'],
              ['Rome', 'Italy'],
            ],
            blanks: [(row: 0, column: 0)],
          ),
        ],
      ),
      '사진': ([photo], [const TextContent('France')]),
    };

    for (final MapEntry(key: kind, value: sides) in kinds.entries) {
      testWidgets(
        'a $kind card: the preview\'s front is study\'s current card and its turned side study\'s previous card, in size, text, type size and place, on the theme\'s edge',
        (tester) async {
          final study = await _open(tester, [kind], sides: {kind: sides});
          final cells = drawnCellsOf(
            tester.widget<CurrentCard>(_currentCard).card,
          );
          final current = _drawing(tester, _currentCard);
          await study.know();
          final previous = _drawing(tester, _previousCard);
          expect(
            previous,
            isNot(current),
            reason: 'the setup: the two faces draw the card differently',
          );

          unawaited(
            study.navigator.currentState!.push(
              MaterialPageRoute<void>(
                builder: (_) => CardPreviewScreen(cells: cells),
              ),
            ),
          );
          await tester.pumpAndSettle();
          final preview = find.byType(CardPreviewScreen);
          expect(_drawing(tester, preview), current, reason: 'the front');
          await tester.tap(
            find.descendant(of: preview, matching: find.byType(CardScroll)),
          );
          await tester.pumpAndSettle();
          expect(_drawing(tester, preview), previous, reason: 'turned');
          expect(
            _line(tester, preview),
            AppColors.of(tester.element(preview)).edge,
            reason: 'no answer, so no grade',
          );
          await study.close();
        },
      );
    }
  });
}

/// What the face under [of] draws, measured from its top left: its size and
/// outline, then each paragraph's text, type size and box and each
/// picture's box, so two faces that draw a card alike measure alike.
List<String> _drawing(WidgetTester tester, Finder of) {
  final face = find.descendant(of: of, matching: find.byType(CardScroll)).first;
  final origin = tester.getTopLeft(face);
  final decoration =
      tester
              .widget<DecoratedBox>(
                find
                    .ancestor(of: face, matching: find.byType(DecoratedBox))
                    .first,
              )
              .decoration
          as BoxDecoration;
  String box(RenderBox render) =>
      (render.localToGlobal(Offset.zero) - origin & render.size).toString();
  return [
    'face ${tester.getSize(face)}, radius ${decoration.borderRadius}, '
        'line ${decoration.border?.top.width}',
    for (final element
        in find
            .descendant(of: face, matching: find.byType(RichText))
            .evaluate())
      if (element.renderObject case final RenderParagraph paragraph)
        '${paragraph.text.toPlainText().replaceAll('\u2060', '')} '
            '${paragraph.text.style?.fontSize} ${box(paragraph)}',
    for (final element
        in find
            .descendant(of: face, matching: find.byType(MediaImage))
            .evaluate())
      'picture ${box(element.renderObject! as RenderBox)}',
  ];
}

/// The colour of the line around the face under [of].
Color? _line(WidgetTester tester, Finder of) {
  final face = find.descendant(of: of, matching: find.byType(CardScroll)).first;
  final decoration =
      tester
              .widget<DecoratedBox>(
                find
                    .ancestor(of: face, matching: find.byType(DecoratedBox))
                    .first,
              )
              .decoration
          as BoxDecoration;
  return decoration.border?.top.color;
}

/// Due at 05:00 UTC tomorrow, an hour after the next study day starts.
/// The word joiner set between the characters of each word.
const _wordJoiner = '\u2060';

/// The empty previous card's place's line, in English.
const _placeholder = 'Cards you responded to stack up here';

/// The label on the day's last card from an earlier session, in English.
const _earlier = 'Last card last time';

/// Answered "Know" at 06:00 UTC today, the card's first answer, and due
/// tomorrow.
final _answeredToday = CardState(
  stability: 3,
  difficulty: 5,
  lastReview: DateTime.utc(2026, 10, 14, 6),
  due: DateTime.utc(2026, 10, 15, 5),
);

/// The fronts of [count] cards, created in this order, and the first [today]
/// of them answered today.
(List<String>, Map<String, CardState>) _deck(int count, {required int today}) {
  final names = [
    for (var i = 0; i < count; i++) 'c${i.toString().padLeft(2, '0')}',
  ];
  return (names, {for (final name in names.take(today)) name: _answeredToday});
}

/// The day's new cards: the 5 daily minutes [_open] stores, at 10 s a card.
const _quota = 30;

/// Last answered four days before the session's day and due before it began.
final _dueToday = CardState(
  stability: 3,
  difficulty: 5,
  lastReview: DateTime.utc(2026, 10, 10),
  due: DateTime.utc(2026, 10, 13),
);

/// Overdue by a month at a thirty-day interval, so a few such cards are more
/// than three days of reviews: a backlog.
final _overdue = CardState(
  stability: 30,
  difficulty: 5,
  lastReview: DateTime.utc(2026, 8, 14),
  due: DateTime.utc(2026, 9, 13),
);

final dueTomorrow = CardState(
  stability: 3,
  difficulty: 5,
  lastReview: DateTime.utc(2026, 10, 12),
  due: DateTime.utc(2026, 10, 15, 5),
);
