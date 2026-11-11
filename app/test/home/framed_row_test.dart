import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/deck/deck.dart';
import 'package:knowno/home/src/deck_screen.dart';

import '../word_breaks.dart';
import 'deck_screens.dart';

void main() {
  testWidgets('the deck screen draws a framed card by the 칸 it stores, a back '
      'under the 글 it was written on', (tester) async {
    const cells = [
      BlankCell(ClozeContent('{{c1::Rose}} is red.')),
      TextCell(front: 'one'),
      TextCell(front: 'two', back: 'of two'),
    ];
    final sides = sidesOf(cells);
    final screens = await DeckScreens.open(tester);
    await tester.runAsync(
      () => screens.repository.addCards(AddToDeck(screens.deck.id), [
        IncomingCard(
          front: sides.front,
          back: sides.back,
          cells: cells,
          onDuplicate: DuplicateChoice.addNew,
        ),
      ]),
    );
    expect((await screens.cards()).single.cells, cells, reason: 'the setup');
    await screens.push((deck) => DeckScreen(deck: deck));
    double top(String text) => tester.getTopLeft(shownText(text)).dy;
    expect(top('two'), lessThan(top('of two')));
    expect(top('one'), lessThan(top('two')));
    await screens.close();
  });
}
