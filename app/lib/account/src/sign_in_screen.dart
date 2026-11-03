import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../design/app_button.dart';
import '../../design/theme.dart';
import '../../design/word_break.dart';
import '../../l10n/app_localizations.dart';
import 'account_state.dart';
import 'failure.dart';
import 'failure_message.dart';
import 'google_button.dart';
import 'legal.dart';
import 'providers.dart';

/// The app's welcome while no account is signed in: its stacked logo on the
/// ground's panel, what it does, Google sign-in, and the terms the user
/// agrees to; or, when this build cannot sign anyone in, why.
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
                                height:
                                    AppSize.cta +
                                    AppSpace.s8 +
                                    AppSize.tapTarget,
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
                                onPressed: _signIn,
                              ),
                              const SizedBox(height: AppSpace.s8),
                              // Apple sign-in (M4b) fills this slot.
                              AppButton(
                                label: l10n.signInWithAppleSoon,
                                variant: AppButtonVariant.text,
                                onPressed: null,
                              ),
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

  /// Signs in with Google; an [AccountFailure] is shown in a snack bar. Any
  /// other exception propagates.
  Future<void> _signIn() async {
    final service = ref.read(accountServiceProvider);
    final messenger = ScaffoldMessenger.of(context);
    final l10n = AppLocalizations.of(context);
    setState(() => _busy = true);
    try {
      await service.signIn();
    } on AccountFailure catch (failure) {
      messenger.showSnackBar(
        SnackBar(content: Text(describeAccountFailure(l10n, failure))),
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }
}
