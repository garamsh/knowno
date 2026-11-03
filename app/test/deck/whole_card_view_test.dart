import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/deck/src/card_frame.dart';
import 'package:knowno/deck/src/content.dart';
import 'package:knowno/deck/src/whole_card_view.dart';
import 'package:knowno/design/theme.dart';
import 'package:knowno/media/media.dart';

import '../design/harness.dart';
import 'whole_cards.dart';

void main() {
  const cloze = ClozeContent('The capital is $clozeBlank today', ['Paris']);

  /// The blank's span under the card.
  TextSpan blankSpan(WidgetTester tester) {
    TextSpan? found;
    for (final paragraph in tester.widgetList<RichText>(
      find.descendant(
        of: find.byType(WholeCardView),
        matching: find.byType(RichText),
      ),
    )) {
      paragraph.text.visitChildren((span) {
        if (span is TextSpan && blankAnswer(span.text ?? '') == 'Paris') {
          found = span;
        }
        return true;
      });
    }
    return found ?? (throw StateError('no blank drawn'));
  }

  for (final MapEntry(key: themeMode, value: colors) in themeModes.entries) {
    testWidgets('an empty blank is a gap of its answer\'s width over a muted '
        'underline, with no fill, and a filled one keeps the brand tint, in '
        '${themeMode.name}', (tester) async {
      Future<Size> pump({required bool revealed}) async {
        await pumpComponent(
          tester,
          WholeCardView(const [cloze], revealed: revealed, style: AppType.back),
          themeMode: themeMode,
        );
        return tester.getSize(
          find.descendant(
            of: find.byType(WholeCardView),
            matching: find.byType(RichText),
          ),
        );
      }

      final empty = await pump(revealed: false);
      final style = blankSpan(tester).style!;
      expect(style.backgroundColor, isNull, reason: 'no grey bar');
      expect(style.color?.a, 0, reason: 'the answer is not drawn');
      expect(style.decoration, TextDecoration.underline);
      expect(style.decorationColor, colors.muted);
      expect(isEmptyBlank(style), isTrue);
      expect(blanksUnder(find.byType(WholeCardView)), {'Paris': false});

      // Control: filled, the same span is drawn on the brand tint, and the
      // line keeps its size, so the gap was the answer's width.
      final filled = await pump(revealed: true);
      expect(blankSpan(tester).style!.backgroundColor, colors.brandTint);
      expect(blanksUnder(find.byType(WholeCardView)), {'Paris': true});
      expect(filled, empty);
    });
  }

  for (final MapEntry(key: themeMode, value: colors) in themeModes.entries) {
    testWidgets('on study\'s cards an empty blank is a box on the hatch three '
        'ems wide at its line\'s height whatever its answer, with no '
        'underline and no answer, and a filled one its answer on the hatch, '
        'in ${themeMode.name} (#635)', (tester) async {
      const short = ClozeContent('$clozeBlank is short', ['A']);
      const long = ClozeContent('$clozeBlank is long', [
        'A much longer answer',
      ]);
      for (final block in [short, long]) {
        await pumpComponent(
          tester,
          WholeCardView.studied(
            [BlankCell(block)],
            revealed: false,
            style: AppType.back,
          ),
          themeMode: themeMode,
        );
        final card = find.byType(WholeCardView);
        expect(boxedBlanksUnder(card), 1);
        final hatch = tester.widget<DecoratedBox>(
          find.descendant(
            of: find.byKey(const Key('hatchedBlank')),
            matching: find.byType(DecoratedBox),
          ),
        );
        expect(
          hatch.decoration,
          isA<HatchDecoration>().having((it) => it.colors, 'colors', colors),
        );
        final box = tester.getSize(find.byKey(const Key('hatchedBlank')));
        expect(box.width, AppType.back.fontSize! * blankEms);
        expect(
          box.height,
          AppType.back.fontSize! * AppType.back.height! - AppSpace.s4,
        );
        // No underline and no answer anywhere in the sentence.
        expect(blanksUnder(card), isEmpty);
        expect(find.textContaining(block.answers.single), findsNothing);
      }

      // Control: revealed, the answer is drawn on the hatch's paint, and the
      // box is gone.
      await pumpComponent(
        tester,
        const WholeCardView.studied(
          [BlankCell(long)],
          revealed: true,
          style: AppType.back,
        ),
        themeMode: themeMode,
      );
      expect(boxedBlanksUnder(find.byType(WholeCardView)), 0);
      expect(hatchedBlanksUnder(find.byType(WholeCardView)), [
        'A much longer answer',
      ]);
    });
  }

  testWidgets('a Korean cloze sentence breaks only between words, its blank '
      'included, and reads as written (#454)', (tester) async {
    const korean = ClozeContent(
      '낮에는 친구들과 함께 춤을 추고 밤에는 $clozeBlank 노래를 부르며 하루를 보냈어요',
      ['조용히'],
    );
    await pumpComponent(
      tester,
      const SizedBox(
        width: 180,
        child: WholeCardView([korean], revealed: false, style: AppType.back),
      ),
      themeMode: ThemeMode.light,
    );
    final paragraph = tester.renderObject<RenderParagraph>(
      find.descendant(
        of: find.byType(WholeCardView),
        matching: find.byType(RichText),
      ),
    );
    final plain = paragraph.text.toPlainText();
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
    // It wraps at this width, so where it breaks is tested.
    expect(ends.length, greaterThan(2));
    bool space(String char) => char == ' ' || char == '\u00a0';
    for (final end in ends.take(ends.length - 1)) {
      expect(
        space(plain[end - 1]) || space(plain[end]),
        isTrue,
        reason: 'a break at $end in "$plain"',
      );
    }
    // The joiners are not read: the card reads as its words.
    expect(find.bySemanticsLabel(RegExp('^낮에는 친구들과 함께 춤을')), findsOneWidget);
  });

  group('a whole card of 칸', () {
    const blank = BlankCell(cloze);
    const glue = TextCell(front: 'Title', back: 'Added');
    const word = WordCell(
      term: 'apple',
      senses: [CardSense(meaning: '사과')],
      ask: WordAsk.term,
    );
    const meaningFirst = WordCell(
      term: 'apple',
      senses: [CardSense(meaning: '사과')],
      ask: WordAsk.meaning,
    );
    final photo = PlacedCell(
      const ImageContent(media: MediaId('m'), width: 4, height: 3),
      CellSide.back,
    );

    List<String> order(WidgetTester tester) => [
      for (final text in tester.widgetList<RichText>(
        find.descendant(
          of: find.byType(WholeCardView),
          matching: find.byType(RichText),
        ),
      ))
        text.text
            .toPlainText()
            .replaceAll('⁠', '')
            .trim()
            .replaceAll(RegExp(r'\s+'), ' '),
    ];

    TextStyle styleOf(WidgetTester tester, String text) =>
        tester.widget<Text>(find.text(text)).style!;

    testWidgets('before the reveal it draws a 글\'s front as a title, a 단어\'s '
        'asked side and the blank empty, in order', (tester) async {
      await pumpComponent(
        tester,
        const WholeCardView.cells(
          [glue, word, blank],
          revealed: false,
          style: AppType.front,
        ),
      );
      expect(order(tester), ['Title', 'apple', 'The capital is Paris today']);
      expect(styleOf(tester, 'Title').fontSize, AppType.wholeFront.fontSize);
      expect(blanksUnder(find.byType(WholeCardView)), {'Paris': false});
      expect(find.text('Added'), findsNothing);
      expect(find.textContaining('사과'), findsNothing);
    });

    for (final MapEntry(key: themeMode, value: colors) in themeModes.entries) {
      testWidgets('after it each added part is under its larger first part '
          'in ink2, the blank filled, in ${themeMode.name}', (tester) async {
        await pumpComponent(
          tester,
          const WholeCardView.cells(
            [glue, word, blank],
            revealed: true,
            style: AppType.front,
          ),
          themeMode: themeMode,
        );
        expect(order(tester), [
          'Title',
          'Added',
          'apple',
          '사과',
          'The capital is Paris today',
        ]);
        final added = styleOf(tester, 'Added');
        expect(added.fontSize, 18);
        expect(added.fontWeight, AppType.wholeAdded.fontWeight);
        expect(styleOf(tester, 'Title').fontSize, 20);
        expect(added.color, colors.ink2);
        expect(blanksUnder(find.byType(WholeCardView)), {'Paris': true});
      });
    }

    testWidgets("a 단어 asking its meaning shows the meaning first, the word "
        'added', (tester) async {
      await pumpComponent(
        tester,
        const WholeCardView.cells(
          [meaningFirst, blank],
          revealed: false,
          style: AppType.front,
        ),
      );
      expect(find.textContaining('사과'), findsOneWidget);
      expect(find.text('apple'), findsNothing);
    });

    testWidgets('a 글 with a back alone draws nothing before the reveal', (
      tester,
    ) async {
      await pumpComponent(
        tester,
        const WholeCardView.cells(
          [blank, TextCell(back: 'Only after')],
          revealed: false,
          style: AppType.front,
        ),
      );
      expect(order(tester), hasLength(1));
      expect(find.text('Only after'), findsNothing);
    });

    testWidgets('in a list row\'s style an added part keeps the row\'s size', (
      tester,
    ) async {
      await pumpComponent(
        tester,
        const WholeCardView.cells(
          [glue, blank],
          revealed: true,
          style: AppType.label,
        ),
      );
      expect(styleOf(tester, 'Added').fontSize, AppType.label.fontSize);
      expect(styleOf(tester, 'Added').color, AppColors.light.ink2);
      expect(styleOf(tester, 'Added').fontWeight, FontWeight.w400);
    });

    test('a photo on the back is a part after the reveal alone', () {
      final cells = [blank, photo];
      expect(partsOf(cells, revealed: false), hasLength(1));
      expect(partsOf(cells, revealed: true), [
        (block: cloze, added: false),
        (block: photo.block, added: true),
      ]);
    });
  });

  group('the 칸 a card of two sides is drawn from', () {
    test('a block this build cannot show is kept, after the 칸 it knows', () {
      const later = UnsupportedContent('video', {'media': 'm1'});
      final cells = cellsToDraw([cloze, later], [const TextContent('kept')]);
      expect(cells, [
        const BlankCell(cloze),
        const TextCell(back: 'kept'),
        const UnknownCell(later),
      ]);
      expect(isDrawnWhole(cells), isTrue);
      // Control: the same block with no blank beside it stays split.
      expect(isDrawnWhole(cellsToDraw([later], const [])), isFalse);
    });
  });
}
