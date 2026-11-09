import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter_test/flutter_test.dart';

import '../word_breaks.dart';
import 'fakes.dart';

const _rich = '''
## 통치 체제 비교

**왕정**은 *세습*이고 ~~폐지~~ 되었어요.

- 첫째
  - 안쪽 하나
  - 안쪽 둘
- 둘째

1. 하나
2. 둘

> 인용한 말

```
final x = 1;
```

| 나라 | 체제 |
|---|---|
| 영국 | 입헌군주제 |

[자세히](https://example.com/a) [위험](javascript:alert(1))

---
''';

/// A leaf's style with the styles of the spans above it merged in, by text.
Map<String, TextStyle> _styles(InlineSpan root) {
  final found = <String, TextStyle>{};
  void walk(InlineSpan span, TextStyle inherited) {
    if (span is! TextSpan) return;
    final style = inherited.merge(span.style);
    final text = span.text?.replaceAll('⁠', '');
    if (text != null) found[text] = style;
    for (final child in span.children ?? const <InlineSpan>[]) {
      walk(child, style);
    }
  }

  walk(root, const TextStyle());
  return found;
}

/// The spans of every Text on screen holding [text].
Iterable<InlineSpan> _spans(WidgetTester tester, String text) => tester
    .widgetList<Text>(find.byType(Text))
    .map(
      (one) =>
          one.textSpan ?? (one.data == null ? null : TextSpan(text: one.data)),
    )
    .whereType<InlineSpan>()
    .where((span) => span.toPlainText().replaceAll('⁠', '').contains(text));

void main() {
  testWidgets('draws a reply\'s Markdown, and a plain reply as it was', (
    tester,
  ) async {
    final client = FakeAssistantClient(
      scripts: [textReply(_rich), textReply('그냥 말이에요')],
    );
    final chat = await pumpChat(
      tester,
      client,
      await openAssistantStorage(tester),
    );
    expect(chat, isNotNull);
    await _send(tester, '비교해 줘');
    expect(find.textContaining('**'), findsNothing);
    expect(find.textContaining('##'), findsNothing);
    final bold = _styles(_spans(tester, '왕정').single);
    expect(bold['왕정']?.fontWeight, FontWeight.w700);
    expect(bold['세습']?.fontStyle, FontStyle.italic);
    expect(bold['폐지']?.decoration, TextDecoration.lineThrough);
    expect(_spans(tester, '통치 체제 비교'), hasLength(1));
    expect(find.text('안쪽 하나'), findsNothing);
    expect(_spans(tester, '안쪽 하나'), hasLength(1));
    expect(_spans(tester, 'final x = 1;'), hasLength(1));
    // A table is a table, its cells apart.
    expect(find.byType(Table), findsOneWidget);
    expect(_spans(tester, '입헌군주제'), hasLength(1));
    expect(find.byType(Divider), findsOneWidget);

    // A web link has a tap, another scheme is text.
    final taps = <String>[];
    void collect(InlineSpan span) {
      if (span is! TextSpan) return;
      if (span.recognizer != null) {
        taps.add(span.toPlainText().replaceAll('\u2060', ''));
      }
      span.children?.forEach(collect);
    }

    collect(_spans(tester, '자세히').single);
    expect(taps, ['자세히']);
    expect(_spans(tester, '위험'), hasLength(1));

    await _send(tester, '**내** 글');
    expect(
      shownText('**내** 글'),
      findsOneWidget,
      reason: 'the user stays plain',
    );
  });

  testWidgets('shows an image as its alt text and raw HTML as text', (
    tester,
  ) async {
    final client = FakeAssistantClient(
      scripts: [
        textReply(
          '![지도 그림](https://example.com/map.png)\n\n<b>굵게</b> <script>x</script>',
        ),
      ],
    );
    await pumpChat(tester, client, await openAssistantStorage(tester));
    await _send(tester, '보여 줘');
    expect(
      find.byWidgetPredicate((w) => w is Image && w.image is NetworkImage),
      findsNothing,
    );
    expect(_spans(tester, '지도 그림'), hasLength(1));
    expect(find.textContaining('example.com/map.png'), findsNothing);
    expect(
      _spans(tester, '<b>굵게</b> <script>x</script>'),
      hasLength(1),
      reason: 'the tags are text',
    );
  });

  testWidgets('keeps a link a tappable node and reads the text without marks', (
    tester,
  ) async {
    final handle = tester.ensureSemantics();
    final client = FakeAssistantClient(
      scripts: [textReply('**굵게** 와 [자세히](https://example.com/a) 보세요')],
    );
    await pumpChat(tester, client, await openAssistantStorage(tester));
    await _send(tester, '링크');
    final nodes = <SemanticsNode>[];
    void walk(SemanticsNode node) {
      nodes.add(node);
      node.visitChildren((child) {
        walk(child);
        return true;
      });
    }

    walk(
      tester
          .binding
          .renderViews
          .first
          .owner!
          .semanticsOwner!
          .rootSemanticsNode!,
    );
    final labels = [
      for (final node in nodes) node.label.replaceAll('\u2060', ''),
    ];
    final link = nodes.singleWhere(
      (node) => node.label.replaceAll('\u2060', '') == '자세히',
    );
    expect(link.getSemanticsData().hasAction(SemanticsAction.tap), isTrue);
    expect(link.getSemanticsData().flagsCollection.isLink, isTrue);
    expect(labels.join(' '), contains('굵게'));
    expect(labels.join(' '), isNot(contains('**')));
    handle.dispose();
  });

  for (final (mode, scale) in [
    (ThemeMode.light, 1.0),
    (ThemeMode.dark, 1.0),
    (ThemeMode.light, 3.12),
    (ThemeMode.dark, 3.12),
  ]) {
    testWidgets(
      'draws a reply with a wide table without overflow, $mode at $scale',
      (tester) async {
        final client = FakeAssistantClient(
          scripts: [
            textReply(
              '$_rich\n\n| 가나다라마바사 | 아자차카타파하 | 가나다라마바사 | 아자차카타파하 | 끝 |\n|---|---|---|---|---|\n| 1 | 2 | 3 | 4 | 5 |',
            ),
          ],
        );
        await pumpChat(
          tester,
          client,
          await openAssistantStorage(tester),
          themeMode: mode,
          textScale: scale,
        );
        await _send(tester, '표로 줘');
        expect(tester.takeException(), isNull);
        expect(
          find.byType(SingleChildScrollView),
          findsAtLeastNWidgets(1),
          reason: 'a table scrolls sideways',
        );
      },
    );
  }
}

Future<void> _send(WidgetTester tester, String text) async {
  await tester.enterText(find.byType(TextField), text);
  await tester.pump();
  await tester.tap(find.byTooltip('Send'));
  await tester.pumpAndSettle();
}
