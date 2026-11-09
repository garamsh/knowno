import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../design/app_button.dart';
import '../../design/app_text_field.dart';
import '../../design/theme.dart';
import '../../design/word_break.dart';
import '../../l10n/app_localizations.dart';
import 'failure.dart';
import 'failure_message.dart';
import 'providers.dart';

/// How long after a code is sent before another can be asked for. Supabase
/// Auth refuses a code asked for again before its own interval, so this is
/// that interval as the project sets it, and a refusal names the wait left.
const emailResendInterval = Duration(seconds: 60);

/// How many digits the sign-in code has: the length Supabase Auth is set to.
const emailCodeLength = 6;

/// How many digits the field keeps: what `review-sign-in` takes.
const _codeFieldMaxLength = 128;

/// Whether [text] is shaped like an email address: something, an at sign,
/// something, a dot and something, with no space. Auth decides the rest.
bool looksLikeEmail(String text) =>
    RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$').hasMatch(text);

/// Signing in with an email code, in two steps: the address, which a code is
/// sent to, and the code, which starts the session. Opened over the sign-in
/// screen; it closes itself once the session starts, and a way back from the
/// code to the address is offered on the screen and by the system's back.
class EmailSignInScreen extends ConsumerStatefulWidget {
  const EmailSignInScreen({super.key});

  @override
  ConsumerState<EmailSignInScreen> createState() => _EmailSignInScreenState();
}

class _EmailSignInScreenState extends ConsumerState<EmailSignInScreen> {
  final _email = TextEditingController();
  final _code = TextEditingController();

  /// The length of the code field's text before its last change.
  var _codeLength = 0;
  Timer? _ticker;

  /// The address the code was sent to; null while on the address step.
  String? _sentTo;
  AccountFailure? _failure;
  bool _addressInvalid = false;
  bool _busy = false;
  int _resendIn = 0;

  @override
  void dispose() {
    _ticker?.cancel();
    _email.dispose();
    _code.dispose();
    super.dispose();
  }

  void _startCountdown(Duration wait) {
    _ticker?.cancel();
    setState(() => _resendIn = wait.inSeconds);
    _ticker = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (_resendIn <= 1) timer.cancel();
      setState(() => _resendIn--);
    });
  }

  /// Sends a code to the typed address, or to the one already sent to when
  /// asking again.
  Future<void> _send({required bool again}) async {
    final address = again ? _sentTo! : _email.text.trim();
    if (!looksLikeEmail(address)) {
      setState(() => _addressInvalid = true);
      return;
    }
    setState(() {
      _busy = true;
      _addressInvalid = false;
      _failure = null;
    });
    try {
      await ref.read(accountServiceProvider).sendEmailCode(address);
    } on AccountFailure catch (failure) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _failure = failure;
      });
      if (failure case AccountRateLimited(:final retryAfter?)) {
        _startCountdown(retryAfter);
      }
      return;
    }
    if (!mounted) return;
    _code.clear();
    _codeLength = 0;
    setState(() {
      _busy = false;
      _sentTo = address;
    });
    _startCountdown(emailResendInterval);
  }

  Future<void> _verify() async {
    final address = _sentTo!;
    final code = _code.text;
    if (code.length < emailCodeLength) return;
    setState(() {
      _busy = true;
      _failure = null;
    });
    try {
      await ref.read(accountServiceProvider).verifyEmailCode(address, code);
    } on AccountFailure catch (failure) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _failure = failure;
      });
      return;
    }
    if (!mounted) return;
    // The gate shows the app under this screen once the session starts.
    Navigator.of(context).pop();
  }

  void _changeAddress() {
    _ticker?.cancel();
    setState(() {
      _sentTo = null;
      _failure = null;
      _resendIn = 0;
      _code.clear();
      _codeLength = 0;
    });
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    final sentTo = _sentTo;
    final failure = _failure;
    final message = failure == null
        ? null
        : describeAccountFailure(l10n, failure);
    return PopScope(
      canPop: sentTo == null,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _changeAddress();
      },
      child: Scaffold(
        appBar: AppBar(
          title: Semantics(
            header: true,
            child: Text(l10n.signInWithEmail, style: AppType.title),
          ),
        ),
        body: ListView(
          padding: const EdgeInsets.fromLTRB(
            AppSpace.gutter,
            AppSpace.s8,
            AppSpace.gutter,
            AppSpace.s24,
          ),
          children: [
            Text(
              keepWords(
                sentTo == null
                    ? l10n.emailSignInBody
                    : l10n.emailCodeBody(sentTo),
              ),
              semanticsLabel: sentTo == null
                  ? l10n.emailSignInBody
                  : l10n.emailCodeBody(sentTo),
              style: AppType.body.copyWith(color: colors.ink2),
            ),
            const SizedBox(height: AppSpace.s24),
            if (sentTo == null)
              AppTextField(
                label: l10n.emailAddress,
                hint: l10n.emailAddressHint,
                controller: _email,
                autofocus: true,
                keyboardType: TextInputType.emailAddress,
                autofillHints: const [AutofillHints.email],
                textInputAction: TextInputAction.done,
                errorText: _addressInvalid ? l10n.emailAddressInvalid : message,
                onChanged: (_) {
                  if (_addressInvalid || _failure != null) {
                    setState(() {
                      _addressInvalid = false;
                      _failure = null;
                    });
                  }
                },
                onSubmitted: (_) => _send(again: false),
              )
            else ...[
              AutofillGroup(
                child: AppTextField(
                  label: l10n.emailCode,
                  controller: _code,
                  autofocus: true,
                  keyboardType: TextInputType.number,
                  autofillHints: const [AutofillHints.oneTimeCode],
                  textInputAction: TextInputAction.done,
                  textAlign: TextAlign.center,
                  // What is pasted or filled in keeps its digits, up to what
                  // `review-sign-in` takes: "123 456" and "코드 123456" are
                  // the code.
                  inputFormatters: [
                    FilteringTextInputFormatter.digitsOnly,
                    LengthLimitingTextInputFormatter(_codeFieldMaxLength),
                  ],
                  errorText: message,
                  onChanged: (code) {
                    // A code that arrives whole, pasted or filled by the
                    // platform, signs in; one typed key by key waits for the
                    // button, since its first six digits may be the start of
                    // a review code.
                    final arrivedWhole = _codeLength == 0;
                    _codeLength = code.length;
                    setState(() => _failure = null);
                    if (arrivedWhole &&
                        code.length >= emailCodeLength &&
                        !_busy) {
                      _verify();
                    }
                  },
                  onSubmitted: (_) => _verify(),
                ),
              ),
              const SizedBox(height: AppSpace.s16),
              if (_resendIn > 0)
                Text(
                  l10n.resendEmailCodeIn(_resendIn),
                  textAlign: TextAlign.center,
                  style: AppType.caption.copyWith(color: colors.muted),
                )
              else
                AppButton(
                  label: l10n.resendEmailCode,
                  variant: AppButtonVariant.text,
                  onPressed: _busy ? null : () => _send(again: true),
                ),
              AppButton(
                label: l10n.changeEmailAddress,
                variant: AppButtonVariant.text,
                onPressed: _busy ? null : _changeAddress,
              ),
            ],
          ],
        ),
        bottomNavigationBar: SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(
              AppSpace.gutter,
              AppSpace.s8,
              AppSpace.gutter,
              AppSpace.s16,
            ),
            child: sentTo == null
                ? AppButton(
                    label: l10n.sendEmailCode,
                    size: AppButtonSize.cta,
                    loading: _busy,
                    loadingLabel: l10n.sendingEmailCode,
                    onPressed: () => _send(again: false),
                  )
                : AppButton(
                    label: l10n.verifyEmailCode,
                    size: AppButtonSize.cta,
                    loading: _busy,
                    loadingLabel: l10n.signingIn,
                    onPressed: _code.text.length >= emailCodeLength
                        ? _verify
                        : null,
                  ),
          ),
        ),
      ),
    );
  }
}
