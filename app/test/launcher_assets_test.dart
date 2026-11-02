import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as img;

/// The launcher icons and the native splash that flutter_launcher_icons and
/// flutter_native_splash generated from `assets/brand/`, as `pubspec.yaml`
/// configures them, checked against their sources.

const _iconLight = 'assets/brand/icon/app-icon-light-1024.png';
const _iconDark = 'assets/brand/icon/app-icon-dark-1024.png';
const _iconForeground = 'assets/brand/icon/app-icon-foreground-1024.png';
const _splashLight = 'assets/brand/splash/splash-light.png';
const _splashDark = 'assets/brand/splash/splash-dark.png';
const _android12Light = 'assets/brand/splash/android12-light.png';
const _android12Dark = 'assets/brand/splash/android12-dark.png';

final _groundLight = img.ColorRgb8(0xEE, 0xF3, 0xFF);
final _groundDark = img.ColorRgb8(0x11, 0x1A, 0x2E);
final _white = img.ColorRgb8(0xFF, 0xFF, 0xFF);

img.Image _read(String path) =>
    img.decodePng(File(path).readAsBytesSync()) ??
    (throw StateError('$path is not a PNG'));

/// [image] drawn over an opaque [background].
img.Image _flatten(img.Image image, img.Color background) => img.compositeImage(
  img.Image(
    width: image.width,
    height: image.height,
    numChannels: 3,
    backgroundColor: background,
  ),
  image,
);

/// The mean difference per channel, out of 255, between [generated] and
/// [source] scaled to its size, both over [background].
double _difference(
  img.Image generated,
  img.Image source,
  img.Color background,
) {
  final expected = _flatten(
    img.copyResize(
      source,
      width: generated.width,
      height: generated.height,
      interpolation: img.Interpolation.average,
    ),
    background,
  );
  final actual = _flatten(generated, background);
  var total = 0.0;
  for (final pixel in actual) {
    final other = expected.getPixel(pixel.x, pixel.y);
    total +=
        (pixel.r - other.r).abs() +
        (pixel.g - other.g).abs() +
        (pixel.b - other.b).abs();
  }
  return total / (actual.width * actual.height * 3);
}

/// Fails unless the PNG at [path] is [size] pixels wide and high, or [size]
/// wide when [height] is given, and draws [source] scaled to it.
void _expectDrawn(
  String path,
  String source,
  int size, {
  int? height,
  img.Color? background,
}) {
  final generated = _read(path);
  expect(
    (generated.width, generated.height),
    (size, height ?? size),
    reason: path,
  );
  expect(
    _difference(generated, _read(source), background ?? _white),
    lessThan(_tolerance),
    reason: '$path differs from $source',
  );
}

/// The largest mean difference a resampling may leave.
const _tolerance = 4.0;

/// The colour of the one-pixel PNG at [path].
img.Color _pixel(String path) => _read(path).getPixel(0, 0);

void main() {
  test('a generated image that does not draw its source is told apart', () {
    // Control: the comparison finds the light icon in itself and not in the
    // dark one, so a stale or swapped icon fails the tests below.
    final light = _read(_iconLight);
    final scaled = img.copyResize(light, width: 180, height: 180);
    expect(_difference(scaled, light, _white), lessThan(_tolerance));
    expect(
      _difference(scaled, _read(_iconDark), _white),
      greaterThan(_tolerance),
    );
  });

  test(
    'every iOS launcher icon draws the light or, for dark, the dark icon',
    () {
      const folder = 'ios/Runner/Assets.xcassets/AppIcon.appiconset';
      final images =
          (jsonDecode(File('$folder/Contents.json').readAsStringSync())
                  as Map<String, Object?>)['images']
              as List<Object?>;
      var dark = 0;
      for (final entry in images.cast<Map<String, Object?>>()) {
        final points = double.parse(
          (entry['size']! as String).split('x').first,
        );
        final scale = int.parse(
          (entry['scale']! as String).replaceAll('x', ''),
        );
        final isDark = (entry['appearances'] as List<Object?>?) != null;
        if (isDark) dark++;
        _expectDrawn(
          '$folder/${entry['filename']}',
          isDark ? _iconDark : _iconLight,
          (points * scale).round(),
        );
      }
      // Control: the catalogue lists the dark icons, so iOS 18 can draw them.
      expect(dark, greaterThan(0));
    },
  );

  test('every Android launcher icon draws the light icon', () {
    for (final (density, size) in [
      ('mdpi', 48),
      ('hdpi', 72),
      ('xhdpi', 96),
      ('xxhdpi', 144),
      ('xxxhdpi', 192),
    ]) {
      _expectDrawn(
        'android/app/src/main/res/mipmap-$density/ic_launcher.png',
        _iconLight,
        size,
      );
    }
  });

  test('Android 8 and later draw the adaptive icon: the mark over cobalt', () {
    const res = 'android/app/src/main/res';
    final adaptive = File('$res/mipmap-anydpi-v26/ic_launcher.xml')
        .readAsStringSync();
    expect(adaptive, contains('@color/ic_launcher_background'));
    expect(adaptive, contains('@drawable/ic_launcher_foreground'));
    expect(
      File('$res/values/colors.xml').readAsStringSync(),
      contains('<color name="ic_launcher_background">#2547D0</color>'),
    );
    for (final (density, size) in [
      ('mdpi', 108),
      ('hdpi', 162),
      ('xhdpi', 216),
      ('xxhdpi', 324),
      ('xxxhdpi', 432),
    ]) {
      _expectDrawn(
        '$res/drawable-$density/ic_launcher_foreground.png',
        _iconForeground,
        size,
      );
    }
  });

  test('the iOS splash draws the mark on the light and the dark ground', () {
    const folder = 'ios/Runner/Assets.xcassets';
    for (final (suffix, size) in [('', 160), ('@2x', 320), ('@3x', 480)]) {
      _expectDrawn(
        '$folder/LaunchImage.imageset/LaunchImage$suffix.png',
        _splashLight,
        size,
        background: _groundLight,
      );
      _expectDrawn(
        '$folder/LaunchImage.imageset/LaunchImageDark$suffix.png',
        _splashDark,
        size,
        background: _groundDark,
      );
    }
    expect(
      _pixel('$folder/LaunchBackground.imageset/background.png'),
      _groundLight,
    );
    expect(
      _pixel('$folder/LaunchBackground.imageset/darkbackground.png'),
      _groundDark,
    );
  });

  test(
    'the Android splash draws the mark on the light and the dark ground',
    () {
      const res = 'android/app/src/main/res';
      _expectDrawn(
        '$res/drawable-xxxhdpi/splash.png',
        _splashLight,
        640,
        background: _groundLight,
      );
      _expectDrawn(
        '$res/drawable-night-xxxhdpi/splash.png',
        _splashDark,
        640,
        background: _groundDark,
      );
      _expectDrawn(
        '$res/drawable-xxxhdpi/android12splash.png',
        _android12Light,
        1152,
        background: _groundLight,
      );
      _expectDrawn(
        '$res/drawable-night-xxxhdpi/android12splash.png',
        _android12Dark,
        1152,
        background: _groundDark,
      );
      expect(_pixel('$res/drawable/background.png'), _groundLight);
      expect(_pixel('$res/drawable-night/background.png'), _groundDark);
      expect(
        File('$res/values-v31/styles.xml').readAsStringSync(),
        contains('<item name="android:windowSplashScreenBackground">#EEF3FF'),
      );
      expect(
        File('$res/values-night-v31/styles.xml').readAsStringSync(),
        contains('<item name="android:windowSplashScreenBackground">#111A2E'),
      );
    },
  );
}
