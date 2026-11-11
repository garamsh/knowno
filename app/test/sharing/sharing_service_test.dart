import 'dart:io';

import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/account/account.dart';
import 'package:knowno/database/database.dart';
import 'package:knowno/deck/deck.dart';
import 'package:knowno/media/media.dart';
import 'package:knowno/sharing/sharing.dart';

import '../media/fakes.dart';
import 'fakes.dart';

final _published = DateTime.utc(2026, 10, 15, 9);

PublicDeckSummary publicDeck(
  String id, {
  String name = 'French',
  String owner = '00000000-0000-4000-8000-00000000000b',
  String ownerName = 'Bea',
  String? description,
  int cards = 0,
  int copies = 0,
  DateTime? publishedAt,
}) => PublicDeckSummary(
  id: DeckId(id),
  owner: UserId(owner),
  ownerName: DisplayName.tryParse(ownerName)!,
  name: name,
  description: description,
  cardCount: cards,
  copyCount: copies,
  publishedAt: publishedAt ?? _published,
);

PublicCard publicCard(String front, String back) =>
    PublicCard(front: [TextContent(front)], back: [TextContent(back)]);

void main() {
  late AppDatabase db;
  late DeckRepository decks;
  late FakeSharingServer server;
  late SharingService sharing;

  setUp(() {
    db = AppDatabase(NativeDatabase.memory());
    var ids = 0;
    var tick = 0;
    // Each write a second later, so cards list in the order they were written.
    decks = DeckRepository(
      db,
      clock: () =>
          DateTime.utc(2026, 10, 15, 10).add(Duration(seconds: tick++)),
      newId: () => 'id${ids++}',
    );
    server = FakeSharingServer();
    sharing = SharingService(
      server: server,
      decks: decks,
      reachability: FakeReachability(),
      clock: () => _published,
    );
  });

  tearDown(() => db.close());

  group('display name', () {
    test('takes 2 to 20 characters, trimmed', () {
      expect(DisplayName.tryParse('  Bea ')?.value, 'Bea');
      expect(DisplayName.tryParse('가나')?.value, '가나');
      expect(DisplayName.tryParse('a' * 20)?.value, 'a' * 20);
    });

    test('refuses fewer than 2 or more than 20 characters', () {
      expect(DisplayName.tryParse(' B '), isNull);
      expect(DisplayName.tryParse(''), isNull);
      expect(DisplayName.tryParse('a' * 21), isNull);
      // Characters, not UTF-16 units: 20 emoji are 40 units.
      expect(DisplayName.tryParse('😀' * 20), isNotNull);
    });
  });

  group('publishing', () {
    test(
      'a publish writes the server, then the device, with the description',
      () async {
        final deck = await decks.createDeck('French');
        server.name = DisplayName.tryParse('Ada');

        await sharing.makePublic(deck.id, description: 'Verbs');

        expect(server.writes, hasLength(1));
        expect(server.writes.single.deck.name, 'French');
        expect(server.writes.single.description, 'Verbs');
        final stored = await decks.getDeck(deck.id);
        expect(stored.visibility, isA<PublicDeck>());
        expect(
          (stored.visibility as PublicDeck).publishedAt.isAtSameMomentAs(
            _published,
          ),
          isTrue,
        );
        expect(stored.description, 'Verbs');
      },
    );

    test('a first publish sets the display name before the deck', () async {
      final deck = await decks.createDeck('French');
      expect(server.name, isNull);

      await sharing.makePublic(deck.id, name: DisplayName.tryParse('Ada'));

      expect(server.name?.value, 'Ada');
      expect(server.writes.single.visibility, isA<PublicDeck>());
    });

    test(
      'a publish the server refuses leaves the deck private on the device',
      () async {
        final deck = await decks.createDeck('French');
        server.failure = SharingOffline(Exception('no network'));

        await expectLater(
          sharing.makePublic(deck.id),
          throwsA(isA<SharingOffline>()),
        );

        expect((await decks.getDeck(deck.id)).visibility, isA<PrivateDeck>());
        // Control: the same publish goes through once the server answers.
        server.failure = null;
        await sharing.makePublic(deck.id);
        expect((await decks.getDeck(deck.id)).visibility, isA<PublicDeck>());
      },
    );

    test(
      'unpublishing makes the deck private and keeps its description',
      () async {
        final deck = await decks.createDeck('French');
        await sharing.makePublic(deck.id, description: 'Verbs');

        await sharing.makePrivate(deck.id);

        expect(server.writes.last.visibility, isA<PrivateDeck>());
        final stored = await decks.getDeck(deck.id);
        expect(stored.visibility, isA<PrivateDeck>());
        expect(stored.description, 'Verbs');
        final row = await db.select(db.decks).getSingle();
        expect(
          [row.visibility, row.publishedAt, row.dirty],
          ['private', null, true],
        );
      },
    );
  });

  group('copying', () {
    final source = publicDeck('public', name: 'Spanish', cards: 3);

    setUp(() {
      server.decks = [source];
      server.cards = {
        source.id: [
          publicCard('perro', 'dog'),
          publicCard('gato', 'cat'),
          publicCard('Perro', 'hound'),
        ],
      };
    });

    Future<List<(String, String, CardSource, String?)>> cardsOf(
      DeckId deck,
    ) async => [
      for (final card in await decks.listCards(deck))
        (
          plainText(card.front),
          plainText(card.back),
          card.source,
          card.originDeckId?.value,
        ),
    ];

    test(
      'as a new deck takes every card, named after the source, as shared cards',
      () async {
        final imported = await sharing.copy(source, const CopyIntoNewDeck());

        expect(imported.deck.name, 'Spanish');
        expect(imported.added, 3);
        expect(await cardsOf(imported.deck.id), [
          ('perro', 'dog', CardSource.copy, 'public'),
          ('gato', 'cat', CardSource.copy, 'public'),
          ('Perro', 'hound', CardSource.copy, 'public'),
        ]);
        expect(server.imports, [source.id]);
      },
    );

    test("keeps a table card's blocks as the source stores them, beside a text "
        'card', () async {
      const front = [
        TextContent('Capitals'),
        TableContent(
          columns: ['Capital', 'Country'],
          rows: [
            ['Paris', 'France'],
          ],
          blanks: [(row: 0, column: 0)],
        ),
      ];
      server.cards = {
        source.id: [
          const PublicCard(
            front: front,
            back: [TextContent('Capital | Country\nParis | France')],
          ),
          publicCard('perro', 'dog'),
        ],
      };

      final imported = await sharing.copy(source, const CopyIntoNewDeck());

      final [table, text] = await decks.listCards(imported.deck.id);
      expect(table.front, [
        const TextContent('Capitals', markup: true),
        front.last,
      ]);
      // A text card is copied in the frame too.
      expect(text.front, [const TextContent('perro', markup: true)]);
    });

    Future<Deck> mine() async {
      final deck = await decks.createDeck('Mine');
      await decks.addCard(
        deck.id,
        front: [const TextContent('perro')],
        back: [const TextContent('dog')],
      );
      return deck;
    }

    test('into an existing deck skips duplicates by default', () async {
      final deck = await mine();

      final imported = await sharing.copy(
        source,
        CopyIntoDeck(deck.id, DuplicateChoice.skip),
      );

      expect([imported.added, imported.merged], [1, 0]);
      expect(await cardsOf(deck.id), [
        ('perro', 'dog', CardSource.manual, null),
        ('gato', 'cat', CardSource.copy, 'public'),
      ]);
    });

    test('into an existing deck merges backs when asked', () async {
      final deck = await mine();

      final imported = await sharing.copy(
        source,
        CopyIntoDeck(deck.id, DuplicateChoice.mergeBack),
      );

      expect([imported.added, imported.merged], [1, 1]);
      expect(await cardsOf(deck.id), [
        ('perro', 'dog\nhound', CardSource.manual, null),
        ('gato', 'cat', CardSource.copy, 'public'),
      ]);
    });

    test(
      'into an existing deck adds duplicates as new cards when asked',
      () async {
        final deck = await mine();

        final imported = await sharing.copy(
          source,
          CopyIntoDeck(deck.id, DuplicateChoice.addNew),
        );

        expect([imported.added, imported.merged], [3, 0]);
        expect(await cardsOf(deck.id), hasLength(4));
      },
    );

    test('a deck no longer public is refused and nothing is written', () async {
      server.decks = [];

      await expectLater(
        sharing.copy(source, const CopyIntoNewDeck()),
        throwsA(isA<DeckNoLongerPublic>()),
      );

      expect(await db.select(db.decks).get(), isEmpty);
      expect(server.imports, isEmpty);
    });
  });

  group("copying a deck's photos and sounds (ADR 0113)", () {
    final source = publicDeck('public', name: 'Birds', cards: 2);
    final owner = source.owner.value;
    const photo = MediaId('00000000-0000-4000-8000-0000000000c1');
    const sound = MediaId('00000000-0000-4000-8000-0000000000c2');
    const box = ImageBox(
      id: '1',
      x: 0.1,
      y: 0.2,
      w: 0.3,
      h: 0.4,
      answer: 'beak',
    );
    final image = preparedImage(5);
    final recording = mp4Bytes(7);
    late Directory directory;
    late FakeMediaServer media;
    late MediaStore store;

    setUp(() {
      directory = newMediaDirectory();
      media = FakeMediaServer()
        ..shared[(owner, photo)] = image.bytes
        ..shared[(owner, sound)] = recording;
      var mediaIds = 0;
      store = MediaStore(
        db,
        media,
        directory: directory,
        clock: () => _published,
        newId: () =>
            '00000000-0000-4000-8000-${'${mediaIds++}'.padLeft(12, '0')}',
      );
      var ids = 0;
      decks = DeckRepository(
        db,
        clock: () => _published,
        newId: () => 'id${ids++}',
        media: store,
      );
      sharing = SharingService(
        server: server,
        decks: decks,
        reachability: FakeReachability(),
        clock: () => _published,
      );
      server.decks = [source];
      server.cards = {
        source.id: [
          const PublicCard(
            front: [
              ImageContent(media: photo, width: 4, height: 4, boxes: [box]),
            ],
            back: [TextContent('a robin')],
          ),
          const PublicCard(
            front: [AudioContent(media: sound, duration: Duration(seconds: 2))],
            back: [
              TextContent('its song'),
              ImageContent(media: photo, width: 4, height: 4),
            ],
          ),
        ],
      };
    });

    tearDown(() => deleteMediaDirectory(directory));

    /// The media ids the deck's cards name, front then back, card by card.
    Future<List<MediaId>> mediaIn(DeckId deck) async => [
      for (final card in await decks.listCards(deck))
        for (final block in [...card.front, ...card.back])
          if (block
              case ImageContent(:final media) || AudioContent(:final media))
            media,
    ];

    Future<Map<String, String>> queued() async => {
      for (final row in await db.select(db.mediaUploads).get())
        row.id: row.mimeType,
    };

    /// The ids of the files kept on the device.
    Set<String> filesOnDevice() => {
      if (directory.existsSync())
        for (final file in directory.listSync()) file.uri.pathSegments.last,
    };

    test("a copy stores each of the owner's files under a new id, names it in "
        'the blocks and queues it for upload', () async {
      final copied = await sharing.copy(source, const CopyIntoNewDeck());

      final [photoCard, soundCard] = await decks.listCards(copied.deck.id);
      final ownPhoto = photoCard.front.single as ImageContent;
      expect(ownPhoto.media, isNot(photo));
      expect(
        [for (final b in ownPhoto.boxes) (b.id, b.x, b.y, b.w, b.h, b.answer)],
        [(box.id, box.x, box.y, box.w, box.h, box.answer)],
        reason: 'only the id changes',
      );
      final ownSound = soundCard.front.single as AudioContent;
      expect(ownSound.media, isNot(sound));
      expect(ownSound.duration, const Duration(seconds: 2));
      expect(await mediaIn(copied.deck.id), [
        ownPhoto.media,
        ownSound.media,
        ownPhoto.media,
      ], reason: 'one file of the owner, held twice, is copied once');
      expect(await queued(), {
        ownPhoto.media.value: 'image/jpeg',
        ownSound.media.value: 'audio/mp4',
      });
      expect(await store.read(ownPhoto.media), image.bytes);
      expect(await store.drain(), isTrue);
      expect(media.files, {
        ownPhoto.media: image.bytes,
        ownSound.media: recording,
      });
    });

    test(
      'a file the owner removed, or the network fails past retry, leaves its '
      'block naming no readable file, and the copy still succeeds',
      () async {
        media.shared.remove((owner, photo));
        media.failingDownloads[sound] = MediaStore.fetchAttempts;

        final copied = await sharing.copy(source, const CopyIntoNewDeck());

        expect(copied.added, 2);
        final ids = await mediaIn(copied.deck.id);
        expect(ids.toSet().intersection({photo, sound}), isEmpty);
        for (final id in ids) {
          expect(await store.read(id), isNull, reason: '$id holds no file');
        }
        expect(await queued(), isEmpty);
        // Control: a fetch that succeeds on its last try is copied.
        media.shared[(owner, photo)] = image.bytes;
        media.failingDownloads[sound] = MediaStore.fetchAttempts - 1;
        final again = await sharing.copy(source, const CopyIntoNewDeck());
        for (final id in await mediaIn(again.deck.id)) {
          expect(await store.read(id), isNotNull, reason: '$id holds a file');
        }
      },
    );

    test(
      'copying the same deck again makes a copy with files of its own, which '
      "outlive the first copy's deletion",
      () async {
        final first = await sharing.copy(source, const CopyIntoNewDeck());
        final second = await sharing.copy(source, const CopyIntoNewDeck());

        final firstIds = (await mediaIn(first.deck.id)).toSet();
        final secondIds = (await mediaIn(second.deck.id)).toSet();
        expect(firstIds, hasLength(2));
        expect(secondIds, hasLength(2));
        expect(firstIds.intersection(secondIds), isEmpty);

        await decks.deleteDeck(first.deck.id);
        expect({
          for (final row in await db.select(db.mediaDeletions).get())
            MediaId(row.id),
        }, firstIds);
        await store.drain();
        for (final id in secondIds) {
          expect(await store.read(id), isNotNull);
        }
      },
    );

    test("a card skipped as a duplicate leaves none of its back's files queued "
        'or on the device', () async {
      server.cards = {
        source.id: [
          const PublicCard(
            front: [TextContent('robin')],
            back: [ImageContent(media: photo, width: 4, height: 4)],
          ),
        ],
      };
      final deck = await decks.createDeck('Mine');
      await decks.addCard(
        deck.id,
        front: [const TextContent('robin')],
        back: [const TextContent('a bird')],
      );

      final skipped = await sharing.copy(
        source,
        CopyIntoDeck(deck.id, DuplicateChoice.skip),
      );

      expect(skipped.added, 0);
      expect(await queued(), isEmpty);
      expect(filesOnDevice(), isEmpty);
      // Control: the same card added as new stores its file.
      await sharing.copy(source, CopyIntoDeck(deck.id, DuplicateChoice.addNew));
      expect(await queued(), hasLength(1));
      expect(filesOnDevice(), (await queued()).keys.toSet());
    });

    group('of a framed card', () {
      const placed = ImageContent(media: photo, width: 4, height: 4);
      const voice = AudioContent(media: sound, duration: Duration(seconds: 2));
      final cells = <Cell>[
        const TextCell(front: 'name it', back: 'a robin', id: 'text'),
        BlankCell(placed.withBoxes(const [box]), id: 'boxed'),
        const PlacedCell(voice, CellSide.back, id: 'voice'),
      ];

      PublicCard framed(List<Cell> cells) {
        final sides = sidesOf(cells);
        return PublicCard(front: sides.front, back: sides.back, cells: cells);
      }

      setUp(
        () => server.cards = {
          source.id: [framed(cells)],
        },
      );

      test('a copy keeps the 칸 list and free v2, each photo and sound under '
          'its new id, and queues them for upload', () async {
        final copied = await sharing.copy(source, const CopyIntoNewDeck());

        final row = await db.select(db.cards).getSingle();
        expect(row.template, 'free');
        expect(row.templateVersion, 2);
        expect(row.back, '[]');
        final card = (await decks.listCards(copied.deck.id)).single;
        final [text, boxed, kept] = card.cells!;
        expect(text, cells.first);
        final ownPhoto = (boxed as BlankCell).block as ImageContent;
        final ownSound = ((kept as PlacedCell).block) as AudioContent;
        expect(kept.side, CellSide.back);
        expect(ownPhoto.media, isNot(photo));
        expect(ownPhoto.boxes.single.answer, 'beak');
        expect(ownSound.media, isNot(sound));
        expect(row.front, isNot(contains(photo.value)));
        expect(row.front, isNot(contains(sound.value)));
        expect(await queued(), {
          ownPhoto.media.value: 'image/jpeg',
          ownSound.media.value: 'audio/mp4',
        });
        expect(row.cardKey, frameKey(card.cells!).value);
      });

      test('a card skipped as a duplicate leaves none of its back\'s files '
          'queued or on the device', () async {
        final textOnly = <Cell>[
          const TextCell(front: 'name it', back: 'a robin'),
          const PlacedCell(voice, CellSide.back),
        ];
        server.cards = {
          source.id: [framed(textOnly)],
        };
        final deck = await decks.createDeck('Mine');
        await decks.addCard(
          deck.id,
          front: const [TextContent('name it')],
          back: const [TextContent('mine')],
        );

        final skipped = await sharing.copy(
          source,
          CopyIntoDeck(deck.id, DuplicateChoice.skip),
        );

        expect(skipped.added, 0);
        expect(await queued(), isEmpty);
        expect(filesOnDevice(), isEmpty);
        // Control: the same card added as new stores its file.
        await sharing.copy(
          source,
          CopyIntoDeck(deck.id, DuplicateChoice.addNew),
        );
        expect(await queued(), hasLength(1));
      });
    });

    test('a copy whose write fails leaves none of the files it fetched on the '
        'device', () async {
      final deck = await decks.createDeck('Mine');
      await decks.deleteDeck(deck.id);

      await expectLater(
        sharing.copy(source, CopyIntoDeck(deck.id, DuplicateChoice.skip)),
        throwsA(isA<DeckDeleted>()),
      );

      expect(media.requests, 2, reason: 'both files were fetched');
      expect(await queued(), isEmpty);
      expect(filesOnDevice(), isEmpty);
      // Control: the same copy into a new deck keeps both files.
      await sharing.copy(source, const CopyIntoNewDeck());
      expect(filesOnDevice(), hasLength(2));
    });
  });
}
