# Media

The `media` domain: the user's images and sounds, kept on the device and in the private `media` bucket on the server, each named by its media id; picking and preparing an image, recording, picking and playing a sound, the upload and deletion queues, and the download cache.

## Current decisions

### Surface and location

- The domain lives in `app/lib/media/`; its public surface is `app/lib/media/media.dart`, with internals under `app/lib/media/src/` ([ADR 0002](adr/0002-domain-public-surface-and-shared-database.md)).
- The surface exports:
  - the model: `MediaId`, a stored file's id, `PreparedImage`, an image made ready to store, `PreparedAudio`, a sound made ready to store, with `maxAudioDuration` and `maxAudioBytes`, its limits, `MediaUpload`, a queued file with what its server row records, and `FetchedMedia`, another user's file read to copy it;
  - `MediaStore`, the files on the device and the two queues, and `mediaStoreProvider`, which the composition site overrides with the store it constructs;
  - `MediaImage`, the widget that draws an image by its id;
  - `ImagePick`, the seam through which the user picks an image, `ImageOrigin`, the camera or the album, and `imagePickProvider`, the device's camera and photo library unless a test replaces it;
  - the sound seams, each with a provider of the device's implementation that a test replaces: `AudioRecording` and `audioRecordingProvider`, the microphone; `AudioPick` and `audioPickProvider`, the file picker; `AudioPlayback` and `audioPlaybackProvider`, the player over the store; and `prepareAudio`, which holds a sound to its limits ([ADR 0112](adr/0112-store-an-audio-block-by-media-id-and-length-up-to-60-seconds-and-play-the-front-s-sound-once-as-a-study-card-appears.md));
  - `MediaServer`, the seam to the server, `SupabaseMediaServer`, its implementation, and `UnavailableMediaServer`, the server of a build that cannot sign in;
  - the failures: `MediaFailure`, `MediaTransferFailed`, `MediaUnreadable`, `MediaTooLarge`, a sound past its limits, and `MicrophoneDenied`.
- It imports no other domain. `deck` imports it for a deck's image and a card's photos and sounds, `study` to stop a sound as its screen closes, and `sync` to drain its queues ([`deck.md`](deck.md), [`study.md`](study.md), [`sync.md`](sync.md)). It imports `supabase_flutter` for PostgREST and Storage, beside `account`, `sync` and `sharing`, and `image_picker`, `image` and `crypto`, as `app/pubspec.yaml` already declares them, and `record`, `just_audio` and `file_picker`, each pinned exactly in `app/pubspec.yaml` and moved by Dependabot.
- `main.dart` builds `SupabaseMediaServer` over `connectAccount`'s client, or `UnavailableMediaServer` without one, and keeps files in `media/` under the app's support directory.

### Images

- A stored file is named by a media id, a UUID v7 from the composition site's generator; a deck holds that id, never a URL ([ADR 0107](adr/0107-store-media-in-a-private-supabase-storage-bucket-named-by-media-id-and-give-each-deck-an-image.md)).
- `DeviceImagePick` takes one photo from the camera or the album through `image_picker`, at most 2048 px a side, and prepares it on a background isolate in the `ImageShape` its caller asks for: its EXIF orientation applied, then, for `square`, the default and a deck's tile's, cropped to its centred square, or, for `whole`, a card's photo's, kept whole at its aspect ratio; scaled to at most 1024 px on its longer side and encoded as JPEG at quality 85, with its SHA-256 and its width and height in pixels. A refused camera or library, or bytes no decoder reads, is `MediaUnreadable`.
- A whole image keeps its aspect ratio through the scale, so a box stored in fractions of it covers the same pixels at the size it was drawn on and the size it is stored at ([ADR 0109](adr/0109-store-an-image-block-s-boxes-in-fractions-of-the-image-and-draw-them-with-the-image-s-one-transform.md)).
- The server's ceiling is 10 MiB a file, for an image or a sound (`server-schema.md` §Media storage); it is a ceiling, not the target, and the resize above, not the ceiling, sets a prepared image's size, far below it ([ADR 0107](adr/0107-store-media-in-a-private-supabase-storage-bucket-named-by-media-id-and-give-each-deck-an-image.md)).

### Sounds

- A sound is a recording or a picked file, at most `maxAudioDuration` (60 s) and `maxAudioBytes` (5 MiB); `prepareAudio` refuses one past either as `MediaTooLarge` ([ADR 0112](adr/0112-store-an-audio-block-by-media-id-and-length-up-to-60-seconds-and-play-the-front-s-sound-once-as-a-study-card-appears.md)).
- `DeviceAudioRecording` records through `record`: AAC-LC in an MPEG-4 container, mono at 64 kbit/s, `audio/mp4`, its length the time it ran. The first start on a device asks for the microphone, through `NSMicrophoneUsageDescription` on iOS and `RECORD_AUDIO` on Android, and a refusal is `MicrophoneDenied`.
- `DeviceAudioPick` picks one `.m4a` or `.mp3` through `file_picker`, kept as it is, `audio/mp4` or `audio/mpeg`, its length read by `just_audio`. A file of another kind, or one no player reads, is `MediaUnreadable`.
- `DeviceAudioPlayback` plays one sound at a time through `just_audio`, from the file `MediaStore.fileOf` gives, and answers false when there is none or the player refuses it.

### Store

- `MediaStore.addImage` and `addAudio` write the file to the device under its id, whole or not at all, and queue it in `media_uploads` with its kind, `image` or `audio`, its MIME type, size, digest and creation time. It shows, or plays, at once from the device.
- `release` takes a file out of the upload queue and queues it in `media_deletions`. It writes only rows, so it joins its caller's transaction, a deck's write, whose repository releases an id only once no other live deck or card on the device holds it ([`deck.md`](deck.md)).
- `read` returns the file on the device, or else downloads it, keeps it on the device and returns it; it returns null when neither holds it or the server fails, and a later read tries again. Two reads of one id at once fetch it once. `fileOf` is `read` giving the kept file, which a player plays offline from then on.
- `fetchShared` reads files of another user's folder, to copy a public deck's photos and sounds ([ADR 0113](adr/0113-copy-a-public-deck-s-photos-and-sounds-into-the-copier-s-own-media-under-new-ids-when-the-deck-is-copied.md)):
  - it reads up to 4 at once, and tries each up to 3 times while the network fails;
  - it reads each file's kind and type from its first bytes, since the owner's row is not readable: JPEG as `image/jpeg`; PNG as `image/png` and WebP as `image/webp`, as an MCP card's photo is stored ([ADR 0144](adr/0144-take-and-return-an-mcp-card-as-blocks-fetch-its-photo-from-a-public-https-url-and-store-png-and-webp-as-they-came.md)); an MPEG-4 `ftyp` box, or an ADTS AAC header (layer bits `00`, as a picked `.aac` is stored), as `audio/mp4`; and an ID3 tag, or a frame sync of another layer, as `audio/mpeg`;
  - it writes each file to the device under a new id as it arrives, queues none, and returns only ids and metadata, so only the files in flight are held in memory;
  - it leaves out a file the server does not let the user read, one of no such type, and one the network failed on every try.
- `addFetched` queues a fetched file for upload, its row joining its caller's transaction, and `discardFetched` deletes fetched files from the device. `deck`'s copy calls both ([`deck.md`](deck.md)).
- `drain` uploads each queued file, then deletes each released one from the server and then the device, and says whether both queues are empty. A transfer that fails stays queued while the others run. A queued file no longer on the device is dropped from the queue, as there is nothing to upload.
- `sync`'s controller runs `drain` after each successful run, and retries with its backoff while a queue is left ([`sync.md`](sync.md)). Sign-out clears both queues with the device's other rows.
- `media_uploads` and `media_deletions` are this domain's tables, in the shared database `app/lib/database/database.dart`, since schema v12.

### Server

- `SupabaseMediaServer` acts as the signed-in user, whose id is the folder of each file, `{owner}/{media id}` ([`server-schema.md`](server-schema.md) §Media storage):
  - an upload inserts the `media` row, keeping the user's own row already there under the id, the table's key being `(user_id, id)`, then uploads the file without overwriting; a file Storage already holds counts as uploaded, so a retry after a lost answer succeeds;
  - a suspended user's upload is refused, and stays queued like any refusal;
  - a download reads the signed-in user's own folder, or the folder of the owner it is given, which the server lets the user read for a public deck's live cards ([`server-schema.md`](server-schema.md) §Media storage); one of a file Storage does not hold, or does not let the user read, returns null;
  - a delete removes the file, then the user's row under the id.
- Each request is bounded by 20 seconds. A timeout, a refusal, an unreachable server or no signed-in user is `MediaTransferFailed`, which the store keeps queued.

### Drawing

- `MediaImage` draws the image covering its box, and its `fallback` while the image is read and when it cannot be. `DeckTile` gives it the deck's icon tile as the fallback, and a card's photo a frame of the image's own aspect ratio, so covering it draws it whole, with `ground` as the fallback ([`deck.md`](deck.md)).

### Tests

- `app/test/media/media_store_test.dart` — an added image read from the device before any upload, a drain uploading with its row and emptying the queue, a failed upload and deletion kept queued until a later drain, a released image never uploaded and deleted from the server and the device, a download kept on a second device, and a missing file read as null and tried again.
- `app/test/media/media_store_test.dart` also holds a sound added and uploaded as `audio` of its own type, kept on a second device by its first `fileOf` and played from there offline, and a sound past 60 s or 5 MiB refused against one at both limits.
- `app/test/media/media_store_test.dart` also holds another user's files: read from the owner's folder with the kind and type their bytes show, an ADTS stream as `audio/mp4` apart from an MP3 frame, and bytes of no accepted type left out; a fetched file kept on the device under a new id and unqueued, against the owner's id absent from the user's own folder, then one queued and uploaded and the other discarded from the device and never uploaded; a file failing twice read on its third try, against one failing three times left out; and a removed file left out without a retry.
- `app/test/media/image_test.dart` — a wide image cropped to its centred square, a large one scaled to the bound, the digest, unreadable bytes refused against a readable image, a whole image keeping its aspect ratio and size against a square from the same source, and a box in fractions covering the same pixels of an image at its full and its stored size.
- `app/test/media/supabase_media_server_test.dart` — `SupabaseMediaServer` over a substituted HTTP client: the row then the file at `{owner}/{media id}` without overwriting, a duplicate file counted as uploaded against another refusal failing, a missing download as null, a download with an owner reading that owner's folder against one without reading the user's own, a delete's two requests, and an unreachable server as `MediaTransferFailed`.
- `app/test/media/fakes.dart` holds `FakeMediaServer`, the server in memory, with other users' files and downloads set to fail, `FakeImagePick`, a picker that records the origin and shape asked for, `FakeAudioRecording`, `FakeAudioPick` and `FakeAudioPlayback`, which record what they were asked, and the test images and sounds, `mp4Bytes` and `mp3Bytes` among them; the deck, study, sync and sharing tests use them.

## Rationale

- [ADR 0107](adr/0107-store-media-in-a-private-supabase-storage-bucket-named-by-media-id-and-give-each-deck-an-image.md) records why media lives in a private Supabase Storage bucket named by id, the path scheme and the size limits, why an image is cropped to a centred square, and why the device stores first and uploads after.
- Issue #383 records the owner's request and the PM's decision.
- [ADR 0112](adr/0112-store-an-audio-block-by-media-id-and-length-up-to-60-seconds-and-play-the-front-s-sound-once-as-a-study-card-appears.md) records a sound's formats and limits, why a picked file is not transcoded, and why a sound plays from the file kept on the device.
- [ADR 0109](adr/0109-store-an-image-block-s-boxes-in-fractions-of-the-image-and-draw-them-with-the-image-s-one-transform.md) records why a card's photo is kept whole at its aspect ratio, with its size, rather than cropped as a tile's is, why a release waits for the last card or deck holding the id, and why any signed-in user reads the photos of a public deck's live cards.
- [ADR 0113](adr/0113-copy-a-public-deck-s-photos-and-sounds-into-the-copier-s-own-media-under-new-ids-when-the-deck-is-copied.md) records why a copy of a public deck stores the owner's files under new ids in the copier's own media, and why a fetched file's type is read from its bytes.

## Open questions

- Whether files a deck deleted on another device left behind on this one should be swept. None is large yet.
