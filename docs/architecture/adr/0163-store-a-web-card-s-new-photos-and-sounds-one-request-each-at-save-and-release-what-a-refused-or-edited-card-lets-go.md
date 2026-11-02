# ADR 0163: Store a web card's new photos and sounds one request each at save, and release what a refused or edited card lets go

> Status: accepted
> Date: 2026-11-03

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #557.** The phone's card editor adds a 사진 칸, a photo picked whole with boxes drawn over it ([ADR 0109](0109-store-an-image-block-s-boxes-in-fractions-of-the-image-and-draw-them-with-the-image-s-one-transform.md)), and a 소리 칸, a recording or a picked `.m4a` or `.mp3` of at most 60 seconds and 5 MiB ([ADR 0112](0112-store-an-audio-block-by-media-id-and-length-up-to-60-seconds-and-play-the-front-s-sound-once-as-a-study-card-appears.md)). The web's editor kept a stored one and added neither ([ADR 0143](0143-edit-a-stored-card-on-the-web-from-its-row-the-later-updated-at-winning.md)), and drew a card's photo as its frame alone, "사진은 앱에서 볼 수 있어요" under it in the editor.
- **The phone stores at pick.** It writes the file to the device and queues its upload, and its editor releases a picked file the saved card does not hold when the card is saved or the editor is left (`card_editor_screen.dart`'s `_releaseUnsaved`). An edit that drops a stored photo or sound releases it after the write, read from the stored card (ADR 0109).
- **The web has one media path** ([ADR 0159](0159-give-the-web-s-note-page-the-phone-s-note-settings-and-the-web-one-media-path-acting-as-the-user.md)), `web/src/features/decks/media.ts`, acting as the user; #557 builds on it. The policies already let `authenticated` insert and delete its own `media` rows and objects, and the bucket takes `audio/mp4` and `audio/mpeg`, so no migration and no server function is needed.
- **A Server Action's request was bounded at 4 MiB** (`web/next.config.ts`), under the phone's 5 MiB sound.
- The PM decided on #557, 2026-11-03: upload each new file in its own Server Action at save; accept only the user's own media of the right kind; release the new ids when a write refuses and a stored card's dropped media after an edit; raise the action limit to 6 MiB; draw a card's photo in the editor, on the note page and in study; offer recording only where the browser records `audio/mp4;codecs=mp4a.40.2`, decided by capability.
- **Alternatives considered:**
  - **The files inside the card's save request**, as `decorateDeck` stores a note's photo. A card has no bound on its 칸, and a request has one, so a card of several sounds could not be saved at all.
  - **Upload at pick**, as the phone stores at pick. The web keeps no device queue, so a tab closed after a pick would leave a file no card names until the account is deleted, which no later run would find to release.
  - **A media id made on the server.** The card's 칸 are built in the browser, so the editor would wait on an answer before it could build them; the phone's ids are made on the device too.

## Decision

### Storing

- The browser prepares a photo as the phone's `ImageShape.whole`: decoded upright by its EXIF orientation, kept at its aspect ratio, scaled to at most 1024 px on its longer side, never up, and encoded as JPEG at quality 85, with its size and SHA-256 (`prepare-image.ts`). A sound is kept as it was picked or recorded, its length read by the browser's player or taken from the recording's clock, and held to the phone's 60 seconds and 5 MiB (`prepare-sound.ts`).
- Each new file is named at pick by a UUID v7 made in the browser, as the phone's are, and stored only when the card is saved: one `storeCardMedia` Server Action per file, through `media.ts`, its `media` row, then its object. The action takes a JPEG photo and a sound whose bytes open as MPEG-4 or ADTS (`audio/mp4`) or as MP3 (`audio/mpeg`), the row recording the type the bytes name, and refuses a wrong digest. A file already stored under its id counts as stored, so a retry succeeds; a store that fails releases what it left.
- The card's write, `addCard` or `editCard`, takes a photo or a sound the stored card does not hold only where the user's own `media` row of that kind names it, and refuses it otherwise.
- `serverActions.bodySizeLimit` is 6 MiB, so a 5 MiB sound fits with its envelope.

### Releasing

- A write that refuses releases the files it named that nothing else holds, so a file stored for a card that was not saved does not stay. The editor keeps the prepared files, and its next save stores them again, "그래도 추가" and "그래도 저장" among them.
- After an edit is written, the photos and sounds the stored card held and the edit drops are released unless another live deck or card holds them, read from the stored row, as the phone's `editCard`. A release that fails leaves the write standing, logged with the ids.

### Drawing

- `readLibrary` signs every card photo and sound for the user in one request, valid for 4 hours, past a study session, and gives each block its URL; a block has none where Storage does not sign. The URL is never written: `encodeCells` writes a block's stored fields alone.
- The editor draws a stored photo from that URL and a picked one from its object URL, with its boxes; the note page's whole card and study's cards draw it the same way. A photo with no box, on one side of a split card, is drawn whole on that side in study, as the phone draws it; a list row names it "사진", as the phone's row does.
- Study's sounds play from the same URLs, so study signs nothing of its own.

### Recording

- "녹음하기" is drawn only where `MediaRecorder` records `audio/mp4;codecs=mp4a.40.2`, mono AAC in MPEG-4 at 64 kbit/s, as the phone records; elsewhere "파일에서 고르기" is the 소리 칸's one way in. One 칸 records at a time. The minute stops a recording itself.

## Consequences

- A photo or sound added on the web shows and plays on the web and, once synced, on the phone.
- A tab closed between a file's store and its card's write leaves that file unnamed until the account is deleted. The window is one save's requests long, rather than the time an editor stays open.
- A card refused after its files were stored costs their upload again on the next save.
- A note page or a study session holding a card with media makes one more Storage request.
- A browser that records no AAC in MPEG-4, Firefox and Chromium without the platform's encoder among them, offers no recording.
- The MCP orphan in #557's comment, a card refused after its photo was stored, is not covered here; it is the server function's, filed as its own issue.

## Signs the decision was wrong

- Orphaned card files, logged as `media not released`, grow enough to matter in storage cost.
- A card with several sounds fails to save on a slow connection, which would point at storing them at pick, with a sweep for files no card names.
- A photo or sound added on the web is missing or unplayable on the phone, which would point at a difference in the stored shape or type.
