import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../deck/deck.dart' show DeckFailure, describeFailure;
import '../../design/app_button.dart';
import '../../design/app_list_row.dart';
import '../../design/bottom_actions.dart';
import '../../design/app_sheet.dart';
import '../../design/theme.dart';
import '../../design/word_break.dart';
import '../../l10n/app_localizations.dart';
import 'daily_minutes.dart';
import 'failure.dart';
import 'failure_message.dart';
import 'providers.dart';
import 'queue.dart';

/// Opens the screen that sets the daily study minutes, over the current one,
/// with a back button. Resolves to the minutes saved, or null when none were.
Future<int?> openDailyMinutesScreen(BuildContext context) => Navigator.of(
  context,
).push(MaterialPageRoute<int>(builder: (_) => const DailyMinutesPicker()));

/// Shows the first-run step once on this device, while no daily study
/// minutes are stored from any device, and stores that it has shown; null,
/// with nothing to wait on, where it has shown before.
Future<void>? askDailyMinutesOnce(BuildContext context) {
  final providers = ProviderScope.containerOf(context, listen: false);
  final storage = providers.read(studyStorageProvider);
  if (storage.getBool(dailyMinutesAskedKey) == true) return null;
  // Stored before the read, so a second caller meanwhile does not ask again.
  unawaited(storage.setBool(dailyMinutesAskedKey, true));
  return () async {
    final int? stored;
    try {
      stored = await providers.read(studyRepositoryProvider).dailyMinutes();
    } on StudyFailure {
      return;
    }
    if (stored != null || !context.mounted) return;
    await showAppSheet<int>(
      context,
      builder: (_) => const DailyMinutesPicker(first: true),
    );
  }();
}

/// Asks for the daily study minutes once ([askDailyMinutesOnce]) the first
/// time it is visible with its route on top: the 오늘 tab's first-run step
/// once a deck has cards, which waits while another tab is selected or a
/// screen is open over the tab.
class FirstDailyMinutes extends StatefulWidget {
  const FirstDailyMinutes({super.key});

  @override
  State<FirstDailyMinutes> createState() => _FirstDailyMinutesState();
}

class _FirstDailyMinutesState extends State<FirstDailyMinutes> {
  var _asked = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // A tab kept behind the selected one is not visible.
    if (_asked ||
        !Visibility.of(context) ||
        !(ModalRoute.isCurrentOf(context) ?? true)) {
      return;
    }
    _asked = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) unawaited(askDailyMinutesOnce(context));
    });
  }

  @override
  Widget build(BuildContext context) => const SizedBox.shrink();
}

/// The daily study minutes as a row, "하루 공부 시간" with the minutes, which
/// opens the screen that changes them and shows those saved: the account
/// screen's setting, the one place they are changed after the first-run step.
class DailyMinutesRow extends ConsumerStatefulWidget {
  const DailyMinutesRow({super.key});

  @override
  ConsumerState<DailyMinutesRow> createState() => _DailyMinutesRowState();
}

class _DailyMinutesRowState extends ConsumerState<DailyMinutesRow> {
  late Future<int?> _minutes = ref.read(studyRepositoryProvider).dailyMinutes();

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return FutureBuilder(
      future: _minutes,
      builder: (context, read) => AppListRow(
        title: l10n.dailyMinutesTitle,
        trailing: Row(
          mainAxisSize: MainAxisSize.min,
          spacing: AppSpace.s4,
          children: [
            if (read.connectionState == ConnectionState.done && !read.hasError)
              Text(
                l10n.dailyMinutesChoice(read.data ?? defaultDailyMinutes),
                style: AppType.secondary.copyWith(
                  color: AppColors.of(context).ink2,
                ),
              ),
            const Icon(LucideIcons.chevronRight),
          ],
        ),
        onTap: () async {
          final saved = await openDailyMinutesScreen(context);
          if (saved != null && mounted) {
            setState(() {
              _minutes = Future.value(saved);
            });
          }
        },
      ),
    );
  }
}

/// The picker that sets the daily study minutes: the minutes as one large
/// number between − and +, typed on the keypad when the number is tapped, two
/// tiles of what they mean for the new cards, and "저장". With [first] it is
/// the first-run step, a sheet titled as a question whose "건너뛰기" keeps the
/// minutes as they are; otherwise a screen with a back button.
class DailyMinutesPicker extends ConsumerStatefulWidget {
  const DailyMinutesPicker({super.key, this.first = false});

  /// Whether the picker is the first-run step.
  final bool first;

  @override
  ConsumerState<DailyMinutesPicker> createState() => _DailyMinutesPickerState();
}

class _DailyMinutesPickerState extends ConsumerState<DailyMinutesPicker> {
  late final Future<MinutesPlan> _plan = readMinutesPlan(ref);

  /// The minutes chosen; null until they differ from the stored ones.
  int? _chosen;

  /// The minutes as typed while the number is edited; null otherwise.
  String? _typed;
  final _input = TextEditingController();
  final _inputFocus = FocusNode();
  final _less = FocusNode();
  final _more = FocusNode();
  var _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    // Leaving the field commits it, as Done does.
    _inputFocus.addListener(() {
      if (!_inputFocus.hasFocus && _typed != null) _commit();
    });
  }

  @override
  void dispose() {
    _input.dispose();
    _inputFocus.dispose();
    _less.dispose();
    _more.dispose();
    super.dispose();
  }

  /// The whole number [_typed] holds within the bounds, or null.
  int? get _typedMinutes => switch (int.tryParse(_typed ?? '')) {
    final value? when value >= minDailyMinutes && value <= maxDailyMinutes =>
      value,
    _ => null,
  };

  /// Whether a number is typed that cannot be saved.
  bool get _outOfRange => switch (_typed) {
    final typed? when typed.isNotEmpty => _typedMinutes == null,
    _ => false,
  };

  /// The minutes the tiles show and "저장" saves: those typed, while they are
  /// within the bounds, or those chosen.
  int? _minutes(MinutesPlan? plan) => _typedMinutes ?? _chosen ?? plan?.current;

  void _edit(int minutes) {
    _input.text = '$minutes';
    _input.selection = TextSelection(
      baseOffset: 0,
      extentOffset: _input.text.length,
    );
    setState(() => _typed = _input.text);
    _inputFocus.requestFocus();
  }

  /// Ends the edit: an empty field keeps the minutes as they were, a number
  /// within the bounds becomes them, and one outside keeps the field open.
  void _commit() {
    if (_outOfRange) return;
    setState(() {
      _chosen = _typedMinutes ?? _chosen;
      _typed = null;
    });
  }

  /// Moves the minutes by [delta] within the bounds; when that disables the
  /// step pressed, the focus moves to the other, so it is never disabled under
  /// the user.
  void _step(int from, int delta) {
    final next = (from + delta).clamp(minDailyMinutes, maxDailyMinutes);
    final pressed = delta < 0 ? _less : _more;
    final other = delta < 0 ? _more : _less;
    final atBound = next == minDailyMinutes || next == maxDailyMinutes;
    setState(() {
      _chosen = next;
      _typed = null;
    });
    if (atBound && pressed.hasFocus) other.requestFocus();
  }

  Future<void> _save(int minutes) async {
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await ref
          .read(studyRepositoryProvider)
          .setDailyMinutes(minutes, at: ref.read(studyClockProvider)());
      if (mounted) Navigator.of(context).pop(minutes);
    } on StudyFailure catch (failure) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _error = describeStudyFailure(AppLocalizations.of(context), failure);
      });
    }
  }

  /// The sheet's content: why the plan could not be read, its place while it
  /// is read, or the picker.
  Widget _content(
    BuildContext context,
    AsyncSnapshot<MinutesPlan> read,
    MinutesPlan? plan,
    int? minutes,
  ) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    if (read case AsyncSnapshot(hasError: true, :final error?)) {
      return Text(switch (error) {
        DeckFailure() => describeFailure(l10n, error),
        StudyFailure() => describeStudyFailure(l10n, error),
        _ => Error.throwWithStackTrace(
          error,
          read.stackTrace ?? StackTrace.empty,
        ),
      }, style: AppType.secondary.copyWith(color: colors.dontKnowText));
    }
    if (plan == null || minutes == null) {
      // The picker's height, so the sheet does not jump.
      return const SizedBox(height: AppSize.cta + AppSize.cta + AppSpace.s40);
    }
    final shown = _chosen ?? plan.current;
    final error = _error;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      spacing: AppSpace.s12,
      children: [
        Row(
          children: [
            _Step(
              focusNode: _less,
              icon: LucideIcons.minus,
              tooltip: l10n.dailyMinutesLess,
              onPressed: minutes > minDailyMinutes
                  ? () => _step(minutes, -dailyMinuteStep)
                  : null,
            ),
            Expanded(
              child: _typed == null
                  ? _Number(minutes: shown, onTap: () => _edit(shown))
                  : _NumberInput(
                      controller: _input,
                      focusNode: _inputFocus,
                      outOfRange: _outOfRange,
                      onChanged: (text) => setState(() => _typed = text),
                      onSubmitted: (_) => _commit(),
                    ),
            ),
            _Step(
              focusNode: _more,
              icon: LucideIcons.plus,
              tooltip: l10n.dailyMinutesMore,
              onPressed: minutes < maxDailyMinutes
                  ? () => _step(minutes, dailyMinuteStep)
                  : null,
            ),
          ],
        ),
        if (_outOfRange)
          Text(
            l10n.dailyMinutesOutOfRange,
            textAlign: TextAlign.center,
            style: AppType.caption.copyWith(color: colors.dontKnowText),
          ),
        _Tiles(plan: plan, minutes: minutes),
        if (error != null)
          Text(
            error,
            style: AppType.caption.copyWith(color: colors.dontKnowText),
          ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return FutureBuilder(
      future: _plan,
      builder: (context, read) {
        final plan = read.data;
        final minutes = _minutes(plan);
        final content = _content(context, read, plan, minutes);
        final save = AppButton(
          label: l10n.save,
          size: AppButtonSize.cta,
          loading: _saving,
          // A number outside the bounds is fixed before it is saved.
          onPressed: minutes == null || _outOfRange
              ? null
              : () => _save(minutes),
        );
        if (!widget.first) {
          return Scaffold(
            appBar: AppBar(title: Text(l10n.dailyMinutesTitle)),
            // A list, so the tiles scroll above the keypad.
            body: ListView(
              padding: const EdgeInsets.fromLTRB(
                AppSpace.gutter,
                AppSpace.s8,
                AppSpace.gutter,
                AppSpace.s24,
              ),
              children: [
                Text(
                  l10n.dailyMinutesBody,
                  style: AppType.secondary.copyWith(
                    color: AppColors.of(context).muted,
                  ),
                ),
                const SizedBox(height: AppSpace.s24),
                content,
              ],
            ),
            bottomNavigationBar: BottomActions(secondary: save),
          );
        }
        return AppSheet(
          title: l10n.dailyMinutesFirstTitle,
          body: l10n.dailyMinutesBody,
          content: content,
          actions: [
            AppButton(
              label: l10n.dailyMinutesSkip,
              variant: AppButtonVariant.text,
              onPressed: _saving ? null : () => Navigator.of(context).pop(),
            ),
            save,
          ],
        );
      },
    );
  }
}

/// The minutes as one large number with "분", read as a button that opens the
/// keypad.
class _Number extends StatelessWidget {
  const _Number({required this.minutes, required this.onTap});

  final int minutes;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    return Semantics(
      container: true,
      button: true,
      label: l10n.dailyMinutesNumberSemantics(minutes),
      excludeSemantics: true,
      child: Material(
        type: MaterialType.transparency,
        borderRadius: BorderRadius.circular(AppRadius.button),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: AppSize.cta),
            // At a large text size the number shrinks to fit between the steps.
            child: FittedBox(
              fit: BoxFit.scaleDown,
              child: Row(
                mainAxisSize: MainAxisSize.min,
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.baseline,
                textBaseline: TextBaseline.alphabetic,
                spacing: AppSpace.s4,
                children: [
                  Text('$minutes', style: AppType.figure),
                  Text(
                    l10n.dailyMinutesUnit,
                    style: AppType.headline.copyWith(color: colors.ink2),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// The minutes typed in place of the number, on the number keypad.
class _NumberInput extends StatelessWidget {
  const _NumberInput({
    required this.controller,
    required this.focusNode,
    required this.outOfRange,
    required this.onChanged,
    required this.onSubmitted,
  });

  final TextEditingController controller;
  final FocusNode focusNode;
  final bool outOfRange;
  final ValueChanged<String> onChanged;
  final ValueChanged<String> onSubmitted;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    final line = outOfRange ? colors.dontKnowText : colors.ink;
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      crossAxisAlignment: CrossAxisAlignment.baseline,
      textBaseline: TextBaseline.alphabetic,
      spacing: AppSpace.s4,
      children: [
        // Wide enough for three figures, so "분" stays beside the number,
        // and narrower where a large text size leaves less room.
        Flexible(
          child: SizedBox(
            width: AppSize.cta + AppSize.cta,
            child: Semantics(
              label: l10n.dailyMinutesInput,
              child: TextField(
                controller: controller,
                focusNode: focusNode,
                autofocus: true,
                keyboardType: TextInputType.number,
                textInputAction: TextInputAction.done,
                inputFormatters: [
                  FilteringTextInputFormatter.digitsOnly,
                  LengthLimitingTextInputFormatter(3),
                ],
                textAlign: TextAlign.center,
                style: AppType.figure.copyWith(color: line),
                decoration: InputDecoration(
                  isDense: true,
                  filled: false,
                  enabledBorder: UnderlineInputBorder(
                    borderSide: BorderSide(color: line),
                  ),
                  focusedBorder: UnderlineInputBorder(
                    borderSide: BorderSide(color: line),
                  ),
                ),
                onChanged: onChanged,
                onSubmitted: onSubmitted,
              ),
            ),
          ),
        ),
        Text(
          l10n.dailyMinutesUnit,
          style: AppType.headline.copyWith(color: colors.ink2),
        ),
      ],
    );
  }
}

/// A step of the minutes, an outlined icon button.
class _Step extends StatelessWidget {
  const _Step({
    required this.focusNode,
    required this.icon,
    required this.tooltip,
    required this.onPressed,
  });

  final FocusNode focusNode;
  final IconData icon;
  final String tooltip;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) => IconButton(
    focusNode: focusNode,
    tooltip: tooltip,
    onPressed: onPressed,
    icon: Icon(icon),
    style: IconButton.styleFrom(
      minimumSize: const Size.square(AppSize.button),
      side: BorderSide(color: AppColors.of(context).outline),
    ),
  );
}

/// What [minutes] a day means, in two tiles on the brand tint: today's new
/// cards, and in how many days the last unstarted card starts; in a backlog,
/// that new cards wait. A screen reader hears them again whenever they change.
class _Tiles extends StatelessWidget {
  const _Tiles({required this.plan, required this.minutes});

  final MinutesPlan plan;
  final int minutes;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final (:fresh, :after) = plan.at(minutes);
    Widget tile(String title, String value) => Expanded(
      child: _Tile(title: title, value: value),
    );
    return Semantics(
      container: true,
      liveRegion: true,
      child: plan.backlog
          ? _Tile(title: null, value: l10n.backlogPaused)
          : IntrinsicHeight(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                spacing: AppSpace.s8,
                children: [
                  tile(
                    l10n.dailyMinutesFreshTitle,
                    l10n.dailyMinutesFreshValue(fresh),
                  ),
                  tile(l10n.dailyMinutesAllTitle, switch (after) {
                    _ when plan.unstarted == 0 => l10n.dailyMinutesAllStarted,
                    null => l10n.dailyMinutesNoTime,
                    0 => l10n.dailyMinutesAfterToday,
                    final days => l10n.dailyMinutesAfterDays(days),
                  }),
                ],
              ),
            ),
    );
  }
}

/// A tile on the brand tint: an optional [title] over its [value].
class _Tile extends StatelessWidget {
  const _Tile({required this.title, required this.value});

  final String? title;
  final String value;

  @override
  Widget build(BuildContext context) {
    final colors = AppColors.of(context);
    final title = this.title;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: colors.brandTint,
        borderRadius: BorderRadius.circular(AppRadius.row),
      ),
      child: Padding(
        padding: const EdgeInsets.all(AppSpace.s16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          spacing: AppSpace.s4,
          children: [
            if (title != null)
              Text(title, style: AppType.caption.copyWith(color: colors.ink2)),
            Text(
              keepWords(value),
              semanticsLabel: value,
              style: AppType.bodyStrong,
            ),
          ],
        ),
      ),
    );
  }
}
