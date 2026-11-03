import 'package:flutter/material.dart';

import '../../deck/deck.dart';
import 'above_menu.dart';

/// Opens [deck]'s screen in the 노트 tab, with the add-card sheet up while
/// [addingCard].
typedef OpenDeck = void Function(Deck deck, {bool addingCard});

/// Opens 새 노트 over the menu, then the deck it made through [open], with
/// the add-card sheet up when "저장하고 카드 추가" made it.
Future<void> openNewDeck(BuildContext context, OpenDeck open) async {
  final made = await Navigator.of(aboveMenu(context))
      .push(MaterialPageRoute<NewDeck>(builder: (_) => const NewDeckScreen()));
  if (made == null) return;
  open(made.deck, addingCard: made.addCards);
}
