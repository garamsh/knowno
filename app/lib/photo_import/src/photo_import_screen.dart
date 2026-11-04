import 'dart:async';

import 'package:flutter/material.dart' hide Card;
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../deck/deck.dart';
import '../../design/app_list_row.dart';
import '../../design/app_sheet.dart';
import '../../l10n/app_localizations.dart';
import 'extracting_view.dart';
import 'failure.dart';
import 'failure_message.dart';
import 'failure_view.dart';
import 'import_job.dart';
import 'import_list.dart';
import 'import_list_view.dart';
import 'photo_imports.dart';
import 'photo_source.dart';
import 'providers.dart';
import 'reading_view.dart';

/// The keys the storage given to photo import must be opened to cache.
const photoImportStorageKeys = {photoImportFormsKey};

/// Every deck, kept current, for the target chip.
final _decksProvider = StreamProvider.autoDispose<List<Deck>>(
  (ref) => ref.watch(deckRepositoryProvider).watchDecks(),
);

/// Takes a photo with the camera, or picks up to [maxPhotosPerImport] from
/// the library, as [origin] names, over [context], and opens the screen that
/// reads candidate cards from them as [imports]'s job and saves the ones the
/// user keeps into [deck], or into a new deck when it is null. While a job is
/// under way, a snack bar says so and nothing starts. A cancel opens nothing.
/// Nothing is written before the user confirms; resolves to how the import
/// ended, or to null, also when the user leaves the screen with the job still
/// reading.
Future<PhotoImportOutcome?> importFromPhoto(
  BuildContext context, {
  required PhotoImports imports,
  required DeckId? deck,
  required PhotoOrigin origin,
}) async {
  final navigator = Navigator.of(context);
  if (imports.job != null) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(AppLocalizations.of(context).photoImportBusy)),
    );
    return null;
  }
  final PhotoImportScreen screen;
  switch (await _takePhotos(imports.photos, origin, maxPhotosPerImport)) {
    case null:
      return null;
    case _Taken(:final failure):
      screen = PhotoImportScreen(
        imports: imports,
        job: null,
        deck: deck,
        origin: origin,
        failure: failure,
      );
    case _Picked(:final picked):
      final job = imports.create(deck, origin);
      if (await job.add(picked) case final failure?) {
        await job.end();
        screen = PhotoImportScreen(
          imports: imports,
          job: null,
          deck: deck,
          origin: origin,
          failure: failure,
        );
      } else {
        imports.attach(job);
        screen = PhotoImportScreen(
          imports: imports,
          job: job,
          deck: deck,
          origin: origin,
        );
      }
  }
  return navigator.push(
    MaterialPageRoute<PhotoImportOutcome>(builder: (_) => screen),
  );
}

/// Opens [imports]'s job over [context], first asking to resume one restored
/// with photos still to read; resolves to how the import ended, or to null.
Future<PhotoImportOutcome?> openPhotoImport(
  BuildContext context,
  PhotoImports imports,
) async {
  final job = imports.job;
  if (job == null) return null;
  final navigator = Navigator.of(context);
  if (job.paused && !await offerPhotoImportResume(context, imports, job)) {
    return null;
  }
  return navigator.push(
    MaterialPageRoute<PhotoImportOutcome>(
      builder: (_) => PhotoImportScreen(
        imports: imports,
        job: job,
        deck: job.target,
        origin: job.origin,
      ),
    ),
  );
}

/// What a take of photos came to.
sealed class _Take {
  const _Take();
}

final class _Picked extends _Take {
  const _Picked(this.picked);

  final List<PickedPhoto> picked;
}

/// The failure that came instead of a photo.
final class _Taken extends _Take {
  const _Taken(this.failure);

  final PhotoImportFailure failure;
}

/// Takes one photo by [origin] from [photos], or up to [limit] from the
/// album; null when the camera or the picker is cancelled.
Future<_Take?> _takePhotos(
  PhotoSource photos,
  PhotoOrigin origin,
  int limit,
) async {
  try {
    final picked = switch (origin) {
      PhotoOrigin.camera => switch (await photos.takePhoto()) {
        final photo? => [() async => photo],
        null => null,
      },
      PhotoOrigin.album => await photos.pickFromLibrary(limit: limit),
    };
    return switch (picked) {
      null || [] => null,
      final picked => _Picked(picked),
    };
  } on PhotoImportFailure catch (failure) {
    return _Taken(failure);
  }
}

/// A photo import's screen over [job]: its one photo being read, a failure,
/// the photos being read, or the list. Leaving it leaves [job] reading, or
/// ends it once every photo failed; "취소" ends it.
class PhotoImportScreen extends ConsumerStatefulWidget {
  const PhotoImportScreen({
    super.key,
    required this.imports,
    required this.job,
    required this.deck,
    required this.origin,
    this.failure,
  });

  final PhotoImports imports;

  /// The job shown; null while [failure] came instead of a photo.
  final ImportJob? job;

  final DeckId? deck;

  /// Where the photo came from, which a retake goes back to.
  final PhotoOrigin origin;

  /// The failure that came instead of a photo, before any job.
  final PhotoImportFailure? failure;

  @override
  ConsumerState<PhotoImportScreen> createState() => _PhotoImportScreenState();
}

class _PhotoImportScreenState extends ConsumerState<PhotoImportScreen> {
  late ImportJob? _job = widget.job;
  late PhotoImportFailure? _failure = widget.failure;

  /// Where the first photo came from; a retake with no job goes back there.
  late PhotoOrigin _origin = widget.origin;

  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _job?.addListener(_jobChanged);
  }

  @override
  void dispose() {
    _job?.removeListener(_jobChanged);
    super.dispose();
  }

  void _jobChanged() {
    final job = _job;
    if (!mounted || job == null) return;
    if (job.deckFailure case final failure?) {
      job.deckFailure = null;
      _showDeckFailure(failure);
    }
    if (job.empty) {
      _watch(null);
      unawaited(widget.imports.end(job));
      Navigator.of(context).pop();
      return;
    }
    setState(() {});
  }

  void _watch(ImportJob? job) {
    _job?.removeListener(_jobChanged);
    _job = job;
    job?.addListener(_jobChanged);
  }

  /// Whether [job] holds only photos that failed, with no list: leaving it
  /// then dismisses it, as nothing is left to read (#690).
  static bool _failed(ImportJob job) =>
      job.list == null &&
      job.batch.isNotEmpty &&
      job.batch.every((photo) => photo.state is PhotoFailed);

  /// Ends the job once the screen is left with it failed, by the close, the
  /// system back or the edge swipe; a job still reading goes on.
  void _popped(bool didPop) {
    final job = _job;
    if (!didPop || job == null || !_failed(job)) return;
    _watch(null);
    unawaited(widget.imports.end(job));
  }

  @override
  Widget build(BuildContext context) => PopScope(
    onPopInvokedWithResult: (didPop, _) => _popped(didPop),
    child: _view(context),
  );

  Widget _view(BuildContext context) {
    final decks = ref.watch(_decksProvider);
    final job = _job;
    final target = switch (decks) {
      AsyncData(:final value) => value.where(
        (deck) => deck.id == (job?.target ?? widget.deck),
      ),
      _ => const <Deck>[],
    }.firstOrNull;
    final l10n = AppLocalizations.of(context);
    final origin = job?.origin ?? _origin;
    // A retake goes back to where the photo came from, or to the album
    // where the camera cannot open, which it then names.
    String retakeLabel(PhotoImportFailure? failure) =>
        switch (failure is CameraUnavailable ? PhotoOrigin.album : origin) {
          PhotoOrigin.camera => l10n.retake,
          PhotoOrigin.album when origin == PhotoOrigin.camera =>
            l10n.photoAlbum,
          PhotoOrigin.album => l10n.pickAnother,
        };
    // While photo import is unavailable, the note's cards are added another
    // way: by hand or from a spreadsheet, each leaving this screen.
    final deck = job?.target ?? widget.deck;
    VoidCallback? instead(
      bool unavailable,
      PhotoImportOutcome Function(DeckId deck) outcome,
    ) => unavailable && deck != null ? () => _addInstead(outcome(deck)) : null;
    if (job == null) {
      final failure = _failure;
      if (failure == null) return const Scaffold();
      final unavailable = failure is ExtractionUnavailable;
      return FailureView(
        failure: failure,
        onRetry: null,
        onRetake: () => _retake(failure),
        retakeLabel: retakeLabel(failure),
        onOpenSettings: failure is PhotoAccessDenied ? _openSettings : null,
        onAddByHand: instead(unavailable, AddByHandInstead.new),
        onAddFromSpreadsheet: instead(
          unavailable,
          AddFromSpreadsheetInstead.new,
        ),
      );
    }
    if (job.list == null && job.photos.length == 1) {
      final photo = job.photos.single;
      if (photo.state case PhotoFailed(:final failure)) {
        final unavailable = failure is ExtractionUnavailable;
        return FailureView(
          failure: failure,
          onRetry: isRetryable(failure) ? () => job.retry(photo) : null,
          onRetake: () => _retake(failure),
          retakeLabel: retakeLabel(failure),
          onOpenSettings: failure is PhotoAccessDenied ? _openSettings : null,
          onAddByHand: instead(unavailable, AddByHandInstead.new),
          onAddFromSpreadsheet: instead(
            unavailable,
            AddFromSpreadsheetInstead.new,
          ),
        );
      }
      return ExtractingView(photo: job.imageOf(photo), onCancel: _cancel);
    }
    if (job.reading) {
      // Only once every photo of the batch failed so: a photo still to read
      // or read keeps the rows' own actions.
      final unavailable = job.batch.every(
        (photo) => switch (photo.state) {
          PhotoFailed(failure: ExtractionUnavailable()) => true,
          _ => false,
        },
      );
      return ReadingView(
        job: job,
        onBack: () => Navigator.of(context).pop(),
        onCancel: _cancel,
        onAddByHand: instead(unavailable, AddByHandInstead.new),
        onAddFromSpreadsheet: instead(
          unavailable,
          AddFromSpreadsheetInstead.new,
        ),
      );
    }
    final list = job.list;
    if (list == null) return const Scaffold();
    return ImportListView(
      list: list,
      photos: [for (final photo in job.photos) ?job.imageOf(photo)],
      decks: decks.value ?? const [],
      target: target,
      onTarget: (deck) => unawaited(job.chooseTarget(deck)),
      saving: _saving,
      onChanged: () => setState(() {}),
      onCancel: () => _leave(job),
      // A retake replaces a single photo; with several, photos are added.
      onRetake: list.photoCount == 1 ? () => _retakeList(job) : null,
      retakeLabel: retakeLabel(null),
      onAddPhotos: job.photos.length < maxPhotosPerImport
          ? () => _addPhotos(job)
          : null,
      onSave: () => _save(job, list),
    );
  }

  /// The cards [job] has read and would be lost by ending it: the list's,
  /// or those of the photos read so far.
  int _cardsAtStake(ImportJob job) =>
      job.list?.cardCount ??
      job.batch.fold(
        0,
        (count, photo) => switch (photo.state) {
          PhotoRead(:final cards) => count + cards.length,
          _ => count,
        },
      );

  /// Ends [job] and closes the screen, once the user confirms discarding the
  /// cards it holds.
  Future<void> _leave(ImportJob job) async {
    if (!await _discardConfirmed(_cardsAtStake(job)) || !mounted) return;
    final navigator = Navigator.of(context);
    _watch(null);
    await widget.imports.end(job);
    navigator.pop();
  }

  /// Ends the job, once the user confirms discarding the cards it holds, and
  /// leaves the screen with [outcome], another way to add the note's cards.
  Future<void> _addInstead(PhotoImportOutcome outcome) async {
    final job = _job;
    if (job != null) {
      if (!await _discardConfirmed(_cardsAtStake(job)) || !mounted) return;
      _watch(null);
      await widget.imports.end(job);
    }
    if (mounted) Navigator.of(context).pop(outcome);
  }

  /// Stops reading: photos being added to a list are left out and the list
  /// shows again; the first photos end the job, as [_leave] does.
  Future<void> _cancel() async {
    final job = _job;
    if (job == null) return;
    if (job.list != null) {
      job.dropBatch();
      return;
    }
    await _leave(job);
  }

  /// Takes another photo in place of [job]'s, once the user confirms
  /// discarding its cards.
  Future<void> _retakeList(ImportJob job) async {
    if (await _discardConfirmed(_cardsAtStake(job)) && mounted) {
      await _retake(null);
    }
  }

  /// Whether [count] cards may go: at once when there are none, else as the
  /// user answers, since reading the photos again counts against today's
  /// limit again.
  Future<bool> _discardConfirmed(int count) async {
    if (count == 0) return true;
    final l10n = AppLocalizations.of(context);
    return showAppConfirm(
      context,
      title: l10n.discardImportTitle,
      consequence: l10n.discardImportBody(count),
      confirmLabel: l10n.discardImport,
    );
  }

  /// Takes another photo in place of the one there is, from where it came,
  /// or from the album where the camera cannot open; a cancel leaves the
  /// screen as it was.
  Future<void> _retake(PhotoImportFailure? failure) async {
    final job = _job;
    final from = failure is CameraUnavailable
        ? PhotoOrigin.album
        : job?.origin ?? _origin;
    switch (await _takePhotos(widget.imports.photos, from, 1)) {
      case null:
        return;
      case _Taken(:final failure):
        _watch(null);
        if (job != null) await widget.imports.end(job);
        if (!mounted) return;
        setState(() {
          _origin = from;
          _failure = failure;
        });
      case _Picked(:final picked):
        if (!mounted) return;
        if (job != null) {
          await job.replace(picked, from);
          return;
        }
        final next = widget.imports.create(widget.deck, from);
        await next.add(picked);
        if (!mounted) return;
        widget.imports.attach(next);
        setState(() {
          _origin = from;
          _failure = null;
          _watch(next);
        });
    }
  }

  Future<void> _openSettings() async {
    final messenger = ScaffoldMessenger.of(context);
    final l10n = AppLocalizations.of(context);
    if (!await widget.imports.photos.openSettings()) {
      messenger.showSnackBar(SnackBar(content: Text(l10n.settingsNotOpened)));
    }
  }

  /// Takes more photos into [job]'s list, from the camera or the album, up
  /// to [maxPhotosPerImport] in all; a cancel leaves the list as it was.
  Future<void> _addPhotos(ImportJob job) async {
    final l10n = AppLocalizations.of(context);
    final origin = await showAppSheet<PhotoOrigin>(
      context,
      builder: (context) => AppSheet(
        title: l10n.addPhotos,
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            for (final (origin, label) in [
              (PhotoOrigin.camera, l10n.photoCamera),
              (PhotoOrigin.album, l10n.photoAlbum),
            ])
              AppListRow(
                title: label,
                onTap: () => Navigator.of(context).pop(origin),
              ),
          ],
        ),
      ),
    );
    if (origin == null || !mounted) return;
    final messenger = ScaffoldMessenger.of(context);
    switch (await _takePhotos(
      widget.imports.photos,
      origin,
      maxPhotosPerImport - job.photos.length,
    )) {
      case null:
        return;
      case _Taken(:final failure):
        messenger.showSnackBar(
          SnackBar(content: Text(describePhotoImportFailure(l10n, failure))),
        );
      case _Picked(:final picked):
        if (await job.add(picked) case final failure?) {
          messenger.showSnackBar(
            SnackBar(content: Text(describePhotoImportFailure(l10n, failure))),
          );
        }
    }
  }

  Future<void> _save(ImportJob job, ImportList list) async {
    final l10n = AppLocalizations.of(context);
    final AddTarget target;
    if (job.target case final deck?) {
      target = AddToDeck(deck);
    } else {
      final name = await showNameSheet(
        context,
        title: l10n.newDeck,
        action: l10n.create,
      );
      if (name == null || !mounted) return;
      target = AddToNewDeck(name);
    }
    final navigator = Navigator.of(context);
    setState(() => _saving = true);
    try {
      final result = await ref
          .read(deckRepositoryProvider)
          .addCards(target, list.toImport());
      // The cards are saved; a form that cannot be stored says so and is
      // used only until the app closes.
      try {
        await widget.imports.preferences.setString(
          photoImportFormsKey,
          job.forms.remember(list, result.deck.id),
        );
      } on Exception catch (cause) {
        _showDeckFailure(StorageFailure(cause));
      }
      _watch(null);
      await widget.imports.end(job);
      // A new deck is offered 노트 꾸미기 once it exists, as one made by hand
      // is; dismissing the sheet keeps the default tile.
      if (target is AddToNewDeck && mounted) {
        await _offerAppearance(result.deck);
      }
      navigator.pop(PhotoImportSaved(result.deck));
    } on DeckFailure catch (failure) {
      _showDeckFailure(failure);
      if (mounted) setState(() => _saving = false);
    }
  }

  /// Offers the 노트 꾸미기 sheet on [deck], and stores the pair it saves.
  Future<void> _offerAppearance(Deck deck) async {
    final chosen = await showDeckAppearanceSheet(context, deck: deck);
    if (chosen case (final icon, final color) when mounted) {
      try {
        await ref
            .read(deckRepositoryProvider)
            .setAppearance(deck.id, icon, color);
      } on DeckFailure catch (failure) {
        _showDeckFailure(failure);
      }
    }
  }

  void _showDeckFailure(DeckFailure failure) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(describeFailure(AppLocalizations.of(context), failure)),
      ),
    );
  }
}
