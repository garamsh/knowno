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

  /// The addresses [sendEmailCode] was asked to send to, in order, and the
  /// codes [verifyEmailCode] was given with theirs.
  final emailsSentTo = <String>[];
  final verified = <({String email, String code})>[];

  /// The one code [verifyEmailCode] accepts.
  String emailCode = '123456';

  /// What [sendEmailCode] and [verifyEmailCode] throw when set.
  AccountFailure? sendFailure;
  AccountFailure? verifyFailure;

  /// Holds [verifyEmailCode] until it completes.
  Completer<void>? pendingVerify;

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

  @override
  Future<void> sendEmailCode(String email) async {
    emailsSentTo.add(email);
    if (sendFailure case final failure?) throw failure;
  }

  @override
  Future<void> verifyEmailCode(String email, String code) async {
    verified.add((email: email, code: code));
    await pendingVerify?.future;
    if (verifyFailure case final failure?) throw failure;
    if (code != emailCode) throw const AccountCodeRefused(_WrongCode());
    _set(SignedIn(userId: userId, email: email));
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

  /// Makes [deleteAccount] return as a cancelled Apple sheet does.
  bool cancelDeletion = false;

  @override
  Future<bool> deleteAccount() async {
    if (deletionFailure case final failure?) throw failure;
    if (cancelDeletion) return false;
    deletions++;
    return true;
  }
}

class _WrongCode implements Exception {
  const _WrongCode();
}
