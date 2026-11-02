import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/painting.dart';

import '../../deck/deck.dart';
import 'candidate_json.dart';
import 'extraction_client.dart';
import 'failure.dart';
import 'failure_message.dart';
import 'import_list.dart';
import 'job_store.dart';
import 'photo.dart';
import 'photo_source.dart';

/// The most photos one import reads, the first pick and every later one
/// together.
const maxPhotosPerImport = 50;

/// The most photos read at once; the rest wait their turn.
const photosReadAtOnce = 3;

/// The widest a thumbnail is decoded, in pixels, whatever it is drawn at.
const thumbnailDecodeWidth = 192;

/// Where one photo of a job stands.
sealed class PhotoState {
  const PhotoState();
}

/// Waiting to be prepared, or for its turn to be read.
final class PhotoWaiting extends PhotoState {
  const PhotoWaiting();
}

/// Being read by `extract-cards`.
final class PhotoReading extends PhotoState {
  const PhotoReading();
}

/// Read, with the cards found on it.
final class PhotoRead extends PhotoState {
  const PhotoRead(this.cards);

  final List<CandidateCard> cards;
}

/// Not read, for [failure].
final class PhotoFailed extends PhotoState {
  const PhotoFailed(this.failure);

  final PhotoImportFailure failure;
}

/// One photo of a job: prepared into the job's store, where it waits for its
/// turn, so no more than a few photos are ever held in memory.
final class JobPhoto {
  JobPhoto._pending(this._prepare);

  JobPhoto._stored(this._kept, this.state) : _prepare = null;

  /// Prepares the photo; null once it is kept in the store.
  PickedPhoto? _prepare;

  /// The photo's key in the store and its size; null until it is kept.
  ({String key, int width, int height})? _kept;

  PhotoState state = const PhotoWaiting();

  /// The cards read off the page so far, before it is read to its end; kept
  /// through a failure, so reading it again adds to them.
  List<CandidateCard> _readSoFar = const [];

  /// The cursor to read the page on from; null to read it from the start.
  String? _cursor;

  Completer<void>? _cancel;
}

/// One photo import, from the photos picked to the cards saved. It belongs
/// to the app rather than to a screen: it reads at most [photosReadAtOnce]
/// photos at a time, in pick order, while the user is anywhere in the app,
/// and keeps its photos and every photo's cards in [ImportJobStore] after
/// each change, so a closed app resumes it. A photo once read is never sent
/// again.
final class ImportJob extends ChangeNotifier {
  ImportJob({
    required this.target,
    required this.origin,
    required this._client,
    required this._store,
    required this._decks,
    required this.forms,
  });

  final ExtractionClient _client;
  final ImportJobStore _store;
  final DeckRepository _decks;

  /// The section forms the device remembers, applied to the list per deck.
  final SectionForms forms;

  /// The deck the cards go into; null for a new deck.
  DeckId? target;

  /// Where the photos came from, which a retake goes back to.
  PhotoOrigin origin;

  /// Every photo, in pick order: those in [list], then those being read.
  final photos = <JobPhoto>[];

  /// How many of [photos] are in [list].
  var _listed = 0;

  /// The cards of every photo read so far, once the first photos are read.
  ImportList? list;

  /// How many photos the period's limit left when it cut the last pick, and
  /// the period; null when it cut nothing.
  ({int count, LimitPeriod period})? limitLeft;

  /// Restored from the device with photos still to read, waiting for the
  /// user to resume or discard it.
  bool paused = false;

  /// A failure to read the deck's cards, for the screen to show once.
  DeckFailure? deckFailure;

  var _ended = false;
  var _preparing = false;

  /// The photos being read: those not yet in [list].
  List<JobPhoto> get batch => photos.sublist(_listed);

  /// Whether photos are being read or wait to be.
  bool get reading => batch.isNotEmpty;

  /// Whether every photo of the batch was left out and no list was made,
  /// so the job holds nothing.
  bool get empty => photos.isEmpty && list == null;

  /// The photos of the batch read so far.
  int get read => batch.where((photo) => photo.state is PhotoRead).length;

  /// [photo]'s image, drawn at most [width] wide; null until it is kept.
  ImageProvider? imageOf(JobPhoto photo, {int? width}) => switch (photo._kept) {
    (:final key, width: _, height: _) => _store.image(key, width: width),
    null => null,
  };

  /// Adds [picked] to the batch and starts reading. With several photos, or
  /// photos added to a list, the period's limit is read first: with none
  /// left it resolves to [PhotoLimitReached] and adds nothing; with fewer
  /// left than picked, only the first ones are added and [limitLeft] says
  /// so. Where no limit applies, or it cannot be read, every photo is added.
  Future<PhotoLimitReached?> add(List<PickedPhoto> picked) async {
    var take = picked;
    limitLeft = null;
    if (picked.length > 1 || list != null) {
      if (await _client.allowance() case (
        limit: final int limit,
        :final period,
        :final used,
      )) {
        final left = limit - used;
        if (left <= 0) return PhotoLimitReached(limit: limit, period: period);
        if (left < picked.length) {
          take = picked.take(left).toList();
          limitLeft = (count: left, period: period);
        }
      }
    }
    photos.addAll([for (final photo in take) JobPhoto._pending(photo)]);
    _changed();
    return null;
  }

  /// Starts reading again a job restored with photos still to read.
  void resume() {
    paused = false;
    _changed();
  }

  /// Reads [photo] again after a failure.
  void retry(JobPhoto photo) {
    photo.state = const PhotoWaiting();
    _changed();
  }

  /// Reads again, in pick order, every photo of the batch whose failure
  /// [isRetryable]; a photo read or waiting is left as it is.
  void retryFailed() {
    for (final photo in batch) {
      if (photo.state case PhotoFailed(:final failure)
          when isRetryable(failure)) {
        photo.state = const PhotoWaiting();
      }
    }
    _changed();
  }

  /// Leaves [photo] out of the import.
  void drop(JobPhoto photo) {
    photos.remove(photo);
    photo._cancel?.complete();
    _changed();
  }

  /// Stops reading the batch and leaves it out, keeping [list] as it was.
  void dropBatch() {
    _stopReading(batch);
    photos.removeRange(_listed, photos.length);
    limitLeft = null;
    _changed();
  }

  /// Replaces every photo and the list with [picked], from [from]. Listeners
  /// hear the job only once it holds [picked], never empty in between.
  Future<PhotoLimitReached?> replace(
    List<PickedPhoto> picked,
    PhotoOrigin from,
  ) {
    _stopReading(photos);
    photos.clear();
    _listed = 0;
    list = null;
    limitLeft = null;
    origin = from;
    return add(picked);
  }

  /// Saves into [deck] from now on, with the rows checked against its keys
  /// and the forms it remembers applied.
  Future<void> chooseTarget(DeckId? deck) async {
    target = deck;
    notifyListeners();
    final existing = await _existingKeys(deck);
    if (_ended || target != deck) return;
    if (list case final list?) {
      list.existingKeys = existing;
      if (deck != null) forms.applyTo(list, deck);
    }
    notifyListeners();
  }

  /// Stops every read, starts no other, and forgets the job on the device.
  Future<void> end() async {
    _ended = true;
    _stopReading(photos);
    // A write under way would otherwise land after the clear.
    await _writing;
    await _store.clear();
  }

  /// Cancels the reads in progress of [these].
  void _stopReading(Iterable<JobPhoto> these) {
    for (final photo in these) {
      final cancel = photo._cancel;
      if (cancel != null && !cancel.isCompleted) cancel.complete();
    }
  }

  void _changed() {
    if (_ended) return;
    notifyListeners();
    _keep();
    if (paused) return;
    _prepareNext();
    for (final photo in batch) {
      if (batch.where((p) => p.state is PhotoReading).length >=
          photosReadAtOnce) {
        break;
      }
      if (photo.state is PhotoWaiting &&
          photo._kept != null &&
          photo._cancel == null) {
        unawaited(_read(photo));
      }
    }
    unawaited(_finishBatch());
  }

  /// Prepares the next photo picked into the store, one at a time.
  void _prepareNext() {
    if (_preparing) return;
    final next = batch
        .where((photo) => photo._prepare != null && photo.state is PhotoWaiting)
        .firstOrNull;
    final prepare = next?._prepare;
    if (next == null || prepare == null) return;
    _preparing = true;
    unawaited(() async {
      try {
        final photo = await prepare();
        final key = await _store.putPhoto(photo.bytes);
        next
          .._kept = (key: key, width: photo.width, height: photo.height)
          .._prepare = null;
      } on PhotoImportFailure catch (failure) {
        next.state = PhotoFailed(failure);
      } finally {
        _preparing = false;
      }
      _changed();
    }());
  }

  Future<void> _read(JobPhoto photo) async {
    final kept = photo._kept;
    if (kept == null) return;
    final cancel = photo._cancel = Completer<void>();
    photo.state = const PhotoReading();
    notifyListeners();
    PhotoState next;
    try {
      final bytes = await _store.photo(kept.key);
      // A page the function leaves unread past a request's cards is read on
      // with its cursor, kept on the device after each answer (ADR 0138).
      do {
        final read = await _client.extract(
          JpegPhoto.stored(bytes, kept.width, kept.height),
          cursor: photo._cursor,
          cancel: cancel.future,
        );
        if (read == null) return;
        photo
          .._readSoFar = _appended(photo._readSoFar, read.cards)
          .._cursor = read.cursor;
        _keep();
      } while (photo._cursor != null && !_ended && photos.contains(photo));
      next = PhotoRead(photo._readSoFar);
    } on PhotoImportFailure catch (failure) {
      // The function took the cursor, or no longer takes it: the photo is
      // read again from the start, keeping the cards read so far.
      photo._cursor = null;
      next = PhotoFailed(failure);
    } finally {
      photo._cancel = null;
    }
    if (_ended || !photos.contains(photo)) return;
    photo.state = next;
    _changed();
  }

  /// [read] followed by those of [more] whose front none of [read] has, as
  /// the function compares the fronts a request reads on past.
  static List<CandidateCard> _appended(
    List<CandidateCard> read,
    List<CandidateCard> more,
  ) {
    final fronts = {for (final card in read) CardKey.fromFront(card.front)};
    return [
      ...read,
      ...more.where((card) => !fronts.contains(CardKey.fromFront(card.front))),
    ];
  }

  /// Once every photo of the batch is read, adds their cards to the list,
  /// photo by photo, making it with the first.
  Future<void> _finishBatch() async {
    final batch = this.batch;
    if (batch.isEmpty ||
        batch.any((photo) => photo.state is! PhotoRead) ||
        _finishing) {
      return;
    }
    _finishing = true;
    try {
      final read = [
        for (final photo in batch)
          switch (photo.state) {
            PhotoRead(:final cards) => cards,
            _ => throw StateError('A finished batch holds only read photos.'),
          },
      ];
      final keys = list?.existingKeys ?? await _existingKeys(target);
      if (_ended) return;
      final added = <ImportSection>[];
      final ImportList made;
      var rest = read;
      if (list case final existing?) {
        made = existing;
      } else {
        made = ImportList(read.first, keys);
        added.addAll(made.sections);
        rest = read.skip(1).toList();
      }
      for (final cards in rest) {
        added.addAll(made.addPhoto(cards));
      }
      if (target case final deck?) {
        forms.applyTo(made, deck, sections: added);
      }
      list = made;
      _listed = photos.length;
      limitLeft = null;
    } finally {
      _finishing = false;
    }
    _changed();
  }

  var _finishing = false;

  /// The card keys [deck] holds; none for a new deck, or when they cannot be
  /// read, which [deckFailure] holds.
  Future<Set<CardKey>> _existingKeys(DeckId? deck) async {
    if (deck == null) return const {};
    try {
      return {for (final card in await _decks.listCards(deck)) card.cardKey};
    } on DeckFailure catch (failure) {
      deckFailure = failure;
      return const {};
    }
  }

  /// The write of the job's state under way; null while none is.
  Future<void>? _writing;

  /// Whether the job changed while [_writing] was under way.
  var _keepAgain = false;

  /// Writes the job to the store one write at a time: a change during a
  /// write is written once it ends, from the job as it is then, so the last
  /// state written is the latest.
  void _keep() {
    if (_writing != null) {
      _keepAgain = true;
      return;
    }
    _writing = () async {
      do {
        _keepAgain = false;
        await _writeState();
      } while (_keepAgain && !_ended);
      _writing = null;
    }();
  }

  /// Writes the job's target and origin, and each kept photo with its cards
  /// once read, or, before then, those read so far and its cursor. A photo
  /// not yet prepared is not kept.
  Future<void> _writeState() async {
    final state = jsonEncode({
      'version': 1,
      'target': target?.value,
      'origin': origin.name,
      'photos': [
        for (final photo in photos)
          if (photo._kept case (:final key, :final width, :final height))
            {
              'key': key,
              'width': width,
              'height': height,
              if (photo.state case PhotoRead(:final cards))
                'cards': [for (final card in cards) encodeCandidate(card)]
              else if (photo._readSoFar.isNotEmpty) ...{
                'readSoFar': [
                  for (final card in photo._readSoFar) encodeCandidate(card),
                ],
                'cursor': ?photo._cursor,
              },
            },
      ],
    });
    try {
      await _store.writeState(state);
    } on Exception {
      // A job that cannot be kept still reads; only a resume is lost.
    }
  }

  /// The job [_store] keeps, as [_keep] wrote it: paused while it holds
  /// photos still to read, and with its list once every one is read; null
  /// when none is kept or it cannot be read.
  static Future<ImportJob?> restore({
    required ExtractionClient client,
    required ImportJobStore store,
    required DeckRepository decks,
    required SectionForms forms,
  }) async {
    final String? state;
    try {
      state = await store.readState();
    } on Exception {
      return null;
    }
    if (state == null) return null;
    final Object? json;
    try {
      json = jsonDecode(state);
    } on FormatException {
      return null;
    }
    if (json case {
      'version': 1,
      'origin': final String origin,
      'photos': final List<Object?> kept,
    }) {
      final from = PhotoOrigin.values.asNameMap()[origin];
      final target = switch (json['target']) {
        final String id => DeckId(id),
        _ => null,
      };
      if (from == null) return null;
      final job = ImportJob(
        target: target,
        origin: from,
        client: client,
        store: store,
        decks: decks,
        forms: forms,
      );
      for (final photo in kept) {
        if (photo case {
          'key': final String key,
          'width': final int width,
          'height': final int height,
        }) {
          final PhotoState state = switch (photo['cards']) {
            final List<Object?> cards => switch ([
              for (final card in cards) decodeCandidate(card),
            ]) {
              final decoded when decoded.every((card) => card != null) =>
                PhotoRead(decoded.whereType<CandidateCard>().toList()),
              _ => const PhotoWaiting(),
            },
            _ => const PhotoWaiting(),
          };
          final restored = JobPhoto._stored((
            key: key,
            width: width,
            height: height,
          ), state);
          // A page left unread past its cards goes on from its cursor; one
          // whose cards cannot be read back is read again from the start.
          if (photo['readSoFar'] case final List<Object?> cards
              when state is PhotoWaiting) {
            final decoded = [for (final card in cards) decodeCandidate(card)];
            if (decoded.every((card) => card != null)) {
              restored
                .._readSoFar = decoded.whereType<CandidateCard>().toList()
                .._cursor = switch (photo['cursor']) {
                  final String cursor => cursor,
                  _ => null,
                };
            }
          }
          job.photos.add(restored);
        }
      }
      if (job.photos.isEmpty) return null;
      job.paused = job.photos.any((photo) => photo.state is! PhotoRead);
      job._changed();
      return job;
    }
    return null;
  }
}
