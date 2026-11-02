# ADR 0159: Give the web's note page the phone's 노트 설정, and the web one media path acting as the user

> Status: accepted
> Date: 2026-11-03

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #582.** The phone's note screen has one ⋯, "노트 설정", holding 이름 바꾸기, 노트 꾸미기 (icon, colour, photo), 노트 공개 or 비공개로 전환, and 노트 삭제 (`app/lib/home/src/deck_screen.dart`). [ADR 0150](0150-open-on-a-home-of-today-on-the-hero-with-the-notes-in-a-drawer-keep-the-menu-on-a-note-and-make-a-note-on-a-full-screen.md) left the web's note page without a ⋯ because the web had none of these. `design.md` §Principles 9 makes mobile web the app.
- **The phone's writes.** A rename writes `name`; 꾸미기 writes `icon` and `color`, and its photo is a media id in `decks.image_media_id`, the file cropped to its centred square, at most 1024 px, JPEG at quality 85, with its SHA-256 (`app/lib/media/src/image.dart`), stored as its `media` row, then the object `{owner}/{media id}`, and the replaced image released unless another live deck or card holds it (`deck_repository.dart`'s `setImage` and `_releaseUnheld`). 공개 sets the display name the first time, then `visibility`, `published_at` and `description` (`sharing_service.dart`). 삭제 tombstones the deck and its cards, then releases what they held, as [ADR 0149](0149-edit-and-delete-cards-and-decks-through-mcp-as-the-clients-do-each-block-keeping-its-id.md) records for the clients and MCP.
- **The policies already allow every write as the user.** `authenticated` updates its own `decks` and `cards` columns and inserts its own `profiles` row (`20261015180000_public_decks.sql`); it inserts, reads and deletes its own `media` rows and the objects in its own folder (`20261026140000_media.sql`). No migration and no server function is needed.
- **The web had no media path.** It read no file from the bucket but a study card's sounds, signed by `study`'s `signSounds` ([ADR 0112](0112-store-an-audio-block-by-media-id-and-length-up-to-60-seconds-and-play-the-front-s-sound-once-as-a-study-card-appears.md)), and wrote none. Issue #557, a photo or sound 칸 from the web's card editor, needs the same upload and release.
- The PM chose on #582, 2026-11-03, full parity: the photo is uploaded, released and drawn on the web, through one general module that #557 builds on.
- **Alternatives considered:**
  - **Upload from the browser with the browser's Supabase client.** It would put a second writer of the user's rows beside the Server Actions, outside the boundary where every other web write is parsed. The issue asks for Server Actions.
  - **Write only, drawing a stored photo as the icon.** Smaller, and leaves a photo picked on the web invisible on the web, which §Principles 9 calls a defect.
  - **A deck-photo module of its own.** #557 would then write a second upload and release beside it.
  - **Release the replaced photo before writing the deck.** A failure after the release would leave the deck naming a file that is gone.

## Decision

### 노트 설정

- The note page's top bar holds "노트 설정", a ⋯ on the surface beside the magnifier, on a note with cards and on one with none. Its menu is the phone's: "이름 바꾸기", "노트 꾸미기", "노트 공개" or, on a published note, "비공개로 전환", and "노트 삭제" in red.
- Each item opens the phone's sheet as an `AuthoringSheet` ([ADR 0158](0158-open-the-web-s-authoring-flows-as-full-screens-below-1024-px-with-the-browser-s-back-as-the-phone-s-back.md)), except "비공개로 전환", which acts at once, as on the phone. A publish, a return to private, and a failure of the latter are said in a snack bar, as the phone's are.
- "노트 삭제" asks as `showAppConfirm` does (`design.md` §Principles 5): the note's name in the title, one sentence of what goes with it, "취소" and, last, a red "삭제". A deletion leaves the dialog's history entry, then opens 홈.
- The web has no offline state, so "노트 공개" is never disabled for want of a network, unlike the phone's.

### The writes

- Each is a Server Action in `web/src/features/decks/`, parsed at the boundary, acting with the user's session under row-level security, and scoped to the user's live deck: `renameDeck`, `decorateDeck`, `publishDeck`, `unpublishDeck` and `deleteDeck`.
- A deletion tombstones the cards first, then the deck, at one time, as MCP's `delete_deck` does, so a failure between the two leaves the deck to delete again. It then releases the deck's image and its cards' photos and sounds that nothing else holds. A release that fails leaves the deletion standing.

### The media path

- `web/src/features/decks/media.ts` is the web's one path to the `media` bucket, server-only, acting as the user:
  - **storing** a prepared JPEG: its `media` row, keeping one already there, then its object, a file Storage already holds counting as stored, in the order `SupabaseMediaServer` uploads;
  - **releasing** files no live deck or card of the user's holds, as the phone reads holding: a deck by its image, a card by any side naming the id. The object goes, then its row, and the ids not released are answered;
  - **signing** URLs to draw files from, short-lived, made on the server with the user's session, never a service-role key.
- The browser prepares a tile's photo as the phone's `cropImage` does (`prepare-image.ts`); the action refuses a file that is not a JPEG, is larger than the bucket's 10 MiB, or whose SHA-256 is not the one sent.
- 노트 꾸미기 stores a new photo before it writes the deck, so an upload that fails leaves the note and its photo as they were, says so under the photo's buttons, and releases the row it left. The replaced photo is released after the deck is written; a release that fails keeps the new photo, leaves the old file in place, and is logged.
- The reads that list notes, `readDeckList` and `readLibrary`, sign each deck's image in one request. The tile draws the photo covering it, over its icon, which shows while the photo is read and where it cannot be, as the phone's `DeckTile` draws its fallback: on 홈's rows and in 노트 꾸미기's preview. The note page draws no tile, as on the phone.
- `study`'s sounds are signed through the same module. #557 builds its photo and sound 칸 on it.

## Consequences

- ADR 0150's "The web's note page has the magnifier and no ⋯" is superseded; the rest of it stands.
- The web reads a deck's photo from the bucket. A card's photo is still drawn as its frame alone, as [ADR 0109](0109-store-an-image-block-s-boxes-in-fractions-of-the-image-and-draw-them-with-the-image-s-one-transform.md) has it, until a later change draws it.
- A note page or 홈 holding a deck with a photo makes one more Storage request.
- A deck's signed URL lasts an hour; a tile drawn from one that has expired shows its icon until the page is read again.
- The web writes without a transaction: a deletion is two statements, and a failure between storing a file and writing the deck leaves a row and a file the action then releases, or, if that fails too, files no live deck or card names.
- The e2e stack runs no Storage, so the photo path is tested in process against a substitute of Storage's API, and against the real one only by hand.

## Signs the decision was wrong

- Users report a photo set on the web missing on the phone, or the other way round, which would point at a difference in the stored shape.
- Orphaned files, logged as `media not released`, grow enough to matter in storage cost.
- #557 cannot reuse the module without changing its shape.
