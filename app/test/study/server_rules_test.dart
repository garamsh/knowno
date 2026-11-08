import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/study/src/overview.dart';

/// The days `public.mastered_interval()` returns in the last migration, in
/// the order they are applied, that defines it; the server's progress counts
/// read the interval from it.
int? serverMasteredDays(Map<String, String> migrations) {
  final definition = RegExp(
    r'create (?:or replace )?function public\.mastered_interval\(\)[^$]*\$\$\s*select interval \x27(\d+) days\x27\s*\$\$',
  );
  int? days;
  for (final name in migrations.keys.toList()..sort()) {
    for (final match in definition.allMatches(migrations[name]!)) {
      days = int.parse(match.group(1)!);
    }
  }
  return days;
}

void main() {
  final directory = Directory('../supabase/migrations');
  final migrations = {
    for (final file in directory.listSync().whereType<File>())
      if (file.path.endsWith('.sql'))
        file.uri.pathSegments.last: file.readAsStringSync(),
  };

  test('masteredInterval is the days the last migration gives public.mastered_interval()', () {
    expect(migrations, isNotEmpty);
    expect(serverMasteredDays(migrations), isNotNull);

    expect(serverMasteredDays(migrations), masteredInterval.inDays);
    expect(
      masteredInterval,
      Duration(days: serverMasteredDays(migrations)!),
      reason: 'whole days',
    );
  });

  test('the read follows a later migration that moves the interval', () {
    const moved = '''
create or replace function public.mastered_interval() returns interval
language sql
as \$\$
  select interval '30 days'
\$\$;''';
    expect(
      serverMasteredDays({...migrations, '99999999999999_moved.sql': moved}),
      30,
    );
    // Control: a file that does not define it leaves the read as it was.
    expect(
      serverMasteredDays({
        ...migrations,
        '99999999999999_other.sql': 'select 1;',
      }),
      serverMasteredDays(migrations),
    );
  });
}
