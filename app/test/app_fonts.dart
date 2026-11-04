import 'dart:io';

import 'package:flutter/services.dart';
import 'package:knowno/design/theme.dart';

/// Loads the bundled fonts, Google Sans among them, Lucide's icons and Material's, which tests
/// otherwise draw in the test font and as boxes.
Future<void> loadAppFonts() async {
  Future<ByteData> bytes(String path) async =>
      ByteData.sublistView(await File(path).readAsBytes());
  final pretendard = FontLoader(appFontFamily);
  for (final weight in ['Regular', 'Medium', 'SemiBold', 'Bold', 'ExtraBold']) {
    pretendard.addFont(bytes('assets/fonts/Pretendard-$weight.otf'));
  }
  await pretendard.load();
  await (FontLoader(
    appDisplayFallbackFamily,
  )..addFont(bytes('assets/fonts/Pretendard-ExtraBold.otf'))).load();
  await (FontLoader(
    appDisplayFontFamily,
  )..addFont(bytes('assets/fonts/Jua-Regular.ttf'))).load();
  await (FontLoader(
    'GoogleSans',
  )..addFont(bytes('assets/fonts/GoogleSans-Medium.ttf'))).load();
  await (FontLoader('packages/lucide_icons_flutter/Lucide')..addFont(
        rootBundle.load('packages/lucide_icons_flutter/assets/lucide.ttf'),
      ))
      .load();
  await (FontLoader('MaterialIcons')..addFont(
        bytes(
          '${_flutterRoot()}/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf',
        ),
      ))
      .load();
}

/// The Flutter SDK running this test, found above the test runner.
String _flutterRoot() {
  var dir = File(Platform.resolvedExecutable).parent;
  while (dir.parent.path != dir.path) {
    if (Directory('${dir.path}/bin/cache/artifacts/material_fonts')
        .existsSync()) {
      return dir.path;
    }
    dir = dir.parent;
  }
  throw StateError('no Flutter SDK above ${Platform.resolvedExecutable}');
}
