import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:shared_preferences_platform_interface/in_memory_shared_preferences_async.dart';
import 'package:shared_preferences_platform_interface/shared_preferences_async_platform_interface.dart';
import 'package:knowno/design/theme.dart';
import 'package:knowno/design/theme_choice.dart';

/// Opens the theme storage as the composition site does, over whatever the
/// platform holds.
Future<SharedPreferencesWithCache> _openStorage() =>
    SharedPreferencesWithCache.create(
      cacheOptions: const SharedPreferencesWithCacheOptions(
        allowList: themeStorageKeys,
      ),
    );

/// A run of the app's providers over [storage].
ProviderContainer _run(SharedPreferencesWithCache storage) {
  final container = ProviderContainer(
    overrides: [themeStorageProvider.overrideWithValue(storage)],
  );
  addTearDown(container.dispose);
  return container;
}

void main() {
  setUp(() {
    SharedPreferencesAsyncPlatform.instance =
        InMemorySharedPreferencesAsync.empty();
  });

  test('with nothing stored the theme follows the system', () async {
    final container = _run(await _openStorage());

    expect(container.read(themeModeProvider), ThemeMode.system);
  });

  test('a choice applies at once and persists across a restart', () async {
    final first = _run(await _openStorage());
    // Control: a restart before any choice still follows the system.
    expect(
      _run(await _openStorage()).read(themeModeProvider),
      ThemeMode.system,
    );

    await first.read(themeModeProvider.notifier).choose(ThemeMode.dark);
    expect(first.read(themeModeProvider), ThemeMode.dark);

    final restarted = _run(await _openStorage());
    expect(restarted.read(themeModeProvider), ThemeMode.dark);

    await restarted.read(themeModeProvider.notifier).choose(ThemeMode.light);
    expect(_run(await _openStorage()).read(themeModeProvider), ThemeMode.light);
  });

  test('an unknown stored value reads as following the system', () async {
    SharedPreferencesAsyncPlatform.instance =
        InMemorySharedPreferencesAsync.withData({'themeMode': 'sepia'});
    final storage = await _openStorage();
    expect(storage.getString('themeMode'), 'sepia');

    expect(_run(storage).read(themeModeProvider), ThemeMode.system);
  });

  test('the light and dark themes carry their own tokens and the font', () {
    expect(lightTheme.brightness, Brightness.light);
    expect(lightTheme.extension<AppColors>(), AppColors.light);
    expect(lightTheme.scaffoldBackgroundColor, AppColors.light.ground);
    expect(darkTheme.brightness, Brightness.dark);
    expect(darkTheme.extension<AppColors>(), AppColors.dark);
    expect(darkTheme.scaffoldBackgroundColor, AppColors.dark.ground);
    expect(lightTheme.textTheme.bodyMedium?.fontFamily, appFontFamily);
    expect(darkTheme.textTheme.bodyMedium?.fontFamily, appFontFamily);
  });

  test('no colour is written outside the theme file, Google\'s button and '
      'the mascot\'s drawing', () {
    final colour = RegExp(r'Color\(0x|\bColors\.');
    final sources = {
      for (final entity in Directory('lib').listSync(recursive: true))
        if (entity is File &&
            entity.path.endsWith('.dart') &&
            !entity.path.endsWith('.g.dart') &&
            !entity.path.startsWith('lib/study/src/rust/'))
          entity.path: entity.readAsStringSync(),
    };
    // Controls: the scan reads the theme file, where every colour is written,
    // Google's button, whose colours are Google's, and the mascot's drawing,
    // whose colours tools/brand/ writes.
    expect(colour.hasMatch(sources['lib/design/theme.dart'] ?? ''), isTrue);
    expect(colour.hasMatch(sources[_googleButton] ?? ''), isTrue);
    expect(colour.hasMatch(sources[_mascotDrawing] ?? ''), isTrue);

    expect([
      for (final MapEntry(key: path, value: source) in sources.entries)
        if (path != 'lib/design/theme.dart' &&
            path != _googleButton &&
            path != _mascotDrawing &&
            colour.hasMatch(source))
          path,
    ], isEmpty);
  });

  test('a spacing or font-size literal is found, and a token is not', () {
    expect(styleLiterals('EdgeInsets.all(16)'), ['EdgeInsets.all(16)']);
    expect(styleLiterals('EdgeInsets.fromLTRB(4, 0, 4, 8)'), [
      'EdgeInsets.fromLTRB(4, 0, 4, 8)',
    ]);
    expect(styleLiterals('Column(spacing: 12, children: [])'), ['spacing: 12']);
    expect(styleLiterals('const SizedBox(height: 4)'), ['SizedBox(height: 4)']);
    expect(styleLiterals('TextStyle(fontSize: 13)'), ['fontSize: 13']);
    // Controls: tokens, zero, a sum of tokens, a sized child and a computed
    // inset are not spacing literals.
    expect(
      styleLiterals('''
        EdgeInsets.fromLTRB(AppSpace.gutter, 0, AppSpace.gutter, AppSpace.s16)
        Row(spacing: AppSpace.s12)
        SizedBox(height: AppSpace.s32 + AppSpace.s20)
        SizedBox(width: 64, child: Text('x'))
        EdgeInsets.only(top: max(0, viewport - total))
      '''),
      isEmpty,
    );
  });

  test('no spacing or font-size literal is written outside the theme, its components, Google\'s button and CardText', () {
    final sources = _appSources();
    // Controls: the scan reads the screens, which build their insets; the
    // two exceptions do write sizes, Google's button its guidelines' and
    // CardText the fitted sizes of the AppType styles it is given; and a
    // literal planted beside CardText, in the same domain, is still found.
    expect(sources['lib/home/src/home_screen.dart'], contains('EdgeInsets'));
    expect(styleLiterals(sources[_googleButton] ?? ''), isNotEmpty);
    expect(styleLiterals(sources[_cardText] ?? ''), isNotEmpty);
    expect(
      _sizeLiterals({
        ...sources,
        'lib/deck/src/planted.dart': 'TextStyle(fontSize: 13)',
      }),
      ['lib/deck/src/planted.dart: fontSize: 13'],
    );

    expect(_sizeLiterals(sources), isEmpty);
  });

  test('no screen opens a dialog, or a sheet other than the app sheet', () {
    final modal = RegExp(r'\b(AlertDialog|showDialog|showModalBottomSheet)\b');
    final sources = _appSources();
    // Control: the app sheet opens the platform's sheet, so the expression
    // finds what it is meant to.
    expect(modal.hasMatch(sources['lib/design/app_sheet.dart'] ?? ''), isTrue);

    expect([
      for (final MapEntry(key: path, value: source) in sources.entries)
        if (path != 'lib/design/app_sheet.dart' && modal.hasMatch(source)) path,
    ], isEmpty);
  });

  test('every modal barrier is the scrim token, and the theme draws sheets '
      'behind it: black at 40% light, 60% dark', () {
    final barrier = RegExp(
      r'\b(barrierColor|modalBarrierColor|scrimColor)\s*:\s*([^,)\n]+)|ModalBarrier\(',
    );
    final token = RegExp(r'^(colors|AppColors\.(light|dark))\.scrim$');
    List<String> refused(Map<String, String> sources) => [
      for (final MapEntry(key: path, value: source) in sources.entries)
        for (final match in barrier.allMatches(source))
          if (match[2] == null || !token.hasMatch(match[2]!.trim()))
            '$path: ${match[0]}',
    ];
    // Controls: a brand tint, Material's default and a hand-drawn barrier are
    // found, and the token is not.
    expect(
      refused({
        'a.dart': 'modalBarrierColor: colors.hero.withValues(alpha: 0.4),',
        'b.dart': 'barrierColor: Colors.black54,',
        'c.dart': 'ModalBarrier(color: x)',
        'd.dart': 'scrimColor: AppColors.dark.hero',
      }),
      hasLength(4),
    );
    expect(
      refused({
        'e.dart': 'modalBarrierColor: colors.scrim,',
        'f.dart': 'barrierColor: AppColors.light.scrim)',
      }),
      isEmpty,
    );
    expect(AppColors.light.scrim, const Color(0x66000000));
    expect(AppColors.dark.scrim, const Color(0x99000000));
    expect(
      lightTheme.bottomSheetTheme.modalBarrierColor,
      AppColors.light.scrim,
    );
    expect(darkTheme.bottomSheetTheme.modalBarrierColor, AppColors.dark.scrim);

    final sources = _appSources();
    expect(sources['lib/design/theme.dart'], contains('modalBarrierColor'));
    expect(refused(sources), isEmpty);
  });

  test('no screen draws a Material chip, so every chip is AppChip', () {
    final materialChip = RegExp(
      r'(?<![\w.])(Chip|ActionChip|FilterChip|ChoiceChip|InputChip|RawChip)\(',
    );
    // Controls: the expression finds each Material chip and not AppChip.
    for (final planted in ['Chip(', 'ActionChip(', 'FilterChip(']) {
      expect(materialChip.hasMatch('child: $planted'), isTrue, reason: planted);
    }
    expect(
      materialChip.hasMatch('AppChip(label: a) AppChip.action(label: b)'),
      isFalse,
    );

    expect([
      for (final MapEntry(key: path, value: source) in _appSources().entries)
        if (materialChip.hasMatch(source)) path,
    ], isEmpty);
  });

  test('a chip is drawn by AppChip alone: no box outside the components '
      'takes the chip radius or a stadium but the shapes named here', () {
    // Controls: the expression finds a hand-drawn chip and AppChip's own
    // shape, and not a chip drawn through AppChip or a doc comment.
    expect(
      _chipShapes({
        'lib/study/src/planted.dart': '''
          DecoratedBox(
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(AppRadius.chip),
            ),
            child: Text(label),
          )
          ShapeDecoration(shape: const StadiumBorder())
        ''',
      }),
      {'lib/study/src/planted.dart': 2},
    );
    expect(
      _chipShapes({'lib/x.dart': _appSources()['lib/design/app_chip.dart']!}),
      {'lib/x.dart': 1},
    );
    expect(
      _chipShapes({
        'lib/study/src/planted.dart': '''
          /// Rounded on [AppRadius.chip].
          AppChip(label: label, tone: AppChipTone.knowTint)
        ''',
      }),
      isEmpty,
    );

    final shapes = {
      for (final MapEntry(key: path, value: count) in _chipShapes(
        _appSources(),
      ).entries)
        if (!path.startsWith('lib/design/')) path: count,
    };
    expect(shapes, {
      // RaisedIconButton, a round icon button (home.md).
      'lib/home/src/above_menu.dart': 1,
      // 기록's period choice, the PM's call in #645.
      'lib/study/src/stats_view.dart': 2,
      // Study's notice in the bar's place, a pill on the hero.
      'lib/study/src/study_screen.dart': 1,
      // Photo import's skeleton line while a photo is read.
      'lib/photo_import/src/extracting_view.dart': 1,
      // A meaning's label field, a text field drawn as its chip.
      'lib/deck/src/editor_group.dart': 1,
      // What study hides, in a card list's row.
      'lib/deck/src/hatched_box.dart': 1,
      // The 라벨 screen's labels, which become AppChips after #706.
      'lib/deck/src/label_presets_screen.dart': 1,
    });
  });

  test('no screen draws a button with Material\'s TextButton, so every '
      'button is AppButton, but the two photo import names', () {
    final textButton = RegExp(r'(?<![\w.])TextButton\(');
    // Controls: the expression finds a TextButton, AppButton's own among
    // them, and not its style or theme.
    expect(textButton.hasMatch('child: TextButton(onPressed: f)'), isTrue);
    expect(
      textButton.hasMatch(_appSources()['lib/design/app_button.dart']!),
      isTrue,
    );
    expect(
      textButton.hasMatch(
        'TextButton.styleFrom(); TextButtonThemeData(); AppButton(label: a)',
      ),
      isFalse,
    );

    expect(
      {
        for (final MapEntry(key: path, value: source) in _appSources().entries)
          if (!path.startsWith('lib/design/') && textButton.hasMatch(source))
            path: textButton.allMatches(source).length,
      },
      {
        // The note's name inside its sentence, and a section's form menu
        // anchor (components.md).
        'lib/photo_import/src/import_list_view.dart': 2,
      },
    );
  });

  test('no screen builds a search field of its own, so every search is '
      'AppSearchField', () {
    final search = RegExp(r'\bLucideIcons\.search\b');
    final sources = _appSources();
    // Control: the expression finds AppSearchField's own magnifier.
    expect(
      search.hasMatch(sources['lib/design/app_search_field.dart'] ?? ''),
      isTrue,
    );

    expect([
      for (final MapEntry(key: path, value: source) in sources.entries)
        if (path != 'lib/design/app_search_field.dart' &&
            search.hasMatch(source))
          path,
    ], isEmpty);
  });

  test('no screen dashes an outline of its own, so every one is '
      'DashedOutline', () {
    final dash = RegExp(r'\.extractPath\(');
    final sources = _appSources();
    // Control: the expression finds DashedOutline's own dashes.
    expect(
      dash.hasMatch(sources['lib/design/dashed_outline.dart'] ?? ''),
      isTrue,
    );

    expect([
      for (final MapEntry(key: path, value: source) in sources.entries)
        if (!path.startsWith('lib/design/') && dash.hasMatch(source)) path,
    ], isEmpty);
  });

  test('no screen gives a text field a floating label, so every label is '
      "AppTextField's, above its field", () {
    final floating = RegExp(r'\blabelText:');
    // Controls: the expression finds a floating label and not AppTextField's.
    expect(
      floating.hasMatch('decoration: InputDecoration(labelText: a)'),
      isTrue,
    );
    expect(floating.hasMatch('AppTextField(label: a)'), isFalse);

    expect([
      for (final MapEntry(key: path, value: source) in _appSources().entries)
        if (floating.hasMatch(source)) path,
    ], isEmpty);
  });

  test(
    'the radii are one scale: group and card 28, button 24, chip 16, sheet 32, '
    'and the theme draws buttons and sheets in them',
    () {
      expect(AppRadius.group, 28);
      expect(AppRadius.card, 28);
      expect(AppRadius.button, 24);
      expect(AppRadius.chip, 16);
      expect(AppRadius.sheet, 32);
      expect(AppSize.button, 64);
      expect(AppSize.cta, 64);
      for (final theme in [lightTheme, darkTheme]) {
        expect(
          theme.bottomSheetTheme.shape,
          const RoundedRectangleBorder(
            borderRadius: BorderRadius.vertical(top: Radius.circular(32)),
          ),
        );
        for (final style in [
          theme.filledButtonTheme.style,
          theme.outlinedButtonTheme.style,
          theme.textButtonTheme.style,
        ]) {
          expect(
            style?.shape?.resolve({}),
            RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
          );
        }
      }
    },
  );

  test('the type scale gives a screen three sizes: a title, the body and a '
      'caption, a button in the body size', () {
    final body = [
      AppType.body,
      AppType.bodyStrong,
      AppType.label,
    ].map((style) => style.fontSize).toSet();
    final caption = [
      AppType.secondary,
      AppType.caption,
      AppType.section,
      AppType.micro,
    ].map((style) => style.fontSize).toSet();
    expect(body, {16});
    expect(caption, {13});
    expect(AppType.label.fontSize, AppType.body.fontSize, reason: 'a button');
    // Material's text theme draws in the same three below the titles.
    for (final style in [
      AppType.textTheme.titleMedium,
      AppType.textTheme.titleSmall,
      AppType.textTheme.bodyLarge,
      AppType.textTheme.bodyMedium,
      AppType.textTheme.bodySmall,
      AppType.textTheme.labelLarge,
      AppType.textTheme.labelMedium,
      AppType.textTheme.labelSmall,
    ]) {
      expect([16.0, 13.0], contains(style?.fontSize));
    }
  });

  /// The WCAG 2.1 contrast ratio of two opaque colours.
  double contrast(Color a, Color b) {
    final (lighter, darker) = a.computeLuminance() > b.computeLuminance()
        ? (a, b)
        : (b, a);
    return (lighter.computeLuminance() + 0.05) /
        (darker.computeLuminance() + 0.05);
  }

  for (final (name, colors) in [
    ('light', AppColors.light),
    ('dark', AppColors.dark),
  ]) {
    test('$name text tokens meet WCAG AA, and answer marks 3:1', () {
      // Text, at 4.5:1: the pairs the screens draw text in, including the
      // answer chips over a dragged card, which no semantics node reaches.
      for (final (text, ground) in [
        (colors.ink, colors.surface),
        (colors.ink, colors.ground),
        (colors.ink, colors.raised),
        (colors.ink2, colors.surface),
        (colors.ink2, colors.ground),
        (colors.muted, colors.surface),
        (colors.muted, colors.ground),
        (colors.muted, colors.raised),
        (colors.onPrimary, colors.primary),
        (colors.onInk, colors.ink),
        (colors.ink, colors.brandTint),
        // A card list's blank, revealed part and 표 caption on either of the
        // hatch's two colours (#629).
        for (final hatch in [colors.hatch, colors.hatchStripe]) ...[
          (colors.ink, hatch),
          (colors.ink2, hatch),
        ],
        (colors.onHero, colors.hero),
        (colors.brand, colors.onHero),
        (colors.know, colors.surface),
        (colors.know, colors.ground),
        (colors.onKnow, colors.know),
        (colors.onDontKnowText, colors.dontKnowText),
        (colors.dontKnowText, colors.surface),
        (colors.dontKnowText, colors.ground),
        // A deck tile's icon on each colour of the deck palette.
        for (final fill in [
          colors.deckBlue,
          colors.deckSky,
          colors.deckPeach,
          colors.deckAmber,
          colors.deckSlate,
          colors.deckSand,
        ])
          (colors.ink, fill),
        // The answers' words on the green and red tints behind a dragged
        // card.
        (colors.onKnowTint, colors.tintGreen),
        (colors.onDontKnowTint, colors.tintRed),
      ]) {
        expect(
          contrast(text, ground),
          greaterThanOrEqualTo(4.5),
          reason: '$text on $ground',
        );
      }
      // Non-text, at 3:1: an answer's mark in its colour on the ground, as
      // the web's grade chip draws it.
      for (final (mark, ground) in [
        (colors.know, colors.ground),
        (colors.dontKnowText, colors.ground),
      ]) {
        expect(
          contrast(mark, ground),
          greaterThanOrEqualTo(3),
          reason: '$mark on $ground',
        );
      }
    });
  }

  for (final (name, theme, colors) in [
    ('light', lightTheme, AppColors.light),
    ('dark', darkTheme, AppColors.dark),
  ]) {
    test('the $name switch reads at 3:1 on the ground, on and off', () {
      final style = theme.switchTheme;
      for (final states in [
        <WidgetState>{},
        {WidgetState.selected},
      ]) {
        final thumb = style.thumbColor!.resolve(states)!;
        final track = style.trackColor!.resolve(states)!;
        final outline = style.trackOutlineColor!.resolve(states)!;
        for (final (mark, ground) in [
          (outline, colors.ground),
          (thumb, track),
        ]) {
          expect(
            contrast(mark, ground),
            greaterThanOrEqualTo(3),
            reason: '$states: $mark on $ground',
          );
        }
      }
      // Control: on and off differ in the track, not only in the thumb's
      // place.
      expect(
        style.trackColor!.resolve({WidgetState.selected}),
        isNot(style.trackColor!.resolve({})),
      );
    });
  }
}

/// Google's sign-in button, drawn to Google's branding guidelines rather than
/// to the tokens: the one file beside the theme and the components that
/// writes colours and sizes.
const _googleButton = 'lib/account/src/google_button.dart';

/// The mascot's shapes, which `make brand` writes from `tools/brand/`.
const _mascotDrawing = 'lib/design/mascot_drawings.dart';

/// `CardText`, which fits a card side's text by scaling the `AppType` style
/// it is given; it is `deck`'s, since `deck` alone draws cards.
const _cardText = 'lib/deck/src/card_text.dart';

/// The spacing and font-size literals in [sources], outside the theme, the
/// components, Google's button and [_cardText].
List<String> _sizeLiterals(Map<String, String> sources) => [
  for (final MapEntry(key: path, value: source) in sources.entries)
    if (!path.startsWith('lib/design/') &&
        path != _googleButton &&
        path != _cardText)
      for (final literal in styleLiterals(source)) '$path: $literal',
];

/// How many boxes each of [sources] rounds on the chip radius or draws as a
/// stadium, the two shapes of a chip, outside its comments.
Map<String, int> _chipShapes(Map<String, String> sources) {
  final shape = RegExp(r'\bAppRadius\.chip\b|\bStadiumBorder\(');
  return {
    for (final MapEntry(key: path, value: source) in sources.entries)
      if (shape
              .allMatches(
                source
                    .split('\n')
                    .where((line) => !line.trimLeft().startsWith('//'))
                    .join('\n'),
              )
              .length
          case final count when count > 0)
        path: count,
  };
}

/// Every Dart source under `lib/` keyed by its path under `app/`, leaving out
/// generated code.
Map<String, String> _appSources() => {
  for (final entity in Directory('lib').listSync(recursive: true))
    if (entity is File &&
        entity.path.endsWith('.dart') &&
        !entity.path.endsWith('.g.dart') &&
        !entity.path.startsWith('lib/study/src/rust/') &&
        !entity.path.startsWith('lib/l10n/'))
      entity.path: entity.readAsStringSync(),
};

final _number = RegExp(r'(?<![\w.])(\d+(?:\.\d+)?)(?![\w.])');

bool _hasNonZeroNumber(String text) =>
    _number.allMatches(text).any((match) => double.parse(match[1]!) != 0);

/// The text of [source] from the parenthesis at [open] to the one closing it.
String _balanced(String source, int open) {
  var depth = 0;
  for (var i = open; i < source.length; i++) {
    switch (source[i]) {
      case '(':
        depth++;
      case ')':
        if (--depth == 0) return source.substring(open, i + 1);
    }
  }
  return source.substring(open);
}

/// The spacing and font-size literals in [source]: an `EdgeInsets` or a
/// childless `SizedBox` built from a number, a `spacing:` given a number, and
/// every `fontSize:`. Zero is no spacing value, so it is allowed.
List<String> styleLiterals(String source) => [
  for (final match in RegExp(
    r'EdgeInsets(?:Directional)?\.\w+(?=\()',
  ).allMatches(source))
    if (_balanced(source, match.end) case final args
        when _hasNonZeroNumber(args))
      '${match[0]}$args',
  for (final match in RegExp(r'\bSizedBox(?=\()').allMatches(source))
    if (_balanced(source, match.end) case final args
        when !args.contains('child:') && _hasNonZeroNumber(args))
      'SizedBox$args',
  for (final match in RegExp(r'spacing:\s*([^,)\n]+)').allMatches(source))
    if (_hasNonZeroNumber(match[1]!)) match[0]!,
  for (final match in RegExp(r'fontSize:\s*[^,)\n]+').allMatches(source))
    match[0]!,
];
