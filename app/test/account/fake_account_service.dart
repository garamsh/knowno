import 'dart:async';

import 'package:knowno/account/account.dart';

/// Stands in for the account service at the auth boundary.
/// [signInWithGoogle] and [signInWithApple] count [googleSignIns] and
/// [appleSignIns] and sign in as [email], or throw [failure] when one is set;
/// [cancelSignIn] makes them return as a cancelled picker or sheet does, and
/// [pendingSignIn] holds them until it completes. [deleteAccount] counts
/// [deletions], leaving the session to [signOut], or throws [deletionFailure]
/// when one is set.
class FakeAccountService implements AccountService {
  FakeAccountService([this._state = const SignedOut()]);

  AccountState _state;
  final _changes = StreamController<AccountState>.broadcast();

  UserId userId = const UserId('00000000-0000-4000-8000-00000000000a');
  String email = 'ada@example.com';
  AccountFailure? failure;
  bool cancelSignIn = false;
  Completer<void>? pendingSignIn;
  AccountFailure? deletionFailure;
  var deletions = 0;
  var googleSignIns = 0;
  var appleSignIns = 0;

  @override
  AccountState get state => _state;

  @override
  Stream<AccountState> get stateChanges => _changes.stream;

  void _set(AccountState next) {
    _state = next;
    _changes.add(next);
  }

  @override
  Future<void> signInWithGoogle() async {
    googleSignIns++;
    await _signIn();
  }

  @override
  Future<void> signInWithApple() async {
    appleSignIns++;
    await _signIn();
  }

  Future<void> _signIn() async {
    await pendingSignIn?.future;
    if (failure case final failure?) throw failure;
    if (cancelSignIn) return;
    _set(SignedIn(userId: userId, email: email));
  }

  @override
  Future<void> signOut() async {
    _set(const SignedOut());
    if (failure case final failure?) throw failure;
  }

  @override
  Future<void> deleteAccount() async {
    if (deletionFailure case final failure?) throw failure;
    deletions++;
  }
}
