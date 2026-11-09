import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../design/app_button.dart';
import '../../design/app_choice.dart';
import '../../design/app_list_row.dart';
import '../../design/app_section_label.dart';
import '../../design/app_sheet.dart';
import '../../design/theme.dart';
import '../../design/theme_choice.dart';
import '../../l10n/app_localizations.dart';
import 'account_data.dart';
import 'account_service.dart';
import 'account_state.dart';
import 'failure.dart';
import 'failure_message.dart';
import 'legal.dart';
import 'providers.dart';

/// The settings screen: the signed-in account with [syncStatus] under its
/// email and sign-out, the study settings, the theme the app is drawn in,
/// and, last, deleting the account.
class AccountScreen extends ConsumerStatefulWidget {
  const AccountScreen({
    super.key,
    required this.syncStatus,
    required this.studySettings,
  });

  /// Where sync stands, as its caller draws it.
  final Widget syncStatus;

  /// The study settings' rows, as their callers draw them, under "학습".
  final List<Widget> studySettings;

  @override
  ConsumerState<AccountScreen> createState() => _AccountScreenState();
}

/// The account action under way, whose row shows progress.
enum _Action { signingOut, deleting }

class _AccountScreenState extends ConsumerState<AccountScreen> {
  _Action? _busy;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final state = ref.watch(accountStateProvider);
    final idle = _busy == null && state is SignedIn;
    return Scaffold(
      appBar: AppBar(title: Text(l10n.accountTitle)),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(
          AppSpace.gutter,
          AppSpace.s8,
          AppSpace.gutter,
          AppSpace.s24,
        ),
        children: [
          AppSectionLabel(l10n.accountSection),
          AppGroup(
            children: [
              // The gate leaves this screen once no account is signed in.
              if (state case SignedIn(:final email))
                _EmailRow(email: email, syncStatus: widget.syncStatus),
              AppListRow(
                title: l10n.signOut,
                trailing: _busy == _Action.signingOut
                    ? _Progress(l10n.signingOut)
                    : null,
                onTap: idle ? _signOut : null,
              ),
            ],
          ),
          const SizedBox(height: AppSpace.sectionGap),
          AppSectionLabel(l10n.settingsStudy),
          AppGroup(children: widget.studySettings),
          const SizedBox(height: AppSpace.sectionGap),
          AppSectionLabel(l10n.displaySection),
          const AppGroup(children: [_ThemeRow()]),
          const SizedBox(height: AppSpace.sectionGap),
          AppGroup(
            children: [
              AppListRow(
                title: l10n.deleteAccount,
                destructive: true,
                trailing: _busy == _Action.deleting
                    ? _Progress(l10n.deletingAccount)
                    : null,
                onTap: idle ? _deleteAccount : null,
              ),
            ],
          ),
          const SizedBox(height: AppSpace.s32),
          const _Footer(),
        ],
      ),
    );
  }

  /// Pushes unsynced changes, and asks before signing out when some did not
  /// arrive; then signs out and clears the device's data.
  Future<void> _signOut() async {
    final data = ref.read(accountDataProvider);
    final service = ref.read(accountServiceProvider);
    final messenger = ScaffoldMessenger.of(context);
    final l10n = AppLocalizations.of(context);
    setState(() => _busy = _Action.signingOut);
    try {
      if (!await data.push()) {
        if (!mounted || !await _confirmUnsynced()) return;
      }
      await _endSession(service, data, messenger, l10n);
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  /// Asks before deleting the account; then deletes it, signs out and clears
  /// the device's data, without pushing first.
  Future<void> _deleteAccount() async {
    final data = ref.read(accountDataProvider);
    final service = ref.read(accountServiceProvider);
    final messenger = ScaffoldMessenger.of(context);
    final l10n = AppLocalizations.of(context);
    if (!await showAppConfirm(
      context,
      title: l10n.deleteAccountTitle,
      consequence: l10n.deleteAccountBody,
      confirmLabel: l10n.delete,
    )) {
      return;
    }
    if (!mounted) return;
    setState(() => _busy = _Action.deleting);
    try {
      try {
        // Cancelling the Apple sheet cancels the deletion: nothing is deleted
        // and the account stays signed in.
        if (!await service.deleteAccount()) return;
      } on AccountFailure catch (failure) {
        messenger.showSnackBar(
          SnackBar(content: Text(describeDeletionFailure(l10n, failure))),
        );
        return;
      }
      await _endSession(service, data, messenger, l10n);
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  /// Signs out, then clears the device's data. Signing out makes the gate
  /// close this screen, so nothing here may depend on it staying mounted.
  static Future<void> _endSession(
    AccountService service,
    AccountData data,
    ScaffoldMessengerState messenger,
    AppLocalizations l10n,
  ) async {
    try {
      await service.signOut();
    } on AccountFailure catch (failure) {
      messenger.showSnackBar(
        SnackBar(content: Text(describeAccountFailure(l10n, failure))),
      );
    }
    // A failed sign-out still ends the session on the device.
    if (service.state is! SignedIn) {
      try {
        await data.clear();
      } on AccountDataNotCleared {
        messenger.showSnackBar(SnackBar(content: Text(l10n.dataNotCleared)));
      }
    }
  }

  /// Whether the user signs out although some changes are not synced.
  Future<bool> _confirmUnsynced() async {
    final l10n = AppLocalizations.of(context);
    return showAppConfirm(
      context,
      title: l10n.unsyncedChangesTitle,
      consequence: l10n.unsyncedChangesBody,
      confirmLabel: l10n.signOutAnyway,
    );
  }
}

/// The progress shown in the row of the action under way.
class _Progress extends StatelessWidget {
  const _Progress(this.label);

  final String label;

  @override
  Widget build(BuildContext context) => SizedBox.square(
    dimension: AppSpace.s24,
    child: CircularProgressIndicator(semanticsLabel: label),
  );
}

/// The signed-in account's row: the email, and where sync stands under it.
class _EmailRow extends StatelessWidget {
  const _EmailRow({required this.email, required this.syncStatus});

  final String? email;
  final Widget syncStatus;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(
      AppSpace.s16,
      AppSpace.s12,
      AppSpace.s12,
      AppSpace.s12,
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          email ?? AppLocalizations.of(context).signedIn,
          style: AppType.bodyStrong,
        ),
        syncStatus,
      ],
    ),
  );
}

/// The screen's foot, centred and muted on one line: the app's version, and
/// the links to the terms and the privacy policy.
class _Footer extends ConsumerWidget {
  const _Footer();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    final quiet = AppType.caption.copyWith(color: colors.muted);
    final dot = ExcludeSemantics(child: Text('·', style: quiet));
    Widget link(String title, Uri uri) => AppButton(
      label: title,
      variant: AppButtonVariant.link,
      onPressed: () => openLegalLink(context, ref, uri),
    );
    return Wrap(
      alignment: WrapAlignment.center,
      crossAxisAlignment: WrapCrossAlignment.center,
      spacing: AppSpace.s4,
      children: [
        // Padded as each link's button is, so the dots sit evenly.
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: AppSpace.s4),
          child: Text(
            l10n.appVersion(ref.watch(appVersionProvider)),
            style: quiet,
          ),
        ),
        dot,
        link(l10n.termsOfService, termsOfServiceUrl),
        dot,
        link(l10n.privacyPolicy, privacyPolicyUrl),
      ],
    );
  }
}

/// The theme row: "테마" with the current choice, which opens a sheet that
/// chooses following the system, light or dark, applied at once.
class _ThemeRow extends ConsumerWidget {
  const _ThemeRow();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final current = ref.watch(themeModeProvider);
    return AppChoiceRow(
      title: l10n.themeTitle,
      value: _themeName(l10n, current),
      onTap: () async {
        final chosen = await showAppChoice(
          context,
          title: l10n.themeTitle,
          options: [
            for (final mode in [
              ThemeMode.system,
              ThemeMode.light,
              ThemeMode.dark,
            ])
              (title: _themeName(l10n, mode), value: mode),
          ],
          current: (value: current),
        );
        if (chosen != null) {
          ref.read(themeModeProvider.notifier).choose(chosen.value);
        }
      },
    );
  }
}

String _themeName(AppLocalizations l10n, ThemeMode mode) => switch (mode) {
  ThemeMode.system => l10n.themeSystem,
  ThemeMode.light => l10n.themeLight,
  ThemeMode.dark => l10n.themeDark,
};
