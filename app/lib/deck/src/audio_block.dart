import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../design/app_button.dart';
import '../../design/theme.dart';
import 'undo_snack_bar.dart';
import '../../l10n/app_localizations.dart';
import '../../media/media.dart';
import 'content.dart';

/// The side of the play control, large enough to find and hit at a glance
/// on a study card (ADR 0112).
const audioControlSize = 64.0;

/// [duration] as minutes and seconds, `0:07`, rounded up to the second.
String audioLength(Duration duration) {
  final seconds = (duration.inMilliseconds / 1000).ceil();
  return '${seconds ~/ 60}:${(seconds % 60).toString().padLeft(2, '0')}';
}

/// A sound block: a round play control named "소리 듣기", which plays it
/// through `media`'s player, and its length under it (ADR 0112).
class AudioBlockView extends StatelessWidget {
  const AudioBlockView(this.audio, {super.key});

  final AudioContent audio;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    return Column(
      mainAxisSize: MainAxisSize.min,
      spacing: AppSpace.s4,
      children: [
        SizedBox.square(
          dimension: audioControlSize,
          child: IconButton.filled(
            tooltip: l10n.playAudio,
            style: IconButton.styleFrom(
              backgroundColor: colors.brandTint,
              foregroundColor: colors.ink,
            ),
            iconSize: audioControlSize / 2,
            icon: const Icon(LucideIcons.volume2),
            onPressed: () => playAudio(context, audio),
          ),
        ),
        ExcludeSemantics(
          child: Text(
            audioLength(audio.duration),
            style: AppType.caption.copyWith(color: colors.muted),
          ),
        ),
      ],
    );
  }
}

/// Plays [audio], and says so in a snack bar when it cannot be read or
/// played.
Future<void> playAudio(BuildContext context, AudioContent audio) async {
  final messenger = ScaffoldMessenger.maybeOf(context);
  final unplayable = AppLocalizations.of(context).audioUnplayable;
  final playback = ProviderScope.containerOf(
    context,
    listen: false,
  ).read(audioPlaybackProvider);
  if (!await playback.play(audio.media)) {
    messenger?.showSnackBar(SnackBar(content: Text(unplayable)));
  }
}

/// A sound block as the editor edits it: its sound, once one is recorded or
/// picked.
class AudioDraft {
  AudioDraft([this.audio]);

  AudioContent? audio;

  /// Ends the recording under way and puts it in the block; null while the
  /// block records nothing, so saving can keep what was recorded.
  Future<void> Function()? stopRecording;
}

/// What a sound block's fields are doing for the user, shown on its button.
enum _Work { record, pick }

/// Why a sound block's fields show a line under them.
enum _Problem { unreadable, tooLarge, microphone }

/// The sound block that holds the recorder, null while none does. The
/// device has one recorder, so "녹음" is off in every other block until the
/// holder has stopped (ADR 0112).
final recordingBlockProvider = NotifierProvider<RecordingBlock, Object?>(
  RecordingBlock.new,
);

class RecordingBlock extends Notifier<Object?> {
  @override
  Object? build() => null;

  /// Whether [block] now holds the recorder: it did, or no block did.
  bool claim(Object block) {
    if (state != null && state != block) return false;
    state = block;
    return true;
  }

  /// Lets go of the recorder, if [block] holds it.
  void release(Object block) {
    if (state == block) state = null;
  }
}

/// A sound block's fields: "녹음하기" and "파일에서 고르기" until a sound is
/// in it; while recording, the time so far against the limit and
/// "녹음 끝내기", which the limit presses itself; then the sound's play
/// control and length, "다시 녹음", "다른 파일 고르기" and "소리 삭제"
/// (ADR 0112). The microphone is asked for on the first recording alone.
class AudioBlockFields extends ConsumerStatefulWidget {
  const AudioBlockFields({
    super.key,
    required this.draft,
    required this.showErrors,
    required this.onChanged,
    required this.edits,
    required this.onStored,
  });

  final AudioDraft draft;
  final bool showErrors;
  final VoidCallback onChanged;

  /// The edits in this 칸's group, which end an undo offered for what this
  /// widget took out.
  final Listenable edits;

  /// Called with each sound stored for the block, so the editor can let go
  /// of one it does not save.
  final ValueChanged<MediaId> onStored;

  @override
  ConsumerState<AudioBlockFields> createState() => _AudioBlockFieldsState();
}

class _AudioBlockFieldsState extends ConsumerState<AudioBlockFields> {
  /// The recording or pick being started or stored; null while none is.
  _Work? _working;
  bool get _busy => _working != null;
  _Problem? _problem;

  /// The whole seconds the recording under way has run; null while none is.
  int? _recorded;
  Timer? _tick;
  late final AudioRecording _recording = ref.read(audioRecordingProvider);
  // Read here, not on first use: dispose releases it, where ref is unsafe.
  late final RecordingBlock _recorder;

  @override
  void initState() {
    super.initState();
    _recorder = ref.read(recordingBlockProvider.notifier);
  }

  @override
  void dispose() {
    widget.draft.stopRecording = null;
    _tick?.cancel();
    if (_recorded != null) unawaited(_recording.cancel());
    _recorder.release(this);
    super.dispose();
  }

  Future<void> _record() async {
    if (!_recorder.claim(this)) return;
    setState(() {
      _working = _Work.record;
      _problem = null;
    });
    try {
      await _recording.start();
      if (!mounted) {
        await _recording.cancel();
        return;
      }
      setState(() => _recorded = 0);
      widget.draft.stopRecording = _stopRecording;
      _tick = Timer.periodic(const Duration(seconds: 1), (_) {
        final recorded = (_recorded ?? 0) + 1;
        setState(() => _recorded = recorded);
        // The limit stops the recording itself.
        if (recorded >= maxAudioDuration.inSeconds) _stopRecording();
      });
    } on MicrophoneDenied {
      if (mounted) setState(() => _problem = _Problem.microphone);
    } on MediaUnreadable {
      if (mounted) setState(() => _problem = _Problem.unreadable);
    } finally {
      // A recording under way keeps the recorder.
      if (_recorded == null) _recorder.release(this);
      if (mounted) setState(() => _working = null);
    }
  }

  Future<void> _stopRecording() async {
    _tick?.cancel();
    widget.draft.stopRecording = null;
    if (_recorded == null) return;
    setState(() {
      _recorded = null;
      _working = _Work.record;
    });
    await _store(_recording.stop);
  }

  Future<void> _pick() async {
    setState(() {
      _working = _Work.pick;
      _problem = null;
    });
    await _store(ref.read(audioPickProvider).pick);
  }

  /// Stores the sound [take] gives, if any, and puts it in the block.
  Future<void> _store(Future<PreparedAudio?> Function() take) async {
    // Read before the waits: a pick can end after the editor is left.
    final store = ref.read(mediaStoreProvider);
    try {
      final taken = await take();
      if (taken == null) return;
      final media = await store.addAudio(taken);
      // Stored once the fields are gone, it has no block to hold it.
      if (!mounted) {
        await store.release(media);
        return;
      }
      widget.onStored(media);
      setState(
        () => widget.draft.audio = AudioContent(
          media: media,
          duration: taken.duration,
        ),
      );
      widget.onChanged();
    } on MediaTooLarge {
      if (mounted) setState(() => _problem = _Problem.tooLarge);
    } on MediaUnreadable {
      if (mounted) setState(() => _problem = _Problem.unreadable);
    } finally {
      _recorder.release(this);
      if (mounted) setState(() => _working = null);
    }
  }

  /// Deletes the sound at once, and offers to put it back.
  void _remove() {
    final sound = widget.draft.audio;
    setState(() => widget.draft.audio = null);
    widget.onChanged();
    showUndoSnackBar(
      context,
      message: AppLocalizations.of(context).deletedAudio,
      onUndo: () {
        if (!mounted) return;
        setState(() => widget.draft.audio = sound);
        widget.onChanged();
      },
      endOn: widget.edits,
    );
  }

  /// A button that starts [work], showing progress while a file it picked is
  /// stored.
  Widget _button(String label, _Work work, {required bool enabled}) =>
      AppButton(
        label: label,
        variant: AppButtonVariant.secondary,
        loading: work == _Work.pick && _working == work,
        onPressed: !enabled || _busy
            ? null
            : switch (work) {
                _Work.record => _record,
                _Work.pick => _pick,
              },
      );

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    final error = AppType.caption.copyWith(color: colors.dontKnowText);
    final audio = widget.draft.audio;
    final recorded = _recorded;
    // Another block holds the one recorder.
    final recorderTaken = switch (ref.watch(recordingBlockProvider)) {
      final holder? => holder != this,
      null => false,
    };
    final problem = switch (_problem) {
      _Problem.unreadable => l10n.audioUnreadable,
      _Problem.tooLarge => l10n.audioTooLarge(maxAudioDuration.inSeconds),
      _Problem.microphone => l10n.microphoneDenied,
      null when widget.showErrors && audio == null && recorded == null =>
        l10n.audioRequired,
      null => null,
    };
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      spacing: AppSpace.s8,
      children: [
        if (recorded != null) ...[
          Text(
            l10n.audioRecording(
              audioLength(Duration(seconds: recorded)),
              audioLength(maxAudioDuration),
            ),
            textAlign: TextAlign.center,
            style: AppType.bodyStrong,
          ),
          AppButton(
            label: l10n.audioStopRecording,
            // Outlined: the bottom bar holds the screen's one primary fill.
            variant: AppButtonVariant.secondary,
            onPressed: _stopRecording,
          ),
        ] else if (audio != null) ...[
          Center(child: AudioBlockView(audio)),
          Row(
            spacing: AppSpace.s8,
            children: [
              Expanded(
                child: _button(
                  l10n.audioRecordAgain,
                  _Work.record,
                  enabled: !recorderTaken,
                ),
              ),
              Expanded(
                child: _button(
                  l10n.audioPickAnother,
                  _Work.pick,
                  enabled: true,
                ),
              ),
            ],
          ),
          AppButton(
            label: l10n.audioRemove,
            variant: AppButtonVariant.secondary,
            onPressed: _busy ? null : _remove,
          ),
        ] else
          Row(
            spacing: AppSpace.s8,
            children: [
              Expanded(
                child: _button(
                  l10n.audioRecord,
                  _Work.record,
                  enabled: !recorderTaken,
                ),
              ),
              Expanded(
                child: _button(l10n.audioPick, _Work.pick, enabled: true),
              ),
            ],
          ),
        Semantics(
          liveRegion: true,
          child: problem == null
              ? const SizedBox.shrink()
              : Text(problem, style: error),
        ),
      ],
    );
  }
}
