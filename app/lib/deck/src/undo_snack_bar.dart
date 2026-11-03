import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';

import '../../design/theme.dart';
import '../../design/word_break.dart';
import '../../l10n/app_localizations.dart';

/// How long an undo snack bar offers "되돌리기".
const undoDuration = Duration(seconds: 4);

/// Says [message], what was just deleted, in a snack bar with "되돌리기",
/// which calls [onUndo] (`design/principles.md` §Correct, don't confirm). The bar replaces the one
/// showing, and goes after [undoDuration], counted while a screen reader is
/// off and the focus is not on the bar. It goes at once the first time
/// [endOn] notifies after it shows. [onGone] is called once it has gone
/// without an undo, so what was kept for one can be let go.
void showUndoSnackBar(
  BuildContext context, {
  required String message,
  required VoidCallback onUndo,
  VoidCallback? onGone,
  Listenable? endOn,
}) {
  var undone = false;
  final undo = SnackBarAction(
    label: AppLocalizations.of(context).undo,
    onPressed: () {
      undone = true;
      onUndo();
    },
  );
  final beside = _fitsBeside(context, message, undo.label);
  final messenger = ScaffoldMessenger.of(context)..hideCurrentSnackBar();
  final bar = messenger.showSnackBar(
    SnackBar(
      content: _UndoMessage(
        message: message,
        endOn: endOn,
        below: beside ? null : undo,
      ),
      // [_UndoMessage] times the bar, so the messenger never does.
      persist: true,
      action: beside ? undo : null,
    ),
  );
  if (onGone != null) {
    bar.closed.then((_) {
      if (!undone) onGone();
    });
  }
}

/// What a floating bar takes from the screen's width besides its message and
/// its action's label: Material's inset of 15 at each side, 16 before the
/// message, and 8 around the action and 16 inside it at each side.
const _barChrome = 2 * 15.0 + 16 + 2 * (8 + 16);

/// Whether [message] and the action [label] fit on one line of a bar at the
/// text size of [context]. Material measures the label at text scale 1.0, so
/// at a large text size it keeps the action beside a squeezed message.
bool _fitsBeside(BuildContext context, String message, String label) {
  final theme = Theme.of(context);
  double width(String text, TextStyle? style) {
    final painter = TextPainter(
      text: TextSpan(text: text, style: style),
      textScaler: MediaQuery.textScalerOf(context),
      textDirection: Directionality.of(context),
      maxLines: 1,
    )..layout();
    final width = painter.width;
    painter.dispose();
    return width;
  }

  return width(
            message,
            theme.snackBarTheme.contentTextStyle ?? theme.textTheme.bodyMedium,
          ) +
          width(label, theme.textTheme.labelLarge) +
          _barChrome <=
      MediaQuery.widthOf(context);
}

/// Keeps [height] at the height of the undo bar showing under its child,
/// margins included, and at 0 while none is, so a screen can leave the bar
/// room.
class UndoBarRoom extends InheritedWidget {
  const UndoBarRoom({super.key, required this.height, required super.child});

  final ValueNotifier<double> height;

  @override
  bool updateShouldNotify(UndoBarRoom oldWidget) => height != oldWidget.height;
}

/// An undo bar's message, with [below] under it where the bar's action does
/// not fit beside it, which hides its bar after [undoDuration] unheld, or as
/// soon as [endOn] notifies.
class _UndoMessage extends StatefulWidget {
  const _UndoMessage({
    required this.message,
    required this.endOn,
    required this.below,
  });

  final String message;
  final Listenable? endOn;
  final Widget? below;

  @override
  State<_UndoMessage> createState() => _UndoMessageState();
}

class _UndoMessageState extends State<_UndoMessage> {
  Timer? _timer;
  bool _held = false;
  bool _over = false;

  /// Whether a screen reader is on, read where the bar is drawn.
  bool _reader = false;

  /// The bar this message is drawn in, whose action may take the focus.
  Element? _bar;

  /// [_bar] inside its entry animation, its margins included.
  Element? _whole;

  /// Where the bar's height is kept, if a screen keeps it.
  ValueNotifier<double>? _room;

  /// The messenger showing [_bar], which hides it.
  ScaffoldMessengerState? _messenger;

  /// Whether [_bar]'s action has the focus.
  bool _focused = false;

  @override
  void initState() {
    super.initState();
    // Listened to from the bar's first build, so the delete's own change,
    // made before it, does not end it.
    widget.endOn?.addListener(_end);
    FocusManager.instance.addListener(_focusChanged);
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _reader = MediaQuery.accessibleNavigationOf(context);
    // Read so that a change of either measures the bar again.
    MediaQuery.textScalerOf(context);
    MediaQuery.sizeOf(context);
    _whole = null;
    context.visitAncestorElements((element) {
      if (element.widget is Dismissible) _whole ??= element;
      if (element.widget is! SnackBar) return true;
      _bar = element;
      return false;
    });
    _messenger = ScaffoldMessenger.maybeOf(context);
    _room = context.getInheritedWidgetOfExactType<UndoBarRoom>()?.height;
    _hold();
    _measure();
  }

  /// Keeps in [_room] the height the bar needs at its width once the frame
  /// is laid out: what it is given is cut to the room it shows in.
  void _measure() => SchedulerBinding.instance.addPostFrameCallback((_) {
    if (!mounted) return;
    if (_whole?.renderObject case final RenderBox box when box.hasSize) {
      _room?.value = box.getMaxIntrinsicHeight(box.size.width);
    }
  });

  /// Reads where the focus went, outside a frame, where no element it walks
  /// is being taken out of the tree.
  void _focusChanged() {
    void read() {
      if (!mounted) return;
      _focused = _focusedHere;
      _hold();
    }

    if (SchedulerBinding.instance.schedulerPhase == SchedulerPhase.idle) {
      read();
    } else {
      SchedulerBinding.instance.addPostFrameCallback((_) => read());
    }
  }

  /// Whether the focus is on this bar's action.
  bool get _focusedHere {
    var inside = false;
    FocusManager.instance.primaryFocus?.context?.visitAncestorElements(
      (element) => !(inside = identical(element, _bar)),
    );
    return inside;
  }

  /// Stops the count while a screen reader is on or the bar has the focus,
  /// and starts it again from the whole [undoDuration] once neither holds.
  void _hold() {
    final held = _reader || _focused;
    if (held == _held && (held || _timer != null)) return;
    _held = held;
    _timer?.cancel();
    _timer = held ? null : Timer(undoDuration, _end);
  }

  void _end() {
    if (_over) return;
    _over = true;
    _messenger?.hideCurrentSnackBar();
  }

  @override
  void dispose() {
    _timer?.cancel();
    widget.endOn?.removeListener(_end);
    FocusManager.instance.removeListener(_focusChanged);
    _room?.value = 0;
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final below = widget.below;
    final said = Text(
      keepWords(widget.message),
      semanticsLabel: widget.message,
    );
    return below == null
        ? said
        : Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              said,
              const SizedBox(height: AppSpace.s8),
              Align(alignment: AlignmentDirectional.centerEnd, child: below),
            ],
          );
  }
}
