import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';

/// How long an undo snack bar offers "되돌리기".
const undoDuration = Duration(seconds: 4);

/// Says [message], what was just deleted, in a snack bar with "되돌리기",
/// which calls [onUndo] (`design.md` §Principles 5). The bar replaces the one
/// showing, and goes after [undoDuration]; [onGone] is called once it has
/// gone without an undo, so what was kept for one can be let go.
void showUndoSnackBar(
  BuildContext context, {
  required String message,
  required VoidCallback onUndo,
  VoidCallback? onGone,
}) {
  final messenger = ScaffoldMessenger.of(context)..hideCurrentSnackBar();
  final bar = messenger.showSnackBar(
    SnackBar(
      content: Text(message),
      duration: undoDuration,
      // A bar with an action stays until dismissed unless told otherwise.
      persist: false,
      action: SnackBarAction(
        label: AppLocalizations.of(context).undo,
        onPressed: onUndo,
      ),
    ),
  );
  if (onGone != null) {
    bar.closed.then((reason) {
      if (reason != SnackBarClosedReason.action) onGone();
    });
  }
}
