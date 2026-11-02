import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

/// The family of the bundled Pretendard, declared in `pubspec.yaml`: body
/// text, and everything a user wrote, in any style.
const appFontFamily = 'Pretendard';

/// The family of the bundled Jua, declared in `pubspec.yaml`: the titles,
/// figures and buttons we write, and never a user's text. Its styles ask for
/// [FontWeight.w400], its one face's own, since Flutter thickens it at any
/// heavier weight.
const appDisplayFontFamily = 'Jua';

/// Pretendard ExtraBold as a family of one face, which draws a character Jua
/// lacks at a Jua style's weight.
const appDisplayFallbackFamily = 'PretendardExtraBold';

const _displayFallback = [appDisplayFallbackFamily];

/// The spacing scale, on a 4 px base. Every padding, margin and gap in the
/// app is one of these.
abstract final class AppSpace {
  static const s4 = 4.0;
  static const s8 = 8.0;
  static const s12 = 12.0;
  static const s16 = 16.0;
  static const s20 = 20.0;
  static const s24 = 24.0;
  static const s28 = 28.0;
  static const s32 = 32.0;
  static const s40 = 40.0;

  /// Space between the screen's left and right edges and its content.
  static const gutter = s20;

  /// Space between two rows of a list.
  static const rowGap = s12;

  /// Space between two sections of a screen.
  static const sectionGap = s28;
}

/// The corner radii of the app's rounded surfaces, on one scale: group and
/// card 28, button 24, row 22, sheet 32, and a chip and a field 16 to 18
/// (ADR 0147).
abstract final class AppRadius {
  /// The bottom corners of the sign-in screen's brand panel.
  static const panel = 40.0;

  /// A sheet's top corners.
  static const sheet = 32.0;

  /// A card: a study card, the today card, or a card preview.
  static const card = 28.0;

  /// A previous card in the study stack.
  static const previous = 28.0;

  /// A row in a list that stands alone on the ground.
  static const row = 22.0;

  /// A group of rows split by hairlines: a settings section, a deck's cards.
  static const group = 28.0;

  /// A button.
  static const button = 24.0;

  /// A chip, and a label before a meaning.
  static const chip = 16.0;

  /// A field.
  static const field = 18.0;

  /// A pull-down menu, such as a photo import section's form menu.
  static const menu = 16.0;
}

/// The heights and sizes of the app's controls and brand marks.
abstract final class AppSize {
  /// The screen's or the sheet's primary action, at the bottom.
  static const cta = 64.0;

  /// Every other button.
  static const button = 64.0;

  /// A one-line field.
  static const field = 50.0;

  /// The search field over a list.
  static const search = 46.0;

  /// The least width and height of anything tapped.
  static const tapTarget = 44.0;

  /// A sheet's drag handle.
  static const handle = Size(44, 5);

  /// The account screen's initial avatar.
  static const avatar = 56.0;

  /// The home screen's initial avatar, in its top bar.
  static const smallAvatar = 32.0;

  /// A deck row's initial tile.
  static const deckTile = 46.0;

  /// A small icon, inside a button or a line of text.
  static const smallIcon = 18.0;

  /// The tick inside a row's round check, such as a photo import row's.
  static const checkIcon = 14.0;

  /// A first-use coach's finger over the card it demonstrates on.
  static const coachFinger = 34.0;

  /// The blur of the shadow that lifts a coach's finger off the card.
  static const coachFingerBlur = 6.0;

  /// A coach's step dot, and its height when it is the current step's.
  static const coachDot = 6.0;

  /// The current step's dot, drawn long.
  static const coachDotCurrent = 16.0;

  /// How high a pull-down menu floats, which sets its shadow.
  static const menuElevation = 12.0;

  /// The horizontal lockup's height in the home screen's top bar.
  static const lockupHeight = 30.0;

  /// The stacked lockup's width on the sign-in screen.
  static const stackedLockupWidth = 200.0;

  /// The mascot where it heads the first-run home or a cardless 오늘 tab.
  static const mascotLarge = 128.0;

  /// The mascot over a card's or a screen's words.
  static const mascotMedium = 96.0;

  /// The mascot beside words: the backlog card's, or a photo being read.
  static const mascotGuide = 64.0;

  /// The symbol in the today card's corner.
  static const heroSymbol = 120.0;

  /// The study progress bar's thickness.
  static const progress = 10.0;

  /// The tab bar's height, before a larger text size grows it.
  static const tabBar = 66.0;

  /// The edge a card, a group or a quiet button sits on.
  static const edgeCard = 6.0;

  /// The edge a primary button sits on.
  static const edgeButton = 7.0;

  /// The edge a list row or the tab bar sits on.
  static const edgeRow = 5.0;

  /// What is left of an edge while its object is pressed down onto it.
  static const edgePressed = 2.0;
}

/// Digits of one width, so a figure keeps its place as it changes. Kept out
/// of [AppType]'s styles, which the web's token test reads.
const _tabularDigits = [FontFeature.tabularFigures()];

/// The app's type scale, with explicit line heights: Jua for the titles,
/// figures and buttons we write, Pretendard for body text and for everything
/// a user wrote, whatever its rank (ADR 0147). A style without a colour takes
/// the text colour of where it is drawn.
abstract final class AppType {
  /// A home screen's title: 28/36, Jua.
  static const display = TextStyle(
    fontFamily: appDisplayFontFamily,
    fontFamilyFallback: _displayFallback,
    fontSize: 28,
    height: 36 / 28,
    fontWeight: FontWeight.w400,
  );

  /// A pushed screen's and a sheet's title: 26/34, Jua.
  static const title = TextStyle(
    fontFamily: appDisplayFontFamily,
    fontFamilyFallback: _displayFallback,
    fontSize: 26,
    height: 34 / 26,
    fontWeight: FontWeight.w400,
  );

  /// A tab's title: 28/36, Jua.
  static const deckTitle = TextStyle(
    fontFamily: appDisplayFontFamily,
    fontFamilyFallback: _displayFallback,
    fontSize: 28,
    height: 36 / 28,
    fontWeight: FontWeight.w400,
  );

  /// A title a user wrote, such as a deck's name: 28/36, extra bold
  /// Pretendard, never Jua.
  static const deckName = TextStyle(
    fontFamily: appFontFamily,
    fontSize: 28,
    height: 36 / 28,
    fontWeight: FontWeight.w800,
    letterSpacing: -0.8,
  );

  /// A large figure, such as the today card's count: 38/46, Jua, its digits
  /// tabular.
  static const figure = TextStyle(
    fontFamily: appDisplayFontFamily,
    fontFamilyFallback: _displayFallback,
    fontSize: 38,
    height: 46 / 38,
    fontWeight: FontWeight.w400,
    fontFeatures: _tabularDigits,
  );

  /// A section's title and a figure's unit: 20/28, Jua.
  static const headline = TextStyle(
    fontFamily: appDisplayFontFamily,
    fontFamilyFallback: _displayFallback,
    fontSize: 20,
    height: 28 / 20,
    fontWeight: FontWeight.w400,
  );

  /// Running text: 16/24, medium.
  static const body = TextStyle(
    fontFamily: appFontFamily,
    fontSize: 16,
    height: 24 / 16,
    fontWeight: FontWeight.w500,
  );

  /// A row's title: 16/24, bold.
  static const bodyStrong = TextStyle(
    fontFamily: appFontFamily,
    fontSize: 16,
    height: 24 / 16,
    fontWeight: FontWeight.w700,
  );

  /// A quiet label we write, such as a tab's or a chart's heading: 16/24,
  /// Jua.
  static const label = TextStyle(
    fontFamily: appDisplayFontFamily,
    fontFamilyFallback: _displayFallback,
    fontSize: 16,
    height: 24 / 16,
    fontWeight: FontWeight.w400,
  );

  /// A primary or quiet button's label: 23/28, Jua.
  static const button = TextStyle(
    fontFamily: appDisplayFontFamily,
    fontFamilyFallback: _displayFallback,
    fontSize: 23,
    height: 28 / 23,
    fontWeight: FontWeight.w400,
  );

  /// Secondary text, such as a sheet's body or a line under a title: the
  /// caption size, 13/18.
  static const secondary = TextStyle(
    fontFamily: appFontFamily,
    fontSize: 13,
    height: 18 / 13,
    fontWeight: FontWeight.w400,
  );

  /// Small supporting text: 13/18.
  static const caption = TextStyle(
    fontFamily: appFontFamily,
    fontSize: 13,
    height: 18 / 13,
    fontWeight: FontWeight.w400,
  );

  /// A section label and a hint: 13/18, semibold.
  static const section = TextStyle(
    fontFamily: appFontFamily,
    fontSize: 13,
    height: 18 / 13,
    fontWeight: FontWeight.w600,
  );

  /// Chips and notes: the caption size, 13/18.
  static const micro = TextStyle(
    fontFamily: appFontFamily,
    fontSize: 13,
    height: 18 / 13,
    fontWeight: FontWeight.w400,
  );

  /// A study card's front: 42/46, extra bold Pretendard, never Jua, so a
  /// card's text is one face whatever its script.
  static const front = TextStyle(
    fontFamily: appFontFamily,
    fontSize: 42,
    height: 46 / 42,
    fontWeight: FontWeight.w800,
    letterSpacing: -0.6,
  );

  /// A study card's back: 20/28, semibold.
  static const back = TextStyle(
    fontFamily: appFontFamily,
    fontSize: 20,
    height: 28 / 20,
    fontWeight: FontWeight.w600,
  );

  /// A 글's front on a whole card: 20/28, bold, above its added part.
  static const wholeFront = TextStyle(
    fontFamily: appFontFamily,
    fontSize: 20,
    height: 28 / 20,
    fontWeight: FontWeight.w700,
  );

  /// The part the reveal adds to a whole card: 18/26, semibold (ADR 0145).
  static const wholeAdded = TextStyle(
    fontFamily: appFontFamily,
    fontSize: 18,
    height: 26 / 18,
    fontWeight: FontWeight.w600,
  );

  /// A study card's text too long for [back]: 17/27, medium, read as a
  /// paragraph (ADR 0123).
  static const cardBody = TextStyle(
    fontFamily: appFontFamily,
    fontSize: 17,
    height: 27 / 17,
    fontWeight: FontWeight.w500,
  );

  /// The smallest a card's front and back shrink to so they fit their
  /// half.
  static const frontFloor = 18.0;
  static const backFloor = 15.0;

  /// The scale as Material's text theme, so Material widgets draw in it.
  static const textTheme = TextTheme(
    displayLarge: display,
    displayMedium: display,
    displaySmall: display,
    headlineLarge: display,
    headlineMedium: title,
    headlineSmall: headline,
    titleLarge: title,
    titleMedium: bodyStrong,
    titleSmall: section,
    bodyLarge: body,
    bodyMedium: secondary,
    bodySmall: caption,
    labelLarge: label,
    labelMedium: section,
    labelSmall: micro,
  );
}

/// The brand's marks, drawn from the files under `assets/brand/`.
abstract final class AppBrand {
  /// The mark on its circle, 알아몰라 and knowno side by side, in a
  /// light-ground or a dark-ground version.
  static String lockup(Brightness brightness) =>
      'assets/brand/knowno-lockup-${brightness.name}.png';

  /// The mark on its circle over 알아몰라 and knowno, in a light-ground or a
  /// dark-ground version.
  static String stacked(Brightness brightness) =>
      'assets/brand/knowno-stacked-${brightness.name}.png';

  /// The mascot in its [expression], the same on either ground.
  static String mascot(String expression) =>
      'assets/brand/knowno-$expression.png';
}

/// The edges solid objects sit on: a hard offset of a darker colour, with no
/// blur (ADR 0147).
abstract final class AppShadow {
  /// An edge of [color], [height] tall.
  static List<BoxShadow> edge(Color color, double height) => [
    BoxShadow(color: color, offset: Offset(0, height)),
  ];

  /// A card resting on the ground: the today card, a study card, a group.
  static List<BoxShadow> card(AppColors colors) =>
      edge(colors.edge, AppSize.edgeCard);
}

/// The app's colour tokens. Every colour a screen draws comes from here or
/// from the [ColorScheme] built from it.
@immutable
final class AppColors extends ThemeExtension<AppColors> {
  const AppColors({
    required this.ground,
    required this.surface,
    required this.raised,
    required this.ink,
    required this.onInk,
    required this.primary,
    required this.primaryEdge,
    required this.onPrimary,
    required this.accent,
    required this.edge,
    required this.ink2,
    required this.muted,
    required this.hairline,
    required this.outline,
    required this.brandTint,
    required this.hero,
    required this.onHero,
    required this.onHeroEdge,
    required this.heroButton,
    required this.onHeroButton,
    required this.bar,
    required this.brand,
    required this.know,
    required this.onKnow,
    required this.dontKnow,
    required this.dontKnowText,
    required this.dontKnowEdge,
    required this.onDontKnowText,
    required this.shadow,
    required this.chartOther,
    required this.chartQuiet,
    required this.chartFading,
    required this.tintAmber,
    required this.tintGreen,
    required this.tintRed,
    required this.knowCard,
    required this.knowLine,
    required this.onKnowTint,
    required this.dontKnowCard,
    required this.dontKnowLine,
    required this.onDontKnowTint,
    required this.streak,
    required this.deckBlue,
    required this.deckSky,
    required this.deckPeach,
    required this.deckAmber,
    required this.deckSlate,
    required this.deckSand,
  });

  /// Light tokens: navy ink on white surfaces over a pale blue ground, each
  /// solid object on a darker [edge]; coral is the mascot's alone.
  static const light = AppColors(
    ground: Color(0xFFEEF3FF),
    surface: Color(0xFFFFFFFF),
    raised: Color(0xFFFFFFFF),
    ink: Color(0xFF13224A),
    onInk: Color(0xFFFFFFFF),
    primary: Color(0xFF2547D0),
    primaryEdge: Color(0xFF172E94),
    onPrimary: Color(0xFFFFFFFF),
    accent: Color(0xFF2547D0),
    edge: Color(0xFFC9D6FB),
    ink2: Color(0xFF44527A),
    muted: Color(0xFF44527A),
    hairline: Color(0xFFDCE5FD),
    outline: Color(0xFFC9D6FB),
    brandTint: Color(0xFFDCE5FD),
    hero: Color(0xFF2547D0),
    onHero: Color(0xFFFFFFFF),
    onHeroEdge: Color(0xFFC9D6FB),
    heroButton: Color(0xFFFFFFFF),
    onHeroButton: Color(0xFF2547D0),
    bar: Color(0xFFFFFFFF),
    brand: Color(0xFF2547D0),
    know: Color(0xFF14683F),
    onKnow: Color(0xFFFFFFFF),
    dontKnow: Color(0xFFA3202F),
    dontKnowText: Color(0xFFA3202F),
    dontKnowEdge: Color(0xFF7A1622),
    onDontKnowText: Color(0xFFFFFFFF),
    shadow: Color(0xFF13224A),
    chartOther: Color(0xFF9DB1F0),
    chartQuiet: Color(0xFF6F86D9),
    chartFading: Color(0xFF6B1320),
    tintAmber: Color(0xFFFFE9A8),
    tintGreen: Color(0xFFBFF0DC),
    tintRed: Color(0xFFFFD2DE),
    knowCard: Color(0xFFBFF0DC),
    knowLine: Color(0xFF86D5B7),
    onKnowTint: Color(0xFF14683F),
    dontKnowCard: Color(0xFFFFD2DE),
    dontKnowLine: Color(0xFFF0A3B8),
    onDontKnowTint: Color(0xFFA3202F),
    streak: Color(0xFFC26A0A),
    deckBlue: Color(0xFFDCE6FF),
    deckSky: Color(0xFFE0F0FA),
    deckPeach: Color(0xFFFFE3DC),
    deckAmber: Color(0xFFFFE9A8),
    deckSlate: Color(0xFFE3E8F2),
    deckSand: Color(0xFFF2EAD8),
  );

  /// Dark tokens: pale ink on deep navy surfaces, the primary lightened, and
  /// the greens and reds lightened to meet WCAG AA on [surface].
  static const dark = AppColors(
    ground: Color(0xFF111A2E),
    surface: Color(0xFF232F4E),
    raised: Color(0xFF2E3B60),
    ink: Color(0xFFEEF2FF),
    onInk: Color(0xFF0D1424),
    primary: Color(0xFF8AB4FF),
    primaryEdge: Color(0xFF4A78D6),
    onPrimary: Color(0xFF0D1424),
    accent: Color(0xFF8AB4FF),
    edge: Color(0xFF0A1020),
    ink2: Color(0xFFB3BEDC),
    muted: Color(0xFFB3BEDC),
    hairline: Color(0xFF34405F),
    outline: Color(0xFF34405F),
    brandTint: Color(0xFF34405F),
    hero: Color(0xFF1A2F78),
    onHero: Color(0xFFFFFFFF),
    onHeroEdge: Color(0xFF4A78D6),
    heroButton: Color(0xFF8AB4FF),
    onHeroButton: Color(0xFF0D1424),
    bar: Color(0xFF2C3A60),
    brand: Color(0xFF1A2F78),
    know: Color(0xFF8CE6BC),
    onKnow: Color(0xFF1D1833),
    dontKnow: Color(0xFFFFA8BA),
    dontKnowText: Color(0xFFFFA8BA),
    dontKnowEdge: Color(0xFFD97C92),
    onDontKnowText: Color(0xFF1D1833),
    shadow: Color(0xFF000000),
    chartOther: Color(0xFF3D568F),
    chartQuiet: Color(0xFF6890E2),
    chartFading: Color(0xFFFFA8BA),
    tintAmber: Color(0xFF4A3B1E),
    tintGreen: Color(0xFF1F5A44),
    tintRed: Color(0xFF6B2331),
    knowCard: Color(0xFF1B4A3B),
    knowLine: Color(0xFF2C6B57),
    onKnowTint: Color(0xFF8CE6BC),
    dontKnowCard: Color(0xFF52202F),
    dontKnowLine: Color(0xFF7A3049),
    onDontKnowTint: Color(0xFFFFA8BA),
    streak: Color(0xFFF5A623),
    deckBlue: Color(0xFF2C3A66),
    deckSky: Color(0xFF1D3A50),
    deckPeach: Color(0xFF4A3330),
    deckAmber: Color(0xFF4A3B1E),
    deckSlate: Color(0xFF323B52),
    deckSand: Color(0xFF433C30),
  );

  /// The screen's background, under every surface.
  final Color ground;

  /// Cards, rows, sheets and bars.
  final Color surface;

  /// A surface raised over [surface], such as a study card in the dark theme.
  final Color raised;

  /// Primary text, and the quiet fills: a bar, a selection, an avatar.
  final Color ink;

  /// Text and icons on an [ink] fill.
  final Color onInk;

  /// The primary action's fill, under its [onPrimary] label; text and marks
  /// take [accent] (ADR 0147).
  final Color primary;

  /// The edge [primary] sits on.
  final Color primaryEdge;

  /// A primary action's label on [primary].
  final Color onPrimary;

  /// Coloured text, a count, the current tab, and a chart's or a progress
  /// bar's stressed mark: never [primary].
  final Color accent;

  /// The edge a [surface] sits on: a card, a row, a quiet button, the tab bar.
  /// Decoration, so no contrast is asked of it.
  final Color edge;

  /// Text one step quieter than [ink], such as a card's back in a list.
  final Color ink2;

  /// Secondary text.
  final Color muted;

  /// Dividers and the line around a card.
  final Color hairline;

  /// The outline of a field, and the track of a progress bar.
  final Color outline;

  /// A quiet tint of the ground: a chip, an avatar's circle, a filled blank.
  final Color brandTint;

  /// A full-screen colour surface, and the study coach's fill and the study
  /// screen's notice, apart from [primary].
  final Color hero;

  /// Text and the button fill on [hero].
  final Color onHero;

  /// The edge a button on [hero] sits on.
  final Color onHeroEdge;

  /// A button or a chip on [hero], and its label: never white under a
  /// light blue.
  final Color heroButton;
  final Color onHeroButton;

  /// The tab bar's fill: the surface in the light theme, a step lighter in
  /// the dark.
  final Color bar;

  /// A photo's box outline and its hidden fill.
  final Color brand;

  /// "Know", as text and icons on [surface] or [ground], and as a fill under [onKnow].
  final Color know;
  final Color onKnow;

  /// "Don't know", as the tint over a dragged card; never as text.
  final Color dontKnow;

  /// "Don't know" and destruction, as text on [surface] and as a fill under [onDontKnowText].
  final Color dontKnowText;

  /// The edge a destructive fill sits on.
  final Color dontKnowEdge;
  final Color onDontKnowText;

  /// The colour of every shadow, before its opacity.
  final Color shadow;

  /// A chart's bar or segment that is not the one it stresses, beside its
  /// own count, which carries it: 1.5:1 from [accent].
  final Color chartOther;

  /// A mark with no count of its own: a past week's mastered bar, a deck's
  /// learning share. 3:1 on [surface], where [edge] is not (ADR 0147).
  final Color chartQuiet;

  /// The recall band that is fading: 3:1 on [surface], and 1.5:1 from
  /// [chartOther]; in the dark theme it is 모른다's colour, apart from
  /// [accent] by hue (ADR 0147).
  final Color chartFading;

  /// An amber tint: the backlog card's check and a chart's shortfall.
  final Color tintAmber;

  /// A green tint, behind a study card dragged toward "Know".
  final Color tintGreen;

  /// A red tint, behind a study card dragged toward "Don't know".
  final Color tintRed;

  /// A previous card answered "Know": its fill and its line.
  final Color knowCard;
  final Color knowLine;

  /// "Know" as text on [tintGreen], the tint behind a card dragged toward it.
  final Color onKnowTint;

  /// A previous card answered "Don't know": its fill and its line.
  final Color dontKnowCard;
  final Color dontKnowLine;

  /// "Don't know" as text on [tintRed], the tint behind a card dragged toward
  /// it.
  final Color onDontKnowTint;

  /// The streak flame's body, on the 오늘 tab and the completion card.
  final Color streak;

  /// What a pressed row draws over itself: [ink] at the 10% a pressed
  /// button's label colour is drawn at, so a press dims either alike.
  /// Derived, so the web's token set needs no colour of its own.
  Color get pressed => ink.withValues(alpha: 0.1);

  /// The streak flame's line at its first stage, before it takes [streak].
  Color get flameOutline => muted;

  /// The streak flame's warm core, from its fourth stage: [streak] halfway
  /// toward white, so the web's token set needs no flame of its own.
  Color get flameCore => Color.lerp(streak, const Color(0xFFFFFFFF), 0.5)!;

  /// The streak flame's glow, from its fourth stage.
  Color get flameGlow => streak.withValues(alpha: 0.35);

  /// The deck palette, the colours a deck's tile takes: blue, sky, peach,
  /// amber, slate and sand, none green or red, which mean "Know" and "Don't
  /// know".
  final Color deckBlue;
  final Color deckSky;
  final Color deckPeach;
  final Color deckAmber;
  final Color deckSlate;
  final Color deckSand;

  /// The tokens of [context]'s theme.
  static AppColors of(BuildContext context) =>
      Theme.of(context).extension<AppColors>() ??
      (throw StateError('the app theme carries no AppColors'));

  @override
  AppColors copyWith({
    Color? ground,
    Color? surface,
    Color? raised,
    Color? ink,
    Color? onInk,
    Color? primary,
    Color? primaryEdge,
    Color? onPrimary,
    Color? accent,
    Color? edge,
    Color? ink2,
    Color? muted,
    Color? hairline,
    Color? outline,
    Color? brandTint,
    Color? hero,
    Color? onHero,
    Color? onHeroEdge,
    Color? heroButton,
    Color? onHeroButton,
    Color? bar,
    Color? brand,
    Color? know,
    Color? onKnow,
    Color? dontKnow,
    Color? dontKnowText,
    Color? dontKnowEdge,
    Color? onDontKnowText,
    Color? shadow,
    Color? chartOther,
    Color? chartQuiet,
    Color? chartFading,
    Color? tintAmber,
    Color? tintGreen,
    Color? tintRed,
    Color? knowCard,
    Color? knowLine,
    Color? onKnowTint,
    Color? dontKnowCard,
    Color? dontKnowLine,
    Color? onDontKnowTint,
    Color? streak,
    Color? deckBlue,
    Color? deckSky,
    Color? deckPeach,
    Color? deckAmber,
    Color? deckSlate,
    Color? deckSand,
  }) => AppColors(
    ground: ground ?? this.ground,
    surface: surface ?? this.surface,
    raised: raised ?? this.raised,
    ink: ink ?? this.ink,
    onInk: onInk ?? this.onInk,
    primary: primary ?? this.primary,
    primaryEdge: primaryEdge ?? this.primaryEdge,
    onPrimary: onPrimary ?? this.onPrimary,
    accent: accent ?? this.accent,
    edge: edge ?? this.edge,
    ink2: ink2 ?? this.ink2,
    muted: muted ?? this.muted,
    hairline: hairline ?? this.hairline,
    outline: outline ?? this.outline,
    brandTint: brandTint ?? this.brandTint,
    hero: hero ?? this.hero,
    onHero: onHero ?? this.onHero,
    onHeroEdge: onHeroEdge ?? this.onHeroEdge,
    heroButton: heroButton ?? this.heroButton,
    onHeroButton: onHeroButton ?? this.onHeroButton,
    bar: bar ?? this.bar,
    brand: brand ?? this.brand,
    know: know ?? this.know,
    onKnow: onKnow ?? this.onKnow,
    dontKnow: dontKnow ?? this.dontKnow,
    dontKnowText: dontKnowText ?? this.dontKnowText,
    dontKnowEdge: dontKnowEdge ?? this.dontKnowEdge,
    onDontKnowText: onDontKnowText ?? this.onDontKnowText,
    shadow: shadow ?? this.shadow,
    chartOther: chartOther ?? this.chartOther,
    chartQuiet: chartQuiet ?? this.chartQuiet,
    chartFading: chartFading ?? this.chartFading,
    tintAmber: tintAmber ?? this.tintAmber,
    tintGreen: tintGreen ?? this.tintGreen,
    tintRed: tintRed ?? this.tintRed,
    knowCard: knowCard ?? this.knowCard,
    knowLine: knowLine ?? this.knowLine,
    onKnowTint: onKnowTint ?? this.onKnowTint,
    dontKnowCard: dontKnowCard ?? this.dontKnowCard,
    dontKnowLine: dontKnowLine ?? this.dontKnowLine,
    onDontKnowTint: onDontKnowTint ?? this.onDontKnowTint,
    streak: streak ?? this.streak,
    deckBlue: deckBlue ?? this.deckBlue,
    deckSky: deckSky ?? this.deckSky,
    deckPeach: deckPeach ?? this.deckPeach,
    deckAmber: deckAmber ?? this.deckAmber,
    deckSlate: deckSlate ?? this.deckSlate,
    deckSand: deckSand ?? this.deckSand,
  );

  @override
  AppColors lerp(AppColors? other, double t) {
    if (other == null) return this;
    Color mix(Color a, Color b) => Color.lerp(a, b, t) ?? b;
    return AppColors(
      ground: mix(ground, other.ground),
      surface: mix(surface, other.surface),
      raised: mix(raised, other.raised),
      ink: mix(ink, other.ink),
      onInk: mix(onInk, other.onInk),
      primary: mix(primary, other.primary),
      primaryEdge: mix(primaryEdge, other.primaryEdge),
      onPrimary: mix(onPrimary, other.onPrimary),
      accent: mix(accent, other.accent),
      edge: mix(edge, other.edge),
      ink2: mix(ink2, other.ink2),
      muted: mix(muted, other.muted),
      hairline: mix(hairline, other.hairline),
      outline: mix(outline, other.outline),
      brandTint: mix(brandTint, other.brandTint),
      hero: mix(hero, other.hero),
      onHero: mix(onHero, other.onHero),
      onHeroEdge: mix(onHeroEdge, other.onHeroEdge),
      heroButton: mix(heroButton, other.heroButton),
      onHeroButton: mix(onHeroButton, other.onHeroButton),
      bar: mix(bar, other.bar),
      brand: mix(brand, other.brand),
      know: mix(know, other.know),
      onKnow: mix(onKnow, other.onKnow),
      dontKnow: mix(dontKnow, other.dontKnow),
      dontKnowText: mix(dontKnowText, other.dontKnowText),
      dontKnowEdge: mix(dontKnowEdge, other.dontKnowEdge),
      onDontKnowText: mix(onDontKnowText, other.onDontKnowText),
      shadow: mix(shadow, other.shadow),
      chartOther: mix(chartOther, other.chartOther),
      chartQuiet: mix(chartQuiet, other.chartQuiet),
      chartFading: mix(chartFading, other.chartFading),
      tintAmber: mix(tintAmber, other.tintAmber),
      tintGreen: mix(tintGreen, other.tintGreen),
      tintRed: mix(tintRed, other.tintRed),
      knowCard: mix(knowCard, other.knowCard),
      knowLine: mix(knowLine, other.knowLine),
      onKnowTint: mix(onKnowTint, other.onKnowTint),
      dontKnowCard: mix(dontKnowCard, other.dontKnowCard),
      dontKnowLine: mix(dontKnowLine, other.dontKnowLine),
      onDontKnowTint: mix(onDontKnowTint, other.onDontKnowTint),
      streak: mix(streak, other.streak),
      deckBlue: mix(deckBlue, other.deckBlue),
      deckSky: mix(deckSky, other.deckSky),
      deckPeach: mix(deckPeach, other.deckPeach),
      deckAmber: mix(deckAmber, other.deckAmber),
      deckSlate: mix(deckSlate, other.deckSlate),
      deckSand: mix(deckSand, other.deckSand),
    );
  }
}

/// The light theme.
final lightTheme = _theme(Brightness.light, AppColors.light);

/// The dark theme.
final darkTheme = _theme(Brightness.dark, AppColors.dark);

ThemeData _theme(Brightness brightness, AppColors colors) {
  final scheme = ColorScheme(
    brightness: brightness,
    primary: colors.accent,
    onPrimary: colors.onInk,
    secondary: colors.ink2,
    onSecondary: colors.surface,
    error: colors.dontKnowText,
    onError: colors.onDontKnowText,
    surface: colors.surface,
    onSurface: colors.ink,
    onSurfaceVariant: colors.muted,
    surfaceContainerLowest: colors.surface,
    surfaceContainerLow: colors.surface,
    surfaceContainer: colors.surface,
    surfaceContainerHigh: colors.surface,
    surfaceContainerHighest: colors.ground,
    outline: colors.outline,
    outlineVariant: colors.hairline,
    shadow: colors.shadow,
    inverseSurface: colors.ink,
    onInverseSurface: colors.onInk,
  );
  final control = RoundedRectangleBorder(
    borderRadius: BorderRadius.circular(AppRadius.button),
  );
  const buttonSize = Size(AppSize.tapTarget, AppSize.button);
  final textTheme = AppType.textTheme.apply(
    bodyColor: colors.ink,
    displayColor: colors.ink,
  );
  return ThemeData(
    brightness: brightness,
    colorScheme: scheme,
    fontFamily: appFontFamily,
    textTheme: textTheme,
    scaffoldBackgroundColor: colors.ground,
    extensions: [colors],
    // A pressed row or button dims under its text's colour, at once, with
    // no splash spreading from the finger (#454).
    splashFactory: NoSplash.splashFactory,
    highlightColor: colors.pressed,
    // Stroke icons in place of Material's back and close glyphs.
    actionIconTheme: ActionIconThemeData(
      backButtonIconBuilder: (_) => const Icon(LucideIcons.chevronLeft),
      closeButtonIconBuilder: (_) => const Icon(LucideIcons.x),
    ),
    appBarTheme: AppBarTheme(
      backgroundColor: colors.ground,
      foregroundColor: colors.ink,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
      titleTextStyle: AppType.title.copyWith(color: colors.ink),
    ),
    dividerTheme: DividerThemeData(color: colors.hairline),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: buttonSize,
        shape: control,
        textStyle: AppType.button,
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: buttonSize,
        shape: control,
        textStyle: AppType.button,
        foregroundColor: colors.ink,
        side: BorderSide.none,
        backgroundColor: colors.surface,
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        minimumSize: const Size(AppSize.tapTarget, AppSize.tapTarget),
        shape: control,
        textStyle: AppType.label,
        foregroundColor: colors.ink,
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: colors.surface,
      hintStyle: AppType.body.copyWith(color: colors.muted),
      prefixIconColor: colors.muted,
      contentPadding: const EdgeInsets.symmetric(
        horizontal: AppSpace.s16,
        vertical: AppSpace.s12,
      ),
      border: _fieldBorder(colors.outline, 1),
      enabledBorder: _fieldBorder(colors.outline, 1),
      focusedBorder: _fieldBorder(colors.ink, 2),
      errorBorder: _fieldBorder(colors.dontKnowText, 1),
      focusedErrorBorder: _fieldBorder(colors.dontKnowText, 2),
      errorStyle: AppType.caption.copyWith(color: colors.dontKnowText),
    ),
    bottomSheetTheme: BottomSheetThemeData(
      backgroundColor: colors.ground,
      modalBackgroundColor: colors.ground,
      showDragHandle: false,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(
          top: Radius.circular(AppRadius.sheet),
        ),
      ),
      clipBehavior: Clip.antiAlias,
    ),
    segmentedButtonTheme: SegmentedButtonThemeData(
      style: SegmentedButton.styleFrom(
        minimumSize: const Size(AppSize.tapTarget, AppSize.button),
        textStyle: AppType.label,
        foregroundColor: colors.ink,
        selectedForegroundColor: colors.onInk,
        selectedBackgroundColor: colors.ink,
        backgroundColor: colors.surface,
        side: BorderSide(color: colors.outline),
        shape: control,
      ),
    ),
    // On, the accent track; off, a muted thumb and outline, each at least
    // 3:1 on the ground.
    switchTheme: SwitchThemeData(
      thumbColor: WidgetStateProperty.resolveWith(
        (states) =>
            states.contains(WidgetState.selected) ? colors.onInk : colors.muted,
      ),
      trackColor: WidgetStateProperty.resolveWith(
        (states) => states.contains(WidgetState.selected)
            ? colors.accent
            : colors.surface,
      ),
      trackOutlineColor: WidgetStateProperty.resolveWith(
        (states) => states.contains(WidgetState.selected)
            ? colors.accent
            : colors.muted,
      ),
    ),
    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      shape: control,
      contentTextStyle: AppType.secondary.copyWith(color: colors.onInk),
    ),
    popupMenuTheme: PopupMenuThemeData(
      color: colors.surface,
      textStyle: AppType.body.copyWith(color: colors.ink),
      shape: control,
    ),
    // A pull-down menu: rounded, softly shadowed, with items at least a tap
    // target high, unlike Material's dropdown.
    menuTheme: MenuThemeData(
      style: MenuStyle(
        backgroundColor: WidgetStatePropertyAll(colors.raised),
        surfaceTintColor: const WidgetStatePropertyAll(Colors.transparent),
        shadowColor: WidgetStatePropertyAll(colors.shadow),
        elevation: const WidgetStatePropertyAll(AppSize.menuElevation),
        padding: const WidgetStatePropertyAll(EdgeInsets.zero),
        shape: const WidgetStatePropertyAll(
          RoundedRectangleBorder(
            borderRadius: BorderRadius.all(Radius.circular(AppRadius.menu)),
          ),
        ),
      ),
    ),
    menuButtonTheme: MenuButtonThemeData(
      style: ButtonStyle(
        foregroundColor: WidgetStatePropertyAll(colors.ink),
        iconColor: WidgetStatePropertyAll(colors.ink),
        textStyle: WidgetStatePropertyAll(AppType.body),
        minimumSize: const WidgetStatePropertyAll(Size(0, AppSize.tapTarget)),
        padding: const WidgetStatePropertyAll(
          EdgeInsets.symmetric(horizontal: AppSpace.s16),
        ),
      ),
    ),
  );
}

/// A field's rounded border in [color], [width] pixels wide.
OutlineInputBorder _fieldBorder(Color color, double width) =>
    OutlineInputBorder(
      borderRadius: BorderRadius.circular(AppRadius.field),
      borderSide: BorderSide(color: color, width: width),
    );
