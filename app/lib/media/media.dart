/// The media domain: the user's images and audio, kept on the device and in
/// a private bucket on the server, each named by its media id (ADR 0107,
/// ADR 0112).
library;

export 'src/audio.dart'
    show AudioPick, AudioPlayback, AudioRecording, prepareAudio;
export 'src/failure.dart'
    show
        MediaFailure,
        MediaTooLarge,
        MediaTransferFailed,
        MediaUnreadable,
        MicrophoneDenied;
export 'src/media_image.dart' show MediaImage;
export 'src/media_store.dart' show MediaStore;
export 'src/model.dart'
    show
        FetchedMedia,
        ImageShape,
        MediaId,
        MediaUpload,
        PreparedAudio,
        PreparedImage,
        maxAudioBytes,
        maxAudioDuration;
export 'src/image.dart' show prepareImage;
export 'src/picker.dart' show ImageOrigin, ImagePick;
export 'src/providers.dart'
    show
        audioPickProvider,
        audioPlaybackProvider,
        audioRecordingProvider,
        imagePickProvider,
        mediaStoreProvider;
export 'src/server.dart' show MediaServer, UnavailableMediaServer;
export 'src/supabase_media_server.dart' show SupabaseMediaServer;
