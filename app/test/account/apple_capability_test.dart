import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('the iOS app is entitled to Sign in with Apple', () {
    expect(
      File('ios/Runner/Runner.entitlements').readAsStringSync(),
      matches(
        RegExp(
          r'<key>com\.apple\.developer\.applesignin</key>\s*'
          r'<array>\s*<string>Default</string>\s*</array>',
        ),
      ),
    );
  });

  test('every build of the app target signs with those entitlements', () {
    final project = File('ios/Runner.xcodeproj/project.pbxproj')
        .readAsStringSync();
    // The app target's configurations are those reading Runner/Info.plist:
    // Debug, Release and Profile.
    final appConfigurations = project
        .split('isa = XCBuildConfiguration;')
        .where((block) => block.contains('INFOPLIST_FILE = Runner/Info.plist;'))
        .toList();

    expect(appConfigurations, hasLength(3));
    for (final configuration in appConfigurations) {
      expect(
        configuration,
        contains('CODE_SIGN_ENTITLEMENTS = Runner/Runner.entitlements;'),
      );
    }
  });
}
