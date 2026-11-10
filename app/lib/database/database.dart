import 'dart:convert';

import 'package:drift/drift.dart';

import 'database.steps.dart';

part 'database.g.dart';

/// [time] as every time column stores it: in UTC, truncated to the
/// millisecond, so every stored value has one length and one zone and its text
/// order is its time order.
DateTime storedTime(DateTime time) => DateTime.fromMillisecondsSinceEpoch(
  time.millisecondsSinceEpoch,
  isUtc: true,
);

/// Writes every time column through [storedTime].
final class StoredTime extends TypeConverter<DateTime, DateTime> {
  const StoredTime();

  @override
  DateTime fromSql(DateTime fromDb) => fromDb;

  @override
  DateTime toSql(DateTime value) => storedTime(value);
}

/// Decks, each a named collection of cards, with whether it is published.
@DataClassName('DeckRow')
@TableIndex.sql('CREATE INDEX decks_unsynced ON decks (id) WHERE "dirty"')
class Decks extends Table {
  TextColumn get id => text()();
  TextColumn get name => text()();
  TextColumn get visibility => text()
      .withDefault(const Constant('private'))
      .check(const CustomExpression("visibility IN ('private', 'public')"))();

  /// When the deck was last published; null while it never was, or once it
  /// was made private again.
  DateTimeColumn get publishedAt =>
      dateTime().nullable().map(const StoredTime())();

  /// Where the server's screening has the deck (ADR 0238): a deck the
  /// device made public is `checking`, `held` or `public` there.
  TextColumn get publication => text()
      .withDefault(const Constant('private'))
      .check(
        const CustomExpression(
          "publication IN ('private', 'checking', 'held', 'refused', 'public')",
        ),
      )();
  TextColumn get description => text().nullable()();

  /// The key of the icon the owner chose for the deck's tile; null, or a key
  /// this build does not know, draws the default.
  TextColumn get icon => text().nullable()();

  /// The key of the colour the owner chose for the deck's tile; null, or a
  /// key this build does not know, draws the colour the deck's id selects.
  TextColumn get color => text().nullable()();

  /// The media id of the image the owner chose for the deck's tile; null
  /// draws its icon (ADR 0107).
  TextColumn get imageMediaId => text().nullable()();
  DateTimeColumn get createdAt => dateTime().map(const StoredTime())();
  DateTimeColumn get updatedAt => dateTime().map(const StoredTime())();
  DateTimeColumn get deletedAt =>
      dateTime().nullable().map(const StoredTime())();
  BoolColumn get dirty => boolean().withDefault(const Constant(true))();

  @override
  Set<Column<Object>> get primaryKey => {id};
}

/// Cards; `front` and `back` hold encoded content blocks, `cardKey` the
/// normalized front the duplicate check looks up.
@DataClassName('CardRow')
@TableIndex.sql(
  'CREATE INDEX cards_deck_id_card_key ON cards (deck_id, card_key) '
  'WHERE deleted_at IS NULL',
)
@TableIndex(name: 'cards_deck_id_created_at', columns: {#deckId, #createdAt})
@TableIndex.sql('CREATE INDEX cards_unsynced ON cards (id) WHERE "dirty"')
class Cards extends Table {
  TextColumn get id => text()();
  TextColumn get deckId =>
      text().references(Decks, #id, onDelete: KeyAction.cascade)();
  TextColumn get front => text()();
  TextColumn get back => text()();
  TextColumn get cardKey => text()();
  TextColumn get source => text().check(
    const CustomExpression("source IN ('manual', 'import', 'copy')"),
  )();

  /// The public deck a copied card came from; null for any other card.
  TextColumn get originDeckId => text().nullable()();

  /// The template the card was made from and its version, null until its
  /// first write in a build that records them; never checked against a list,
  /// so a later build's template is kept (ADR 0106).
  TextColumn get template => text().nullable()();
  IntColumn get templateVersion => integer().nullable()();
  DateTimeColumn get createdAt => dateTime().map(const StoredTime())();
  DateTimeColumn get updatedAt => dateTime().map(const StoredTime())();
  DateTimeColumn get deletedAt =>
      dateTime().nullable().map(const StoredTime())();
  BoolColumn get dirty => boolean().withDefault(const Constant(true))();

  @override
  Set<Column<Object>> get primaryKey => {id};
}

/// Reviews of a card, written by the study domain.
@DataClassName('ReviewRow')
@TableIndex(
  name: 'reviews_card_id_reviewed_at',
  columns: {#cardId, #reviewedAt},
)
@TableIndex(name: 'reviews_reviewed_at', columns: {#reviewedAt})
@TableIndex.sql('CREATE INDEX reviews_unsynced ON reviews (id) WHERE "dirty"')
class Reviews extends Table {
  TextColumn get id => text()();
  TextColumn get cardId =>
      text().references(Cards, #id, onDelete: KeyAction.cascade)();
  TextColumn get rating =>
      text().check(const CustomExpression("rating IN ('again', 'good')"))();
  DateTimeColumn get reviewedAt => dateTime().map(const StoredTime())();
  IntColumn get durationMs => integer()();

  /// The fuzz factor the review was scheduled with; null for a review written
  /// before schema v3, which was scheduled without fuzz.
  RealColumn get fuzzFactor => real().nullable().check(
    const CustomExpression('fuzz_factor >= 0 AND fuzz_factor < 1'),
  )();
  DateTimeColumn get updatedAt => dateTime().map(const StoredTime())();
  BoolColumn get dirty => boolean().withDefault(const Constant(true))();

  @override
  Set<Column<Object>> get primaryKey => {id};
}

/// A reviewed card's scheduling state, owned by the study domain. A card that
/// was never reviewed has no row.
@DataClassName('CardStateRow')
@TableIndex.sql(
  'CREATE INDEX card_states_unsynced ON card_states (card_id) WHERE "dirty"',
)
class CardStates extends Table {
  TextColumn get cardId =>
      text().references(Cards, #id, onDelete: KeyAction.cascade)();
  RealColumn get stability => real()();
  RealColumn get difficulty => real()();
  DateTimeColumn get lastReview => dateTime().map(const StoredTime())();
  DateTimeColumn get due => dateTime().map(const StoredTime())();
  DateTimeColumn get updatedAt => dateTime().map(const StoredTime())();
  BoolColumn get dirty => boolean().withDefault(const Constant(true))();

  @override
  Set<Column<Object>> get primaryKey => {cardId};
}

/// Which account the local database belongs to, and how far each synced table
/// has been pulled: the highest server revision seen. At most one row; none
/// while no account owns the database.
@DataClassName('SyncStateRow')
class SyncState extends Table {
  IntColumn get id => integer().check(const CustomExpression('id = 0'))();
  TextColumn get owner => text()();
  IntColumn get decksRevision => integer()();
  IntColumn get cardsRevision => integer()();
  IntColumn get reviewsRevision => integer()();
  IntColumn get cardStatesRevision => integer()();

  @override
  Set<Column<Object>> get primaryKey => {id};
}

/// The user's study settings, owned by the study domain and synced: the daily
/// study minutes new cards fill (ADR 0085). At most one row; none while the
/// user has set nothing, which reads as the default.
@DataClassName('StudySettingsRow')
class StudySettings extends Table {
  IntColumn get id => integer().check(const CustomExpression('id = 0'))();
  IntColumn get dailyMinutes => integer().check(
    const CustomExpression('daily_minutes BETWEEN 5 AND 180'),
  )();
  DateTimeColumn get updatedAt => dateTime().map(const StoredTime())();
  BoolColumn get dirty => boolean().withDefault(const Constant(true))();

  @override
  Set<Column<Object>> get primaryKey => {id};
}

/// Media this device stored, owned by the media domain: each row waits for
/// its file, kept on the device, to be uploaded, and goes once it is
/// (ADR 0107).
@DataClassName('MediaUploadRow')
class MediaUploads extends Table {
  TextColumn get id => text()();
  TextColumn get kind =>
      text().check(const CustomExpression("kind IN ('image', 'audio')"))();
  TextColumn get mimeType => text()();
  IntColumn get byteSize => integer()();
  TextColumn get sha256 => text()();
  DateTimeColumn get createdAt => dateTime().map(const StoredTime())();

  @override
  Set<Column<Object>> get primaryKey => {id};
}

/// Media the user let go, owned by the media domain: each row waits for its
/// file and row on the server to be deleted, and goes once they are
/// (ADR 0107).
@DataClassName('MediaDeletionRow')
class MediaDeletions extends Table {
  TextColumn get id => text()();

  @override
  Set<Column<Object>> get primaryKey => {id};
}

/// The app's local SQLite database, shared by every domain below which it sits.
@DriftDatabase(
  tables: [
    Decks,
    Cards,
    Reviews,
    CardStates,
    SyncState,
    StudySettings,
    MediaUploads,
    MediaDeletions,
  ],
)
class AppDatabase extends _$AppDatabase {
  AppDatabase(super.executor);

  @override
  int get schemaVersion => 15;

  @override
  MigrationStrategy get migration => MigrationStrategy(
    onUpgrade: stepByStep(
      from1To2: (m, schema) async {
        await m.createTable(schema.cardStates);
      },
      from2To3: (m, schema) async {
        await m.addColumn(schema.reviews, schema.reviews.fuzzFactor);
      },
      // Every row from before v4 is unsynced, so the new dirty flags start set.
      from3To4: (m, schema) async {
        for (final (table, deletedAt, dirty) in [
          (schema.decks, schema.decks.deletedAt, schema.decks.dirty),
          (schema.cards, schema.cards.deletedAt, schema.cards.dirty),
        ]) {
          await m.addColumn(table, deletedAt);
          await m.addColumn(table, dirty);
        }
        await m.alterTable(
          TableMigration(
            schema.reviews,
            columnTransformer: {
              schema.reviews.updatedAt: schema.reviews.reviewedAt,
            },
            newColumns: [
              schema.reviews.updatedAt,
              schema.reviews.deletedAt,
              schema.reviews.dirty,
            ],
          ),
        );
        await m.alterTable(
          TableMigration(
            schema.cardStates,
            columnTransformer: {
              schema.cardStates.updatedAt: schema.cardStates.lastReview,
            },
            newColumns: [
              schema.cardStates.updatedAt,
              schema.cardStates.deletedAt,
              schema.cardStates.dirty,
            ],
          ),
        );
        await m.createTable(schema.syncState);
      },
      // The cards table is rebuilt, since SQLite cannot change its source check
      // in place; foreign keys are off during migrations, so no review cascades.
      from4To5: (m, schema) async {
        await m.addColumn(schema.decks, schema.decks.visibility);
        await m.addColumn(schema.decks, schema.decks.publishedAt);
        await m.addColumn(schema.decks, schema.decks.description);
        await m.alterTable(
          TableMigration(schema.cards, newColumns: [schema.cards.originDeckId]),
        );
      },
      // Every time column moves from Unix seconds to UTC text at the
      // millisecond. Each table is rebuilt with its rows and dirty flags, and
      // foreign keys are off during migrations, so no review cascades.
      from5To6: (m, schema) async {
        for (final (table, columns)
            in <(TableInfo<Table, dynamic>, List<GeneratedColumn<Object>>)>[
              (
                schema.decks,
                [
                  schema.decks.publishedAt,
                  schema.decks.createdAt,
                  schema.decks.updatedAt,
                  schema.decks.deletedAt,
                ],
              ),
              (
                schema.cards,
                [
                  schema.cards.createdAt,
                  schema.cards.updatedAt,
                  schema.cards.deletedAt,
                ],
              ),
              (
                schema.reviews,
                [
                  schema.reviews.reviewedAt,
                  schema.reviews.updatedAt,
                  schema.reviews.deletedAt,
                ],
              ),
              (
                schema.cardStates,
                [
                  schema.cardStates.lastReview,
                  schema.cardStates.due,
                  schema.cardStates.updatedAt,
                  schema.cardStates.deletedAt,
                ],
              ),
            ]) {
          await m.alterTable(
            TableMigration(
              table,
              columnTransformer: {
                for (final column in columns)
                  column: CustomExpression<String>(
                    "strftime('%Y-%m-%dT%H:%M:%fZ', "
                    "${column.escapedNameFor(SqlDialect.sqlite)}, 'unixepoch')",
                  ),
              },
            ),
          );
        }
        // The rebuild restored the v5 index, which v6 makes partial.
        await m.drop(schema.cardsDeckIdCardKey);
        for (final index in [
          schema.decksUnsynced,
          schema.cardsDeckIdCardKey,
          schema.cardsDeckIdCreatedAt,
          schema.cardsUnsynced,
          schema.reviewsCardIdReviewedAt,
          schema.reviewsLiveReviewedAt,
          schema.reviewsUnsynced,
          schema.cardStatesUnsynced,
        ]) {
          await m.create(index);
        }
      },
      // Reviews and card states lose deleted_at, which nothing wrote, so every
      // row is kept as it was. The partial index naming the column goes first,
      // since a rebuild restores the indexes the table had.
      from6To7: (m, schema) async {
        await m.drop(Index('reviews_live_reviewed_at', ''));
        await m.alterTable(TableMigration(schema.reviews));
        await m.alterTable(TableMigration(schema.cardStates));
        await m.create(schema.reviewsReviewedAt);
      },
      // A copied card's source is 'copy', not 'shared' (ADR 0082). The table
      // is rebuilt for its check with each such row remapped and every other
      // row and dirty flag kept; the server remaps its own copy.
      from7To8: (m, schema) async {
        await m.alterTable(
          TableMigration(
            schema.cards,
            columnTransformer: {
              schema.cards.source: const CustomExpression<String>(
                "CASE source WHEN 'shared' THEN 'copy' ELSE source END",
              ),
            },
          ),
        );
      },
      // The daily study minutes (ADR 0085): a new table, so no row changes.
      from8To9: (m, schema) async {
        await m.createTable(schema.studySettings);
      },
      from9To10: (m, schema) async {
        await m.addColumn(schema.decks, schema.decks.icon);
        await m.addColumn(schema.decks, schema.decks.color);
      },
      // A card's template and its version (ADR 0106): two nullable columns,
      // so no row changes; a card gains them on its next write.
      from10To11: (m, schema) async {
        await m.addColumn(schema.cards, schema.cards.template);
        await m.addColumn(schema.cards, schema.cards.templateVersion);
      },
      // A deck's image and the media queues (ADR 0107): a nullable column and
      // two new tables, so no row changes.
      from11To12: (m, schema) async {
        await m.addColumn(schema.decks, schema.decks.imageMediaId);
        await m.createTable(schema.mediaUploads);
        await m.createTable(schema.mediaDeletions);
      },
      // Every live card of a template earlier builds wrote becomes a 자유
      // card at version 1 (ADR 0114). Its content, edit time and dirty flag
      // are kept: the server migrates its own rows, so a synced card takes
      // the server's copy on the tie and an unsynced edit still wins it. A
      // template, or a version, this build does not know is left as it is.
      from12To13: (m, schema) async {
        await m.database.customStatement(
          "UPDATE cards SET template = 'free', template_version = 1 "
          'WHERE deleted_at IS NULL AND (template IS NULL OR '
          "(template IN ('flip', 'cloze', 'table') AND template_version = 1))",
        );
      },
      // Every live card moves to the 칸 frame (ADR 0137), as the server's
      // migration does. Its key, edit time and dirty flag are kept, so a
      // synced card takes the server's copy on the tie and an unsynced edit
      // wins it, already in the frame. A card [frameSides] cannot convert, a
      // tombstone and a template no build wrote are left as they are.
      from13To14: (m, schema) async {
        final cards = await m.database
            .customSelect(
              'SELECT id, front, back FROM cards '
              'WHERE deleted_at IS NULL AND (template IS NULL OR '
              "(template IN ('free', 'flip', 'cloze', 'table') "
              'AND template_version = 1))',
            )
            .get();
        for (final card in cards) {
          final framed = frameSides(
            card.read<String>('front'),
            card.read<String>('back'),
          );
          if (framed == null) continue;
          await m.database.customStatement(
            "UPDATE cards SET front = ?, back = '[]', template = 'free', "
            'template_version = 2 WHERE id = ?',
            [framed, card.read<String>('id')],
          );
        }
      },
      // A deck's screening state (ADR 0238): a public deck is `public` until
      // a pull says otherwise, so no row changes shape.
      from14To15: (m, schema) async {
        await m.addColumn(schema.decks, schema.decks.publication);
        await m.database.customStatement(
          "UPDATE decks SET publication = 'public' WHERE visibility = 'public'",
        );
      },
    ),
    // SQLite leaves foreign keys off per connection; deck deletion cascades only with them on.
    beforeOpen: (details) async {
      await customStatement('PRAGMA foreign_keys = ON');
    },
  );
}

/// The stored block of [type] at version 2 with [fields], taking [owner]'s id
/// when it has one.
Map<String, Object?> _frameBlock(
  String type,
  Map<String, Object?> fields, [
  Map<String, Object?> owner = const {},
]) => {'type': type, 'v': 2, 'id': ?owner['id'], 'payload': fields};

bool _allStrings(Object? value) =>
    value is List<Object?> && value.every((item) => item is String);

/// Whether step 14 can read [block]: a type at a version some build wrote,
/// holding the fields the step reads, as `decodeBlock` reads them.
bool _frameReads(Object? block) {
  if (block is! Map<String, Object?>) return false;
  final type = block['type'];
  final version = block['v'] ?? 1;
  final id = block['id'];
  if (id != null && id is! String) return false;
  if (version is! int || version < 1) return false;
  if (version > (type == 'table' ? 2 : 1)) return false;
  return switch ((type, block['payload'])) {
    ('text', {'text': String()}) => true,
    (
      'cloze',
      {'text': final String text, 'answers': final List<Object?> answers},
    ) =>
      _allStrings(answers) &&
          answers.isNotEmpty &&
          text.split('___').length - 1 == answers.length,
    (
      'table',
      {
        'columns': final List<Object?> columns,
        'rows': final List<Object?> rows,
      },
    ) =>
      columns.isNotEmpty &&
          rows.isNotEmpty &&
          _allStrings(columns) &&
          rows.every(_allStrings),
    ('senses', {'senses': final List<Object?> senses}) => senses.isNotEmpty,
    ('image', {'media': String(), 'boxes': final List<Object?> boxes}) =>
      boxes.every((box) => box is Map<String, Object?>),
    ('audio', {'media': String()}) => true,
    _ => false,
  };
}

bool _frameBlank(Map<String, Object?> block) => switch (block['type']) {
  'cloze' || 'table' => true,
  'image' => ((block['payload'] as Map)['boxes'] as List).isNotEmpty,
  _ => false,
};

/// A cloze with each blank filled, or a table as text.
String _frameFilled(Map<String, Object?> block) {
  final payload = block['payload'] as Map<String, Object?>;
  if (block['type'] == 'cloze') {
    final answers = payload['answers'] as List<Object?>;
    final parts = (payload['text'] as String).split('___');
    return [
      for (final (index, part) in parts.indexed) ...[
        part,
        if (index < answers.length) answers[index],
      ],
    ].join();
  }
  return [
    payload['columns'] as List<Object?>,
    ...(payload['rows'] as List<Object?>).cast<List<Object?>>(),
  ].map((cells) => cells.join(' | ')).join('\n');
}

String _textFront(Map<String, Object?> cell) =>
    (cell['payload'] as Map)[cell['v'] == 2 ? 'front' : 'text'] as String;

String _textBack(Map<String, Object?> cell) =>
    cell['v'] == 2 ? (cell['payload'] as Map)['back'] as String : '';

/// A card's stored sides as its stored 칸 list, the rule of ADR 0137 as
/// amended by ADR 0140, for schema step 14: a migration keeps what it did when
/// it shipped, and `database/` sits below `deck`, whose `cellsFromSides` holds
/// the same rule. Null when the card stays as it is: it does not decode, it
/// holds a block the step cannot read, or it would write a 글 of no text.
String? frameSides(String storedFront, String storedBack) {
  final Object? decodedFront;
  final Object? decodedBack;
  try {
    decodedFront = jsonDecode(storedFront);
    decodedBack = jsonDecode(storedBack);
  } on FormatException {
    return null;
  }
  if (decodedFront is! List<Object?> || decodedBack is! List<Object?>) {
    return null;
  }
  if (![...decodedFront, ...decodedBack].every(_frameReads)) return null;
  final front = decodedFront.cast<Map<String, Object?>>();
  final back = decodedBack.cast<Map<String, Object?>>();

  final cells = [...front];
  final frontBlank = front.any(_frameBlank);
  final oneText = back.length == 1 && back.single['type'] == 'text';
  final backText = oneText ? (back.single['payload'] as Map)['text'] : null;

  // The derived back: the front's filled text, exactly (ADR 0140).
  if (frontBlank &&
      oneText &&
      front.every(
        (block) => const {'text', 'cloze', 'table'}.contains(block['type']),
      ) &&
      backText ==
          front
              .map(
                (block) => block['type'] == 'text'
                    ? (block['payload'] as Map)['text']
                    : _frameFilled(block),
              )
              .join('\n')) {
    return jsonEncode(cells);
  }

  final words = front.where((block) => block['type'] == 'senses').toList();
  if (oneText && words.length == 1) {
    final word = words.single;
    cells[cells.indexOf(word)] = _frameBlock('senses', {
      ...word['payload'] as Map<String, Object?>,
      'term': backText,
      'ask': 'meaning',
    }, word);
    return jsonEncode(cells);
  }

  for (final block in back) {
    final payload = block['payload'] as Map<String, Object?>;
    switch (block['type']) {
      case 'text':
        final at = cells.indexWhere(
          (cell) =>
              cell['type'] == 'text' &&
              _textFront(cell).isNotEmpty &&
              _textBack(cell).isEmpty,
        );
        if (at < 0) {
          cells.add(
            _frameBlock('text', {'front': '', 'back': payload['text']}, block),
          );
        } else {
          cells[at] = _frameBlock('text', {
            'front': _textFront(cells[at]),
            'back': payload['text'],
          }, cells[at]);
        }
      case 'senses':
        if (cells.length == 1 &&
            cells.single['type'] == 'text' &&
            _textBack(cells.single).isEmpty) {
          cells[0] = _frameBlock('senses', {
            ...payload,
            'term': _textFront(cells.single),
            'ask': 'term',
          }, cells.single);
        } else {
          cells.add(
            _frameBlock('senses', {
              ...payload,
              'term': '',
              'ask': 'term',
            }, block),
          );
        }
      case 'cloze' || 'table' when frontBlank:
        cells.add(
          _frameBlock('text', {
            'front': '',
            'back': _frameFilled(block),
          }, block),
        );
      case 'image' when frontBlank && _frameBlank(block):
        final boxes = (payload['boxes'] as List<Object?>)
            .cast<Map<String, Object?>>();
        final answers = [
          for (final box in boxes)
            if (box['answer'] case final String answer) answer,
        ];
        cells.add(
          _frameBlock('image', {
            ...payload,
            'boxes': [],
            'side': 'back',
          }, block),
        );
        if (answers.isNotEmpty) {
          cells.add(
            _frameBlock('text', {'front': '', 'back': answers.join('\n')}),
          );
        }
      case _ when _frameBlank(block):
        cells.add(block);
      default:
        cells.add(
          _frameBlock(block['type'] as String, {
            ...payload,
            'side': 'back',
          }, block),
        );
    }
  }

  final empty = cells.any(
    (cell) =>
        cell['type'] == 'text' &&
        cell['v'] == 2 &&
        _textFront(cell).trim().isEmpty &&
        _textBack(cell).trim().isEmpty,
  );
  return empty ? null : jsonEncode(cells);
}
