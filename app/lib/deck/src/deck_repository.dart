import 'dart:async';

import 'package:drift/drift.dart';

import '../../database/database.dart';
import '../../media/media.dart';
import 'add_cards.dart';
import 'card_key.dart';
import 'card_frame.dart';
import 'card_template.dart';
import 'content.dart';
import 'failure.dart';
import 'model.dart';

/// The outcome of saving a card.
sealed class SaveCardResult {
  const SaveCardResult();
}

/// The card was stored.
final class CardSaved extends SaveCardResult {
  const CardSaved(this.card);

  final Card card;
}

/// Nothing was stored: [existing] in the same deck already has the card key.
final class DuplicateFront extends SaveCardResult {
  const DuplicateFront(this.existing);

  final Card existing;
}

/// Reads and writes decks and cards in the local database.
///
/// Every database failure reaches the caller as [StorageFailure], and a card
/// whose stored content cannot be decoded as [UnreadableCard].
class DeckRepository {
  DeckRepository(
    this._db, {
    required this._clock,
    required this._newId,
    String Function()? newBlockId,
    this._media,
  }) : _newBlockId = newBlockId ?? _newId;

  final AppDatabase _db;

  /// Releases each image or sound a deck or card lets go, by a new one or
  /// its deletion; without it, as in a test that stores none, none is
  /// released.
  final MediaStore? _media;
  final DateTime Function() _clock;
  final String Function() _newId;

  /// Makes each block's id: [_newId] unless another is given, so a test can
  /// keep its card ids apart from its block ids.
  final String Function() _newBlockId;

  /// Every deck, ordered by name, re-emitted on each change.
  Stream<List<Deck>> watchDecks() {
    final query = _db.select(_db.decks)
      ..where((deck) => deck.deletedAt.isNull())
      ..orderBy([(deck) => OrderingTerm.asc(deck.name)]);
    return _guardStream(
      query.watch().map((rows) => rows.map(_toDeck).toList()),
    );
  }

  /// Makes a private deck named [name], with [icon], [color] and [image]
  /// when given, in one write.
  Future<Deck> createDeck(
    String name, {
    DeckIcon? icon,
    DeckColor? color,
    MediaId? image,
  }) => _guard(() async {
    final now = _clock();
    final row = DeckRow(
      id: _newId(),
      name: name,
      icon: icon?.key,
      color: color?.key,
      imageMediaId: image?.value,
      visibility: _visibilityName(const PrivateDeck()),
      publication: _publicationName(const PrivateDeck()),
      createdAt: now,
      updatedAt: now,
      dirty: true,
    );
    await _db.into(_db.decks).insert(row);
    return _toDeck(row);
  });

  Future<void> renameDeck(DeckId id, String name) => _guard(() async {
    await (_db.update(
      _db.decks,
    )..where((deck) => deck.id.equals(id.value))).write(
      DecksCompanion(
        name: Value(name),
        updatedAt: Value(_clock()),
        dirty: const Value(true),
      ),
    );
  });

  /// Stores [icon] and [color] as the deck's appearance, no colour leaving
  /// the deck with none chosen.
  Future<void> setAppearance(DeckId id, DeckIcon icon, DeckColor? color) =>
      _guard(() async {
        await (_db.update(
          _db.decks,
        )..where((deck) => deck.id.equals(id.value))).write(
          DecksCompanion(
            icon: Value(icon.key),
            color: Value(color?.key),
            updatedAt: Value(_clock()),
            dirty: const Value(true),
          ),
        );
      });

  /// Stores [image] as the deck's image, or none when it is null, and
  /// releases the image it replaces unless another holds it.
  Future<void> setImage(DeckId id, MediaId? image) => _guard(
    () => _db.transaction(() async {
      final previous = await _imageOf(id);
      await (_db.update(
        _db.decks,
      )..where((deck) => deck.id.equals(id.value))).write(
        DecksCompanion(
          imageMediaId: Value(image?.value),
          updatedAt: Value(_clock()),
          dirty: const Value(true),
        ),
      );
      if (previous != null && previous != image) {
        await _releaseUnheld({previous});
      }
    }),
  );

  /// Sets where the deck stands, as the server's answer or the owner's
  /// choice. [description] is kept with a deck that was asked to be public
  /// and left as it was otherwise, for the next publish. Refused with
  /// [DeckDeleted] once the deck is deleted.
  Future<Deck> setVisibility(
    DeckId id,
    DeckVisibility visibility, {
    String? description,
  }) => _guard(
    () => _db.transaction(() async {
      await getDeck(id);
      await (_db.update(
        _db.decks,
      )..where((deck) => deck.id.equals(id.value))).write(
        DecksCompanion(
          visibility: Value(_visibilityName(visibility)),
          publication: Value(_publicationName(visibility)),
          publishedAt: Value(switch (visibility) {
            CheckingDeck(:final publishedAt) ||
            HeldDeck(:final publishedAt) ||
            PublicDeck(:final publishedAt) => publishedAt,
            PrivateDeck() || RefusedDeck() => null,
          }),
          description: visibility.requested
              ? Value(description)
              : const Value.absent(),
          updatedAt: Value(_clock()),
          dirty: const Value(true),
        ),
      );
      return getDeck(id);
    }),
  );

  /// The deck, re-emitted on each change; null once it is deleted.
  Stream<Deck?> watchDeck(DeckId id) {
    final query = _db.select(_db.decks)
      ..where((deck) => deck.id.equals(id.value) & deck.deletedAt.isNull());
    return _guardStream(
      query.watchSingleOrNull().map((row) => row == null ? null : _toDeck(row)),
    );
  }

  /// Deletes the deck and every card in it, as tombstones sync pushes, and
  /// releases its image and its cards' photos and sounds unless another
  /// holds them.
  Future<void> deleteDeck(DeckId id) => _guard(
    () => _db.transaction(() async {
      final now = _clock();
      final cards = _db.select(_db.cards)
        ..where(
          (card) => card.deckId.equals(id.value) & card.deletedAt.isNull(),
        );
      final images = {
        ?await _imageOf(id),
        for (final row in await cards.get()) ..._mediaOf(row),
      };
      await (_db.update(
        _db.decks,
      )..where((deck) => deck.id.equals(id.value))).write(_deckTombstone(now));
      await (_db.update(_db.cards)..where(
            (card) => card.deckId.equals(id.value) & card.deletedAt.isNull(),
          ))
          .write(_cardTombstone(now));
      await _releaseUnheld(images);
    }),
  );

  /// The number of cards in the deck.
  Future<int> countCards(DeckId deckId) => _guard(() async {
    final count = _db.cards.id.count();
    final query = _db.selectOnly(_db.cards)
      ..addColumns([count])
      ..where(
        _db.cards.deckId.equals(deckId.value) & _db.cards.deletedAt.isNull(),
      );
    final row = await query.getSingle();
    return row.read(count) ?? 0;
  });

  /// How many cards each deck holds, re-emitted on each change. A deck with
  /// no card is absent.
  Stream<Map<DeckId, int>> watchCardCounts() {
    final count = _db.cards.id.count();
    final query = _db.selectOnly(_db.cards)
      ..addColumns([_db.cards.deckId, count])
      ..where(_db.cards.deletedAt.isNull())
      ..groupBy([_db.cards.deckId]);
    return _guardStream(
      query.watch().map(
        (rows) => {
          for (final row in rows)
            // deck_id is NOT NULL, so every grouped row carries one.
            if (row.read(_db.cards.deckId) case final deck?)
              DeckId(deck): row.read(count) ?? 0,
        },
      ),
    );
  }

  /// The deck's cards, oldest first, re-emitted on each change.
  Stream<List<Card>> watchCards(DeckId deckId) {
    final query = _db.select(_db.cards)
      ..where(
        (card) => card.deckId.equals(deckId.value) & card.deletedAt.isNull(),
      )
      ..orderBy([(card) => OrderingTerm.asc(card.createdAt)]);
    return _guardStream(
      query.watch().map((rows) => rows.map(_toCard).toList()),
    );
  }

  /// The deck's cards, oldest first.
  Future<List<Card>> listCards(DeckId deckId) => _guard(() async {
    final query = _db.select(_db.cards)
      ..where(
        (card) => card.deckId.equals(deckId.value) & card.deletedAt.isNull(),
      )
      ..orderBy([(card) => OrderingTerm.asc(card.createdAt)]);
    return (await query.get()).map(_toCard).toList();
  });

  /// The card key of every card in [deckId].
  Future<Set<CardKey>> listKeys(DeckId deckId) => _guard(() async {
    final query = _db.selectOnly(_db.cards)
      ..addColumns([_db.cards.cardKey])
      ..where(
        _db.cards.deckId.equals(deckId.value) & _db.cards.deletedAt.isNull(),
      );
    return {
      for (final row in await query.get())
        CardKey.stored(row.read(_db.cards.cardKey)!),
    };
  });

  /// Adds a manual card in the frame, of the [cells] it is given or else of
  /// [front] and [back] converted, which are then the projection. A card in
  /// the same deck with an equal key blocks the save unless [allowDuplicate]
  /// is set.
  Future<SaveCardResult> addCard(
    DeckId deckId, {
    required List<Content> front,
    required List<Content> back,
    List<Cell>? cells,
    bool allowDuplicate = false,
  }) {
    final framed = cells ?? cellsFromSides(front, back);
    if (framed == null) {
      throw ArgumentError.value(back, 'back', 'holds a block with no 칸');
    }
    final key = frameKey(framed);
    return _guard(
      () => _db.transaction(() async {
        if (!allowDuplicate) {
          final existing = await _findByKey(deckId, key);
          if (existing != null) {
            return DuplicateFront(existing);
          }
        }
        final now = _clock();
        final row = CardRow(
          id: _newId(),
          deckId: deckId.value,
          front: encodeCells(framed, newId: _newBlockId),
          back: encodeContent(const []),
          cardKey: key.value,
          source: CardSource.manual.name,
          template: freeTemplate,
          templateVersion: cardFrameVersion,
          createdAt: now,
          updatedAt: now,
          dirty: true,
        );
        await _db.into(_db.cards).insert(row);
        return CardSaved(_toCard(row));
      }),
    );
  }

  /// Replaces [card]'s content, in the frame when given its [cells], of which
  /// [front] and [back] are then the projection. Another card in the same
  /// deck with an equal key blocks the save unless [allowDuplicate] is set.
  /// Content that cannot be read back is not stored: the save fails as
  /// [UnreadableCard].
  Future<SaveCardResult> editCard(
    Card card, {
    required List<Content> front,
    required List<Content> back,
    List<Cell>? cells,
    bool allowDuplicate = false,
  }) {
    final key = CardKey.fromFront(plainText(front));
    return _guard(
      () => _db.transaction(() async {
        if (!allowDuplicate) {
          final existing = await _findByKey(card.deckId, key, except: card.id);
          if (existing != null) {
            return DuplicateFront(existing);
          }
        }
        final stored = await (_db.select(
          _db.cards,
        )..where((row) => row.id.equals(card.id.value))).getSingle();
        final now = _clock();
        await (_db.update(
          _db.cards,
        )..where((row) => row.id.equals(card.id.value))).write(
          CardsCompanion(
            front: Value(
              cells == null
                  ? encodeContent(_withIds(front, card.front))
                  : encodeCells(cells, newId: _newBlockId),
            ),
            back: Value(
              cells == null
                  ? encodeContent(_withIds(back, card.back))
                  : encodeContent(const []),
            ),
            cardKey: Value(key.value),
            template: const Value(freeTemplate),
            templateVersion: Value(
              cells == null ? cardTemplateVersion : cardFrameVersion,
            ),
            updatedAt: Value(now),
            dirty: const Value(true),
          ),
        );
        // Read back as any card is read, so content the decoder refuses
        // throws here and the write rolls back, as an add's does.
        final row = await (_db.select(
          _db.cards,
        )..where((row) => row.id.equals(card.id.value))).getSingle();
        await _releaseUnheld(_mediaOf(stored));
        return CardSaved(_toCard(row));
      }),
    );
  }

  /// Deletes the card as a tombstone sync pushes, and releases its photos and
  /// sounds unless another holds them.
  Future<void> deleteCard(CardId id) => _guard(
    () => _db.transaction(() async {
      final cards = _db.select(_db.cards)
        ..where((card) => card.id.equals(id.value));
      final images = {for (final row in await cards.get()) ..._mediaOf(row)};
      await (_db.update(_db.cards)..where((card) => card.id.equals(id.value)))
          .write(_cardTombstone(_clock()));
      await _releaseUnheld(images);
    }),
  );

  /// Saves [cards] from [source] into [target] in one transaction, creating
  /// the deck first when the target is a new one. A card whose key collides
  /// with a card already in the deck, or with one saved earlier in [cards],
  /// does what its [IncomingCard.onDuplicate] says; no card is overwritten or
  /// deleted.
  ///
  /// A copy's photos and sounds become the user's own: each file is read
  /// from the owner's folder and kept on the device under a new id before
  /// the transaction, then queued for upload as its card is written, and its
  /// blocks name that id. The files no written card holds are deleted after
  /// the transaction, and all of them when it fails. A file that could not
  /// be read leaves its block naming a new id no file holds (ADR 0113).
  Future<CardsAdded> addCards(
    AddTarget target,
    List<IncomingCard> cards, {
    AddSource source = const FromPhoto(),
  }) => _guard(() async {
    // Read before the transaction, which holds the database while it runs.
    final fetched = switch ((source, _media)) {
      (FromCopy(:final owner), final media?) => await media.fetchShared(owner, [
        for (final card in cards)
          for (final side in [card.front, card.back]) ...mediaOf(side),
      ]),
      _ => const <MediaId, FetchedMedia>{},
    };
    // One file of the owner's, held by several cards, is copied once.
    final copies = <MediaId, MediaId>{};
    Future<MediaId> copyOf(MediaId media) async =>
        copies[media] ??= switch ((fetched[media], _media)) {
          (final file?, final store?) => await store.addFetched(file),
          _ => MediaId(_newId()),
        };
    Future<List<Content>> own(List<Content> side) async => switch (source) {
      FromPhoto() || FromFile() => side,
      FromCopy() => [
        for (final block in side)
          switch (block) {
            ImageContent() => ImageContent(
              media: await copyOf(block.media),
              width: block.width,
              height: block.height,
              boxes: block.boxes,
              rest: block.rest,
              id: block.id,
            ),
            AudioContent() => AudioContent(
              media: await copyOf(block.media),
              duration: block.duration,
              rest: block.rest,
              id: block.id,
            ),
            _ => block,
          },
      ],
    };
    Future<List<Cell>> ownCells(List<Cell> cells) async => [
      for (final cell in cells)
        switch (cell) {
          BlankCell(:final block, :final id) => BlankCell(
            (await own([block])).single,
            id: id,
          ),
          PlacedCell(:final block, :final side, :final id) => PlacedCell(
            (await own([block])).single,
            side,
            id: id,
          ),
          _ => cell,
        },
    ];
    final CardsAdded result;
    try {
      result = await _db.transaction(() async {
        final deck = switch (target) {
          AddToDeck(:final deck) => await getDeck(deck),
          AddToNewDeck(:final name) => await createDeck(name),
        };
        var added = 0;
        var merged = 0;
        for (final card in cards) {
          // A copied front with a photo or sound names a new id, so its key
          // matches no card already stored.
          final front = await own(card.front);
          final key = CardKey.fromFront(plainText(front));
          final existing = await _findByKey(deck.id, key);
          switch ((existing, card.onDuplicate)) {
            case (null, _) || (_, DuplicateChoice.addNew):
              final now = _clock();
              final back = await own(card.back);
              final cells = switch (card.cells) {
                final cells? => await ownCells(cells),
                null => null,
              };
              await _db
                  .into(_db.cards)
                  .insert(
                    CardRow(
                      id: _newId(),
                      deckId: deck.id.value,
                      front: cells == null
                          ? encodeContent(_withIds(front, const []))
                          : encodeCells(cells, newId: _newBlockId),
                      back: cells == null
                          ? encodeContent(_withIds(back, const []))
                          : encodeContent(const []),
                      cardKey: key.value,
                      template: freeTemplate,
                      templateVersion: cells == null
                          ? cardTemplateVersion
                          : cardFrameVersion,
                      source: switch (source) {
                        FromPhoto() || FromFile() => CardSource.import.name,
                        FromCopy() => CardSource.copy.name,
                      },
                      originDeckId: switch (source) {
                        FromPhoto() || FromFile() => null,
                        FromCopy(:final origin) => origin.value,
                      },
                      createdAt: now,
                      updatedAt: now,
                      dirty: true,
                    ),
                  );
              added++;
            case (final existing?, DuplicateChoice.mergeBack):
              final incoming = plainText(card.back);
              final cells = cellsOf(existing);
              if (cells != null && mergeBack(existing.back, incoming) != null) {
                await (_db.update(
                  _db.cards,
                )..where((row) => row.id.equals(existing.id.value))).write(
                  CardsCompanion(
                    front: Value(
                      encodeCells([
                        ...cells,
                        TextCell.literal(back: incoming),
                      ], newId: _newBlockId),
                    ),
                    back: Value(encodeContent(const [])),
                    template: const Value(freeTemplate),
                    templateVersion: const Value(cardFrameVersion),
                    updatedAt: Value(_clock()),
                    dirty: const Value(true),
                  ),
                );
                merged++;
              }
            case (_?, DuplicateChoice.skip):
              break;
          }
        }
        return CardsAdded(deck: deck, added: added, merged: merged);
      });
    } on Object {
      // Nothing the transaction wrote holds a fetched file.
      await _media?.discardFetched(fetched.values);
      rethrow;
    }
    await _media?.discardFetched([
      for (final MapEntry(:key, :value) in fetched.entries)
        if (!copies.containsKey(key)) value,
    ]);
    return result;
  });

  /// The deck, unless it was deleted; then [DeckDeleted].
  Future<Deck> getDeck(DeckId id) => _guard(() async {
    final row =
        await (_db.select(_db.decks)..where(
              (deck) => deck.id.equals(id.value) & deck.deletedAt.isNull(),
            ))
            .getSingleOrNull();
    if (row == null) throw DeckDeleted(id);
    return _toDeck(row);
  });

  /// The `visibility` column. A deck being checked or held is public there
  /// as it is on the server, so a later push of the row cannot lift the hold;
  /// a pull brings the server's state back.
  static String _visibilityName(DeckVisibility visibility) =>
      switch (visibility) {
        PrivateDeck() || RefusedDeck() => 'private',
        CheckingDeck() || HeldDeck() || PublicDeck() => 'public',
      };

  /// The `publication` column.
  static String _publicationName(DeckVisibility visibility) =>
      switch (visibility) {
        PrivateDeck() => DeckPublication.private,
        CheckingDeck() => DeckPublication.checking,
        HeldDeck() => DeckPublication.held,
        RefusedDeck() => DeckPublication.refused,
        PublicDeck() => DeckPublication.public,
      }.name;

  static DecksCompanion _deckTombstone(DateTime at) => DecksCompanion(
    deletedAt: Value(at),
    updatedAt: Value(at),
    dirty: const Value(true),
  );

  static CardsCompanion _cardTombstone(DateTime at) => CardsCompanion(
    deletedAt: Value(at),
    updatedAt: Value(at),
    dirty: const Value(true),
  );

  /// [blocks] as written: each keeps its id, or takes the id of the next
  /// block of its kind in [previous] not yet taken, or a new one, so a block
  /// keeps its id across edits and every block has one once written
  /// (ADR 0106). A block this build cannot read is kept as it is.
  List<Content> _withIds(List<Content> blocks, List<Content> previous) {
    final unused = [
      for (final block in previous)
        if (block.id != null && block is! UnsupportedContent) block,
    ];
    final taken = {for (final block in blocks) ?block.id};
    return [
      for (final block in blocks)
        switch (block) {
          UnsupportedContent() || Content(id: _?) => block,
          _ => withBlockId(block, switch (unused.indexWhere(
            (old) =>
                old.runtimeType == block.runtimeType && !taken.contains(old.id),
          )) {
            -1 => _newBlockId(),
            final index => unused.removeAt(index).id!,
          }),
        },
    ];
  }

  /// One lookup on the `(deck_id, card_key)` index.
  Future<Card?> _findByKey(DeckId deckId, CardKey key, {CardId? except}) async {
    final query = _db.select(_db.cards)
      ..where(
        (card) =>
            card.deckId.equals(deckId.value) &
            card.cardKey.equals(key.value) &
            card.deletedAt.isNull() &
            (except == null
                ? const Constant(true)
                : card.id.equals(except.value).not()),
      )
      ..limit(1);
    final row = await query.getSingleOrNull();
    return row == null ? null : _toCard(row);
  }

  /// The photos and sounds [row]'s sides hold (ADR 0109, ADR 0112). A side
  /// this build cannot decode names no file it can find, so it gives none.
  static Set<MediaId> _mediaOf(CardRow row) => {
    for (final side in [row.front, row.back]) ..._mediaOfSide(side),
  };

  static Set<MediaId> _mediaOfSide(String side) {
    try {
      return mediaOf(decodeContent(side));
    } on FormatException {
      return const {};
    }
  }

  /// Releases each of [images] that no live deck or card still holds, as a
  /// copied card or deck keeps the media id of the one it was copied from.
  /// Called after the write, inside its transaction, so the rows read are
  /// the ones the write leaves.
  Future<void> _releaseUnheld(Set<MediaId> images) async {
    final media = _media;
    if (media == null) return;
    for (final image in images) {
      if (!await _isHeld(image)) await media.release(image);
    }
  }

  Future<bool> _isHeld(MediaId image) async {
    final deck = _db.selectOnly(_db.decks)
      ..addColumns([_db.decks.id])
      ..where(
        _db.decks.imageMediaId.equals(image.value) &
            _db.decks.deletedAt.isNull(),
      )
      ..limit(1);
    if (await deck.getSingleOrNull() != null) return true;
    // The pattern narrows the scan to rows naming the id; decoding decides.
    // A side this build cannot decode, but which names the id, holds it.
    final pattern = '%${image.value}%';
    final cards = _db.select(_db.cards)
      ..where(
        (card) =>
            card.deletedAt.isNull() &
            (card.front.like(pattern) | card.back.like(pattern)),
      );
    for (final row in await cards.get()) {
      for (final side in [row.front, row.back]) {
        if (!side.contains(image.value)) continue;
        try {
          if (mediaOf(decodeContent(side)).contains(image)) return true;
        } on FormatException {
          return true;
        }
      }
    }
    return false;
  }

  /// The image of deck [id]; null when it has none or is not stored.
  Future<MediaId?> _imageOf(DeckId id) async {
    final query = _db.selectOnly(_db.decks)
      ..addColumns([_db.decks.imageMediaId])
      ..where(_db.decks.id.equals(id.value));
    final image = (await query.getSingleOrNull())?.read(_db.decks.imageMediaId);
    return image == null ? null : MediaId(image);
  }

  /// The two columns as one state. A public row always carries its publish
  /// time, which the server checks; a row that says public with a
  /// `publication` of private or refused reads as public, as the server
  /// shows it, and one that says private with any state but refused as
  /// private.
  static DeckVisibility _visibilityOf(DeckRow row) =>
      switch ((row.visibility, row.publishedAt)) {
        ('public', final publishedAt?) => switch (DeckPublication.fromName(
          row.publication,
        )) {
          DeckPublication.checking => CheckingDeck(publishedAt),
          DeckPublication.held => HeldDeck(publishedAt),
          DeckPublication.public ||
          DeckPublication.private ||
          DeckPublication.refused => PublicDeck(publishedAt),
        },
        _ when row.publication == DeckPublication.refused.name =>
          const RefusedDeck(),
        _ => const PrivateDeck(),
      };

  Deck _toDeck(DeckRow row) => Deck(
    id: DeckId(row.id),
    name: row.name,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    visibility: _visibilityOf(row),
    description: row.description,
    icon: DeckIcon.fromKey(row.icon),
    color: DeckColor.fromKey(row.color),
    image: switch (row.imageMediaId) {
      final image? => MediaId(image),
      null => null,
    },
  );

  Card _toCard(CardRow row) {
    final id = CardId(row.id);
    try {
      final cells = isFramed(row.template, row.templateVersion)
          ? decodeCells(row.front)
          : null;
      final sides = cells == null ? null : sidesOf(cells);
      return Card(
        id: id,
        deckId: DeckId(row.deckId),
        front: sides?.front ?? decodeContent(row.front),
        back: sides?.back ?? decodeContent(row.back),
        cardKey: CardKey.stored(row.cardKey),
        source: CardSource.values.byName(row.source),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        originDeckId: switch (row.originDeckId) {
          final origin? => DeckId(origin),
          null => null,
        },
        template: row.template,
        templateVersion: row.templateVersion,
        cells: cells,
      );
    } on FormatException catch (cause) {
      throw UnreadableCard(id, cause);
    }
  }

  /// Runs [operation], reporting a database exception as [StorageFailure].
  Future<T> _guard<T>(Future<T> Function() operation) async {
    try {
      return await operation();
    } on DeckFailure {
      rethrow;
    } on Exception catch (cause, stackTrace) {
      Error.throwWithStackTrace(StorageFailure(cause), stackTrace);
    }
  }

  /// [stream] with each database exception reported as [StorageFailure].
  Stream<T> _guardStream<T>(Stream<T> stream) => stream.transform(
    StreamTransformer.fromHandlers(
      handleError: (error, stackTrace, sink) => sink.addError(
        error is Exception && error is! DeckFailure
            ? StorageFailure(error)
            : error,
        stackTrace,
      ),
    ),
  );
}
