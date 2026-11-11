import 'dart:convert';

import '../../deck/deck.dart';
import 'extraction_client.dart';

/// Which cards a vocabulary row makes: word to meaning, meaning to word, or
/// both.
enum Direction { forward, backward, both }

/// How the cards of one section read. A vocabulary section's form decides
/// the direction and what its meanings show; a note section's whether front
/// and back are swapped. The user picks it from the section's menu, and the
/// device remembers it per deck and topic.
sealed class SectionForm {
  const SectionForm();

  /// The form [json] stores, or null when it is not one.
  static SectionForm? fromJson(Object? json) => switch (json) {
    {
      'direction': final String direction,
      'firstSenseOnly': final bool firstSenseOnly,
      'showPos': final bool showPos,
      'showPronunciation': final bool showPronunciation,
      'showExtras': final bool showExtras,
    } =>
      switch (Direction.values.where((d) => d.name == direction).firstOrNull) {
        final direction? => VocabularyForm(
          direction: direction,
          firstSenseOnly: firstSenseOnly,
          showPos: showPos,
          showPronunciation: showPronunciation,
          showExtras: showExtras,
        ),
        null => null,
      },
    {'swapped': final bool swapped} => NoteForm(swapped: swapped),
    _ => null,
  };

  Map<String, Object> toJson();
}

/// How a vocabulary section's cards read: by default word to meaning, every
/// sense with its part of speech, and no pronunciation or extras.
final class VocabularyForm extends SectionForm {
  const VocabularyForm({
    this.direction = Direction.forward,
    this.firstSenseOnly = false,
    this.showPos = true,
    this.showPronunciation = false,
    this.showExtras = false,
  });

  final Direction direction;
  final bool firstSenseOnly;
  final bool showPos;
  final bool showPronunciation;
  final bool showExtras;

  VocabularyForm copyWith({
    Direction? direction,
    bool? firstSenseOnly,
    bool? showPos,
    bool? showPronunciation,
    bool? showExtras,
  }) => VocabularyForm(
    direction: direction ?? this.direction,
    firstSenseOnly: firstSenseOnly ?? this.firstSenseOnly,
    showPos: showPos ?? this.showPos,
    showPronunciation: showPronunciation ?? this.showPronunciation,
    showExtras: showExtras ?? this.showExtras,
  );

  @override
  Map<String, Object> toJson() => {
    'direction': direction.name,
    'firstSenseOnly': firstSenseOnly,
    'showPos': showPos,
    'showPronunciation': showPronunciation,
    'showExtras': showExtras,
  };
}

/// How a note section's cards read: front and back as the page gave them, or
/// swapped.
final class NoteForm extends SectionForm {
  const NoteForm({this.swapped = false});

  final bool swapped;

  @override
  Map<String, Object> toJson() => {'swapped': swapped};
}

/// One sense of a row, which the user keeps or drops, edits and reorders.
final class RowSense {
  RowSense(this.labels, this.meaning, this.examples);

  final List<SenseLabel> labels;
  String meaning;
  final List<String> examples;
  bool kept = true;

  /// The labels as a card shows them, `[명] [사물]`; null without one.
  String? get labelText => labels.isEmpty
      ? null
      : [for (final label in labels) '[${label.shown}]'].join(' ');
}

/// The two sides a row draws in the list, the projection of its first card.
typedef CardSides = ({List<Content> front, List<Content> back});

/// The candidates of one card key on one photo, combined into one row the
/// user includes or leaves out, and edits.
final class ImportRow {
  ImportRow(this.sources)
    : front = sources.first.front,
      senses = [
        for (final sense in {for (final card in sources) ...card.senses})
          RowSense(sense.labels, sense.meaning, sense.examples),
      ],
      answer = _mergedAnswer(sources);

  /// Every candidate with this row's key, in the order the photo gave them.
  final List<CandidateCard> sources;

  String front;

  /// A vocabulary row's senses in their order, each kept or dropped.
  final List<RowSense> senses;

  /// A note row's answer: the first candidate's, with each later one's joined
  /// by the merge-back rule.
  String answer;

  /// Whether the user included the row (true) or left it out (false); null
  /// until they do either, when [ImportList.isIncluded] decides.
  bool? included;

  CardKind get kind => sources.first.kind;
  CardType get type => sources.first.type;
  String get topic => sources.first.topic;
  String? get pronunciation => sources.first.pronunciation;
  List<Extra> get extras => sources.first.extras;

  /// Whether the row has anything to save: a note always, a vocabulary row
  /// while it keeps a sense.
  bool get savable =>
      kind == CardKind.note || senses.any((sense) => sense.kept);

  static String _mergedAnswer(List<CandidateCard> sources) {
    var blocks = <Content>[TextContent(sources.first.answer)];
    for (final card in sources.skip(1)) {
      blocks = mergeBack(blocks, card.answer) ?? blocks;
    }
    return plainText(blocks);
  }

  /// The 칸 of a vocabulary row in [form], [ask] naming the side shown first:
  /// a 단어 of the kept senses, or the first alone, each without its
  /// part-of-speech labels when the form hides them, its other labels kept;
  /// then a 글 of a back alone of what the form shows of the pronunciation and
  /// the extras (ADR 0075, ADR 0137). With no sense kept nothing is saved, and
  /// a 글 of the word stands for the 단어 in the list.
  List<Cell> _word(VocabularyForm form, WordAsk ask) {
    final kept = senses.where((sense) => sense.kept);
    final shown = form.firstSenseOnly ? kept.take(1) : kept;
    final added = [
      if (form.showPronunciation) ?pronunciation,
      if (form.showExtras)
        for (final extra in extras) '${extra.label} ${extra.text}',
    ];
    return [
      if (shown.isEmpty)
        ask == WordAsk.term
            ? TextCell.literal(front: front)
            : TextCell.literal(back: front)
      else
        WordCell(
          term: front,
          senses: [
            for (final sense in shown)
              CardSense(
                labels: [
                  for (final label in sense.labels)
                    if (form.showPos || label is! PartOfSpeechLabel) label,
                ],
                meaning: sense.meaning,
                examples: sense.examples,
              ),
          ],
          ask: ask,
        ),
      if (added.isNotEmpty) TextCell.literal(back: added.join('\n')),
    ];
  }

  /// A table or cloze row's front blocks, drawn whole; null for any other
  /// row (ADR 0068).
  List<Content>? get wholeFront => sources.first.wholeFront;

  /// The 칸 of a [wholeFront]; null without one, or for one holding a block
  /// this build does not know.
  List<Cell>? get _wholeCells => switch (wholeFront) {
    final blocks? => cellsFromSides(blocks, const []),
    null => null,
  };

  /// The cards the row saves in [form], each a list of 칸. A table or cloze
  /// row saves one, its [wholeFront] alone, in any form.
  List<List<Cell>> cards(SectionForm form) => switch ((_wholeCells, form)) {
    (final cells?, _) => [cells],
    (_, final VocabularyForm form) when kind == CardKind.vocabulary => [
      if (form.direction != Direction.backward) _word(form, WordAsk.term),
      if (form.direction != Direction.forward) _word(form, WordAsk.meaning),
    ],
    (_, NoteForm(swapped: true)) => [
      [TextCell(front: answer, back: front)],
    ],
    _ => [
      [TextCell(front: front, back: answer)],
    ],
  };
}

/// The rows of one topic of one photo, of one kind, identify cards apart,
/// with the form their cards take.
final class ImportSection {
  ImportSection({
    required this.topic,
    required this.kind,
    required this.identify,
    this.photo = 0,
  }) : form = kind == CardKind.vocabulary && !identify
           ? const VocabularyForm()
           : const NoteForm();

  /// The topic's name.
  final String topic;

  final CardKind kind;

  /// Whether the section holds the topic's identify cards.
  final bool identify;

  /// The photo the rows come from, counted from 0 in the order read.
  final int photo;

  final rows = <ImportRow>[];

  SectionForm form;

  /// The key the device remembers the section's form under, within a deck.
  String get formKey => '${identify ? 'identify:' : ''}${kind.name}:$topic';
}

/// The rows of one or more photos, by photo and then in sections by topic,
/// against the keys the deck they go into already holds.
final class ImportList {
  /// The rows of one photo's [cards]; [addPhoto] adds each later photo.
  ImportList(List<CandidateCard> cards, this.existingKeys) {
    addPhoto(cards);
  }

  /// The sections, photo by photo, each photo's in the order each first
  /// appears, identify cards after the page's own.
  final sections = <ImportSection>[];

  /// How many photos the rows come from.
  int photoCount = 0;

  /// Adds the rows of another photo's [cards] after every row there is, in
  /// sections of their own; returns those sections.
  List<ImportSection> addPhoto(List<CandidateCard> cards) {
    final photo = photoCount++;
    final added = <ImportSection>[];
    final groups = <CardKey, List<CandidateCard>>{};
    for (final card in cards) {
      (groups[CardKey.fromFront(card.front)] ??= []).add(card);
    }
    for (final group in groups.values) {
      final row = ImportRow(group);
      final identify = row.type == CardType.identify;
      var section = added
          .where(
            (section) =>
                section.topic == row.topic &&
                section.kind == row.kind &&
                section.identify == identify,
          )
          .firstOrNull;
      if (section == null) {
        section = ImportSection(
          topic: row.topic,
          kind: row.kind,
          identify: identify,
          photo: photo,
        );
        added.add(section);
      }
      section.rows.add(row);
    }
    sections.addAll(added);
    return added;
  }

  /// The sections of the photo counted [photo] from 0.
  Iterable<ImportSection> sectionsOf(int photo) =>
      sections.where((section) => section.photo == photo);

  /// The keys the deck the rows go into holds; replaced when the user
  /// chooses another deck.
  Set<CardKey> existingKeys;

  Iterable<ImportRow> get rows => sections.expand((section) => section.rows);

  /// Whether every row is a vocabulary entry.
  bool get allVocabulary =>
      rows.every((row) => row.kind == CardKind.vocabulary);

  ImportSection sectionOf(ImportRow row) =>
      sections.firstWhere((section) => section.rows.contains(row));

  /// Whether the deck already holds [row]'s first card in its form, the
  /// word to its meaning unless the form turns it. A further card, such as
  /// "양쪽 다"'s reversed one, whose key the deck holds merges back when
  /// saved, as any duplicate does, and leaves the row included.
  bool isDuplicate(ImportRow row) =>
      existingKeys.contains(frameKey(row.cards(sectionOf(row).form).first));

  /// Whether [row] is saved: as the user set it, else unless it is an
  /// identify card or the deck holds it. A row with nothing to save is not.
  bool isIncluded(ImportRow row) =>
      row.savable &&
      (row.included ?? (row.type != CardType.identify && !isDuplicate(row)));

  /// The cards to import, each as its section's form shows it. Each merges
  /// back into a card with its key, the deck's or one written before it.
  List<IncomingCard> toImport() => [
    for (final section in sections)
      for (final row in section.rows)
        if (isIncluded(row))
          for (final cells in row.cards(section.form))
            IncomingCard.framed(cells, onDuplicate: DuplicateChoice.mergeBack),
  ];

  /// How many cards saving writes or merges into: one per card key among
  /// [toImport], since cards of one key merge into one.
  int get cardCount =>
      {for (final card in toImport()) CardKey.fromFront(plainText(card.front))}
          .length;

  /// Includes every row of [section], or leaves every one out when any is
  /// included.
  void toggleSection(ImportSection section) {
    final include = !section.rows.any(isIncluded);
    for (final row in section.rows) {
      row.included = include;
    }
  }
}

/// The section forms the device remembers, per deck and section, in one
/// stored JSON value.
final class SectionForms {
  SectionForms(this._stored);

  /// Every form the device holds: deck id → section key → form.
  final Map<String, Map<String, Object?>> _stored;

  /// The forms [json] stores; none when it is absent or not a map of maps.
  factory SectionForms.parse(String? json) {
    final Object? decoded;
    try {
      decoded = json == null ? null : jsonDecode(json);
    } on FormatException {
      return SectionForms({});
    }
    return SectionForms({
      if (decoded case final Map<String, Object?> decks)
        for (final MapEntry(:key, :value) in decks.entries)
          if (value case final Map<String, Object?> sections) key: sections,
    });
  }

  /// Applies the forms remembered for [deck] to [sections], [list]'s every
  /// section unless given, where they are of the same kind; a section with
  /// none keeps its own.
  void applyTo(
    ImportList list,
    DeckId deck, {
    Iterable<ImportSection>? sections,
  }) {
    final remembered = _stored[deck.value] ?? const {};
    for (final section in sections ?? list.sections) {
      final form = SectionForm.fromJson(remembered[section.formKey]);
      if (form != null && form.runtimeType == section.form.runtimeType) {
        section.form = form;
      }
    }
  }

  /// Remembers [list]'s section forms for [deck], and returns the JSON to
  /// store.
  String remember(ImportList list, DeckId deck) {
    _stored[deck.value] = {
      ...?_stored[deck.value],
      for (final section in list.sections)
        section.formKey: section.form.toJson(),
    };
    return jsonEncode(_stored);
  }
}
