import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/deck/deck.dart';
import 'package:knowno/design/theme.dart';
import 'package:knowno/l10n/app_localizations.dart';

import '../design/harness.dart';
import '../word_breaks.dart';
import 'whole_cards.dart';

/// The text of every paragraph under [of], word joiners left out.
String _plain(Finder of) => find
    .descendant(of: of, matching: find.byType(RichText))
    .evaluate()
    .map(
      (element) => (element.widget as RichText).text
          .toPlainText(includeSemanticsLabels: false)
          .replaceAll('⁠', ''),
    )
    .join('\n');

/// The weight and style [word] is drawn in under [of], inherited through its
/// spans.
({FontWeight? weight, FontStyle? fontStyle, String? family}) _styleOf(
  Finder of,
  String word,
) {
  ({FontWeight? weight, FontStyle? fontStyle, String? family})? found;
  void walk(InlineSpan span, TextStyle? inherited) {
    if (span is! TextSpan) return;
    final style = inherited?.merge(span.style) ?? span.style;
    if (span.text?.replaceAll('⁠', '') == word) {
      found = (
        weight: style?.fontWeight,
        fontStyle: style?.fontStyle,
        family: style?.fontFamily,
      );
    }
    for (final child in span.children ?? const <InlineSpan>[]) {
      walk(child, style);
    }
  }

  for (final element
      in find.descendant(of: of, matching: find.byType(RichText)).evaluate()) {
    walk((element.widget as RichText).text, null);
  }
  return found ?? (throw StateError('"$word" is not drawn'));
}

void main() {
  const text = TextContent(
    '**bold** and *slanted* and `code`\n- one\n- two\n\n1. first',
    markup: true,
  );
  const cloze = ClozeContent(
    'The {{c1::cat::animal}} sat on the {{c2::mat}}, {{c1::cat}}',
  );

  group('a text of version 3', () {
    testWidgets('draws its marks, its lists and its line breaks on a card', (
      tester,
    ) async {
      await pumpComponent(
        tester,
        const WholeCardView([text], revealed: true, style: AppType.back),
      );
      final under = find.byType(WholeCardView);
      expect(
        _plain(under),
        'bold and slanted and code\n• one\n• two\n\n1. first',
      );
      expect(_styleOf(under, 'bold').weight, FontWeight.w700);
      expect(_styleOf(under, 'slanted').fontStyle, FontStyle.italic);
      expect(_styleOf(under, 'code').family, 'monospace');
    });

    testWidgets(
      'draws as a text in the content view, and as one line of a card list row',
      (tester) async {
        await pumpComponent(tester, const ContentView([text]));
        expect(
          _plain(find.byType(ContentView)),
          'bold and slanted and code\n• one\n• two\n\n1. first',
        );
        expect(
          _styleOf(find.byType(ContentView), 'bold').weight,
          FontWeight.w700,
        );
        await pumpComponent(
          tester,
          WholeCardView.listed(const [
            TextCell(front: '**bold** line'),
          ], style: AppType.body),
        );
        expect(_plain(find.byType(WholeCardView)), 'bold line');
      },
    );

    testWidgets('is read as its words by a screen reader, with no mark', (
      tester,
    ) async {
      await pumpComponent(tester, const SizedBox());
      final l10n = AppLocalizations.of(tester.element(find.byType(SizedBox)));
      expect(
        describeContent(l10n, [text]),
        contains('bold and slanted and code'),
      );
      expect(describeContent(l10n, [text]), isNot(contains('**')));
    });

    testWidgets(
      'a text of version 1 or 2 shows as written, its marks literal',
      (tester) async {
        await pumpComponent(
          tester,
          const WholeCardView(
            [TextContent('**bold** `code` {{c1::x}}')],
            revealed: true,
            style: AppType.back,
          ),
        );
        expect(_plain(find.byType(WholeCardView)), '**bold** `code` {{c1::x}}');
      },
    );
  });

  group('a cloze of version 2', () {
    for (final MapEntry(key: themeMode, value: _) in themeModes.entries) {
      testWidgets(
        'is drawn with each blank empty, its hint in its place, then filled in, in ${themeMode.name}',
        (tester) async {
          await pumpComponent(
            tester,
            const WholeCardView([cloze], revealed: false, style: AppType.back),
            themeMode: themeMode,
          );
          expect(blanksUnder(find.byType(WholeCardView)), {
            'mat': false,
            'cat': false,
          }, reason: 'the span with a hint shows it, not its answer');
          expect(_plain(find.byType(WholeCardView)), contains('animal'));
          expect(
            _plain(find.byType(WholeCardView)),
            isNot(contains('The cat')),
          );
          await pumpComponent(
            tester,
            const WholeCardView([cloze], revealed: true, style: AppType.back),
            themeMode: themeMode,
          );
          expect(blanksUnder(find.byType(WholeCardView)), {
            'cat': true,
            'mat': true,
          });
          expect(
            _plain(find.byType(WholeCardView)),
            'The  cat  sat on the  mat ,  cat ',
          );
        },
      );
    }

    testWidgets(
      'is a box for each span on study\'s card, a hint in its box, and filled on the hatch once revealed',
      (tester) async {
        await pumpComponent(
          tester,
          WholeCardView.studied(
            const [BlankCell(cloze)],
            revealed: false,
            style: AppType.back,
          ),
        );
        expect(boxedBlanksUnder(find.byType(WholeCardView)), 3);
        expect(shownText('animal'), findsOneWidget);
        expect(shownText('cat'), findsNothing);
        await pumpComponent(
          tester,
          WholeCardView.studied(
            const [BlankCell(cloze)],
            revealed: true,
            style: AppType.back,
          ),
        );
        expect(hatchedBlanksUnder(find.byType(WholeCardView)), [
          'cat',
          'mat',
          'cat',
        ]);
      },
    );

    testWidgets('is read by a screen reader as blanks until the reveal', (
      tester,
    ) async {
      await pumpComponent(tester, const SizedBox());
      final l10n = AppLocalizations.of(tester.element(find.byType(SizedBox)));
      expect(
        spokenContent(l10n, [cloze], revealed: false),
        'The blank sat on the blank, blank',
      );
      expect(
        spokenContent(l10n, [cloze], revealed: true),
        'The cat sat on the mat, cat',
      );
      expect(describeContent(l10n, [cloze]), 'The cat sat on the mat, cat');
    });

    testWidgets(
      'a cloze of version 1 is drawn as before, `___` and its answers',
      (tester) async {
        await pumpComponent(
          tester,
          const WholeCardView(
            [ClozeContent('The {{c1::cat}} sat')],
            revealed: true,
            style: AppType.back,
          ),
        );
        expect(blanksUnder(find.byType(WholeCardView)), {'cat': true});
      },
    );
  });
}
