# ADR 0112: Store an audio block by media id and length, up to 60 seconds, and play the front's sound once as a study card appears

> Status: accepted; its copy keeping the owner's media id refined by ADR-0113; its "소리 빼기" superseded by [ADR 0172](0172-undo-every-delete-in-the-card-editor-focus-what-an-add-makes-and-show-what-a-refused-save-refuses.md)
> Date: 2026-10-27

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #391** records the owner's approval of 2026-10-26, part of the flexible-card direction: a recording or an audio file on either side of a card, played in study. An example is a sound on the front, and a photo and the meaning on the back. Its criteria:
  - the payload is `{media, duration_ms}`, versioned per #388;
  - the editor records, asking for the microphone on first use alone, or picks a file; it shows the length, plays back, and replaces or removes the sound, within a limit this ADR states;
  - study shows a large play control named "소리 듣기", plays the front's sound once as the card appears unless the user turns that off, keeps the sound on the device after its first play, and lets a screen reader play it from the card's actions;
  - the web plays the same block.
- **[ADR 0106](0106-store-each-card-s-template-and-each-block-s-version-and-id-derive-one-face-or-front-back-from-blanks-and-keep-unknown-shapes-unchanged.md)** versions each block and keeps a block a build cannot read unchanged. **[ADR 0108](0108-add-a-free-template-and-an-add-control-that-puts-any-block-on-either-side-of-every-template.md)** left 음성 out of the add sheet until this issue.
- **[ADR 0107](0107-store-media-in-a-private-supabase-storage-bucket-named-by-media-id-and-give-each-deck-an-image.md)** stores media by id in a private bucket. That bucket accepts `image/jpeg` alone, though `public.media.kind` already allows `audio`. ADR 0107 says audio widens the MIME types in its own migration.
- **[ADR 0109](0109-store-an-image-block-s-boxes-in-fractions-of-the-image-and-draw-them-with-the-image-s-one-transform.md)** lets any signed-in user read a photo that an `image` block names in a public deck's live card. It releases a card's photo once no other card or deck on the device holds it.
- **The PM's dispatch of #391** names the bucket's new type, `audio/mp4`, which both phones record. It asks the card-photo read to cover audio blocks, release to count sounds, and the autoplay setting to sit where the study settings live. On review of the package choice, the PM accepted `record`, `just_audio` and `file_picker`, pinned exactly, and `audio/mpeg` beside `audio/mp4`. The ceiling stays 10 MiB.
- Alternatives considered:
  - **Transcode a picked file to AAC on the device.** That would need an encoder such as FFmpeg in the app, for files the phones already play. MP3 is accepted as it is instead.
  - **Store the length only in `public.media`.** A reader would then fetch a row before showing the length. The payload carries it, and the file is the source of nothing else.
  - **A per-account, synced autoplay setting in `study_settings`.** That would mean a migration and a sync change for a playback preference. Device settings such as the coach's are kept on the device.
  - **Autoplay on the web.** Browsers refuse sound before the page's first gesture, and a session opens from a link. A sound that plays on one card and not on another reads as a fault.
  - **A play control inside the web's whole card.** The deck page's card is a button, and a button cannot hold another.

## Decision

- **The payload.** A block of type `audio`, at v1: `{media, duration_ms}`.
  - `media` is a media id, never a URL.
  - `duration_ms` is a positive whole number, the sound's length, so the length shows before the file is read.
  - Fields this build does not know are written back as they were read.
  - A block missing either field, or with a length that is not a positive whole number, is unreadable.
  - A sound is not a blank, so `oneFaceOf` is unchanged.
  - Its card-key text is its media id, so two sound cards never collide. It reads as "음성" in a side's line and to a screen reader.
- **Format and limits.**
  - A recording is AAC-LC in an MPEG-4 container, mono at 64 kbit/s, stored as `audio/mp4`.
  - A picked file is an `.m4a` or an `.mp3`, stored as it is, as `audio/mp4` or `audio/mpeg`.
  - A sound plays for at most 60 seconds and holds at most 5 MiB. A recording stops itself at 60 seconds. A picked file past either limit is refused with "60초, 5MB까지 넣을 수 있어요".
  - The bucket accepts `image/jpeg`, `audio/mp4` and `audio/mpeg`, at most 10 MiB a file, as its ceiling.
- **The editor.** "+ 앞면에 추가" and "+ 뒷면에 추가" offer 음성. Its block offers "녹음하기" and "파일에서 고르기".
  - While recording, it shows the time against the limit and "녹음 끝내기".
  - With a sound, it shows the play control and the length, "다시 녹음", "다른 파일 고르기" and "소리 빼기".
  - The microphone is asked for on the first "녹음하기" alone. A refusal says "마이크를 쓸 수 없어요. 설정에서 마이크 접근을 허용해 주세요.".
  - A sound is stored through `media` at once. One the saved card does not hold is released, as ADR 0109 releases a photo.
- **Study on the phone.** A side's sound is drawn as a round play control 64 across, named "소리 듣기", with its length under it.
  - The current card plays its front's first sound once as it appears while the device's "앞면 소리 자동 재생" is on. It is on until the user turns it off.
  - The current card offers "소리 듣기" among its screen reader actions when its front holds a sound. The previous card offers it for its back's first sound, or else its front's.
  - Closing the screen stops what plays.
- **The autoplay setting** lives on the account screen, between "하루 공부 시간" and "품사 표시". It is kept on the device under `autoplayAudio` in the study domain's storage and not synced.
- **Caching.** The player plays from the file `media` keeps on the device. A sound another device stored is downloaded on its first play and kept there, so it plays offline from then on.
- **The web.** The study page signs the user's sounds in one Storage request on the server, valid for 4 hours. It draws each sound's "소리 듣기" control under the current card's front and in the opened card. The browser keeps a sound once played, and nothing plays on its own. The deck page and the whole card name a sound "음성" with its length, with no control.
- **Reading another's sound.** The card-photo read of ADR 0109 covers audio blocks too: `public.media_in_public_card` matches an `image` or an `audio` block. Migration `20261027120000_media_audio.sql` replaces that function and widens the bucket's types. It rewrites no row of `media`, `cards` or `storage.objects`.
- **Release.** `mediaOf` names a side's sounds beside its photos, so the repository releases a sound as it releases a photo: on an edit that drops it, and with its card or its deck, once no other live card or deck on the device holds it.
- This **extends** ADR 0106's block types and ADR 0108's add sheet. It **refines** ADR 0107's MIME types and ADR 0109's read of a public card's photo.

## Consequences

- A card can hold a sound on either side, on its own or beside any other block, and both phones and the web play it.
- A sound plays offline on the device that recorded it at once, and on another device after its first play there.
- A copy of a public deck carries its sounds' media ids. The copier reads the owner's file while the owner's card is in a public deck, as a copied photo is read.
- The web needs a signed address per sound, made once per page; a session open past 4 hours plays no sound until the page reloads.
- MP3 and AAC files stay in the formats they came in, so a later format change does not touch stored sounds.

## Signs the decision was wrong

- Users ask for sounds longer than a minute, such as a passage read aloud, which would ask for a higher limit and resumable uploads.
- Picked files are often refused for their format, which would ask for transcoding or wider types.
- Users turn autoplay off on one device and expect it off on another, which would ask for the setting to sync.
- Web learners expect the front's sound to play by itself, which would ask for autoplay after the session's first gesture.
