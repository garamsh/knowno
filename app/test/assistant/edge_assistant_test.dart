import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/assistant/assistant.dart';
import 'package:knowno/design/mascot.dart';
import 'package:knowno/design/theme.dart';
import 'package:knowno/l10n/app_localizations.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../word_breaks.dart';
import 'fakes.dart';

const _screen = Size(390, 844);

/// A list of [rows] rows, each a button, over the edge character.
Widget _list(int rows, {double bottom = 0}) => ListView.builder(
  padding: EdgeInsets.only(bottom: bottom),
  itemCount: rows,
  itemBuilder: (context, i) => SizedBox(
    height: 56,
    child: ListTile(title: Text('row $i'), onTap: () {}),
  ),
);

/// The edge character over [child], 390 wide, as a screen draws it; [opened]
/// counts the taps that open the chat.
Future<({ProviderContainer container, List<int> opened})> _pump(
  WidgetTester tester, {
  required SharedPreferencesWithCache storage,
  Widget? child,
  bool hint = false,
  bool assistant = true,
  Locale locale = const Locale('en'),
  double textScale = 1,
  ThemeMode themeMode = ThemeMode.light,
  bool reduceMotion = false,
}) async {
  tester.view.physicalSize = _screen;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final opened = <int>[];
  final container = ProviderContainer(
    overrides: [
      assistantClientProvider.overrideWithValue(
        assistant ? FakeAssistantClient() : null,
      ),
      assistantStorageProvider.overrideWithValue(storage),
    ],
  );
  addTearDown(container.dispose);
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: MaterialApp(
        theme: lightTheme,
        darkTheme: darkTheme,
        themeMode: themeMode,
        locale: locale,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(context).copyWith(
            textScaler: TextScaler.linear(textScale),
            disableAnimations: reduceMotion,
          ),
          child: child!,
        ),
        home: Scaffold(
          body: EdgeAssistant(
            hint: hint,
            onOpen: () => opened.add(opened.length),
            child: child ?? _list(3),
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
  return (container: container, opened: opened);
}

Rect _character(WidgetTester tester) => tester.getRect(find.byType(Mascot));

Map<String, Object> _ready() => storedChatWithProposal();

void main() {
  testWidgets('draws nothing of its own where the app has no assistant', (
    tester,
  ) async {
    await _pump(
      tester,
      storage: await openAssistantStorage(tester),
      assistant: false,
    );
    expect(find.byType(Mascot), findsNothing);
    expect(find.text('row 0'), findsOneWidget);
  });

  testWidgets(
    'is a button named "Chat with Malangi" of 72, at the bottom right, that opens the chat',
    (tester) async {
      final semantics = tester.ensureSemantics();
      final shown = await _pump(
        tester,
        storage: await openAssistantStorage(tester),
      );
      final rect = _character(tester);
      expect(rect.size, const Size.square(72));
      expect(rect.size.shortestSide, greaterThanOrEqualTo(44));
      expect(rect.right, _screen.width - 12);
      expect(rect.bottom, _screen.height - 12);
      expect(
        tester.getSemantics(find.bySemanticsLabel('Chat with Malangi')),
        matchesSemantics(
          label: 'Chat with Malangi',
          isButton: true,
          hasTapAction: true,
        ),
      );
      await tester.tap(find.byType(Mascot));
      await tester.pump();
      expect(shown.opened, hasLength(1));
      semantics.dispose();
    },
  );

  testWidgets('breathes and blinks', (tester) async {
    await _pump(tester, storage: await openAssistantStorage(tester));
    final mascot = tester.widget<Mascot>(find.byType(Mascot));
    expect(mascot.breathes, isTrue);
    expect(mascot.expression.blinks, isTrue);
  });

  testWidgets('can be dragged to the other edge, which this device keeps', (
    tester,
  ) async {
    final storage = await openAssistantStorage(tester);
    await _pump(tester, storage: storage);
    // A short drag falls back to the edge it left.
    await tester.drag(find.byType(Mascot), const Offset(-40, 0));
    await tester.pumpAndSettle();
    expect(_character(tester).right, _screen.width - 12);
    expect(storage.getString('assistant.edge'), 'right');
    await tester.drag(find.byType(Mascot), const Offset(-260, 0));
    await tester.pumpAndSettle();
    expect(_character(tester).left, 12);
    expect(storage.getString('assistant.edge'), 'left');
    // A screen drawn anew, on this device, finds it there.
    await tester.pumpWidget(const SizedBox());
    await _pump(tester, storage: storage);
    expect(_character(tester).left, 12);
    // Control: another device's storage starts at the right.
    await tester.pumpWidget(const SizedBox());
    await _pump(tester, storage: await openAssistantStorage(tester));
    expect(_character(tester).right, _screen.width - 12);
  });

  testWidgets(
    'tucks half into its edge while the list scrolls, and comes back once it stops',
    (tester) async {
      await _pump(
        tester,
        storage: await openAssistantStorage(tester),
        child: _list(30),
      );
      final rest = _character(tester);
      final scroll = await tester.startGesture(const Offset(100, 400));
      await scroll.moveBy(const Offset(0, -80));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      final tucked = _character(tester);
      expect(tucked.left, rest.left + 36, reason: 'half of its 72 is out');
      expect(tucked.right, greaterThan(_screen.width));
      // Still a button of 44 and more in view.
      expect(_screen.width - tucked.left, greaterThanOrEqualTo(36));
      await scroll.up();
      await tester.pump(const Duration(milliseconds: 100));
      expect(
        _character(tester).left,
        tucked.left,
        reason: 'not before the delay',
      );
      await tester.pump(edgeReturnDelay + const Duration(seconds: 1));
      await tester.pumpAndSettle();
      expect(_character(tester), rest);
    },
  );

  testWidgets('tucks at once under reduce motion', (tester) async {
    Future<double> afterOnePump({required bool reduce}) async {
      await _pump(
        tester,
        storage: await openAssistantStorage(tester),
        child: _list(30),
        reduceMotion: reduce,
      );
      final scroll = await tester.startGesture(const Offset(100, 400));
      await scroll.moveBy(const Offset(0, -80));
      await tester.pump();
      final left = _character(tester).left;
      await scroll.up();
      await tester.pumpAndSettle(edgeReturnDelay * 4);
      return left;
    }

    final still = await afterOnePump(reduce: true);
    expect(still, _screen.width - 12 - 72 + 36, reason: 'tucked in one frame');
    // Control: with motion it has barely left after one frame.
    await tester.pumpWidget(const SizedBox());
    final moving = await afterOnePump(reduce: false);
    expect(moving, lessThan(still));
  });

  testWidgets('does not tuck for a list that scrolls sideways', (tester) async {
    await _pump(
      tester,
      storage: await openAssistantStorage(tester),
      child: SizedBox(
        height: 100,
        child: ListView(
          scrollDirection: Axis.horizontal,
          children: [
            for (var i = 0; i < 20; i++)
              SizedBox(width: 200, child: Text('c$i')),
          ],
        ),
      ),
    );
    final rest = _character(tester);
    await tester.drag(find.text('c0'), const Offset(-200, 0));
    await tester.pump(const Duration(milliseconds: 300));
    expect(_character(tester), rest);
  });

  group('the ready bubble', () {
    testWidgets(
      'says "n cards ready" beside the character, and opens the chat',
      (tester) async {
        final semantics = tester.ensureSemantics();
        final shown = await _pump(
          tester,
          storage: await openAssistantStorage(tester, _ready()),
        );
        expect(shownText('3 cards ready'), findsOneWidget);
        expect(
          tester.getRect(shownText('3 cards ready')).right,
          lessThan(_character(tester).left),
        );
        expect(
          find.bySemanticsLabel('Chat with Malangi, 3 cards ready'),
          findsOneWidget,
        );
        await tester.tap(shownText('3 cards ready'));
        await tester.pump();
        expect(shown.opened, hasLength(1));
        semantics.dispose();
      },
    );

    testWidgets(
      'is the shorter Korean line, on the other side from the left edge',
      (tester) async {
        final storage = await openAssistantStorage(tester, {
          ..._ready(),
          'assistant.edge': 'left',
        });
        await _pump(tester, storage: storage, locale: const Locale('ko'));
        expect(shownText('3장 만들어 뒀어요'), findsOneWidget);
        expect(
          tester.getRect(shownText('3장 만들어 뒀어요')).left,
          greaterThan(_character(tester).right),
        );
      },
    );

    testWidgets('is not there with nothing ready', (tester) async {
      await _pump(tester, storage: await openAssistantStorage(tester));
      expect(shownTextContaining('ready'), findsNothing);
    });
  });

  group('the hint', () {
    const hint = 'Tap Malangi to chat any time';

    testWidgets('shows once a first note exists, and not before', (
      tester,
    ) async {
      await _pump(tester, storage: await openAssistantStorage(tester));
      expect(shownText(hint), findsNothing);
      await tester.pumpWidget(const SizedBox());
      await _pump(
        tester,
        storage: await openAssistantStorage(tester),
        hint: true,
      );
      expect(shownText(hint), findsOneWidget);
    });

    testWidgets(
      'goes for good on a tap of the character, which still opens the chat',
      (tester) async {
        final storage = await openAssistantStorage(tester);
        final shown = await _pump(tester, storage: storage, hint: true);
        await tester.tap(find.byType(Mascot));
        await tester.pumpAndSettle();
        expect(shown.opened, hasLength(1));
        expect(shownText(hint), findsNothing);
        expect(storage.getBool('assistant.hintShown'), isTrue);
        await tester.pumpWidget(const SizedBox());
        await _pump(tester, storage: storage, hint: true);
        expect(shownText(hint), findsNothing, reason: 'not on the next screen');
      },
    );

    testWidgets('goes for good on its close button, without opening the chat', (
      tester,
    ) async {
      final storage = await openAssistantStorage(tester);
      final shown = await _pump(tester, storage: storage, hint: true);
      await tester.tap(find.byTooltip('Dismiss the hint'));
      await tester.pumpAndSettle();
      expect(shown.opened, isEmpty);
      expect(shownText(hint), findsNothing);
      expect(storage.getBool('assistant.hintShown'), isTrue);
    });

    testWidgets('gives way to the ready bubble, and is still there after it', (
      tester,
    ) async {
      final storage = await openAssistantStorage(tester, _ready());
      await _pump(tester, storage: storage, hint: true);
      expect(shownText('3 cards ready'), findsOneWidget);
      expect(shownText(hint), findsNothing);
      expect(
        storage.getBool('assistant.hintShown'),
        isNull,
        reason: 'not spent',
      );
    });
  });

  for (final (mode, scale) in [
    (ThemeMode.light, 1.0),
    (ThemeMode.dark, 1.0),
    (ThemeMode.light, 3.12),
    (ThemeMode.dark, 3.12),
  ]) {
    testWidgets(
      'draws the hint and the ready bubble inside the screen, $mode at $scale',
      (tester) async {
        for (final stored in [<String, Object>{}, _ready()]) {
          await _pump(
            tester,
            storage: await openAssistantStorage(tester, stored),
            hint: true,
            themeMode: mode,
            textScale: scale,
          );
          final bubble = tester.getRect(
            shownTextContaining(stored.isEmpty ? 'Tap Malangi' : 'cards ready'),
          );
          expect(bubble.left, greaterThanOrEqualTo(0));
          expect(bubble.right, lessThanOrEqualTo(_screen.width));
          expect(bubble.top, greaterThanOrEqualTo(0));
          await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
          await tester.pumpWidget(const SizedBox());
        }
      },
    );
  }

  testWidgets(
    'never covers a row at the foot of a list that keeps the room it asks',
    (tester) async {
      Future<(Rect, Rect)> atTheEnd(double bottom) async {
        await _pump(
          tester,
          storage: await openAssistantStorage(tester),
          child: _list(30, bottom: bottom),
        );
        await tester.drag(find.byType(ListView), const Offset(0, -10000));
        await tester.pumpAndSettle(edgeReturnDelay * 4);
        return (tester.getRect(find.text('row 29')), _character(tester));
      }

      final (row, character) = await atTheEnd(edgeReserve);
      expect(row.overlaps(character), isFalse);
      expect(
        tester
            .getRect(find.widgetWithText(ListTile, 'row 29'))
            .overlaps(character),
        isFalse,
        reason: 'the whole tappable row, not its text',
      );
      // Control: a list with no room kept has its last row under it.
      await tester.pumpWidget(const SizedBox());
      final (bare, under) = await atTheEnd(0);
      expect(
        tester.getRect(find.widgetWithText(ListTile, 'row 29')).overlaps(under),
        isTrue,
      );
      expect(bare.bottom, greaterThan(0));
    },
  );
}
