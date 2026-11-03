import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../design/app_button.dart';
import '../../design/app_list_row.dart';
import '../../design/mascot.dart';
import '../../design/theme.dart';
import '../../design/word_break.dart';
import '../../l10n/app_localizations.dart';
import 'failure.dart';
import 'failure_message.dart';
import 'import_job.dart';
import 'photo_viewer.dart';

/// Several photos being read: "사진 n장 중 k장 읽음", beside the thinking mascot
/// while no row shows a failure's red, over a bar of the same k, and one row
/// per photo with its thumbnail and state. A photo that failed says
/// why, with a retry where sending it again can help and a way to leave it
/// out, and while any can be sent again, one action at the bottom that sends
/// them all. [note] says when today's limit left photos out; the privacy note
/// and a cancel close the screen. Once photo import is unavailable for every
/// photo, the bottom offers the other ways to add the note's cards in the
/// cancel's place.
class ReadingView extends StatelessWidget {
  const ReadingView({
    super.key,
    required this.job,
    required this.onBack,
    required this.onCancel,
    this.onAddByHand,
    this.onAddFromSpreadsheet,
  });

  /// The job whose batch is read.
  final ImportJob job;

  /// Leaves the screen while the photos go on being read.
  final VoidCallback onBack;

  /// Stops reading and leaves the batch out.
  final VoidCallback onCancel;

  /// Leaves photo import for adding the note's cards by hand; null while
  /// photo import is not unavailable for every photo.
  final VoidCallback? onAddByHand;

  /// Leaves photo import for adding the note's cards from a spreadsheet;
  /// null as [onAddByHand] is.
  final VoidCallback? onAddFromSpreadsheet;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    final jobs = job.batch;
    final images = [for (final photo in jobs) job.imageOf(photo)];
    final read = jobs.where((photo) => photo.state is PhotoRead).length;
    final failed = jobs.where((photo) => photo.state is PhotoFailed).length;
    final retryable = jobs.any(
      (photo) => switch (photo.state) {
        PhotoFailed(:final failure) => isRetryable(failure),
        _ => false,
      },
    );
    final busy = jobs.any(
      (photo) => photo.state is PhotoReading || photo.state is PhotoWaiting,
    );
    final title = busy || failed == 0
        ? l10n.readingTitle(read, jobs.length)
        : l10n.readingFailed(failed);
    final note = switch (job.limitLeft) {
      (:final count, period: LimitPeriod.day) => l10n.photosLeftToday(count),
      (:final count, period: LimitPeriod.month) => l10n.photosLeftThisMonth(
        count,
      ),
      null => null,
    };
    return Scaffold(
      appBar: AppBar(
        automaticallyImplyLeading: false,
        leading: IconButton(
          tooltip: l10n.navigateBack,
          icon: const Icon(LucideIcons.chevronLeft),
          onPressed: onBack,
        ),
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(
            AppSpace.gutter,
            AppSpace.s24,
            AppSpace.gutter,
            AppSpace.s16,
          ),
          children: [
            Row(
              spacing: AppSpace.s16,
              children: [
                Expanded(
                  child: Semantics(
                    header: true,
                    liveRegion: true,
                    child: Text(title, style: AppType.title),
                  ),
                ),
                if (busy && failed == 0)
                  const Mascot(
                    expression: MascotExpression.thinking,
                    size: AppSize.mascotGuide,
                  ),
              ],
            ),
            const SizedBox(height: AppSpace.s16),
            ExcludeSemantics(
              child: LinearProgressIndicator(
                value: jobs.isEmpty ? 0 : read / jobs.length,
                color: colors.accent,
                backgroundColor: colors.edge,
                borderRadius: BorderRadius.circular(AppSpace.s4),
              ),
            ),
            if (note != null) ...[
              const SizedBox(height: AppSpace.s12),
              Text(note, style: AppType.body.copyWith(color: colors.ink2)),
            ],
            const SizedBox(height: AppSpace.s20),
            for (final (i, photo) in jobs.indexed) ...[
              if (i > 0) const SizedBox(height: AppSpace.rowGap),
              _PhotoRow(
                key: ObjectKey(photo),
                state: photo.state,
                photos: images,
                number: i + 1,
                onRetry: () => job.retry(photo),
                onDrop: () => job.drop(photo),
              ),
            ],
            const SizedBox(height: AppSpace.s20),
            Text(
              l10n.extractingNote,
              textAlign: TextAlign.center,
              style: AppType.caption.copyWith(color: colors.muted),
            ),
          ],
        ),
      ),
      bottomNavigationBar: SafeArea(
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
              if (onAddFromSpreadsheet case final onAddFromSpreadsheet?)
                Expanded(
                  child: AppButton(
                    label: l10n.spreadsheetPick,
                    variant: AppButtonVariant.secondary,
                    size: AppButtonSize.cta,
                    onPressed: onAddFromSpreadsheet,
                  ),
                ),
              if (onAddByHand case final onAddByHand?)
                Expanded(
                  child: AppButton(
                    label: l10n.createManually,
                    size: AppButtonSize.cta,
                    onPressed: onAddByHand,
                  ),
                )
              else
                Expanded(
                  child: AppButton(
                    label: l10n.cancel,
                    variant: AppButtonVariant.secondary,
                    size: AppButtonSize.cta,
                    onPressed: onCancel,
                  ),
                ),
              if (retryable)
                Expanded(
                  flex: 2,
                  child: AppButton(
                    label: l10n.retryFailedPhotos,
                    size: AppButtonSize.cta,
                    onPressed: job.retryFailed,
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

/// One photo: its thumbnail, "사진 n", and its state in words with an icon,
/// read as one line; a failed one with its actions.
class _PhotoRow extends StatelessWidget {
  const _PhotoRow({
    super.key,
    required this.state,
    required this.photos,
    required this.number,
    required this.onRetry,
    required this.onDrop,
  });

  final PhotoState state;

  /// Every photo of the batch in pick order, for the viewer.
  final List<ImageProvider?> photos;
  final int number;
  final VoidCallback onRetry;
  final VoidCallback onDrop;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    final (IconData icon, Color iconColor, String status) = switch (state) {
      PhotoWaiting() => (LucideIcons.clock, colors.muted, l10n.photoWaiting),
      PhotoReading() => (LucideIcons.loader, colors.ink, l10n.photoReading),
      PhotoRead(:final cards) => (
        LucideIcons.check,
        // Green means 안다 alone: a photo read is ink, its words saying so.
        colors.ink,
        l10n.cardCount(cards.length),
      ),
      PhotoFailed(:final failure) => (
        LucideIcons.circleAlert,
        colors.dontKnow,
        describePhotoImportFailure(l10n, failure),
      ),
    };
    final failure = switch (state) {
      PhotoFailed(:final failure) => failure,
      _ => null,
    };
    return AppRowSurface(
      child: Padding(
        padding: const EdgeInsets.all(AppSpace.s12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              spacing: AppSpace.s12,
              children: [
                PhotoThumbnail(
                  photos: photos,
                  index: number - 1,
                  width: 48,
                  height: 64,
                ),
                Expanded(
                  child: MergeSemantics(
                    child: Row(
                      spacing: AppSpace.s12,
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            spacing: AppSpace.s4,
                            children: [
                              Text(
                                l10n.photoNumber(number),
                                style: AppType.bodyStrong,
                              ),
                              Semantics(
                                liveRegion: failure != null,
                                child: Text(
                                  keepWords(status),
                                  semanticsLabel: status,
                                  style: AppType.body.copyWith(
                                    color: failure == null
                                        ? colors.ink2
                                        : colors.ink,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                        ExcludeSemantics(
                          child: Icon(
                            icon,
                            size: AppSize.smallIcon,
                            color: iconColor,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
            if (failure != null) ...[
              const SizedBox(height: AppSpace.s12),
              Row(
                spacing: AppSpace.s8,
                children: [
                  if (isRetryable(failure))
                    Expanded(
                      child: AppButton(
                        label: l10n.retry,
                        variant: AppButtonVariant.secondary,
                        onPressed: onRetry,
                      ),
                    ),
                  Expanded(
                    child: AppButton(
                      label: l10n.photoDrop,
                      variant: AppButtonVariant.secondary,
                      onPressed: onDrop,
                    ),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}
