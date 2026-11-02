import '../../media/media.dart';
import 'card_frame.dart';
import 'card_key.dart';
import 'content.dart';

/// Identifies a deck.
extension type const DeckId(String value) {}

/// Identifies a card.
extension type const CardId(String value) {}

/// One or more decks studied together; never empty.
final class DeckSelection {
  /// The selection of [first] and every deck in [rest].
  DeckSelection(DeckId first, [Iterable<DeckId> rest = const []])
    : ids = Set.unmodifiable({first, ...rest});

  final Set<DeckId> ids;

  /// The selection of [decks], or null when there is none.
  static DeckSelection? of(Iterable<DeckId> decks) =>
      decks.isEmpty ? null : DeckSelection(decks.first, decks.skip(1));
}

/// Whether other signed-in users can find a deck.
sealed class DeckVisibility {
  const DeckVisibility();
}

/// Only its owner sees the deck; the default.
final class PrivateDeck extends DeckVisibility {
  const PrivateDeck();
}

/// Others can find, preview and copy the deck, since [publishedAt].
final class PublicDeck extends DeckVisibility {
  const PublicDeck(this.publishedAt);

  final DateTime publishedAt;
}

/// The icons a deck's tile can hold, each stored under its [key].
enum DeckIcon {
  layers('layers'),
  book('book'),
  languages('languages'),
  pencil('pencil'),
  flask('flask'),
  calculator('calculator'),
  globe('globe'),
  music('music'),
  palette('palette'),
  brain('brain'),
  code('code'),
  landmark('landmark'),
  briefcase('briefcase'),
  star('star');

  const DeckIcon(this.key);

  /// What the deck stores for the icon.
  final String key;

  /// The icon a deck shows while it holds none this build knows.
  static const fallback = DeckIcon.layers;

  /// The icon stored as [key]; null for none, or for a key this build does
  /// not know, such as one a newer app wrote.
  static DeckIcon? fromKey(String? key) {
    for (final icon in values) {
      if (icon.key == key) return icon;
    }
    return null;
  }
}

/// The colours a deck's tile can take, each stored under its [key].
enum DeckColor {
  blue('blue'),
  sky('sky'),
  violet('violet'),
  sand('sand'),
  amber('amber'),
  slate('slate');

  const DeckColor(this.key);

  /// What the deck stores for the colour.
  final String key;

  /// The colours a picker offers, t1 to t4. A deck that stored [sky] or
  /// [amber], offered before, still draws it.
  static const offered = [blue, violet, sand, slate];

  /// The colour stored as [key]; null for none, or for a key this build
  /// does not know, such as one a newer app wrote.
  static DeckColor? fromKey(String? key) {
    for (final color in values) {
      if (color.key == key) return color;
    }
    return null;
  }
}

/// A named collection of cards.
final class Deck {
  const Deck({
    required this.id,
    required this.name,
    required this.createdAt,
    required this.updatedAt,
    this.visibility = const PrivateDeck(),
    this.description,
    this.icon,
    this.color,
    this.image,
  });

  final DeckId id;
  final String name;
  final DateTime createdAt;
  final DateTime updatedAt;
  final DeckVisibility visibility;

  /// What the owner wrote about the deck when publishing it, if anything.
  final String? description;

  /// The icon the owner chose for the deck's tile; null while none this
  /// build knows is chosen.
  final DeckIcon? icon;

  /// The colour the owner chose for the deck's tile; null while none this
  /// build knows is chosen.
  final DeckColor? color;

  /// The image the owner chose for the deck's tile, drawn in place of its
  /// icon; null while none is chosen.
  final MediaId? image;
}

/// Where a card came from: the editor writes [manual], photo import
/// [import], and a copy of another user's public deck [copy].
enum CardSource { manual, import, copy }

/// A card inside a deck.
final class Card {
  const Card({
    required this.id,
    required this.deckId,
    required this.front,
    required this.back,
    required this.cardKey,
    required this.source,
    required this.createdAt,
    required this.updatedAt,
    this.originDeckId,
    this.template,
    this.templateVersion,
    this.cells,
  });

  final CardId id;
  final DeckId deckId;
  final List<Content> front;
  final List<Content> back;
  final CardKey cardKey;
  final CardSource source;
  final DateTime createdAt;
  final DateTime updatedAt;

  /// The public deck a [CardSource.copy] card was copied from; null for any
  /// other card.
  final DeckId? originDeckId;

  /// The template the card was made from, as stored: `flip`, `cloze`,
  /// `table`, or one a later build added. It only decides how the editor
  /// opens the card; null until the card's first write in a build that
  /// records it (ADR 0106).
  final String? template;

  /// The version of [template] the card was written in; null with it.
  final int? templateVersion;

  /// The 칸 list a framed card stores, of which [front] and [back] are the
  /// projection; null on an earlier card (ADR 0137). Read through [cellsOf].
  final List<Cell>? cells;
}
