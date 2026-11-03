import 'dart:async';

import 'package:flutter/material.dart' hide Card;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../deck/deck.dart';
import 'daily_minutes_sheet.dart';
import 'study_coach.dart';
import '../../design/app_chip.dart';
import '../../design/app_button.dart';
import '../../design/mascot.dart';
import '../../design/theme.dart';
import '../../design/word_break.dart';
import '../../l10n/app_localizations.dart';
import 'autoplay.dart';
import 'completion_card.dart';
import 'current_card.dart';
import 'failure.dart';
import 'failure_message.dart';
import 'providers.dart';
import 'previous_card.dart';
import 'previous_placeholder.dart';
import 'rust/api/engine.dart';
import 'session.dart';
import 'stop_sound.dart';
import 'study_style.dart';

/// The study coach's steps: answering "Know", answering "Don't know", and
/// changing an answered card.
enum _CoachStep {
  know,
  dontKnow,
  redecide;

  /// The step after this one; null after the last.
  _CoachStep? get next => switch (this) {
    know => dontKnow,
    dontKnow => redecide,
    redecide => null,
  };

  /// The step before this one; the first is its own.
  _CoachStep get previous => switch (this) {
    know => know,
    dontKnow => know,
    redecide => dontKnow,
  };
}

/// How long the notice that a session goes on with the day stays.
const _resumeShown = Duration(seconds: 3);

/// Opens a session over [decks] in a [StudyScreen], after the first-run step
/// that asks for the daily study minutes while it has not shown
/// ([askDailyMinutesOnce]), so the session takes the minutes chosen.
Future<void> openStudy(BuildContext context, DeckSelection decks) async {
  if (askDailyMinutesOnce(context) case final ask?) {
    await ask;
    if (!context.mounted) return;
  }
  await Navigator.of(context)
      .push(MaterialPageRoute<void>(builder: (_) => StudyScreen(decks: decks)));
}

/// Studies the cards of [decks] left today in one session, one card at a time,
/// answered by swiping, below the card answered just before it; then shows the
/// completion card, from which the new cards past today's go on in the same
/// session.
///
/// On a device's first session, a coach teaches the swipes on the cards, and
/// "안내 다시 보기" shows it again. A session that goes on with a day that has
/// cards done says so for a moment in the progress bar's place.
class StudyScreen extends ConsumerStatefulWidget {
  const StudyScreen({super.key, required this.decks});

  final DeckSelection decks;

  @override
  ConsumerState<StudyScreen> createState() => _StudyScreenState();
}

class _StudyScreenState extends ConsumerState<StudyScreen>
    with SingleTickerProviderStateMixin {
  late final StudySession _session;

  /// The coach's step; null while it does not show.
  _CoachStep? _coach;

  /// Drives the coach's demonstration, one cycle after another.
  late final _demo = AnimationController(vsync: this, duration: coachCycle);

  /// Whether the session has been studied on screen, after which the coach
  /// is no longer started on its own.
  var _studied = false;

  /// Whether the session has loaded, after which the notice is not offered
  /// again.
  var _loaded = false;

  /// The notice that the session goes on with the day, while it shows.
  String? _resume;
  Timer? _resumeTimer;
  late final AppLifecycleListener _lifecycle;
  late ScaffoldMessengerState _messenger;
  late AppLocalizations _l10n;

  @override
  void initState() {
    super.initState();
    final clock = ref.read(studyClockProvider);
    _session = StudySession(
      decks: widget.decks,
      cards: ref.read(deckRepositoryProvider),
      repository: ref.read(studyRepositoryProvider),
      scheduler: ref.read(schedulerProvider),
      clock: clock,
      random: ref.read(studyRandomProvider)(clock()),
      onFailure: _report,
      offsetAt: ref.read(studyZoneProvider),
    )..addListener(_onSession);
    // An answer counts only the time the app is resumed.
    _lifecycle = AppLifecycleListener(
      onStateChange: (state) {
        if (state == AppLifecycleState.resumed) {
          _session.resume();
        } else {
          // A sound does not play on in the background.
          stopSound(_providers);
          _session.pause();
        }
      },
    );
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // Kept for writes that fail after this screen has closed.
    _messenger = ScaffoldMessenger.of(context);
    _providers = ProviderScope.containerOf(context, listen: false);
    _l10n = AppLocalizations.of(context);
  }

  /// Whether each card's front sound plays as it appears, read once as the
  /// session opens.
  late final _autoplay = autoplaysAudio(ref.read(studyStorageProvider));

  /// The providers, kept to stop a sound still playing when the screen
  /// closes.
  late ProviderContainer _providers;

  @override
  void dispose() {
    stopSound(_providers);
    _resumeTimer?.cancel();
    _demo.dispose();
    _lifecycle.dispose();
    _session.dispose();
    super.dispose();
  }

  /// Once the session has loaded, says for a moment that it goes on with the
  /// day where it does; the first time a card is on screen, starts the coach
  /// unless it has shown on this device, and stores it as shown.
  void _onSession() {
    final state = _session.state;
    if (!_loaded && state is! SessionLoading) {
      _loaded = true;
      final size = _session.size;
      if (size.resumed && size.cards > 0) {
        _resume = _l10n.resumeToast(size.cards, size.minutes);
        _resumeTimer = Timer(_resumeShown, () {
          if (mounted) setState(() => _resume = null);
        });
      }
    }
    if (!_studied && state is SessionStudying) {
      _studied = true;
      final storage = ref.read(studyStorageProvider);
      if (storage.getBool(studyCoachShownKey) != true) {
        unawaited(storage.setBool(studyCoachShownKey, true));
        _startCoach();
      }
    }
  }

  /// Starts the coach at its first step; its demonstration moves unless
  /// reduce motion is on, where each step holds still.
  void _startCoach() {
    _coach = _CoachStep.know;
    if (!MediaQuery.disableAnimationsOf(context) && !_demo.isAnimating) {
      _demo.repeat();
    }
  }

  void _setCoach(_CoachStep? step) {
    if (step == null && _coach == null) return;
    setState(() => step == null ? _endCoach() : _coach = step);
  }

  void _endCoach() {
    _coach = null;
    _demo.reset();
  }

  void _answer(Answer answer) {
    _setCoach(null);
    _session.answer(answer);
  }

  void _report(StudyFailure failure) => _messenger.showSnackBar(
    SnackBar(content: Text(describeStudyFailure(_l10n, failure))),
  );

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: _session,
      builder: (context, _) {
        final state = _session.state;
        return Scaffold(
          body: SafeArea(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _TopBar(
                  progress: switch (state) {
                    SessionStudying(:final progress) ||
                    SessionComplete(:final progress) => progress,
                    _ => null,
                  },
                  notice: _resume,
                  onClose: () => Navigator.of(context).maybePop(),
                ),
                Expanded(child: _body(context, state)),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _body(BuildContext context, SessionState state) {
    final l10n = AppLocalizations.of(context);
    final (previous, current) = switch (state) {
      SessionLoading() => (
        null,
        const Center(child: CircularProgressIndicator()),
      ),
      CardsUnreadable(:final failure) => (
        null,
        Center(child: Text(describeFailure(l10n, failure))),
      ),
      StatesUnreadable(:final failure) => (
        null,
        Center(child: Text(describeStudyFailure(l10n, failure))),
      ),
      SessionStudying(:final current, :final previous) => (
        previous,
        AnimatedBuilder(
          // A new key for each card shown, a re-shown card included.
          key: ValueKey(('card', previous.length)),
          animation: _demo,
          builder: (context, _) => CurrentCard(
            card: current,
            autoplay: _autoplay,
            onAnswer: _answer,
            onGuide: () => setState(_startCoach),
            onDragStart: () => _setCoach(null),
            demo: switch (_coach) {
              _CoachStep.know => Answer.know,
              _CoachStep.dontKnow => Answer.dontKnow,
              _ => null,
            },
            demoProgress: _demoProgress(context),
            coach: _coachCaption(),
          ),
        ),
      ),
      SessionEmpty() => (
        null,
        Center(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppSpace.s20),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              spacing: AppSpace.s16,
              children: [
                const Center(
                  child: Mascot(
                    expression: MascotExpression.sleepy,
                    size: AppSize.mascotMedium,
                  ),
                ),
                Text(
                  l10n.nothingToStudyToday,
                  textAlign: TextAlign.center,
                  style: AppType.body.copyWith(
                    color: AppColors.of(context).muted,
                  ),
                ),
                const SizedBox(height: AppSpace.s4),
                AppButton(
                  label: l10n.close,
                  size: AppButtonSize.cta,
                  onPressed: () => Navigator.of(context).maybePop(),
                ),
              ],
            ),
          ),
        ),
      ),
      SessionComplete(:final completion, :final previous, :final more) => (
        previous,
        CompletionCard(
          key: const ValueKey('completion'),
          completion: completion,
          onStudyOn: more ? _session.studyOn : null,
        ),
      ),
    };
    if (previous == null) return current;
    final reduceMotion = MediaQuery.disableAnimationsOf(context);
    Widget switcher(
      Widget? child,
      AnimatedSwitcherTransitionBuilder transition,
    ) => AnimatedSwitcher(
      duration: reduceMotion
          ? StudyStyle.fadeDuration
          : StudyStyle.settleDuration,
      switchInCurve: Curves.easeOutCubic,
      transitionBuilder: reduceMotion
          ? AnimatedSwitcher.defaultTransitionBuilder
          : transition,
      layoutBuilder: (current, previous) =>
          Stack(fit: StackFit.expand, children: [...previous, ?current]),
      child: child,
    );
    final newest = previous.lastOrNull;
    final earlier = switch (state) {
      SessionStudying(:final earlier) ||
      SessionComplete(:final earlier) => earlier,
      _ => null,
    };
    // The previous card's place holds the coach's sample in its last step;
    // otherwise the card answered last in the session, or the day's last card
    // from an earlier session, or, while studying, the empty place's outline.
    final Widget? above = switch (state) {
      SessionStudying() when _coach == _CoachStep.redecide => AnimatedBuilder(
        key: const ValueKey('coach'),
        animation: _demo,
        builder: (context, _) => PreviousCardDemo(
          front: [TextContent(l10n.studyCoachSampleFront)],
          back: [TextContent(l10n.studyCoachSampleBack)],
          progress: _demoProgress(context),
        ),
      ),
      _ when newest != null => PreviousCardView(
        // A new key for each answer, so the card answered just now rises in
        // and a change of its answer leaves it in place.
        key: ValueKey(newest.position),
        card: newest,
        onRedecide: (answer) => _session.redecide(newest.position, answer),
      ),
      _ when earlier != null => EarlierCardView(
        key: const ValueKey('earlier'),
        earlier: earlier,
      ),
      SessionStudying() => const PreviousPlaceholder(
        key: ValueKey('placeholder'),
      ),
      _ => null,
    };
    // While the coach shows the current card's answers, what is above it
    // steps back.
    final dimmed = _coach == _CoachStep.know || _coach == _CoachStep.dontKnow;
    return LayoutBuilder(
      builder: (context, constraints) {
        // The completion card's place counts as a card's, so the previous
        // card keeps its size when the completion card arrives.
        final card = StudyStyle.cardHeight(constraints.maxHeight);
        return Padding(
          padding: const EdgeInsets.fromLTRB(
            StudyStyle.cardMargin,
            StudyStyle.topGap,
            StudyStyle.cardMargin,
            StudyStyle.currentBottomGap,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              SizedBox(
                height: card,
                child: AnimatedOpacity(
                  opacity: dimmed ? StudyStyle.coachDim : 1,
                  duration: StudyStyle.fadeDuration,
                  child: switcher(above, _rise),
                ),
              ),
              const SizedBox(height: StudyStyle.cardGap),
              // The completion card may take the guide's row's place too,
              // so its actions stay in reach.
              Expanded(child: switcher(current, _emerge)),
            ],
          ),
        );
      },
    );
  }

  /// The coach's progress through its cycle: held where the card is out under
  /// reduce motion, so each step is a still image.
  double _demoProgress(BuildContext context) =>
      MediaQuery.disableAnimationsOf(context)
      ? StudyStyle.coachStill
      : _demo.value;

  /// The coach's caption in the guide's row's place while it shows.
  Widget? _coachCaption() {
    final step = _coach;
    if (step == null) return null;
    return StudyCoach(
      line: keepWords(switch (step) {
        _CoachStep.know => _l10n.studyCoachKnow,
        _CoachStep.dontKnow => _l10n.studyCoachDontKnow,
        _CoachStep.redecide => _l10n.studyCoachRedecide,
      }),
      step: step.index,
      steps: _CoachStep.values.length,
      onPrevious: () => _setCoach(step.previous),
      onNext: () => _setCoach(step.next),
    );
  }
}

/// Rises the card answered just now into the previous card's place.
Widget _rise(Widget child, Animation<double> animation) => AnimatedBuilder(
  animation: animation,
  builder: (context, child) => Transform.translate(
    offset: Offset(0, StudyStyle.emergeOffset * (1 - animation.value)),
    child: FadeTransition(opacity: animation, child: child),
  ),
  child: child,
);

/// Brings the next card up from slightly below and smaller.
Widget _emerge(Widget child, Animation<double> animation) => AnimatedBuilder(
  animation: animation,
  builder: (context, child) => Transform.translate(
    offset: Offset(0, StudyStyle.emergeOffset * (1 - animation.value)),
    child: Transform.scale(
      scale:
          StudyStyle.emergeScale +
          (1 - StudyStyle.emergeScale) * animation.value,
      child: FadeTransition(opacity: animation, child: child),
    ),
  ),
  child: child,
);

/// The close button, the progress bar, or in its place the [notice] while
/// it shows, and the count of cards answered.
class _TopBar extends StatelessWidget {
  const _TopBar({
    required this.progress,
    required this.notice,
    required this.onClose,
  });

  final SessionProgress? progress;
  final String? notice;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    final progress = this.progress;
    return Material(
      color: colors.ground,
      child: SizedBox(
        height: StudyStyle.topBarHeight,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: AppSpace.s8),
          child: Row(
            spacing: AppSpace.s12,
            children: [
              IconButton(
                tooltip: l10n.close,
                icon: const Icon(LucideIcons.x),
                onPressed: onClose,
              ),
              Expanded(
                child: _ResumeNotice(
                  text: notice,
                  otherwise: progress == null
                      ? const SizedBox.shrink()
                      : LinearProgressIndicator(
                          value: progress.total == 0
                              ? 1
                              : progress.done / progress.total,
                          minHeight: StudyStyle.progressHeight,
                          color: colors.accent,
                          backgroundColor: colors.edge,
                          borderRadius: BorderRadius.circular(
                            StudyStyle.progressHeight,
                          ),
                          semanticsLabel: l10n.studyProgressSemantics(
                            progress.done,
                            progress.total,
                          ),
                        ),
                ),
              ),
              if (progress != null) ...[
                Padding(
                  padding: const EdgeInsets.only(right: AppSpace.s12),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    spacing: AppSpace.s8,
                    children: [
                      ExcludeSemantics(
                        child: Text(
                          l10n.studyProgress(progress.done, progress.total),
                          style: AppType.secondary.copyWith(
                            color: colors.ink,
                            fontWeight: FontWeight.w700,
                            fontFeatures: const [FontFeature.tabularFigures()],
                          ),
                        ),
                      ),
                      // Cards past the day's plan are counted apart, so the
                      // day's bar never shrinks as they are taken.
                      if (progress.extra > 0)
                        Semantics(
                          label: l10n.studyExtraSemantics(progress.extra),
                          excludeSemantics: true,
                          child: AppChip(
                            label: l10n.studyExtra(progress.extra),
                            tone: AppChipTone.brand,
                          ),
                        ),
                    ],
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// The notice that the session goes on with the day, [text], on the hero
/// surface in the top bar's row while it is not null, clear of the cards and
/// announced to a screen reader as it appears; [otherwise], the progress bar,
/// in its place. It slides in and out, or fades under reduce motion.
class _ResumeNotice extends StatelessWidget {
  const _ResumeNotice({required this.text, required this.otherwise});

  final String? text;
  final Widget otherwise;

  @override
  Widget build(BuildContext context) {
    final colors = AppColors.of(context);
    final reduceMotion = MediaQuery.disableAnimationsOf(context);
    final text = this.text;
    return AnimatedSwitcher(
      duration: StudyStyle.settleDuration,
      switchInCurve: Curves.easeOutCubic,
      transitionBuilder: (child, animation) => FadeTransition(
        opacity: animation,
        child: reduceMotion
            ? child
            : SlideTransition(
                position: Tween(
                  begin: const Offset(0, -0.3),
                  end: Offset.zero,
                ).animate(animation),
                child: child,
              ),
      ),
      child: text == null
          ? KeyedSubtree(key: const ValueKey('progress'), child: otherwise)
          : FittedBox(
              key: ValueKey(text),
              // One line in the bar's place, however large the text.
              fit: BoxFit.scaleDown,
              child: Semantics(
                container: true,
                liveRegion: true,
                child: DecoratedBox(
                  decoration: ShapeDecoration(
                    color: colors.hero,
                    shape: const StadiumBorder(),
                    shadows: StudyStyle.currentShadow(colors),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: AppSpace.s16,
                      vertical: AppSpace.s8,
                    ),
                    child: Text(
                      text,
                      textAlign: TextAlign.center,
                      style: AppType.secondary.copyWith(color: colors.onHero),
                    ),
                  ),
                ),
              ),
            ),
    );
  }
}
