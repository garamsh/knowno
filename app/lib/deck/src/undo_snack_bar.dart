import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';

import '../../l10n/app_localizations.dart';

/// How long an undo snack bar offers "되돌리기".
const undoDuration = Duration(seconds: 4);

/// Says [message], what was just deleted, in a snack bar with "되돌리기",
/// which calls [onUndo] (`design.md` §Principles 5). The bar replaces the one
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
  final messenger = ScaffoldMessenger.of(context)..hideCurrentSnackBar();
  final bar = messenger.showSnackBar(
    SnackBar(
      content: _UndoMessage(message: message, endOn: endOn),
      // [_UndoMessage] times the bar, so the messenger never does.
      persist: true,
      action: SnackBarAction(
        label: AppLocalizations.of(context).undo,
        onPressed: () {
          undone = true;
          onUndo();
        },
      ),
    ),
  );
  if (onGone != null) {
    bar.closed.then((_) {
      if (!undone) onGone();
    });
  }
}

/// An undo bar's message, which hides its bar after [undoDuration] unheld,
/// or as soon as [endOn] notifies.
class _UndoMessage extends StatefulWidget {
  const _UndoMessage({required this.message, required this.endOn});

  final String message;
  final Listenable? endOn;

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
    context.visitAncestorElements((element) {
      if (element.widget is! SnackBar) return true;
      _bar = element;
      return false;
    });
    _messenger = ScaffoldMessenger.maybeOf(context);
    _hold();
  }

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
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Text(widget.message);
}
