import 'dart:convert';
import 'dart:ui' show Rect, Size;

import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/deck/src/content.dart';
import 'package:knowno/deck/src/whole_card_view.dart';
import 'package:knowno/media/media.dart';

/// Whether a card of [front] and [back] is drawn whole.
bool _whole(List<Content> front, [List<Content> back = const []]) =>
    isDrawnWhole(cellsToDraw(front, back));

void main() {
  group('content encoding', () {
    test('round-trips a text block with its type discriminator', () {
      const blocks = [TextContent('bonjour')];

      final encoded = encodeContent(blocks);

      expect(encoded, '[{"type":"text","v":1,"payload":{"text":"bonjour"}}]');
      expect(decodeContent(encoded), blocks);
    });

    test('decodes an unknown type as unsupported and re-encodes it intact', () {
      const stored =
          '[{"type":"text","payload":{"text":"cat"}},'
          '{"type":"video","payload":{"path":"cat.mp4"}}]';

      final blocks = decodeContent(stored);

      expect(blocks.first, const TextContent('cat'));
      final unsupported = blocks.last;
      expect(unsupported, isA<UnsupportedContent>());
      expect((unsupported as UnsupportedContent).type, 'video');
      // The text block is written at this build's version; the video block
      // as it was stored.
      expect(
        encodeContent(blocks),
        '[{"type":"text","v":1,"payload":{"text":"cat"}},'
        '{"type":"video","payload":{"path":"cat.mp4"}}]',
      );
    });

    test(
      'round-trips a cloze and a table block, as typed blocks beside text',
      () {
        const blocks = [
          TextContent('Capitals'),
          ClozeContent('{{c1::Paris}} is in France'),
          TableContent(
            columns: ['Capital', 'Country'],
            rows: [
              ['Paris', 'France'],
            ],
            blanks: [(row: 0, column: 0)],
          ),
        ];

        final encoded = encodeContent(blocks);

        expect(
          encoded,
          '[{"type":"text","v":1,"payload":{"text":"Capitals"}},'
          '{"type":"cloze","v":2,"payload":{"text":"{{c1::Paris}} is in France"}},'
          '{"type":"table","v":2,"payload":{"columns":["Capital","Country"],'
          '"rows":[["Paris","France"]],"blanks":[{"row":0,"column":0}],'
          '"spans":[]}}]',
        );
        expect(decodeContent(encoded), blocks);
      },
    );

    test('rejects a cloze or a table that breaks its shape, where a whole one '
        'decodes', () {
      String table(Object? rows, Object? blanks) => jsonEncode([
        {
          'type': 'table',
          'payload': {
            'columns': ['a', 'b'],
            'rows': rows,
            'blanks': blanks,
          },
        },
      ]);
      final ok = [
        ['1', '2'],
      ];
      final cell = [
        {'row': 0, 'column': 1},
      ];
      for (final broken in [
        table([
          ['1'],
        ], cell),
        table(ok, <Object>[]),
        table(ok, [
          {'row': 1, 'column': 0},
        ]),
        table([
          ['1', ''],
        ], cell),
        table(ok, [...cell, ...cell]),
      ]) {
        expect(
          () => decodeContent(broken),
          throwsFormatException,
          reason: broken,
        );
      }
      // Control: each whole.
      expect(decodeContent(table(ok, cell)).single, isA<TableContent>());
    });

    test('a cloze below version 2, or with no blank, is kept as unsupported, '
        'where one of version 2 with a blank decodes', () {
      String cloze(int version, String text) => jsonEncode([
        {
          'type': 'cloze',
          'v': version,
          'payload': {'text': text},
        },
      ]);

      for (final stored in [
        cloze(1, '___ and ___'),
        cloze(2, 'no blank here'),
      ]) {
        expect(
          decodeContent(stored).single,
          isA<UnsupportedContent>(),
          reason: stored,
        );
        expect(encodeContent(decodeContent(stored)), stored);
      }
      // Control: a blank, at version 2.
      expect(
        decodeContent(cloze(2, '{{c1::one}} and {{c2::two}}')).single,
        isA<ClozeContent>(),
      );
    });

    test('a cloze and a table read as their filled text, which the card key '
        'takes, and only they make a whole card', () {
      const cloze = ClozeContent('{{c1::Paris}} is in {{c2::France}}');
      const table = TableContent(
        columns: ['Capital', 'Country'],
        rows: [
          ['Paris', 'France'],
        ],
        blanks: [(row: 0, column: 0)],
      );

      expect(plainText([cloze]), 'Paris is in France');
      expect(
        plainText([const TextContent('Capitals'), table]),
        'Capitals\nCapital | Country\nParis | France',
      );
      expect(_whole([cloze]), isTrue);
      expect(_whole([const TextContent('Capitals'), table]), isTrue);
      // Control: text alone, a v6 cloze's "___" included, is split.
      expect(_whole([const TextContent('___ is in France')]), isFalse);
    });

    test('round-trips a senses block, each sense with its labels, meaning and examples', () {
      const blocks = [
        SensesContent([
          CardSense(
            labels: [
              PartOfSpeechLabel(PartOfSpeech.noun, '명'),
              OtherLabel('사물'),
            ],
            meaning: '기차',
            examples: ['기차를 타다'],
          ),
          CardSense(meaning: '열차'),
        ]),
      ];

      final encoded = encodeContent(blocks);

      expect(
        encoded,
        '[{"type":"senses","v":1,"payload":{"senses":['
        '{"labels":[{"kind":"part_of_speech","category":"noun","text":"명"},'
        '{"kind":"other","category":null,"text":"사물"}],'
        '"meaning":"기차","examples":["기차를 타다"]},'
        '{"labels":[],"meaning":"열차","examples":[]}]}}]',
      );
      expect(decodeContent(encoded), blocks);
    });

    test("decodes the back the server's senses migration writes, as "
        'supabase/tests/senses_migration_test.sql states it', () {
      const migrated =
          '[{"type": "senses", "payload": {"senses": [{"labels": [{"kind": "part_of_speech", "text": "명", "category": "noun"}], "meaning": "사과", "examples": []}, {"labels": [{"kind": "part_of_speech", "text": "동", "category": "verb"}], "meaning": "먹다", "examples": []}]}}]';

      final blocks = decodeContent(migrated);

      expect(blocks, const [
        SensesContent([
          CardSense(
            labels: [PartOfSpeechLabel(PartOfSpeech.noun, '명')],
            meaning: '사과',
          ),
          CardSense(
            labels: [PartOfSpeechLabel(PartOfSpeech.verb, '동')],
            meaning: '먹다',
          ),
        ]),
      ]);
      expect(plainText(blocks), '[명] 사과\n[동] 먹다');
    });

    test(
      'rejects a senses block that breaks its shape, where a whole one decodes',
      () {
        String senses(Object? senses) => jsonEncode([
          {
            'type': 'senses',
            'payload': {'senses': senses},
          },
        ]);
        Map<String, Object?> sense({
          Object? labels = const <Object>[],
          Object? meaning = '사과',
          Object? examples = const <Object>[],
        }) => {'labels': labels, 'meaning': meaning, 'examples': examples};
        for (final broken in [
          senses(<Object>[]),
          senses('사과'),
          senses([sense(meaning: ' ')]),
          senses([sense(meaning: null)]),
          senses([
            sense(examples: [1]),
          ]),
          senses([
            sense(
              labels: [
                {'kind': 'part_of_speech', 'category': 'gerund', 'text': '동'},
              ],
            ),
          ]),
          senses([
            sense(
              labels: [
                {'kind': 'other', 'category': 'noun', 'text': '사물'},
              ],
            ),
          ]),
          senses([
            sense(
              labels: [
                {'kind': 'other', 'category': null, 'text': ''},
              ],
            ),
          ]),
          senses([
            {'pos': '[명]', 'meaning': '사과'},
          ]),
        ]) {
          expect(
            () => decodeContent(broken),
            throwsFormatException,
            reason: broken,
          );
        }
        // Control: a whole one, with a label of each kind.
        expect(
          decodeContent(
            senses([
              sense(
                labels: [
                  {'kind': 'part_of_speech', 'category': 'noun', 'text': '명'},
                  {'kind': 'other', 'category': null, 'text': '사물'},
                ],
              ),
            ]),
          ).single,
          isA<SensesContent>(),
        );
      },
    );

    test(
      'a senses block reads as one line per sense, each label in brackets '
      'and a space before the meaning, a part of speech by its short form',
      () {
        const senses = SensesContent([
          CardSense(
            labels: [PartOfSpeechLabel(PartOfSpeech.verb, 'v.')],
            meaning: '살다, 거주하다',
          ),
          CardSense(
            labels: [PartOfSpeechLabel(PartOfSpeech.adjective, '형')],
            meaning: '살아 있는',
          ),
          CardSense(labels: [OtherLabel('사물')], meaning: '철도 위를 다니는 긴 차'),
          CardSense(meaning: '사과'),
        ]);

        expect(
          plainText([senses]),
          '[동] 살다, 거주하다\n[형] 살아 있는\n[사물] 철도 위를 다니는 긴 차\n사과',
        );
      },
    );

    test('rejects a text block without text as a format error', () {
      expect(
        () => decodeContent('[{"type":"text","payload":{}}]'),
        throwsFormatException,
      );
    });
  });

  group('block versions and ids (ADR 0106)', () {
    // One block of each type this build knows, the version it writes it at
    // and its payload as written.
    const blocks = <(String, int, Content, String)>[
      ('text', 1, TextContent('bonjour'), '{"text":"bonjour"}'),
      (
        'cloze',
        2,
        ClozeContent('{{c1::Paris}} is in France'),
        '{"text":"{{c1::Paris}} is in France"}',
      ),
      (
        'table',
        2,
        TableContent(
          columns: ['Capital', 'Country'],
          rows: [
            ['Paris', 'France, in Europe'],
          ],
          blanks: [(row: 0, column: 0)],
          spans: [(row: 0, column: 1, start: 0, end: 6)],
        ),
        '{"columns":["Capital","Country"],"rows":[["Paris","France, in Europe"]],'
            '"blanks":[{"row":0,"column":0}],'
            '"spans":[{"row":0,"column":1,"start":0,"end":6}]}',
      ),
      (
        'senses',
        1,
        SensesContent([CardSense(meaning: '기차')]),
        '{"senses":[{"labels":[],"meaning":"기차","examples":[]}]}',
      ),
      (
        'image',
        1,
        ImageContent(
          media: MediaId('m1'),
          width: 4,
          height: 3,
          boxes: [ImageBox(id: '1', x: 0.25, y: 0.5, w: 0.5, h: 0.25)],
        ),
        '{"media":"m1","width":4,"height":3,'
            '"boxes":[{"id":"1","x":0.25,"y":0.5,"w":0.5,"h":0.25}]}',
      ),
      (
        'audio',
        1,
        AudioContent(
          media: MediaId('m2'),
          duration: Duration(milliseconds: 1250),
        ),
        '{"media":"m2","duration_ms":1250}',
      ),
    ];

    for (final (type, version, block, payload) in blocks) {
      test('a $type block is read at v$version, and written with it', () {
        final withV = '[{"type":"$type","v":$version,"payload":$payload}]';

        expect(decodeContent(withV), [block]);
        expect(encodeContent([block]), withV);
        if (version == 1) {
          final without = '[{"type":"$type","payload":$payload}]';
          expect(decodeContent(without), [block], reason: 'no v reads as v1');
        }
      });

      test('a $type block above the version this build writes is kept, '
          'byte for byte, as unsupported', () {
        final stored =
            '[{"type":"$type","v":${version + 1},"id":"b1","payload":$payload,'
            '"extra":true}]';

        final decoded = decodeContent(stored);

        expect(decoded.single, isA<UnsupportedContent>());
        expect((decoded.single as UnsupportedContent).type, type);
        expect(encodeContent(decoded), stored);
      });
    }

    test('a block keeps its id through a read and a write', () {
      const stored =
          '[{"type":"text","v":1,"id":"0190a8c4-0000-7000-8000-000000000001",'
          '"payload":{"text":"cat"}}]';

      final decoded = decodeContent(stored);

      expect(decoded.single.id, '0190a8c4-0000-7000-8000-000000000001');
      expect(encodeContent(decoded), stored);
      expect(
        decoded.single,
        const TextContent('cat'),
        reason: 'ids are not compared',
      );
    });

    test('a v that is not a positive integer, or an id that is not text, '
        'is a format error, and a v of 1 is not', () {
      for (final broken in [
        '[{"type":"text","v":0,"payload":{"text":"cat"}}]',
        '[{"type":"text","v":"1","payload":{"text":"cat"}}]',
        '[{"type":"text","v":1,"id":7,"payload":{"text":"cat"}}]',
      ]) {
        expect(
          () => decodeContent(broken),
          throwsFormatException,
          reason: broken,
        );
      }
      expect(
        decodeContent(
          '[{"type":"text","v":1,"id":"a","payload":{"text":"x"}}]',
        ),
        [const TextContent('x')],
        reason: 'control',
      );
    });

    test('the upcaster chain upgrades an older payload one step per '
        'version, to the version a type is written at', () {
      // A text block whose v2 renamed text to body, and v3 trimmed it.
      final steps = <String, List<Object? Function(Object?)>>{
        'text': [
          (payload) => {'body': (payload! as Map)['text']},
          (payload) => {'body': ((payload! as Map)['body'] as String).trim()},
        ],
      };

      expect(blockVersion('text', steps: steps), 3);
      expect(upcastPayload('text', 1, {'text': ' cat '}, steps: steps), {
        'body': 'cat',
      });
      expect(upcastPayload('text', 2, {'body': ' cat '}, steps: steps), {
        'body': 'cat',
      }, reason: 'a v2 payload takes the last step only');
      expect(upcastPayload('text', 3, {'body': 'cat'}, steps: steps), {
        'body': 'cat',
      }, reason: 'the current version takes none');
      // Today a table and a cloze are written at v2, and every other type this
      // build knows at v1, with none.
      expect(blockVersion('table'), 2);
      expect(blockVersion('cloze'), 2);
      for (final type in ['text', 'senses', 'image']) {
        expect(blockVersion(type), 1, reason: type);
      }
    });
  });

  group('the face a card is studied on (ADR 0106)', () {
    const text = TextContent('Paris');
    const cloze = ClozeContent('{{c1::Paris}} is in France');
    const table = TableContent(
      columns: ['Capital'],
      rows: [
        ['Paris'],
      ],
      blanks: [(row: 0, column: 0)],
    );
    const senses = SensesContent([CardSense(meaning: '파리')]);
    const unknown = UnsupportedContent('video', {'media': 'm1'});

    test('a card with no blank is drawn split, whatever its blocks', () {
      for (final block in <Content>[text, senses, unknown]) {
        expect(_whole([block], [text]), isFalse, reason: '$block on the front');
        expect(_whole([text], [block]), isFalse, reason: '$block on the back');
      }
    });

    test('a cloze or a table on either side makes the card whole', () {
      for (final block in <Content>[cloze, table]) {
        expect(_whole([text, block], [text]), isTrue);
        expect(_whole([block], [block]), isTrue);
        expect(_whole([text], [senses, block]), isTrue);
        expect(_whole(const [], [senses, block]), isTrue);
      }
    });

    test('an image with a box is a blank, on the front or on the back alone, '
        'and an image with none is not (ADR 0109)', () {
      const photo = ImageContent(media: MediaId('m1'), width: 4, height: 3);
      final boxed = photo.withBoxes(const [
        ImageBox(id: '1', x: 0, y: 0, w: 0.5, h: 0.5),
      ]);

      expect(_whole([boxed], [text]), isTrue);
      expect(_whole([text], [boxed]), isTrue);
      // Control: the same photo without its box is drawn split.
      expect(_whole([photo], [text]), isFalse);
      expect(_whole([text], [photo]), isFalse);
    });
  });

  group('an image block (ADR 0109)', () {
    // A stored block a later build wrote: fields this build does not know on
    // the payload and on a box, and a box with an answer beside one without.
    const stored =
        '[{"type":"image","v":1,"id":"b1","payload":{"media":"m1",'
        '"width":1200,"height":800,"boxes":['
        '{"id":"1","x":0.1,"y":0.2,"w":0.3,"h":0.4,"answer":"Paris",'
        '"shape":"oval"},'
        '{"id":"2","x":0.5,"y":0.5,"w":0.5,"h":0.5}],'
        '"crop":{"x":0,"y":0}}}]';

    test('reads its photo, size and boxes in fractions of the image, and '
        'writes back the fields it does not know', () {
      final image = decodeContent(stored).single as ImageContent;

      expect(image.media, const MediaId('m1'));
      expect((image.width, image.height), (1200, 800));
      expect(image.aspectRatio, 1.5);
      expect(image.id, 'b1');
      expect(
        [for (final box in image.boxes) (box.id, box.x, box.y, box.w, box.h)],
        [('1', 0.1, 0.2, 0.3, 0.4), ('2', 0.5, 0.5, 0.5, 0.5)],
      );
      expect([for (final box in image.boxes) box.answer], ['Paris', null]);
      expect(jsonDecode(encodeContent([image])), jsonDecode(stored));
    });

    test('a box covers the same part of the image at any size it is drawn '
        'at', () {
      const box = ImageBox(id: '1', x: 0.1, y: 0.2, w: 0.3, h: 0.4);

      expect(
        box.rectIn(const Size(1200, 800)),
        const Rect.fromLTWH(120, 160, 360, 320),
      );
      expect(
        box.rectIn(const Size(300, 200)),
        const Rect.fromLTWH(30, 40, 90, 80),
      );
    });

    test('is refused when it breaks its shape, where a whole one is read', () {
      String block(String payload) => '[{"type":"image","payload":$payload}]';
      String boxed(String box) =>
          block('{"media":"m1","width":4,"height":3,"boxes":[$box]}');
      // Control: a whole block of each kind is read.
      expect(
        decodeContent(boxed('{"id":"1","x":0,"y":0,"w":1,"h":1}')),
        hasLength(1),
      );
      expect(
        decodeContent(block('{"media":"m1","width":4,"height":3,"boxes":[]}')),
        hasLength(1),
      );

      for (final broken in [
        block('{"width":4,"height":3,"boxes":[]}'),
        block('{"media":"","width":4,"height":3,"boxes":[]}'),
        block('{"media":"m1","width":0,"height":3,"boxes":[]}'),
        block('{"media":"m1","width":4.5,"height":3,"boxes":[]}'),
        block('{"media":"m1","width":4,"height":3}'),
        boxed('{"x":0,"y":0,"w":1,"h":1}'),
        boxed('{"id":"1","x":-0.1,"y":0,"w":0.5,"h":0.5}'),
        boxed('{"id":"1","x":0,"y":0,"w":0,"h":0.5}'),
        boxed('{"id":"1","x":0.6,"y":0,"w":0.5,"h":0.5}'),
        boxed('{"id":"1","x":0,"y":0.6,"w":0.5,"h":0.5}'),
        boxed('{"id":"1","x":0,"y":0,"w":0.5,"h":0.5,"answer":3}'),
        boxed(
          '{"id":"1","x":0,"y":0,"w":0.5,"h":0.5},'
          '{"id":"1","x":0.5,"y":0.5,"w":0.5,"h":0.5}',
        ),
      ]) {
        expect(
          () => decodeContent(broken),
          throwsFormatException,
          reason: broken,
        );
      }
    });

    test('reads as its media id and then its answers, so two photos never '
        'share a card key, and names its photo', () {
      final image = decodeContent(stored).single as ImageContent;

      expect(plainText([image]), 'm1\nParis');
      expect(
        plainText([
          const ImageContent(media: MediaId('m2'), width: 1, height: 1),
        ]),
        'm2',
      );
      expect(mediaOf([const TextContent('a'), image]), {const MediaId('m1')});
    });
  });

  group('an audio block (ADR 0112)', () {
    // A stored block a later build wrote, with a field this build does not
    // know.
    const stored =
        '[{"type":"audio","v":1,"id":"b1","payload":{"media":"m1",'
        '"duration_ms":2400,"waveform":[1,2]}}]';

    test('round-trips its media id and length, and writes back the fields it '
        'does not know', () {
      final audio = decodeContent(stored).single as AudioContent;

      expect(audio.media, const MediaId('m1'));
      expect(audio.duration, const Duration(milliseconds: 2400));
      expect(audio.id, 'b1');
      expect(jsonDecode(encodeContent([audio])), jsonDecode(stored));
    });

    test('is refused when it breaks its shape, where a whole one is read', () {
      String block(String payload) => '[{"type":"audio","payload":$payload}]';
      // Control: a whole block is read.
      expect(
        decodeContent(block('{"media":"m1","duration_ms":1}')),
        hasLength(1),
      );

      for (final broken in [
        block('{"duration_ms":1000}'),
        block('{"media":"","duration_ms":1000}'),
        block('{"media":"m1"}'),
        block('{"media":"m1","duration_ms":0}'),
        block('{"media":"m1","duration_ms":-5}'),
        block('{"media":"m1","duration_ms":1.5}'),
        block('{"media":"m1","duration_ms":"1000"}'),
        block('{"url":"https://example.com/cat.m4a","duration_ms":1000}'),
      ]) {
        expect(
          () => decodeContent(broken),
          throwsFormatException,
          reason: broken,
        );
      }
    });

    test('is no blank, names its file among the media, and reads as its '
        'media id, so two sounds never share a card key', () {
      const audio = AudioContent(
        media: MediaId('m1'),
        duration: Duration(seconds: 1),
      );
      const image = ImageContent(media: MediaId('m2'), width: 1, height: 1);

      expect(_whole([audio], const [TextContent('cat')]), isFalse);
      expect(mediaOf([const TextContent('a'), audio, image]), {
        const MediaId('m1'),
        const MediaId('m2'),
      });
      expect(audioOf([const TextContent('a'), audio, image]), [audio]);
      expect(plainText([const TextContent('cat'), audio]), 'cat\nm1');
    });
  });

  group("a table's spans (ADR 0110)", () {
    const cell = '5부족 연맹체, 왕 아래 마가·우가';
    String table({
      int? v,
      Object? blanks = const <Object>[],
      Object? spans = const <Object>[],
      bool withSpans = true,
    }) => jsonEncode([
      {
        'type': 'table',
        'v': ?v,
        'payload': {
          'columns': ['', '정치'],
          'rows': [
            ['부여', cell],
            ['고구려', '5부'],
          ],
          'blanks': blanks,
          if (withSpans) 'spans': spans,
        },
      },
    ]);
    Map<String, int> span(int row, int column, int start, int end) => {
      'row': row,
      'column': column,
      'start': start,
      'end': end,
    };

    test('a v1 table, with or without its v, is upcast to v2 with its blanks '
        'whole cells and no span, and written back at v2', () {
      const whole = [
        {'row': 1, 'column': 1},
      ];
      for (final stored in [
        table(blanks: whole, withSpans: false),
        table(v: 1, blanks: whole, withSpans: false),
      ]) {
        final decoded = decodeContent(stored).single as TableContent;

        expect(decoded.blanks, [(row: 1, column: 1)], reason: stored);
        expect(decoded.spans, isEmpty, reason: stored);
        expect(
          jsonDecode(encodeContent([decoded])),
          jsonDecode(table(v: 2, blanks: whole)),
          reason: stored,
        );
      }
    });

    test('a v2 table round-trips its spans beside whole-cell blanks, several '
        'in one cell', () {
      const block = TableContent(
        columns: ['', '정치'],
        rows: [
          ['부여', cell],
          ['고구려', '5부'],
        ],
        blanks: [(row: 1, column: 1)],
        spans: [
          (row: 0, column: 1, start: 0, end: 7),
          (row: 0, column: 1, start: 14, end: 16),
        ],
      );

      final encoded = encodeContent([block]);

      expect(
        encoded,
        table(
          v: 2,
          blanks: [
            {'row': 1, 'column': 1},
          ],
          spans: [span(0, 1, 0, 7), span(0, 1, 14, 16)],
        ),
      );
      expect(decodeContent(encoded), [block]);
      expect(
        plainText([block]),
        ' | 정치\n부여 | $cell\n고구려 | 5부',
        reason: 'the card key reads every cell whole',
      );
    });

    test('a v2 table refuses a span outside its cell, empty, of whitespace, '
        'overlapping another or in a whole-cell blank, and a table of no '
        'blank at all, where a whole one decodes', () {
      for (final broken in [
        table(v: 2, spans: [span(0, 1, 0, cell.length + 1)]),
        table(v: 2, spans: [span(0, 2, 0, 1)]),
        table(v: 2, spans: [span(2, 1, 0, 1)]),
        table(v: 2, spans: [span(0, 1, -1, 3)]),
        table(v: 2, spans: [span(0, 1, 3, 3)]),
        table(v: 2, spans: [span(0, 1, 8, 9)]),
        table(v: 2, spans: [span(0, 1, 0, 7), span(0, 1, 6, 9)]),
        table(v: 2, spans: [span(0, 1, 0, 7), span(0, 1, 0, 7)]),
        table(
          v: 2,
          blanks: [
            {'row': 0, 'column': 1},
          ],
          spans: [span(0, 1, 0, 7)],
        ),
        table(v: 2, spans: [span(0, 1, 0, 7), 'not a span']),
        table(v: 2),
        table(
          v: 2,
          blanks: [
            {'row': 0, 'column': 1},
          ],
          withSpans: false,
        ),
      ]) {
        expect(
          () => decodeContent(broken),
          throwsFormatException,
          reason: broken,
        );
      }
      // Control: spans alone, two touching in one cell.
      final whole = table(v: 2, spans: [span(0, 1, 0, 7), span(0, 1, 7, 9)]);
      expect(decodeContent(whole).single, isA<TableContent>());
    });

    test('a cell reads as its runs: a whole blank as one, spans between its '
        'plain text, and a plain cell as one', () {
      const block = TableContent(
        columns: ['', '정치'],
        rows: [
          ['부여', cell],
          ['고구려', '5부'],
        ],
        blanks: [(row: 1, column: 1)],
        spans: [
          (row: 0, column: 1, start: 14, end: 16),
          (row: 0, column: 1, start: 0, end: 7),
        ],
      );

      expect(block.cellRuns(0, 1), [
        (text: '5부족 연맹체', blank: true),
        (text: ', 왕 아래 ', blank: false),
        (text: '마가', blank: true),
        (text: '·우가', blank: false),
      ]);
      expect(block.cellRuns(1, 1), [(text: '5부', blank: true)]);
      expect(block.cellRuns(0, 0), [(text: '부여', blank: false)]);
    });
  });
}
