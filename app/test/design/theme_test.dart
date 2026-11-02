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

  test('no colour is written outside the theme file and Google\'s button', () {
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
    // and Google's button, whose colours are Google's.
    expect(colour.hasMatch(sources['lib/design/theme.dart'] ?? ''), isTrue);
    expect(colour.hasMatch(sources[_googleButton] ?? ''), isTrue);

    expect([
      for (final MapEntry(key: path, value: source) in sources.entries)
        if (path != 'lib/design/theme.dart' &&
            path != _googleButton &&
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
    test(
      '$name text tokens meet WCAG AA, and answer marks and the streak 3:1',
      () {
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
          // A previous card's sides on its grade's fill, and the answers'
          // words on the green and red tints behind a dragged card.
          for (final card in [colors.knowCard, colors.dontKnowCard]) ...[
            (colors.ink, card),
            (colors.ink2, card),
          ],
          (colors.onKnowTint, colors.tintGreen),
          (colors.onDontKnowTint, colors.tintRed),
        ]) {
          expect(
            contrast(text, ground),
            greaterThanOrEqualTo(4.5),
            reason: '$text on $ground',
          );
        }
        // Non-text, at 3:1: an answer's mark in its colour on a grade's fill
        // and on the ground, as the web's grade chip draws it, and the streak
        // flame on the completion card.
        for (final (mark, ground) in [
          (colors.know, colors.knowCard),
          (colors.know, colors.ground),
          (colors.dontKnowText, colors.dontKnowCard),
          (colors.dontKnowText, colors.ground),
          (colors.streak, colors.surface),
        ]) {
          expect(
            contrast(mark, ground),
            greaterThanOrEqualTo(3),
            reason: '$mark on $ground',
          );
        }
      },
    );
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
