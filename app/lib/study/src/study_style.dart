import 'package:flutter/material.dart';

import '../../design/theme.dart';

/// The sizes and timings of the study screen, in one place; its colours are
/// the app theme's [AppColors].
abstract final class StudyStyle {
  /// Space between the current card and the screen's left and right edges.
  static const cardMargin = AppSpace.gutter;
  static const cardRadius = AppRadius.card;
  static const previousRadius = AppRadius.previous;
  static const cardPadding = AppSpace.s16;

  /// The completion panel's least height.
  static const completionMinHeight = 200.0;

  /// Space above the previous card.
  static const topGap = AppSpace.s20;

  /// Space between the previous card and the current card.
  static const cardGap = AppSpace.s16;

  /// The space kept below the guide's row, or below the completion card.
  static const currentBottomGap = AppSpace.s16;

  /// Space between the current card and the guide's row under it.
  static const guideGap = AppSpace.s20;

  /// The guide's row under the current card, with the space above it: its
  /// one button's tap target is padded to Material's least interactive size.
  static const guideRow = guideGap + kMinInteractiveDimension;

  /// A previous card's line around it, in its grade's colour (ADR 0151).
  static const previousLine = 3.0;

  /// A previous card's front, over its back: user text, so Pretendard.
  static const previousFront = AppType.deckName;
  static const previousBack = AppType.cardBody;

  static const topBarHeight = 56.0;
  static const progressHeight = AppSize.progress;

  /// The width of the empty previous card's place's dashed outline.
  static const placeholderOutline = 1.5;

  /// The length of each dash of that outline, and of each gap.
  static const placeholderDash = 6.0;

  /// The drag after which the answer chip and tint appear.
  static const dragFeedbackDistance = 40.0;

  /// The drag past which a release commits the answer.
  static const commitDistance = 100.0;

  /// The release speed, in logical pixels per second, that commits an answer
  /// in its direction whatever the distance.
  static const commitVelocity = 700.0;

  /// The card's tilt, in radians, per logical pixel of drag.
  static const tiltPerPixel = 0.0006;

  /// How far a previous card follows a drag toward the answer it already has.
  static const sameAnswerResistance = 0.25;

  static const flyDuration = Duration(milliseconds: 200);
  static const settleDuration = Duration(milliseconds: 300);
  static const springBackDuration = Duration(milliseconds: 250);

  /// The cross-fade that replaces every motion under reduce motion.
  static const fadeDuration = Duration(milliseconds: 150);

  /// How far below its place, and how much smaller, the next card starts.
  static const emergeOffset = 40.0;
  static const emergeScale = 0.92;

  /// The tint over a dragged card at full drag.
  static const tintOpacity = 0.12;

  /// How far the coach drags the current card to show an answer.
  static const coachCurrentPeek = 96.0;

  /// How far the coach drags the sample previous card to show a change: far
  /// enough that the change's name shows whole behind it.
  static const coachPreviousPeek = 140.0;

  /// How far the coach's touch sits in from the card's side it pushes from.
  static const coachTouchInset = 70.0;

  /// How far above the sample previous card's bottom the coach's touch sits,
  /// below its sides.
  static const coachTouchLift = 32.0;

  /// How far below the current card's centre the coach's touch rests.
  static const coachTouchDrop = 56.0;

  /// The opacity of what is above the current card while the coach shows its
  /// answers.
  static const coachDim = 0.45;

  /// The coach's touch: a ring this wide, its line, its centre dot, the edge
  /// under it, and its dashed trail's thickness, dashes and gaps.
  static const coachTouch = 40.0;
  static const coachTouchLine = 4.0;
  static const coachTouchDot = 12.0;
  static const coachTouchEdge = 4.0;
  static const coachTrail = 6.0;
  static const coachTrailDash = 10.0;
  static const coachTrailGap = 8.0;

  /// The coach's hand, this wide, and where on it its fingertip presses.
  static const coachHand = 70.0;
  static const coachHandTip = Offset(14, 16);

  /// The mascot that presents the coach, beside its bubble.
  static const coachMascot = 56.0;

  /// Half the bubble's tail toward the mascot, and the gap between them.
  static const coachTail = 9.0;

  /// How far below its place the coach's mascot and bubble rise in from.
  static const coachRise = 16.0;

  /// The opacity of the coach's "이전" on its first step, where it is off.
  static const coachPreviousDisabled = 0.35;

  /// Where in its cycle the coach holds under reduce motion: the card out.
  static const coachStill = 0.54;

  /// The current card's edge.
  static List<BoxShadow> currentShadow(AppColors colors) =>
      AppShadow.card(colors);
}
