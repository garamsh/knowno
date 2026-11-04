import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../design/theme.dart';
import '../../design/word_break.dart';
import '../../l10n/app_localizations.dart';
import 'account_state.dart';
import 'apple_button.dart';
import 'failure.dart';
import 'failure_message.dart';
import 'google_button.dart';
import 'legal.dart';
import 'providers.dart';

/// The app's welcome while no account is signed in: its stacked logo on the
/// ground's panel, what it does, Google sign-in and, on iOS, Apple sign-in,
/// and the terms the user agrees to; or, when this build cannot sign anyone
/// in, why.
class SignInScreen extends ConsumerStatefulWidget {
  const SignInScreen({super.key});

  @override
  ConsumerState<SignInScreen> createState() => _SignInScreenState();
}

class _SignInScreenState extends ConsumerState<SignInScreen> {
  bool _busy = false;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    final state = ref.watch(accountStateProvider);
    final brightness = Theme.of(context).brightness;
    // Apple's sheet is the system's on iOS; no other platform has one.
    final offersApple = defaultTargetPlatform == TargetPlatform.iOS;
    return Scaffold(
      backgroundColor: colors.surface,
      // The panel takes what the sign-in column leaves of the screen; where a
      // large text size leaves it too little, the whole screen scrolls.
      body: LayoutBuilder(
        builder: (context, viewport) => SingleChildScrollView(
          child: ConstrainedBox(
            constraints: BoxConstraints(minHeight: viewport.maxHeight),
            child: IntrinsicHeight(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Expanded(
                    child: DecoratedBox(
                      decoration: BoxDecoration(
                        color: colors.ground,
                        borderRadius: const BorderRadius.vertical(
                          bottom: Radius.circular(AppRadius.panel),
                        ),
                      ),
                      child: SafeArea(
                        bottom: false,
                        child: Padding(
                          padding: const EdgeInsets.all(AppSpace.gutter),
                          child: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Semantics(
                                header: true,
                                image: true,
                                label: l10n.appTitle,
                                // In a row, so the height the scroll
                                // measures is the logo's at its own width,
                                // not at the screen's.
                                child: Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Image.asset(
                                      AppBrand.stacked(
                                        brightness,
                                        Localizations.localeOf(context),
                                      ),
                                      width: AppSize.stackedLockupWidth,
                                      excludeFromSemantics: true,
                                    ),
                                  ],
                                ),
                              ),
                              const SizedBox(height: AppSpace.s24),
                              Text(
                                keepWords(l10n.welcomeBody),
                                semanticsLabel: l10n.welcomeBody,
                                textAlign: TextAlign.center,
                                style: AppType.body.copyWith(
                                  color: colors.ink2,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ),
                  SafeArea(
                    top: false,
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(
                        AppSpace.gutter,
                        AppSpace.s32,
                        AppSpace.gutter,
                        AppSpace.s16,
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          ...switch (state) {
                            AccountUnavailable(:final failure) => [
                              Text(
                                describeAccountFailure(l10n, failure),
                                textAlign: TextAlign.center,
                                style: AppType.body,
                              ),
                            ],
                            _ when _busy => [
                              SizedBox(
                                height: offersApple
                                    ? AppSize.cta + AppSpace.s8 + AppSize.cta
                                    : AppSize.cta,
                                child: Center(
                                  child: CircularProgressIndicator(
                                    semanticsLabel: l10n.signingIn,
                                  ),
                                ),
                              ),
                            ],
                            _ => [
                              GoogleSignInButton(
                                label: l10n.signInWithGoogle,
                                onPressed: () => _signIn(
                                  ref
                                      .read(accountServiceProvider)
                                      .signInWithGoogle,
                                ),
                              ),
                              if (offersApple) ...[
                                const SizedBox(height: AppSpace.s8),
                                // As tall as Google's button at the same
                                // width: Apple's guidelines make it no
                                // smaller than another sign-in button.
                                _HeightForWidth(
                                  height: (width) =>
                                      GoogleSignInButton.heightFor(
                                        context,
                                        l10n.signInWithGoogle,
                                        width,
                                      ),
                                  child: AppleSignInButton(
                                    label: l10n.signInWithApple,
                                    onPressed: () => _signIn(
                                      ref
                                          .read(accountServiceProvider)
                                          .signInWithApple,
                                    ),
                                  ),
                                ),
                              ],
                            ],
                          },
                          const SizedBox(height: AppSpace.s16),
                          Text(
                            l10n.consentNotice(
                              l10n.termsOfService,
                              l10n.privacyPolicy,
                            ),
                            textAlign: TextAlign.center,
                            style: AppType.caption.copyWith(
                              color: colors.muted,
                            ),
                          ),
                          const LegalLinksRow(),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  /// Signs in through [signIn]; an [AccountFailure] is shown in a snack bar.
  /// Any other exception propagates.
  Future<void> _signIn(Future<void> Function() signIn) async {
    final messenger = ScaffoldMessenger.of(context);
    final l10n = AppLocalizations.of(context);
    setState(() => _busy = true);
    try {
      await signIn();
    } on AccountFailure catch (failure) {
      messenger.showSnackBar(
        SnackBar(content: Text(describeAccountFailure(l10n, failure))),
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }
}

/// Lays [child] out at the height [height] gives for the width it is given,
/// in a layout pass and when an ancestor such as [IntrinsicHeight] asks.
class _HeightForWidth extends SingleChildRenderObjectWidget {
  const _HeightForWidth({required this.height, required super.child});

  final double Function(double width) height;

  @override
  RenderObject createRenderObject(BuildContext context) =>
      _RenderHeightForWidth(height);

  @override
  void updateRenderObject(
    BuildContext context,
    _RenderHeightForWidth renderObject,
  ) => renderObject.height = height;
}

class _RenderHeightForWidth extends RenderProxyBox {
  _RenderHeightForWidth(this._height);

  double Function(double width) _height;
  set height(double Function(double width) value) {
    _height = value;
    markNeedsLayout();
  }

  BoxConstraints _tight(BoxConstraints constraints) => BoxConstraints.tightFor(
    width: constraints.maxWidth,
    height: constraints.constrainHeight(_height(constraints.maxWidth)),
  );

  @override
  double computeMinIntrinsicHeight(double width) => _height(width);

  @override
  double computeMaxIntrinsicHeight(double width) => _height(width);

  @override
  Size computeDryLayout(BoxConstraints constraints) =>
      _tight(constraints).smallest;

  @override
  void performLayout() {
    final tight = _tight(constraints);
    child!.layout(tight);
    size = tight.smallest;
  }
}
