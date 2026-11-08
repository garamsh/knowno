import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// The top-level entries `docs/architecture/structure.md` allows under
/// `app/lib/`: the composition site, the shell, the domains and the
/// foundations.
const allowedEntries = {
  'main.dart',
  'home',
  'account',
  'deck',
  'study',
  'sync',
  'sharing',
  'photo_import',
  'assistant',
  'media',
  'design',
  'database',
  'l10n',
};

/// The folders below every domain.
const foundations = {'design', 'database', 'l10n'};

/// The entries under `app/lib/` outside [allowedEntries], given every path
/// under it.
List<String> unlistedEntries(Iterable<String> paths) => [
  for (final entry in {for (final path in paths) path.split('/').first})
    if (!allowedEntries.contains(entry)) entry,
];

/// The import rules of `docs/architecture/structure.md`, checked over Dart
/// sources keyed by their path under `app/lib/`.
///
/// - Nothing in a foundation imports a domain or `home/`.
/// - Nothing but `main.dart` imports `home/`.
/// - Nothing outside a domain's folder imports that domain's `src/`.
List<String> importViolations(Map<String, String> sources) => [
  for (final MapEntry(key: file, value: source) in sources.entries)
    for (final target in importedPaths(file, source)) ?_violation(file, target),
];

/// The tests that reach into a domain's `src/` without being that domain's,
/// checked over Dart sources keyed by their path under `app/test/`: a domain's
/// own tests, under `test/<domain>/`, may import its `src/`, and no other test
/// may (`docs/architecture/structure.md`).
List<String> testImportViolations(Map<String, String> sources) => [
  for (final MapEntry(key: file, value: source) in sources.entries)
    for (final match in _directive.allMatches(source))
      if (match.group(1)!.startsWith(_package))
        ?_testViolation(file, match.group(1)!.substring(_package.length)),
];

/// The foundation files whose importers outside their folder all sit in one
/// domain, or all in `home/`: each serves that one alone, so it belongs there.
List<String> singleUnitFoundations(Map<String, String> sources) {
  final importers = <String, Set<String>>{};
  for (final MapEntry(key: file, value: source) in sources.entries) {
    for (final target in importedPaths(file, source)) {
      if (_unitOf(target) != _unitOf(file)) {
        importers.putIfAbsent(target, () => {}).add(_unitOf(file));
      }
    }
  }
  return [
    for (final MapEntry(key: target, value: units) in importers.entries)
      if (foundations.contains(_unitOf(target)) &&
          units.length == 1 &&
          (units.single == 'home' || _isDomain(units.single)))
        '$target serves ${units.single} alone',
  ];
}

/// The screens each domain's surface exports, by name: the names ending in
/// `Screen` in the `show` lists of `<domain>/<domain>.dart`.
Map<String, String> exportedScreens(Map<String, String> sources) => {
  for (final MapEntry(key: file, value: source) in sources.entries)
    if (_domainOf(file) case final domain? when file == '$domain/$domain.dart')
      for (final shown in _shown.allMatches(source))
        for (final name in shown.group(1)!.split(','))
          if (_screenName.hasMatch(name.trim())) name.trim(): domain,
};

/// The domain files that name a screen another domain exports: a domain
/// imports no screen of another domain, which `home/` composes instead.
List<String> foreignScreens(Map<String, String> sources) {
  final screens = exportedScreens(sources);
  return [
    for (final MapEntry(key: file, value: source) in sources.entries)
      if (_domainOf(file) case final domain?)
        for (final MapEntry(key: screen, value: owner) in screens.entries)
          if (owner != domain &&
              RegExp('\\b$screen\\b').hasMatch(_withoutComments(source)))
            '$file names $screen, a screen of $owner',
  ];
}

/// The files in `home/` that hold a read of their own: a provider declared
/// there, or an import of the database. `home/` composes what the domains
/// read.
List<String> homeReads(Map<String, String> sources) => [
  for (final MapEntry(key: file, value: source) in sources.entries)
    if (_unitOf(file) == 'home') ...[
      for (final declared in _provider.allMatches(source))
        '$file declares ${declared.group(1)}, a provider',
      for (final target in importedPaths(file, source))
        if (_unitOf(target) == 'database') '$file imports $target',
    ],
];

final _shown = RegExp(r'^\s*export\s[^;]*?\bshow\b([^;]*);', multiLine: true);

final _screenName = RegExp(r'^[A-Z]\w*Screen$');

final _provider = RegExp(
  r'^\s*final\s+(\w+)\s*=\s*\w*Provider\b',
  multiLine: true,
);

String _withoutComments(String source) =>
    source.replaceAll(RegExp(r'//.*$', multiLine: true), '');

final _directive = RegExp(
  r'''^\s*(?:import|export)\s+['"]([^'"]+)['"]''',
  multiLine: true,
);

/// The paths under `app/lib/` that [file] imports or exports; imports of
/// other packages and of the SDK are left out.
List<String> importedPaths(String file, String source) => [
  for (final match in _directive.allMatches(source))
    ?_resolve(file, match.group(1)!),
];

const _package = 'package:knowno/';

String? _resolve(String file, String uri) {
  if (uri.startsWith(_package)) return uri.substring(_package.length);
  if (uri.startsWith('package:') || uri.startsWith('dart:')) return null;
  final resolved = Uri.parse('file:///lib/$file').resolve(uri).path;
  return resolved.startsWith('/lib/')
      ? resolved.substring('/lib/'.length)
      : null;
}

/// The top-level entry [path] sits in: a folder, or a file at the top of
/// `lib/`, such as the composition site.
String _unitOf(String path) => path.split('/').first;

bool _isDomain(String unit) =>
    allowedEntries.contains(unit) &&
    unit != 'main.dart' &&
    unit != 'home' &&
    !foundations.contains(unit);

/// The domain folder [path] sits in; null for a foundation, `home/` and the
/// files at the top of `lib/`.
String? _domainOf(String path) {
  final unit = _unitOf(path);
  return path.contains('/') && _isDomain(unit) ? unit : null;
}

String? _violation(String file, String target) {
  final fileUnit = _unitOf(file);
  final targetUnit = _unitOf(target);
  final targetDomain = _domainOf(target);
  if (foundations.contains(fileUnit) &&
      (targetDomain != null || targetUnit == 'home')) {
    return '$file imports ${targetDomain ?? 'home'} ($target), from a foundation';
  }
  if (targetUnit == 'home' && fileUnit != 'home' && file != 'main.dart') {
    return '$file imports home ($target), which only main.dart may';
  }
  final segments = target.split('/');
  if (targetDomain != null &&
      segments.length > 2 &&
      segments[1] == 'src' &&
      _domainOf(file) != targetDomain) {
    return '$file imports $target, inside $targetDomain/src/';
  }
  return null;
}

String? _testViolation(String file, String target) {
  final targetDomain = _domainOf(target);
  final segments = target.split('/');
  final owner = file.contains('/') ? _unitOf(file) : null;
  if (targetDomain != null &&
      segments.length > 2 &&
      segments[1] == 'src' &&
      owner != targetDomain) {
    return 'test/$file imports $target, inside $targetDomain/src/';
  }
  return null;
}

void main() {
  final lib = Directory('lib');
  final sources = {
    for (final entity in lib.listSync(recursive: true))
      if (entity is File && entity.path.endsWith('.dart'))
        entity.path.substring('lib/'.length): entity.readAsStringSync(),
  };

  test('the app sources break no structural rule', () {
    // The scan reaches the files and resolves both import forms, so an empty
    // result below is not the result of reading nothing.
    expect(
      importedPaths('main.dart', sources['main.dart']!),
      contains('deck/deck.dart'),
    );
    expect(
      importedPaths(
        'deck/src/deck_repository.dart',
        sources['deck/src/deck_repository.dart']!,
      ),
      contains('database/database.dart'),
    );
    final paths = [
      for (final entity in lib.listSync(recursive: true))
        if (entity is File) entity.path.substring('lib/'.length),
    ];
    expect(paths, contains('design/theme.dart'));

    expect(exportedScreens(sources), containsPair('StudyScreen', 'study'));
    expect(
      importedPaths(
        'home/src/home_tab.dart',
        sources['home/src/home_tab.dart']!,
      ),
      contains('study/study.dart'),
    );

    expect(unlistedEntries(paths), isEmpty);
    expect(importViolations(sources), isEmpty);
    expect(singleUnitFoundations(sources), isEmpty);
    expect(foreignScreens(sources), isEmpty);
    expect(homeReads(sources), isEmpty);
  });

  test("no test reaches into another domain's src", () {
    final tests = Directory('test');
    final testSources = {
      for (final entity in tests.listSync(recursive: true))
        if (entity is File && entity.path.endsWith('.dart'))
          entity.path.substring('test/'.length): entity.readAsStringSync(),
    };
    // The scan reaches the tests and reads a domain's own test importing its
    // src/, so an empty result below is not the result of reading nothing.
    expect(
      testSources['study/engine_bridge_test.dart'],
      contains("import 'package:knowno/study/src/"),
    );

    expect(testImportViolations(testSources), isEmpty);
  });

  test(
    'an entry outside the closed list is refused, and a listed one is not',
    () {
      expect(unlistedEntries(['shared/theme.dart', 'utils.dart']), [
        'shared',
        'utils.dart',
      ]);
      expect(
        unlistedEntries([
          'main.dart',
          'home/home_screen.dart',
          'deck/deck.dart',
          'design/theme.dart',
          'database/database.dart',
          'l10n/app_localizations.dart',
        ]),
        isEmpty,
      );
    },
  );

  test('a foundation importing a domain or home is refused, and importing a foundation is not', () {
    expect(
      importViolations({
        'design/app_button.dart': "import '../deck/deck.dart';",
        'database/database.dart': "import 'package:knowno/home/shell.dart';",
      }),
      [
        'design/app_button.dart imports deck (deck/deck.dart), from a foundation',
        'database/database.dart imports home (home/shell.dart), from a foundation',
      ],
    );
    expect(
      importViolations({
        'design/app_button.dart': "import '../l10n/app_localizations.dart';",
        'design/theme_choice.dart': "import 'theme.dart';",
      }),
      isEmpty,
    );
  });

  test('importing home from anywhere but main.dart is refused, and from main.dart it is not', () {
    expect(
      importViolations({'deck/deck.dart': "import '../home/shell.dart';"}),
      [
        'deck/deck.dart imports home (home/shell.dart), which only main.dart may',
      ],
    );
    expect(
      importViolations({
        'main.dart': "import 'home/shell.dart';",
        'home/shell.dart': "import 'tabs.dart';",
      }),
      isEmpty,
    );
  });

  test("reaching into a domain's src from outside is refused, and its surface or its own src is not", () {
    expect(
      importViolations({
        'study/study.dart': "import 'package:knowno/deck/src/model.dart';",
        'main.dart': "import 'deck/src/deck_repository.dart';",
        'home/shell.dart': "import '../deck/src/model.dart';",
      }),
      [
        'study/study.dart imports deck/src/model.dart, inside deck/src/',
        'main.dart imports deck/src/deck_repository.dart, inside deck/src/',
        'home/shell.dart imports deck/src/model.dart, inside deck/src/',
      ],
    );
    expect(
      importViolations({
        'study/study.dart': "import 'package:knowno/deck/deck.dart';",
        'main.dart': "import 'deck/deck.dart';",
        'deck/deck.dart': "export 'src/model.dart';",
        'deck/src/deck_row.dart': "import 'model.dart';",
      }),
      isEmpty,
    );
  });

  test("a test reaching into another domain's src is refused, and a domain's own test or the surface is not", () {
    expect(
      testImportViolations({
        'sync/answer_path_test.dart':
            "import 'package:knowno/study/src/providers.dart';",
        'widget_test.dart': "import 'package:knowno/study/src/model.dart';",
        'home/home_data.dart': "import 'package:knowno/study/src/model.dart';",
      }),
      [
        'test/sync/answer_path_test.dart imports study/src/providers.dart, inside study/src/',
        'test/widget_test.dart imports study/src/model.dart, inside study/src/',
        'test/home/home_data.dart imports study/src/model.dart, inside study/src/',
      ],
    );
    expect(
      testImportViolations({
        'study/session_test.dart':
            "import 'package:knowno/study/src/session.dart';",
        'sync/answer_path_test.dart':
            "import 'package:knowno/study/study.dart';",
        'home/home_data.dart': "import '../account/fake_account_service.dart';",
      }),
      isEmpty,
    );
  });

  test('a foundation file serving one domain alone, or home alone, is refused, and one serving two is not', () {
    expect(
      singleUnitFoundations({
        'design/card_text.dart': '',
        'deck/src/content_view.dart': "import '../../design/card_text.dart';",
        'deck/src/card_preview.dart': "import '../../design/card_text.dart';",
        'design/tabs.dart': '',
        'home/shell.dart': "import '../design/tabs.dart';",
      }),
      [
        'design/card_text.dart serves deck alone',
        'design/tabs.dart serves home alone',
      ],
    );
    expect(
      singleUnitFoundations({
        'design/mascot.dart': '',
        'deck/src/first_run.dart': "import '../../design/mascot.dart';",
        'study/src/current_card.dart': "import '../../design/mascot.dart';",
        // Imported by its own folder and main.dart alone: no domain to move to.
        'design/theme_choice.dart': '',
        'design/theme.dart': "import 'theme_choice.dart';",
        'main.dart': "import 'design/theme_choice.dart';",
      }),
      isEmpty,
    );
  });

  test("a domain naming another domain's screen is refused, and naming its own screen or another's widget is not", () {
    const surfaces = {
      'study/study.dart': "export 'src/study_screen.dart' show StudyScreen;",
      'deck/deck.dart': '''
export 'src/card_editor_screen.dart'
    show
        CardEditorScreen;
export 'src/deck_row.dart' show DeckRow;''',
    };
    expect(
      foreignScreens({
        ...surfaces,
        'deck/src/model.dart': 'Widget open() => StudyScreen(decks: d);',
        'study/src/session.dart': 'final screen = CardEditorScreen.new;',
      }),
      [
        'deck/src/model.dart names StudyScreen, a screen of study',
        'study/src/session.dart names CardEditorScreen, a screen of deck',
      ],
    );
    expect(
      foreignScreens({
        ...surfaces,
        'study/src/study_screen.dart': 'class StudyScreen {}',
        'study/src/session.dart': '''
// Opened from the deck's CardEditorScreen.
final row = DeckRow.new;''',
        'home/src/deck_screen.dart': 'final a = StudyScreen.new;',
      }),
      isEmpty,
    );
  });

  test('home declaring a provider or importing the database is refused, and reading through a domain is not', () {
    expect(
      homeReads({
        'home/src/home_screen.dart': '''
import '../../database/database.dart';
final countsProvider = StreamProvider.autoDispose<int>((ref) => s);''',
      }),
      [
        'home/src/home_screen.dart declares countsProvider, a provider',
        'home/src/home_screen.dart imports database/database.dart',
      ],
    );
    expect(
      homeReads({
        'home/src/home_screen.dart': '''
import '../../deck/deck.dart';
import '../../design/theme.dart';
final decks = ref.watch(decksProvider);''',
        'deck/src/providers.dart': '''
import '../../database/database.dart';
final decksProvider = StreamProvider.autoDispose<int>((ref) => s);''',
      }),
      isEmpty,
    );
  });
}
