import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/database/database.dart';

// The release of `third_party/sqlite/sqlite3.c`, which `hooks: user_defines:
// sqlite3:` in `pubspec.yaml` has the sqlite3 package compile (ADR 0220).
const _committedSqlite = '3.54.1';

void main() {
  test(
    'the database runs the SQLite compiled from the committed source',
    () async {
      final db = AppDatabase(NativeDatabase.memory());
      addTearDown(db.close);

      final row = await db
          .customSelect('select sqlite_version() as version')
          .getSingle();

      expect(row.read<String>('version'), _committedSqlite);
    },
  );
}
