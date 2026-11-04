import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/design/app_button.dart';
import 'package:knowno/design/app_raised.dart';
import 'package:knowno/design/theme.dart';

import '../contrast.dart';
import 'harness.dart';
import '../word_breaks.dart';

/// The fill the button labelled [label] is drawn with.
Color? _fill(WidgetTester tester, String label) {
  final material = tester.widget<Material>(
    find.ancestor(of: shownText(label), matching: find.byType(Material)).first,
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
              // faint and link are drawn in a line of text, tested below.
              for (final variant in AppButtonVariant.values.where(
                (variant) => ![
                  AppButtonVariant.faint,
                  AppButtonVariant.link,
                ].contains(variant),
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
                      of: shownText('primary'),
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
                      of: shownText('destructive'),
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
      'in ${mode.name} a faint action is muted micro text on one line and a '
      'link underlined caption at w600 in ink2, each a tap target high with no '
      'fill, and both meet the guidelines',
      (tester) async {
        await pumpComponent(
          tester,
          Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              SizedBox(
                width: AppSize.tapTarget * 2,
                child: AppButton(
                  label: 'show the guide again, please',
                  variant: AppButtonVariant.faint,
                  onPressed: () {},
                ),
              ),
              AppButton(
                label: 'terms',
                variant: AppButtonVariant.link,
                onPressed: () {},
              ),
            ],
          ),
          themeMode: mode,
        );

        TextStyle style(String label) => tester
            .widget<DefaultTextStyle>(
              find
                  .ancestor(
                    of: shownText(label),
                    matching: find.byType(DefaultTextStyle),
                  )
                  .first,
            )
            .style;
        Size size(String label) => tester.getSize(
          find
              .ancestor(of: shownText(label), matching: find.byType(Material))
              .first,
        );
        final faint = style('show the guide again, please');
        expect(
          (faint.color, faint.fontSize),
          (colors.muted, AppType.micro.fontSize),
        );
        expect(
          size('show the guide again, please').height,
          AppSize.tapTarget,
          reason: 'one line, though it would wrap',
        );
        final link = style('terms');
        expect(
          (link.color, link.fontSize, link.fontWeight, link.decoration),
          (
            colors.ink2,
            AppType.caption.fontSize,
            FontWeight.w600,
            TextDecoration.underline,
          ),
        );
        expect(size('terms').height, AppSize.tapTarget);
        await meetsGuidelines(tester);
        expectScreenTextReadable(tester);
      },
    );
  }

  for (final MapEntry(key: mode, value: colors) in themeModes.entries) {
    testWidgets(
      'in ${mode.name} the tonal action draws the tint under an accent label '
      'and icon, on the edge a quiet button sits on',
      (tester) async {
        await pumpComponent(
          tester,
          AppButton(
            label: 'tonal',
            icon: Icons.add,
            variant: AppButtonVariant.tonal,
            size: AppButtonSize.header,
            onPressed: () {},
          ),
          themeMode: mode,
        );

        expect(_fill(tester, 'tonal'), colors.brandTint);
        expect(
          tester
              .renderObject<RenderParagraph>(
                find.descendant(
                  of: shownText('tonal'),
                  matching: find.byType(RichText),
                ),
              )
              .text
              .style!
              .color,
          colors.accent,
        );
        expect(
          tester
              .widget<RichText>(
                find.descendant(
                  of: find.byIcon(Icons.add),
                  matching: find.byType(RichText),
                ),
              )
              .text
              .style!
              .color,
          colors.accent,
        );
        final raised = tester.widget<AppRaised>(find.byType(AppRaised));
        expect(raised.edge, colors.edge);
        expect(raised.height, AppSize.edgeCard);
        await meetsGuidelines(tester);
        expectScreenTextReadable(tester);
      },
    );
  }

  testWidgets(
    'a call to action is taller than a button, and a quiet one and a header action are a tap target',
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
              label: 'header',
              size: AppButtonSize.header,
              onPressed: () {},
            ),
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
                .ancestor(of: shownText(label), matching: find.byType(Material))
                .first,
          )
          .height;
      expect(height('cta'), AppSize.cta);
      expect(height('regular'), AppSize.button);
      expect(height('header'), AppSize.tapTarget);
      // A header action's label is the label type, against the button type.
      double label(String text) => tester
          .renderObject<RenderParagraph>(
            find.descendant(
              of: shownText(text),
              matching: find.byType(RichText),
            ),
          )
          .text
          .style!
          .fontSize!;
      expect(label('header'), AppType.label.fontSize);
      expect(label('regular'), AppType.button.fontSize);
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

    await tester.tap(shownText('enabled'));
    expect(presses, 1);
    await tester.tap(shownText('disabled'));
    expect(presses, 1);
    expect(
      tester.getSemantics(shownText('disabled')),
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

      expect(shownText('Save'), findsNothing);
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
      await tester.tap(shownText('other'));
      await tester.tap(shownText('confirm'));
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
        await tester.tap(shownText('save'));
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
            of: shownText(label),
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
            tester.getCenter(shownText(label)),
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
        tester.getCenter(shownText('Save')),
      );
      await tester.pump(const Duration(milliseconds: 100));
      expect(ink(tester, 'Save'), paints..circle());
      await gesture.up();
      await tester.pumpAndSettle();
    });
  });

  for (final scale in [1.0, 3.12]) {
    testWidgets(
      'at text scale $scale a call to action\'s label, wrapped or not, sits '
      'inside the button with room above and below, so none of it is cut',
      (tester) async {
        tester.platformDispatcher.textScaleFactorTestValue = scale;
        addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
        const labels = ['Add card', 'Save and add the next card'];
        await pumpComponent(
          tester,
          Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            spacing: AppSpace.s8,
            children: [
              for (final label in labels)
                AppButton(
                  label: label,
                  size: AppButtonSize.cta,
                  onPressed: () {},
                ),
            ],
          ),
        );

        for (final label in labels) {
          final text = tester.getRect(
            find.descendant(
              of: shownText(label),
              matching: find.byType(RichText),
            ),
          );
          final button = tester.getRect(
            find
                .ancestor(of: shownText(label), matching: find.byType(Material))
                .first,
          );
          expect(text.top - button.top, greaterThanOrEqualTo(AppSpace.s8));
          expect(
            button.bottom - text.bottom,
            greaterThanOrEqualTo(AppSpace.s8),
          );
        }
        // The first label holds one line at both sizes and the second wraps
        // at the largest, so a grown label is what is measured there.
        // The paragraph's own lines, counted by where its boxes start.
        int lines(String label) {
          final paragraph = tester.renderObject<RenderParagraph>(
            find.descendant(
              of: shownText(label),
              matching: find.byType(RichText),
            ),
          );
          return paragraph
              .getBoxesForSelection(
                TextSelection(
                  baseOffset: 0,
                  extentOffset: paragraph.text.toPlainText().length,
                ),
              )
              .map((box) => box.top)
              .toSet()
              .length;
        }

        expect(lines(labels.first), 1, reason: 'setup');
        expect(lines(labels.last), scale > 1 ? greaterThan(1) : 1);
      },
    );
  }
}
