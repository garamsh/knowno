import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../design/app_button.dart';
import '../../design/mascot.dart';
import '../../design/theme.dart';
import '../../design/word_break.dart';
import '../../l10n/app_localizations.dart';
import 'failure.dart';
import 'failure_message.dart';

/// The sad mascot over what went wrong, in plain words, with a retry where sending the same photo
/// again can succeed, a retake where a new photo can, the way to Settings
/// where access was refused, and the other ways to add cards where photo
/// import is unavailable. The top bar's close is the one way out.
class FailureView extends StatelessWidget {
  const FailureView({
    super.key,
    required this.failure,
    required this.onRetry,
    required this.onRetake,
    required this.retakeLabel,
    required this.onOpenSettings,
    this.onAddByHand,
    this.onAddFromSpreadsheet,
  });

  final PhotoImportFailure failure;

  /// Sends the same photo again; null when that cannot help.
  final VoidCallback? onRetry;

  final VoidCallback onRetake;

  /// What the retake is called: "다시 찍기", or "다른 사진 고르기" for a photo
  /// from the album.
  final String retakeLabel;

  /// Opens this app's page in the system settings; null when access was not
  /// what failed.
  final VoidCallback? onOpenSettings;

  /// Leaves photo import for adding the note's cards by hand; null where
  /// photo import is not what is unavailable.
  final VoidCallback? onAddByHand;

  /// Leaves photo import for adding the note's cards from a spreadsheet;
  /// null as [onAddByHand] is.
  final VoidCallback? onAddFromSpreadsheet;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final onRetry = this.onRetry;
    final onOpenSettings = this.onOpenSettings;
    final onAddByHand = this.onAddByHand;
    final onAddFromSpreadsheet = this.onAddFromSpreadsheet;
    final primaryElsewhere =
        onRetry != null || onOpenSettings != null || onAddByHand != null;
    final anyAction =
        isRetakeable(failure) ||
        primaryElsewhere ||
        onAddFromSpreadsheet != null;
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          tooltip: l10n.close,
          icon: const Icon(LucideIcons.x),
          onPressed: () => Navigator.of(context).pop(),
        ),
      ),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(AppSpace.s24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            spacing: AppSpace.s16,
            children: [
              const Mascot(
                expression: MascotExpression.sad,
                size: AppSize.mascotMedium,
              ),
              Semantics(
                liveRegion: true,
                // Korean breaks only between words (#454).
                child: Text(
                  keepWords(describePhotoImportFailure(l10n, failure)),
                  semanticsLabel: describePhotoImportFailure(l10n, failure),
                  textAlign: TextAlign.center,
                  style: AppType.bodyStrong,
                ),
              ),
            ],
          ),
        ),
      ),
      bottomNavigationBar: !anyAction
          ? null
          : SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(
                  AppSpace.gutter,
                  AppSpace.s8,
                  AppSpace.gutter,
                  AppSpace.s16,
                ),
                child: Row(
                  spacing: AppSpace.s12,
                  children: [
                    if (isRetakeable(failure))
                      Expanded(
                        child: AppButton(
                          label: retakeLabel,
                          variant: primaryElsewhere
                              ? AppButtonVariant.secondary
                              : AppButtonVariant.primary,
                          size: AppButtonSize.cta,
                          onPressed: onRetake,
                        ),
                      ),
                    if (onRetry != null)
                      Expanded(
                        child: AppButton(
                          label: l10n.retry,
                          size: AppButtonSize.cta,
                          onPressed: onRetry,
                        ),
                      ),
                    if (onOpenSettings != null)
                      Expanded(
                        child: AppButton(
                          label: l10n.openSettings,
                          size: AppButtonSize.cta,
                          onPressed: onOpenSettings,
                        ),
                      ),
                    if (onAddFromSpreadsheet != null)
                      Expanded(
                        child: AppButton(
                          label: l10n.spreadsheetPick,
                          variant: AppButtonVariant.secondary,
                          size: AppButtonSize.cta,
                          onPressed: onAddFromSpreadsheet,
                        ),
                      ),
                    if (onAddByHand != null)
                      Expanded(
                        child: AppButton(
                          label: l10n.createManually,
                          size: AppButtonSize.cta,
                          onPressed: onAddByHand,
                        ),
                      ),
                  ],
                ),
              ),
            ),
    );
  }
}
