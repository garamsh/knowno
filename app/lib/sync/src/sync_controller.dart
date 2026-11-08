import 'dart:async';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';

import '../../account/account.dart';
import '../../media/media.dart';
import 'failure.dart';
import 'status.dart';
import 'sync_store.dart';
import 'synchronizer.dart';

/// Decides when sync runs, keeps one run at a time, retries a failed run with
/// backoff, and reports the [status].
///
/// A run starts when an account signs in, at [start] and on each resume while
/// signed in, and [editDelay] after the last of a burst of local edits that
/// left a row unsynced; a study session's answers are such edits. Nothing
/// awaits a run but [push] and [clear].
class SyncController implements AccountData {
  SyncController({
    required this._account,
    required this._synchronizer,
    required this._store,
    required this._edits,
    required this._media,
    this.editDelay = const Duration(seconds: 3),
    this.firstRetry = const Duration(seconds: 5),
    this.maxRetry = const Duration(minutes: 5),
  });

  final AccountService _account;
  final Synchronizer _synchronizer;
  final SyncStore _store;

  /// An event for each write to a synced table.
  final Stream<void> _edits;

  /// Uploads and deletes the user's media after each run of the rows.
  final MediaStore _media;

  final Duration editDelay;
  final Duration firstRetry;
  final Duration maxRetry;

  final _status = ValueNotifier<SyncStatus>(const SyncIdle());
  final _subscriptions = <StreamSubscription<void>>[];
  AppLifecycleListener? _lifecycle;
  Timer? _editTimer;
  Timer? _retryTimer;
  var _failures = 0;
  Future<void>? _current;
  var _again = false;
  var _disposed = false;

  /// Where sync stands now, kept current.
  ValueListenable<SyncStatus> get status => _status;

  /// Starts following the account, local edits and the app's lifecycle, and
  /// runs at once when signed in.
  void start() {
    _subscriptions
      ..add(_account.stateChanges.listen(_onAccount))
      ..add(_edits.listen((_) => _onEdit()));
    _lifecycle = AppLifecycleListener(onResume: () => unawaited(sync()));
    _onAccount(_account.state);
  }

  /// Stops following; a run under way ends without touching [status].
  void dispose() {
    if (_disposed) return;
    _disposed = true;
    for (final subscription in _subscriptions) {
      unawaited(subscription.cancel());
    }
    _lifecycle?.dispose();
    _editTimer?.cancel();
    _retryTimer?.cancel();
    _status.dispose();
  }

  void _onAccount(AccountState state) {
    if (state is SignedIn) {
      unawaited(sync());
    } else {
      _editTimer?.cancel();
      _retryTimer?.cancel();
      _failures = 0;
      _status.value = const SyncIdle();
    }
  }

  void _onEdit() {
    _editTimer?.cancel();
    if (_account.state is! SignedIn) return;
    _editTimer = Timer(editDelay, () => unawaited(_syncIfUnsynced()));
  }

  /// Runs sync when a row is waiting to be pushed. Sync's own writes are
  /// edits too, and leave none unless a merge kept a local row.
  Future<void> _syncIfUnsynced() async {
    if (_account.state is! SignedIn) return;
    try {
      if (!await _store.hasUnsynced() || _disposed) return;
    } on SyncFailure catch (failure) {
      _set(SyncInterrupted(failure));
      return;
    }
    await sync();
  }

  /// Runs sync now, or once more after the run under way; completes when no
  /// run is left. A failure sets [status] and schedules a retry.
  Future<void> sync() {
    if (_current case final current?) {
      _again = true;
      return current;
    }
    final current = _loop().whenComplete(() => _current = null);
    _current = current;
    return current;
  }

  Future<void> _loop() async {
    do {
      _again = false;
      await _runOnce();
    } while (_again);
  }

  Future<void> _runOnce() async {
    final state = _account.state;
    if (state is! SignedIn) {
      _set(const SyncIdle());
      return;
    }
    _retryTimer?.cancel();
    _set(const Syncing());
    try {
      await _synchronizer.run(state.userId);
      // After the rows, so a deck's image is named on the server before its
      // file lands. A transfer left queued retries with the run's backoff,
      // and the rows stay synced.
      if (await _media.drain()) {
        _failures = 0;
      } else {
        _scheduleRetry();
      }
      _set(const Synced());
    } on SyncFailure catch (failure) {
      _set(SyncInterrupted(failure));
      _scheduleRetry();
    }
  }

  void _scheduleRetry() {
    if (_disposed) return;
    final delay = firstRetry * pow(2, min(_failures, 16)).toInt();
    _failures++;
    _retryTimer = Timer(
      delay < maxRetry ? delay : maxRetry,
      () => unawaited(sync()),
    );
  }

  void _set(SyncStatus status) {
    if (!_disposed) _status.value = status;
  }

  /// Runs sync at once, as the account screen's retry does, restarting the
  /// backoff.
  Future<void> retry() {
    _failures = 0;
    return sync();
  }

  @override
  Future<bool> push() async {
    await sync();
    if (_status.value is! Synced) return false;
    try {
      return !await _store.hasUnsynced();
    } on SyncFailure {
      return false;
    }
  }

  /// Waits for the run under way, then clears the local database.
  @override
  Future<void> clear() async {
    _editTimer?.cancel();
    _retryTimer?.cancel();
    await _current;
    try {
      await _store.clear();
    } on SyncFailed catch (failure) {
      throw AccountDataNotCleared(failure);
    }
  }
}
