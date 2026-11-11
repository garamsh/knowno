import 'package:knowno/database/database.dart';
import 'package:knowno/deck/deck.dart';
import 'package:knowno/deck/src/card_template.dart';
import 'package:knowno/deck/src/content.dart';

/// Stores a card of two side lists in [deck], as a build before the 칸 frame
/// wrote it: the app writes none, and a test of how one reads, edits or merges
/// needs the row. Returns the card as [repository] reads it.
Future<Card> storeSides(
  AppDatabase db,
  DeckRepository repository,
  DeckId deck, {
  required List<Content> front,
  required List<Content> back,
  String? template = freeTemplate,
  int? templateVersion = cardTemplateVersion,
}) async {
  var blocks = 0;
  List<Content> withIds(List<Content> sides) => [
    for (final block in sides)
      switch (block) {
        UnsupportedContent() || Content(id: _?) => block,
        _ => withBlockId(block, 'block-${blocks++}'),
      },
  ];
  final id = 'sides-${(await db.select(db.cards).get()).length}';
  final at = DateTime.utc(2026, 1, 1);
  await db
      .into(db.cards)
      .insert(
        CardRow(
          id: id,
          deckId: deck.value,
          front: encodeContent(withIds(front)),
          back: encodeContent(withIds(back)),
          cardKey: CardKey.fromFront(plainText(front)).value,
          source: 'manual',
          template: template,
          templateVersion: templateVersion,
          createdAt: at,
          updatedAt: at,
          dirty: true,
        ),
      );
  return (await repository.listCards(deck))
      .singleWhere((card) => card.id.value == id);
}
