import 'package:flutter/material.dart';

import '../../deck/deck.dart';
import 'above_menu.dart';
import 'deck_screen.dart';

/// Opens 새 노트 over the menu, then the deck it made on [context]'s
/// navigator, with the add-card sheet up when "저장하고 카드 추가" made it.
Future<void> openNewDeck(BuildContext context) async {
  final navigator = Navigator.of(context);
  final made = await Navigator.of(aboveMenu(context))
      .push(MaterialPageRoute<NewDeck>(builder: (_) => const NewDeckScreen()));
  if (made == null) return;
  await navigator.push(
    MaterialPageRoute<void>(
      builder: (_) => DeckScreen(deck: made.deck, addingCard: made.addCards),
    ),
  );
}
