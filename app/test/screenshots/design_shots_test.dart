import 'dart:async';
import 'dart:io';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:knowno/design/app_button.dart';
import 'package:knowno/design/app_list_row.dart';
import 'package:knowno/design/app_search_field.dart';
import 'package:knowno/design/app_section_label.dart';
import 'package:knowno/design/app_sheet.dart';
import 'package:knowno/design/app_text_field.dart';
import 'package:knowno/design/bottom_actions.dart';
import 'package:knowno/design/mascot.dart';
import 'package:knowno/design/screen_skeleton.dart';
import 'package:knowno/design/theme.dart';
import 'package:knowno/design/word_break.dart';
import 'package:knowno/l10n/app_localizations.dart';

import '../app_fonts.dart';
import '../word_breaks.dart';

/// The images `docs/architecture/design/frames.md` shows, one per frame, drawn
/// from the components in light at one pixel to a logical one. They are
/// golden files in `docs/architecture/design/images/`: `flutter test` fails on
/// one that differs from what is drawn by more than [_meanTolerance], and
/// `make design-shots` writes them.
const _images = {
  'screen-skeleton',
  'screen-skeleton-top-level',
  'screen-skeleton-largest-text',
  'list-row',
  'group-and-section',
  'sheet',
  'sheet-confirm',
  'form-field',
  'empty-state',
  'failure-state',
};

/// The mean difference per channel, out of 255, up to which two renderings
/// count as one. None on Linux, where CI draws the images: a mean separates a
/// changed word from nothing only at 0, since one glyph moves it by 0.008.
/// Elsewhere text edges differ from Linux's, and a layout change, 6 in the
/// sheet it was measured on, still stands out.
final _meanTolerance = Platform.isLinux ? 0.0 : 0.5;

const _phone = Size(390, 844);

/// Compares an image with its golden by the mean difference per channel, as
/// `tools/brand/generate.mjs` compares a brand PNG, and writes it on update.
class _MeanComparator extends LocalFileComparator {
  _MeanComparator(super.testFile);

  @override
  Future<bool> compare(Uint8List imageBytes, Uri golden) async {
    final mean = await _meanDifference(
      imageBytes,
      Uint8List.fromList(await getGoldenBytes(golden)),
    );
    if (mean <= _meanTolerance) return true;
    throw FlutterError(
      'The image differs from ${golden.path} by a mean of $mean in 255, '
      'over the $_meanTolerance allowed. `make design-shots` writes it.',
    );
  }
}

Future<ui.Image> _decode(Uint8List bytes) async =>
    (await (await ui.instantiateImageCodec(bytes)).getNextFrame()).image;

/// The mean difference per channel, out of 255, between two PNGs; infinity
/// when they differ in size.
Future<double> _meanDifference(Uint8List a, Uint8List b) async {
  final left = await _decode(a);
  final right = await _decode(b);
  if (left.width != right.width || left.height != right.height) {
    return double.infinity;
  }
  final x = (await left.toByteData())!.buffer.asUint8List();
  final y = (await right.toByteData())!.buffer.asUint8List();
  var total = 0;
  for (var i = 0; i < x.length; i++) {
    total += (x[i] - y[i]).abs();
  }
  return total / x.length;
}

void main() {
  setUpAll(() async {
    await loadAppFonts();
    final base = goldenFileComparator as LocalFileComparator;
    goldenFileComparator = _MeanComparator(
      base.basedir.resolve('design_shots_test.dart'),
    );
  });

  final ko = lookupAppLocalizations(const Locale('ko'));

  /// Pumps [home] in a phone's screen in light, in Korean, [pushed] on a
  /// screen of its own so that it has a back.
  Future<void> pump(
    WidgetTester tester,
    Widget home, {
    double scale = 1,
    bool pushed = false,
  }) async {
    tester.view.physicalSize = _phone;
    tester.view.devicePixelRatio = 1;
    tester.platformDispatcher.textScaleFactorTestValue = scale;
    // A release build draws neither the debug banner nor flat shadows.
    WidgetsApp.debugAllowBannerOverride = false;
    debugDisableShadows = false;
    addTearDown(tester.view.reset);
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    await tester.pumpWidget(
      MaterialApp(
        theme: lightTheme,
        themeMode: ThemeMode.light,
        locale: const Locale('ko'),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: pushed ? const Scaffold() : home,
      ),
    );
    if (pushed) {
      unawaited(
        tester
            .state<NavigatorState>(find.byType(Navigator))
            .push(MaterialPageRoute<void>(builder: (_) => home)),
      );
    }
    await tester.pumpAndSettle();
  }

  Future<void> shot(WidgetTester tester, Finder of, String name) async {
    expect(_images, contains(name));
    expect(of, findsOneWidget);
    await tester.runAsync(() async {
      for (final element in find.byType(Image).evaluate()) {
        await precacheImage((element.widget as Image).image, element);
      }
    });
    await tester.pump();
    try {
      await expectLater(
        of,
        matchesGoldenFile('../../../docs/architecture/design/images/$name.png'),
      );
    } finally {
      // The invariants check runs before the teardowns.
      WidgetsApp.debugAllowBannerOverride = true;
      debugDisableShadows = true;
    }
  }

  /// [child] on the ground, as wide as the phone and as tall as it is.
  Widget fragment(Widget child) => Builder(
    builder: (context) => Material(
      type: MaterialType.transparency,
      child: Align(
        alignment: Alignment.topLeft,
        child: RepaintBoundary(
          key: const ValueKey('fragment'),
          child: ColoredBox(
            color: AppColors.of(context).ground,
            child: SizedBox(
              width: _phone.width,
              child: Padding(
                padding: const EdgeInsets.all(AppSpace.gutter),
                child: child,
              ),
            ),
          ),
        ),
      ),
    ),
  );

  Widget skeleton({required bool topLevel}) => ScreenSkeleton(
    title: '영어 단어',
    userTitle: !topLevel,
    topLevel: topLevel,
    actions: AppButton(
      label: '카드 추가',
      icon: LucideIcons.plus,
      variant: AppButtonVariant.tonal,
      size: AppButtonSize.header,
      onPressed: () {},
    ),
    search: AppSearchField(hint: '카드 검색', onChanged: (_) {}),
    body: [
      SliverToBoxAdapter(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const AppSectionLabel('카드'),
            AppGroup(
              children: [
                for (final word in ['apple', 'banana', 'cherry'])
                  AppListRow(title: word, subtitle: '사과', onTap: () {}),
              ],
            ),
          ],
        ),
      ),
    ],
    bottom: topLevel
        ? null
        : BottomActions(
            secondary: AppButton(
              label: '미리보기',
              variant: AppButtonVariant.secondary,
              size: AppButtonSize.cta,
              onPressed: () {},
            ),
            primary: AppButton(
              label: '공부하기',
              size: AppButtonSize.cta,
              onPressed: () {},
            ),
          ),
  );

  testWidgets('a screen skeleton draws its header, search, body and primary', (
    tester,
  ) async {
    await pump(tester, skeleton(topLevel: false), pushed: true);
    await shot(tester, find.byType(MaterialApp), 'screen-skeleton');
  });

  testWidgets(
    'a tab\'s first screen shares one line between title and action',
    (tester) async {
      await pump(tester, skeleton(topLevel: true));
      await shot(tester, find.byType(MaterialApp), 'screen-skeleton-top-level');
    },
  );

  testWidgets('a screen skeleton at the largest text size clips nothing', (
    tester,
  ) async {
    await pump(tester, skeleton(topLevel: false), scale: 3.12, pushed: true);
    await shot(
      tester,
      find.byType(MaterialApp),
      'screen-skeleton-largest-text',
    );
  });

  testWidgets('a list row has a leading widget, two lines and a trailing one', (
    tester,
  ) async {
    await pump(
      tester,
      fragment(
        Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          spacing: AppSpace.rowGap,
          children: [
            AppListRow(
              title: '영어 단어',
              subtitle: '카드 12장',
              leading: const Icon(LucideIcons.bookOpen),
              trailing: const Icon(LucideIcons.chevronRight),
              onTap: () {},
            ),
            AppListRow(title: '알림', onTap: () {}),
            AppListRow(title: '노트 삭제', destructive: true, onTap: () {}),
          ],
        ),
      ),
    );
    await shot(tester, find.byKey(const ValueKey('fragment')), 'list-row');
  });

  testWidgets('a group is one surface of rows split by hairlines', (
    tester,
  ) async {
    await pump(
      tester,
      fragment(
        Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          spacing: AppSpace.sectionGap,
          children: [
            const Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                AppSectionLabel('계정'),
                AppGroup(
                  children: [
                    AppListRow(title: '이메일', subtitle: 'ada@example.com'),
                    AppListRow(title: '하루 공부 시간', subtitle: '10분'),
                  ],
                ),
              ],
            ),
            Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const AppSectionLabel('화면'),
                AppGroup(
                  children: [
                    AppListRow(
                      title: '다크 모드',
                      trailing: Switch(value: false, onChanged: (_) {}),
                    ),
                    AppListRow(title: '언어', onTap: () {}),
                  ],
                ),
              ],
            ),
          ],
        ),
      ),
    );
    await shot(
      tester,
      find.byKey(const ValueKey('fragment')),
      'group-and-section',
    );
  });

  /// Opens [sheet] over a screen with one button, and shoots the screen.
  Future<void> openSheet(
    WidgetTester tester,
    Widget Function(BuildContext) sheet,
    String name,
  ) async {
    await pump(
      tester,
      Builder(
        builder: (context) => Scaffold(
          body: Center(
            child: AppButton(
              label: '열기',
              onPressed: () => showAppSheet<void>(context, builder: sheet),
            ),
          ),
        ),
      ),
    );
    await tester.tap(shownText('열기'));
    await tester.pumpAndSettle();
    await shot(tester, find.byType(MaterialApp), name);
  }

  testWidgets('a sheet has a handle, a title, a body, content and actions', (
    tester,
  ) async {
    await openSheet(
      tester,
      (context) => AppSheet(
        title: '노트 공유',
        body: '링크를 받은 사람이 이 노트를 복사해 갈 수 있어요.',
        content: const AppGroup(
          children: [
            AppListRow(title: '공개 노트로 올리기'),
            AppListRow(title: '링크 복사'),
          ],
        ),
        actions: [
          AppButton(
            label: '공유하기',
            size: AppButtonSize.cta,
            onPressed: () => Navigator.pop(context),
          ),
        ],
      ),
      'sheet',
    );
  });

  testWidgets('a confirmation puts cancel above the red last button', (
    tester,
  ) async {
    await pump(
      tester,
      Builder(
        builder: (context) => Scaffold(
          body: Center(
            child: AppButton(
              label: '열기',
              onPressed: () => showAppConfirm(
                context,
                title: '이 노트를 지울까요?',
                consequence: '카드와 공부 기록도 함께 지워져요.',
                confirmLabel: '지우기',
              ),
            ),
          ),
        ),
      ),
    );
    await tester.tap(shownText('열기'));
    await tester.pumpAndSettle();
    await shot(tester, find.byType(MaterialApp), 'sheet-confirm');
  });

  testWidgets('a form field has a label, a hint and an error', (tester) async {
    await pump(
      tester,
      fragment(
        const Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          spacing: AppSpace.s16,
          children: [
            AppTextField(label: '노트 이름', hint: '예: 영어 단어', maxLength: 50),
            AppTextField(
              label: '이메일',
              hint: 'ada@example.com',
              errorText: '이메일 주소를 확인해 주세요.',
            ),
          ],
        ),
      ),
    );
    await shot(tester, find.byKey(const ValueKey('fragment')), 'form-field');
  });

  /// What a screen shows in place of content: [expression]'s mascot if any,
  /// a sentence and the action that leads out.
  Widget state({
    MascotExpression? expression,
    required String sentence,
    required AppButton action,
  }) => Padding(
    padding: const EdgeInsets.symmetric(vertical: AppSpace.s40),
    child: Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      spacing: AppSpace.s12,
      children: [
        if (expression != null)
          Center(child: Mascot(expression: expression, size: 128)),
        Text(
          keepWords(sentence),
          textAlign: TextAlign.center,
          style: AppType.body.copyWith(color: AppColors.light.muted),
        ),
        action,
      ],
    ),
  );

  testWidgets('an empty state is a mascot, a sentence and the primary', (
    tester,
  ) async {
    await pump(
      tester,
      fragment(
        state(
          expression: MascotExpression.sleepy,
          sentence: '아직 노트가 없어요.',
          action: AppButton(label: '노트 만들기', onPressed: () {}),
        ),
      ),
    );
    await shot(tester, find.byKey(const ValueKey('fragment')), 'empty-state');
  });

  testWidgets('a failure state is a sentence over a retry, with no mascot', (
    tester,
  ) async {
    await pump(
      tester,
      fragment(
        state(
          sentence: '노트를 불러오지 못했어요.',
          action: AppButton(
            label: ko.retry,
            variant: AppButtonVariant.secondary,
            onPressed: () {},
          ),
        ),
      ),
    );
    await shot(tester, find.byKey(const ValueKey('fragment')), 'failure-state');
  });

  test('the images folder holds the frames and nothing else', () {
    final files = Directory('../docs/architecture/design/images')
        .listSync()
        .map((file) => file.uri.pathSegments.last)
        .toSet();
    expect(files, {for (final name in _images) '$name.png'});
  });
}
