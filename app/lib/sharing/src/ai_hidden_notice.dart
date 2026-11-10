import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../deck/deck.dart';
import '../../design/app_button.dart';
import '../../design/theme.dart';
import '../../l10n/app_localizations.dart';
import 'failure.dart';
import 'failure_message.dart';
import 'model.dart';
import 'providers.dart';
import 'sharing_service.dart';

/// On the owner's deck screen: that an AI hid the note after reports, and as
/// what when the server says, with the one appeal to a person and where it
/// stands. Draws nothing while no AI action hides the note, offline, or
/// without sharing.
class AiHiddenNotice extends ConsumerStatefulWidget {
  const AiHiddenNotice({super.key, required this.deck});

  final DeckId deck;

  @override
  ConsumerState<AiHiddenNotice> createState() => _AiHiddenNoticeState();
}

class _AiHiddenNoticeState extends ConsumerState<AiHiddenNotice> {
  AiHidden? _hidden;
  var _appealing = false;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    final sharing = ref.read(sharingServiceProvider);
    if (sharing == null) return;
    try {
      final hidden = await sharing.aiHidden(widget.deck);
      if (mounted) setState(() => _hidden = hidden);
    } on SharingFailure {
      // The notice is an addition to the screen; without an answer it is absent.
    }
  }

  Future<void> _appeal(SharingService sharing) async {
    final messenger = ScaffoldMessenger.of(context);
    final l10n = AppLocalizations.of(context);
    setState(() => _appealing = true);
    try {
      await sharing.appeal(widget.deck);
    } on SharingFailure catch (failure) {
      if (!mounted) return;
      messenger.showSnackBar(
        SnackBar(content: Text(describeSharingFailure(l10n, failure))),
      );
    }
    if (!mounted) return;
    await _load();
    if (mounted) setState(() => _appealing = false);
  }

  @override
  Widget build(BuildContext context) {
    final hidden = _hidden;
    final sharing = ref.watch(sharingServiceProvider);
    if (hidden == null || sharing == null) return const SizedBox.shrink();
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpace.s16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        spacing: AppSpace.s8,
        children: [
          Text(
            l10n.aiHiddenWhy(switch (hidden.category) {
              TriageCategory.spam => 'spam',
              TriageCategory.ad => 'ad',
              null => 'other',
            }),
            style: AppType.body,
          ),
          switch (hidden.appeal) {
            AppealState.open => AppButton(
              label: l10n.aiHiddenAppeal,
              variant: AppButtonVariant.secondary,
              loading: _appealing,
              loadingLabel: l10n.loading,
              onPressed: () => unawaited(_appeal(sharing)),
            ),
            AppealState.pending => Text(
              l10n.aiHiddenPending,
              style: AppType.secondary.copyWith(color: colors.ink2),
            ),
            AppealState.upheld => Text(
              l10n.aiHiddenUpheld,
              style: AppType.secondary.copyWith(color: colors.ink2),
            ),
          },
        ],
      ),
    );
  }
}
