import 'dart:async';

import 'package:flutter/foundation.dart';

import 'study_repository.dart';

/// Calls [onChange] once the cards, their states and the reviews have stopped
/// changing for [quiet], so a sync applying a page of rows after another
/// asks for one read and not one a row. [cancel] ends it, and a call it has
/// scheduled.
class StudyChanges {
  StudyChanges(
    this._repository,
    this._onChange, {
    this.quiet = const Duration(milliseconds: 300),
  });

  final StudyRepository _repository;
  final VoidCallback _onChange;
  final Duration quiet;

  StreamSubscription<void>? _subscription;
  Timer? _timer;

  void start() {
    _subscription ??= _repository.changes.listen((_) {
      _timer?.cancel();
      _timer = Timer(quiet, _onChange);
    });
  }

  void cancel() {
    _timer?.cancel();
    unawaited(_subscription?.cancel());
    _subscription = null;
  }
}
