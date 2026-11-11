import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/deck/deck.dart';
import 'package:knowno/photo_import/photo_import.dart';
import 'package:knowno/photo_import/src/import_list.dart';

/// The parts of speech these tests print, as a page prints them.
const _printed = {'[동]': PartOfSpeech.verb, '[명]': PartOfSpeech.noun};

/// A word of [senses], each a printed part of speech or none and a meaning,
/// in [topic].
CandidateCard _word(
  String front,
  List<(String?, String)> senses, {
  String topic = '단어',
}) => CandidateCard(
  front: front,
  answer: [for (final (_, meaning) in senses) meaning].join('\n'),
  kind: CardKind.vocabulary,
  senses: [
    for (final (pos, meaning) in senses)
      CardSense(
        labels: [
          if (pos != null)
            PartOfSpeechLabel(_printed[pos]!, pos.substring(1, pos.length - 1)),
        ],
        meaning: meaning,
      ),
  ],
  topic: topic,
);

Set<CardKey> _keys(List<String> fronts) => {
  for (final front in fronts) CardKey.fromFront(front),
};

List<(String, String)> _sides(ImportList list) => [
  for (final card in list.toImport())
    (plainText(card.front), plainText(card.back)),
];

void main() {
  group('duplicates', () {
    test("under 양쪽 다 the word's card alone decides a duplicate, and a reversed card the deck holds merges back", () {
      final list = ImportList([
        _word('big', [(null, '크다')]),
      ], _keys(['크다']));
      list.sections.single.form = const VocabularyForm(
        direction: Direction.both,
      );
      final row = list.rows.single;

      expect(list.isDuplicate(row), isFalse);
      expect(list.isIncluded(row), isTrue);
      expect(_sides(list), [('big', '크다'), ('크다', 'big')]);
      expect(
        list.toImport().map((card) => card.onDuplicate),
        everyElement(DuplicateChoice.mergeBack),
      );
      // Control: the deck holding the word leaves the row out.
      list.existingKeys = _keys(['big']);
      expect(list.isDuplicate(row), isTrue);
      expect(list.isIncluded(row), isFalse);
    });

    test("with meaning → word alone, the meaning's card decides", () {
      final list = ImportList([
        _word('big', [(null, '크다')]),
      ], _keys(['크다']));
      list.sections.single.form = const VocabularyForm(
        direction: Direction.backward,
      );
      expect(list.isDuplicate(list.rows.single), isTrue);
    });
  });

  test('the count is one per card key, as cards of one key merge into one', () {
    final list = ImportList([
      _word('big', [(null, '크다')]),
      _word('large', [(null, '크다')]),
    ], const {});
    list.sections.single.form = const VocabularyForm(direction: Direction.both);

    expect(list.toImport(), hasLength(4));
    expect(list.cardCount, 3, reason: "both reversed cards front '크다'");
    // Control: distinct meanings count every card.
    final distinct = ImportList([
      _word('big', [(null, '크다')]),
      _word('large', [(null, '넓다')]),
    ], const {});
    distinct.sections.single.form = const VocabularyForm(
      direction: Direction.both,
    );
    expect(distinct.cardCount, 4);
  });

  test("an edit is kept when the section's form changes after it", () {
    final list = ImportList([
      _word('face', [('[동]', '직면하다'), ('[명]', '표면'), ('[명]', '얼굴')]),
    ], const {});
    final row = list.rows.single;
    row.front = 'faces';
    row.senses[1].kept = false;
    row.senses[2].meaning = '생김새';

    list.sections.single.form = const VocabularyForm(
      direction: Direction.backward,
      showPos: false,
    );

    expect(_sides(list), [('직면하다\n생김새', 'faces')]);
    list.sections.single.form = const VocabularyForm(firstSenseOnly: true);
    expect(_sides(list), [('faces', '[동] 직면하다')]);
  });

  test(
    'a swapped note keeps a handwritten card\'s star on the side it moves to',
    () {
      final list = ImportList(const [
        CandidateCard(
          front: '★ 스물 → 스무',
          answer: '관형사가 되면 스무로 바뀐다',
          topic: '꼴이 바뀌는 수',
        ),
      ], const {});

      list.sections.single.form = const NoteForm(swapped: true);

      expect(_sides(list), [('관형사가 되면 스무로 바뀐다', '★ 스물 → 스무')]);
      // Control: unswapped, the star leads the front.
      list.sections.single.form = const NoteForm();
      expect(_sides(list), [('★ 스물 → 스무', '관형사가 되면 스무로 바뀐다')]);
    },
  );

  test('a cloze row saves its blocks alone, swapped or not, where a plain note swaps', () {
    const cloze = ClozeContent('3인칭 재귀칭: 높임 {{c1::당신}} · 예사 {{c2::자기}} · 낮춤 저');
    final list = ImportList(const [
      CandidateCard(
        front: '3인칭 재귀칭: 높임 ___ · 예사 ___ · 낮춤 저',
        answer: '당신\n자기',
        type: CardType.cloze,
        topic: '재귀칭',
        wholeFront: [cloze],
      ),
      CandidateCard(front: '재귀칭', answer: '앞의 명사를 다시 가리킴', topic: '재귀칭'),
    ], const {});
    const filled = '3인칭 재귀칭: 높임 당신 · 예사 자기 · 낮춤 저';

    expect(list.toImport().first.front, [cloze]);
    expect(_sides(list), [(filled, ''), ('재귀칭', '앞의 명사를 다시 가리킴')]);
    list.sections.single.form = const NoteForm(swapped: true);
    expect(list.toImport().first.front, [cloze]);
    // Control: the plain note in the same section swaps.
    expect(_sides(list), [(filled, ''), ('앞의 명사를 다시 가리킴', '재귀칭')]);
  });

  test('a vocabulary row saves its senses as a senses block with their labels and examples, '
      'and Show part of speech off drops part-of-speech labels alone', () {
    const train = CardSense(
      labels: [PartOfSpeechLabel(PartOfSpeech.noun, '명'), OtherLabel('사물')],
      meaning: '철도 위를 다니는 긴 차',
      examples: ['기차를 타다'],
    );
    final list = ImportList(const [
      CandidateCard(
        front: '기차',
        answer: '철도 위를 다니는 긴 차',
        kind: CardKind.vocabulary,
        senses: [train],
        topic: '단어',
      ),
    ], const {});

    expect(list.toImport().single.back, [
      const SensesContent([train]),
    ]);
    list.sections.single.form = const VocabularyForm(showPos: false);
    expect(list.toImport().single.back, [
      const SensesContent([
        CardSense(
          labels: [OtherLabel('사물')],
          meaning: '철도 위를 다니는 긴 차',
          examples: ['기차를 타다'],
        ),
      ]),
    ]);
  });

  test('a row with every sense dropped saves nothing and draws its word on '
      'the side its form shows', () {
    final list = ImportList([
      _word('big', [(null, '크다')]),
    ], const {});
    final row = list.rows.single..senses.single.kept = false;

    expect(list.toImport(), isEmpty);
    expect(sidesOf(row.cards(const VocabularyForm()).single).front, [
      const TextContent('big', markup: true),
    ]);
    expect(
      sidesOf(
        row.cards(const VocabularyForm(direction: Direction.backward)).single,
      ).back,
      [const TextContent('big', markup: true)],
    );
  });

  group('stored forms', () {
    const deck = DeckId('id0');
    ImportList words() => ImportList([
      _word('big', [(null, '크다')]),
    ], const {});

    test('a form stored for the deck applies to its section', () {
      final stored = SectionForms({}).remember(
        words()
          ..sections.single.form = const VocabularyForm(
            direction: Direction.backward,
          ),
        deck,
      );
      final list = words();
      SectionForms.parse(stored).applyTo(list, deck);
      expect(
        (list.sections.single.form as VocabularyForm).direction,
        Direction.backward,
      );
    });

    test('corrupt stored JSON, or a form of the wrong shape, leaves every section its default', () {
      for (final stored in [
        'not json',
        '[1, 2]',
        '{"id0": 5}',
        '{"id0": {"vocabulary:단어": {"direction": "sideways", "firstSenseOnly": false, "showPos": true, "showPronunciation": false, "showExtras": false}}}',
        '{"id0": {"vocabulary:단어": {"swapped": true}}}',
        null,
      ]) {
        final list = words();
        SectionForms.parse(stored).applyTo(list, deck);
        expect(
          (list.sections.single.form as VocabularyForm).direction,
          Direction.forward,
          reason: '$stored',
        );
      }
    });
  });

  test(
    'identify rows start left out, and a section toggles every row together',
    () {
      final list = ImportList(const [
        CandidateCard(front: '양성모음', answer: 'ㅏ ㅗ', topic: '모음조화'),
        CandidateCard(
          front: "'잡아라'의 '아'",
          answer: '양성모음',
          type: CardType.identify,
          topic: '모음조화',
        ),
      ], const {});
      final [rules, identify] = list.sections;
      expect(identify.identify, isTrue);
      expect(list.isIncluded(identify.rows.single), isFalse);
      expect(list.isIncluded(rules.rows.single), isTrue, reason: 'control');

      list.toggleSection(identify);
      expect(list.isIncluded(identify.rows.single), isTrue);
      list.toggleSection(identify);
      expect(list.isIncluded(identify.rows.single), isFalse);
    },
  );
}
