import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/design/app_button.dart';
import 'package:knowno/design/theme.dart';

import '../contrast.dart';
import 'harness.dart';

/// The fill the button labelled [label] is drawn with.
Color? _fill(WidgetTester tester, String label) {
  final material = tester.widget<Material>(
    find.ancestor(of: find.text(label), matching: find.byType(Material)).first,
  );
  return material.color;
}

void main() {
  for (final MapEntry(key: mode, value: colors) in themeModes.entries) {
    testWidgets(
      'in ${mode.name} each variant draws its fill and meets the guidelines',
      (tester) async {
        await pumpComponent(
          tester,
          Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            spacing: AppSpace.s8,
            children: [
              // onHeroText is drawn on the hero surface, tested below.
              for (final variant in AppButtonVariant.values.where(
                (variant) => variant != AppButtonVariant.onHeroText,
              ))
                AppButton(
                  label: variant.name,
                  variant: variant,
                  onPressed: () {},
                ),
            ],
          ),
          themeMode: mode,
        );

        expect(_fill(tester, 'primary'), colors.primary);
        expect(_fill(tester, 'onHero'), colors.heroButton);
        // The coral fill holds its cocoa label in both themes.
        expect(
          tester
              .widget<DefaultTextStyle>(
                find
                    .ancestor(
                      of: find.text('primary'),
                      matching: find.byType(DefaultTextStyle),
                    )
                    .first,
              )
              .style
              .color,
          colors.onPrimary,
        );
        expect(_fill(tester, 'destructiveFinal'), colors.dontKnowText);
        expect(_fill(tester, 'secondary'), colors.surface);
        expect(
          tester
              .widget<DefaultTextStyle>(
                find
                    .ancestor(
                      of: find.text('destructive'),
                      matching: find.byType(DefaultTextStyle),
                    )
                    .first,
              )
              .style
              .color,
          colors.dontKnowText,
        );
        await meetsGuidelines(tester);
        expectScreenTextReadable(tester);
      },
    );
  }

  for (final MapEntry(key: mode, value: colors) in themeModes.entries) {
    testWidgets(
      'in ${mode.name} the quiet action on the hero draws its colour there and meets the guidelines',
      (tester) async {
        await pumpComponent(
          tester,
          ColoredBox(
            color: colors.hero,
            child: AppButton(
              label: 'skip',
              variant: AppButtonVariant.onHeroText,
              onPressed: () {},
            ),
          ),
          themeMode: mode,
        );

        expect(
          tester
              .widget<DefaultTextStyle>(
                find
                    .ancestor(
                      of: find.text('skip'),
                      matching: find.byType(DefaultTextStyle),
                    )
                    .first,
              )
              .style
              .color,
          colors.onHero,
        );
        expect(
          tester
              .getSize(
                find
                    .ancestor(
                      of: find.text('skip'),
                      matching: find.byType(Material),
                    )
                    .first,
              )
              .height,
          AppSize.tapTarget,
        );
        await meetsGuidelines(tester);
        expectScreenTextReadable(tester);
      },
    );
  }

  testWidgets(
    'a call to action is taller than a button, and a quiet one is a tap target',
    (tester) async {
      await pumpComponent(
        tester,
        Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            AppButton(label: 'cta', size: AppButtonSize.cta, onPressed: () {}),
            AppButton(label: 'regular', onPressed: () {}),
            AppButton(
              label: 'text',
              variant: AppButtonVariant.text,
              onPressed: () {},
            ),
          ],
        ),
      );

      double height(String label) => tester
          .getSize(
            find
                .ancestor(of: find.text(label), matching: find.byType(Material))
                .first,
          )
          .height;
      expect(height('cta'), AppSize.cta);
      expect(height('regular'), AppSize.button);
      expect(height('text'), AppSize.tapTarget);
    },
  );

  testWidgets('a press calls back, and a disabled button cannot be pressed', (
    tester,
  ) async {
    var presses = 0;
    await pumpComponent(
      tester,
      Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          AppButton(label: 'enabled', onPressed: () => presses++),
          const AppButton(label: 'disabled', onPressed: null),
        ],
      ),
    );

    await tester.tap(find.text('enabled'));
    expect(presses, 1);
    await tester.tap(find.text('disabled'));
    expect(presses, 1);
    expect(
      tester.getSemantics(find.text('disabled')),
      isSemantics(isButton: true, hasEnabledState: true, isEnabled: false),
    );
  });

  testWidgets('a button gives pressed feedback while held', (tester) async {
    await pumpComponent(tester, AppButton(label: 'hold', onPressed: () {}));
    final ink = find.byType(InkWell);
    final idle = tester.widget<InkWell>(ink).overlayColor?.resolve({});
    final pressed = tester.widget<InkWell>(ink).overlayColor?.resolve({
      WidgetState.pressed,
    });

    expect(pressed, isNotNull);
    expect(pressed, isNot(idle));
  });

  testWidgets(
    'while loading it shows progress read as its label, and cannot be pressed again',
    (tester) async {
      var presses = 0;
      await pumpComponent(
        tester,
        AppButton(
          label: 'Save',
          loadingLabel: 'Saving',
          loading: true,
          onPressed: () => presses++,
        ),
        settle: false,
      );

      expect(find.text('Save'), findsNothing);
      expect(find.bySemanticsLabel('Saving'), findsOneWidget);
      await tester.tap(find.byType(AppButton));
      expect(presses, 0);
      // Control: the same button, not loading, is pressed.
      await pumpComponent(
        tester,
        AppButton(label: 'Save', onPressed: () => presses++),
      );
      await tester.tap(find.byType(AppButton));
      expect(presses, 1);
    },
  );

  group('haptics', () {
    late List<String> haptics;
    setUp(() {
      haptics = [];
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(SystemChannels.platform, (call) async {
            if (call.method == 'HapticFeedback.vibrate') {
              haptics.add(call.arguments as String);
            }
            return null;
          });
    });
    tearDown(
      () => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(SystemChannels.platform, null),
    );

    Future<void> pressBoth(WidgetTester tester) async {
      await pumpComponent(
        tester,
        Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            AppButton(label: 'confirm', onPressed: () {}),
            AppButton(
              label: 'other',
              variant: AppButtonVariant.secondary,
              onPressed: () {},
            ),
          ],
        ),
      );
      await tester.tap(find.text('other'));
      await tester.tap(find.text('confirm'));
    }

    for (final platform in [TargetPlatform.iOS, TargetPlatform.android]) {
      testWidgets('on ${platform.name} no button gives a haptic of its own, '
          'only the action it starts', (tester) async {
        debugDefaultTargetPlatformOverride = platform;
        await pressBoth(tester);
        expect(haptics, isEmpty);

        // Control: a press whose action gives one is heard.
        await pumpComponent(
          tester,
          AppButton(label: 'save', onPressed: HapticFeedback.lightImpact),
        );
        await tester.tap(find.text('save'));
        debugDefaultTargetPlatformOverride = null;
        expect(haptics, ['HapticFeedbackType.lightImpact']);
      });
    }
  });

  group('press', () {
    /// The ink layer of the button labelled [label].
    RenderObject ink(WidgetTester tester, String label) => tester.renderObject(
      find
          .ancestor(
            of: find.text(label),
            matching: find.byWidgetPredicate(
              (widget) => widget.runtimeType.toString() == '_InkFeatures',
            ),
          )
          .first,
    );

    for (final MapEntry(key: mode, value: colors) in themeModes.entries) {
      testWidgets('in ${mode.name} a pressed button dims under its label\'s '
          'colour, with no splash and no change of size', (tester) async {
        await pumpComponent(
          tester,
          Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              AppButton(label: 'Save', onPressed: () {}),
              AppButton(
                label: 'Later',
                variant: AppButtonVariant.secondary,
                onPressed: () {},
              ),
            ],
          ),
          themeMode: mode,
        );
        for (final (label, onFill) in [
          ('Save', colors.onPrimary),
          ('Later', colors.ink),
        ]) {
          final rest = tester.getRect(
            find.byType(AppButton).at(label == 'Save' ? 0 : 1),
          );
          final gesture = await tester.startGesture(
            tester.getCenter(find.text(label)),
          );
          await tester.pump();
          await tester.pump(const Duration(milliseconds: 300));
          expect(
            ink(tester, label),
            // The highlight paints its colour at an 8-bit alpha.
            paints..rect(color: onFill.withAlpha((0.1 * 255).round())),
            reason: label,
          );
          expect(
            ink(tester, label),
            paintsExactlyCountTimes(#drawCircle, 0),
            reason: '$label: no splash',
          );
          expect(
            tester.getRect(find.byType(AppButton).at(label == 'Save' ? 0 : 1)),
            rest,
            reason: '$label: no scale',
          );
          await gesture.up();
          await tester.pumpAndSettle();
        }
      });
    }

    testWidgets('a splash, were the theme to draw one, is seen', (
      tester,
    ) async {
      // Control for the test above: the same press under a splashing theme
      // draws a circle, so its absence there is the theme's doing.
      await pumpComponent(
        tester,
        Builder(
          builder: (context) => Theme(
            data: Theme.of(context)
                .copyWith(splashFactory: InkRipple.splashFactory),
            child: AppButton(label: 'Save', onPressed: () {}),
          ),
        ),
      );
      final gesture = await tester.startGesture(
        tester.getCenter(find.text('Save')),
      );
      await tester.pump(const Duration(milliseconds: 100));
      expect(ink(tester, 'Save'), paints..circle());
      await gesture.up();
      await tester.pumpAndSettle();
    });
  });
}
