import 'dart:async';

import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../deck/deck.dart';
import '../../design/app_button.dart';
import '../../design/app_sheet.dart';
import '../../design/theme.dart';
import '../../l10n/app_localizations.dart';
import 'extraction_client.dart';
import 'import_job.dart';
import 'import_list.dart';
import 'job_store.dart';
import 'photo_source.dart';

/// The section forms the device remembers, per deck and section, as JSON.
const photoImportFormsKey = 'photoImportForms';

/// The app's photo import: at most one [ImportJob] at a time, which belongs
/// to the app so it reads while the user is anywhere in it, and what it is
/// made from. Listeners hear every change of the job.
final class PhotoImports extends ChangeNotifier {
  PhotoImports({
    required this.client,
    required this.photos,
    required this.preferences,
    required this.store,
    required this.decks,
  });

  final ExtractionClient client;
  final PhotoSource photos;

  /// Device storage opened to cache [photoImportFormsKey].
  final SharedPreferencesWithCache preferences;
  final ImportJobStore store;
  final DeckRepository decks;

  ImportJob? _job;

  /// The import under way, or with its list waiting; null when there is
  /// none.
  ImportJob? get job => _job;

  /// A new job into [target], from [origin], with the forms the device
  /// remembers; not yet the app's [job].
  ImportJob create(DeckId? target, PhotoOrigin origin) => ImportJob(
    target: target,
    origin: origin,
    client: client,
    store: store,
    decks: decks,
    forms: SectionForms.parse(preferences.getString(photoImportFormsKey)),
  );

  /// Makes [job] the app's job.
  void attach(ImportJob job) => _set(job);

  /// Reads back the job a closed app left on the device, if any; [restored]
  /// completes once it has.
  Future<void> restore() async {
    _set(
      await ImportJob.restore(
        client: client,
        store: store,
        decks: decks,
        forms: SectionForms.parse(preferences.getString(photoImportFormsKey)),
      ),
    );
    if (!_restored.isCompleted) _restored.complete();
  }

  final _restored = Completer<void>();

  /// Completes once [restore] has read back the job a closed app left.
  Future<void> get restored => _restored.future;

  /// Ends [job], forgetting it and its photos on the device.
  Future<void> end(ImportJob job) async {
    await job.end();
    if (identical(_job, job)) _set(null);
  }

  void _set(ImportJob? job) {
    _job?.removeListener(notifyListeners);
    _job = job;
    job?.addListener(notifyListeners);
    notifyListeners();
  }
}

/// Asks whether to resume [job], restored with photos still to read, or to
/// discard it; a dismissal decides nothing. Resolves to whether it resumed.
Future<bool> offerPhotoImportResume(
  BuildContext context,
  PhotoImports imports,
  ImportJob job,
) async {
  final l10n = AppLocalizations.of(context);
  final unread = job.batch.where((photo) => photo.state is! PhotoRead).length;
  final resume = await showAppSheet<bool>(
    context,
    builder: (context) => AppSheet(
      title: l10n.resumeImportTitle(unread),
      body: l10n.resumeImportBody,
      actions: [
        AppButton(
          label: l10n.discardImport,
          variant: AppButtonVariant.secondary,
          size: AppButtonSize.cta,
          onPressed: () => Navigator.of(context).pop(false),
        ),
        AppButton(
          label: l10n.resumeImport,
          size: AppButtonSize.cta,
          onPressed: () => Navigator.of(context).pop(true),
        ),
      ],
    ),
  );
  switch (resume) {
    case true:
      job.resume();
      return true;
    case false:
      await imports.end(job);
    case null:
  }
  return false;
}

/// A bar over the tab bar while [imports] holds a job: the photos read of
/// all while it reads, "카드 n장 확인하기" once its list waits, or the
/// photos left while a restored job waits to resume. [onOpen] opens it.
class PhotoImportBar extends StatelessWidget {
  const PhotoImportBar({
    super.key,
    required this.imports,
    required this.onOpen,
  });

  final PhotoImports imports;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: imports,
    builder: (context, _) {
      final job = imports.job;
      if (job == null || job.empty) return const SizedBox.shrink();
      final l10n = AppLocalizations.of(context);
      final colors = AppColors.of(context);
      final total = job.batch.length;
      final (String label, double? progress) = switch (job) {
        ImportJob(paused: true) => (
          l10n.importBarPaused(
            job.batch.where((photo) => photo.state is! PhotoRead).length,
          ),
          null,
        ),
        ImportJob(reading: true) => (
          l10n.importBarReading(job.read, total),
          total == 0 ? 0.0 : job.read / total,
        ),
        ImportJob(:final list?) => (l10n.importBarReady(list.cardCount), null),
        _ => ('', null),
      };
      return SafeArea(
        top: false,
        bottom: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(
            AppSpace.gutter,
            AppSpace.s8,
            AppSpace.gutter,
            0,
          ),
          child: Material(
            color: colors.surface,
            borderRadius: BorderRadius.circular(AppRadius.field),
            child: Semantics(
              button: true,
              liveRegion: true,
              label: label,
              excludeSemantics: true,
              onTap: onOpen,
              child: InkWell(
                onTap: onOpen,
                borderRadius: BorderRadius.circular(AppRadius.field),
                child: ConstrainedBox(
                  constraints: const BoxConstraints(
                    minHeight: AppSize.tapTarget,
                  ),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: AppSpace.s16,
                      vertical: AppSpace.s8,
                    ),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      spacing: AppSpace.s4,
                      children: [
                        Row(
                          spacing: AppSpace.s8,
                          children: [
                            Expanded(
                              child: Text(
                                label,
                                style: AppType.bodyStrong.copyWith(
                                  color: colors.ink,
                                ),
                              ),
                            ),
                            Icon(
                              LucideIcons.chevronRight,
                              size: AppSize.smallIcon,
                              color: colors.ink2,
                            ),
                          ],
                        ),
                        if (progress != null)
                          LinearProgressIndicator(
                            value: progress,
                            color: colors.accent,
                            backgroundColor: colors.edge,
                            borderRadius: BorderRadius.circular(AppSpace.s4),
                          ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      );
    },
  );
}
