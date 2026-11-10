import '../../account/account.dart';
import '../../deck/deck.dart';

/// A public deck as the listing shows it.
final class PublicDeckSummary {
  const PublicDeckSummary({
    required this.id,
    required this.owner,
    required this.ownerName,
    required this.name,
    required this.description,
    required this.cardCount,
    required this.copyCount,
    required this.publishedAt,
  });

  final DeckId id;
  final UserId owner;

  /// The owner's display name; never the owner's email.
  final DisplayName ownerName;
  final String name;
  final String? description;
  final int cardCount;

  /// How many times other users copied the deck.
  final int copyCount;
  final DateTime publishedAt;
}

/// A card of a public deck, read-only.
final class PublicCard {
  const PublicCard({required this.front, required this.back, this.cells});

  final List<Content> front;
  final List<Content> back;

  /// The 칸 a framed card stores, [front] and [back] their projection; null
  /// on a card stored in two sides.
  final List<Cell>? cells;
}

/// The order the listing takes.
enum BrowseSort {
  /// Most recently published first.
  newest,

  /// Most copied first.
  mostCopied,
}

/// Why a user reports a public deck.
enum ReportReason { inappropriate, sexual, spam, copyright, other }

/// What an AI hid a note as, by the key the server gives.
enum TriageCategory { spam, ad }

/// Where the owner's appeal of an AI's hiding stands.
enum AppealState {
  /// Not appealed; the owner may appeal once.
  open,

  /// Appealed; a person has not decided.
  pending,

  /// A person decided to keep the note hidden.
  upheld,
}

/// A note an AI hid and has not been restored, as its owner reads it.
final class AiHidden {
  const AiHidden({required this.appeal, this.category});

  final AppealState appeal;

  /// What the AI judged the note; null while the server does not say or
  /// answers a category this app does not know.
  final TriageCategory? category;
}

/// What the owner's appeal did.
enum AppealOutcome {
  /// The appeal was sent.
  appealed,

  /// The standing action had been appealed already; nothing changed.
  already,

  /// No standing AI action hides the note.
  notHiddenByAi,
}

/// What a report did.
enum ReportOutcome {
  /// The report was filed.
  reported,

  /// The user had already reported the deck; nothing changed.
  alreadyReported,
}

/// The name shown with a user's public decks: 2 to 20 characters, without
/// surrounding whitespace.
extension type const DisplayName._(String value) {
  /// [input] trimmed, or null when it is not 2 to 20 characters long.
  static DisplayName? tryParse(String input) {
    final trimmed = input.trim();
    final length = trimmed.runes.length;
    return length >= minLength && length <= maxLength
        ? DisplayName._(trimmed)
        : null;
  }

  /// Wraps a name the server returned, which its check already holds to the
  /// same rule.
  const DisplayName.stored(String value) : this._(value);

  static const minLength = 2;
  static const maxLength = 20;
}

/// The longest description a public deck takes, in characters.
const maxDescriptionLength = 300;

/// Where in a note a finding of the screening is.
enum FindingPlace { name, description, front, back }

/// What a finding of the screening found, by the key the server gives;
/// [other] for a key a later server added.
enum FindingCategory {
  residentNumber('resident_number'),
  account('account'),
  phone('phone'),
  link('link'),
  kakaoId('kakao_id'),
  contact('contact'),
  repeat('repeat'),
  term('term'),
  other('');

  const FindingCategory(this.key);

  final String key;

  static FindingCategory fromKey(String key) {
    for (final category in values) {
      if (category.key == key) return category;
    }
    return other;
  }
}

/// One place the screening found something that cannot be public: a card's
/// face, the name or the description, and the characters in it, as UTF-16
/// offsets into the block's text.
final class ScreeningFinding {
  const ScreeningFinding({
    required this.place,
    required this.category,
    this.card,
    this.block,
    this.field,
    this.start,
    this.end,
  });

  final FindingPlace place;
  final FindingCategory category;

  /// The card, for a finding on a face; null for the name and description.
  final CardId? card;

  /// The block of the face, or of the 칸 list, holding the finding.
  final int? block;

  /// The path in the block's stored payload of the string [start] and [end]
  /// index, as `senses.1.meaning`; null for the name and description, and
  /// from a server that does not say.
  final String? field;
  final int? start;
  final int? end;
}

/// What the server's screening answered for a note: where it has the note,
/// why it refused it, and where it found something.
final class Screening {
  const Screening(this.state, {this.refusal, this.findings = const []});

  final DeckPublication state;

  /// The layer that refused the note (`rules`, `ai` or `admin`); null unless
  /// [state] is [DeckPublication.refused].
  final String? refusal;
  final List<ScreeningFinding> findings;
}
