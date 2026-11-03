# ADR 0109: Store an image block's boxes in fractions of the image and draw them with the image's one transform

> Status: accepted; its read of a public card's photo refined by ADR-0112 to cover a card's sound, and its copy keeping the owner's media id by ADR-0113; its filled hidden box and outlined revealed one, on study's cards, superseded by ADR 0176
> Date: 2026-10-27

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #389** records the owner's request of 2026-10-26: a 사진 block with blanks, boxes drawn over a photo, hidden in study and revealed in place. The photo is drawn at different sizes and aspect ratios on a PC and on each phone, and the boxes must cover exactly what they covered when drawn.
- **[ADR 0106](0106-store-each-card-s-template-and-each-block-s-version-and-id-derive-one-face-or-front-back-from-blanks-and-keep-unknown-shapes-unchanged.md)** gave every block a type, a version and an id, and `oneFaceOf` decides one face from blanks. **[ADR 0108](0108-add-a-free-template-and-an-add-control-that-puts-any-block-on-either-side-of-every-template.md)** added the 자유 template and the "+ 추가" sheet, and left 사진 to this issue.
- **[ADR 0107](0107-store-media-in-a-private-supabase-storage-bucket-named-by-media-id-and-give-each-deck-an-image.md)** stores images by media id. Its picker crops to a centred square for a deck's tile, and the web reads no file from the bucket yet. Only a public deck's own image is readable to anyone but its owner.
- **This ADR refines ADR 0107.** ADR 0107 crops every stored image to its centred square; a card's photo is kept whole instead, and a deck's tile keeps the square. It also extends ADR 0107's read of a public deck's image to the photos of its cards.
- Alternatives considered:
  - **Boxes in screen pixels, or in the pixels of the image at one size.** A different screen or a re-encoded image would move every box.
  - **Crop the photo to a fixed shape, as the tile does.** That would cut off what the user drew boxes over on one screen or another, and a crop that differs per screen breaks the boxes.
  - **Draw the boxes in a layer scaled apart from the photo.** Two transforms drift apart as soon as one is changed.
  - **A crop and rotation step in the editor now.** Nothing in the issue's acceptance needs it, and it would bring an image editor and re-encoding into this change. The rule below holds without it.
  - **Ids for boxes from the repository's id generator, as blocks get.** The PM's dispatch of #389 keeps the repository to releasing media. A box id has to be unique only within its block.

## Decision

- **The payload.** A block of type `image`, at v1: `{media, width, height, boxes: [{id, x, y, w, h, answer?}]}`.
  - `media` is the media id, never a URL.
  - `width` and `height` are the stored image's pixels. With them the aspect ratio is known before the file is read, so the layout does not jump.
  - Fields this build does not know, on the payload or on a box, are written back as they were read.
  - A box with no answer is still a blank. Once revealed it shows the photo under its outline.
- **The coordinate space.** `x`, `y`, `w` and `h` are fractions, from 0 to 1, of the stored image's own width and height.
  - They are never screen pixels.
  - A box lies inside the image, with a width and a height above 0.
  - Ids are distinct within the block. The editor gives a new box one more than the highest number among them.
- **One transform.** The photo is drawn whole (`contain`), as large as fits, never cropped differently per screen.
  - Each box is placed in the same frame, at its fractions of the frame's size. The one scale and offset that place the photo place the boxes, so a resize, a rotation of the phone or a change of text scale moves and scales them together.
  - A view that zooms the photo zooms the frame, boxes included.
  - On the web, the frame is a container with the image's aspect ratio, and each box is positioned in percentages of it.
- **Constant chrome.** A box's border (2 logical pixels), its corners and the revealed answer's label are in logical pixels and do not scale with the photo.
  - The photo fits the space it is given itself, so nothing scales it as a picture.
  - In the editor, a box's target is at least 48 on each side, about its centre, however small the box is drawn. That is Android's minimum, above iOS's 44 pt. The selected box's resize handle is a target of the same size, hidden from a screen reader, since the tools resize without a drag.
- **Study.** A box is a blank for `oneFaceOf`, so a card with a boxed photo is studied on one face by ADR 0106's and ADR 0108's rules.
  - The current card fills each box opaquely in `hero`.
  - Once answered, the previous card and its sheet show each box as an outline in `brand`, with its answer on `brandTint` at its top left.
  - A photo with no box is not a blank. It is drawn on its side like any block.
  - A screen reader hears "사진" and each box as "빈칸", or as its answer once revealed.
- **The editor.** "+ 앞면에 추가" and "+ 뒷면에 추가" offer 사진, which picks a photo from the album or the camera, kept whole at its aspect ratio (`ImageShape.whole`), and stores it at once.
  - A drag over the photo draws a box. A tap selects one, a drag on it moves it, and a drag on its corner resizes it.
  - Without a drag: "빈칸 추가" adds a box in the middle. Tools under the photo move the selected box a step in each direction, widen, narrow, lengthen and shorten it, and delete it.
  - Each box is a button named "빈칸 n", and the selected one has a field for its answer.
  - The photo's own drag and tap are hidden from a screen reader, which uses those buttons.
- **Crop and rotation.** The editor offers neither.
  - The picker applies the photo's EXIF orientation before any box exists, and the upload's resize keeps the aspect ratio. Fractions of the image therefore stay valid at every size it is stored or drawn at.
  - A later crop or rotation must transform the boxes with the image, or store the crop and keep the boxes relative to it. A box falling wholly outside a new crop is flagged to the user, never dropped silently.
- **Media.** A photo chosen in the editor that the saved card does not hold is released when the card is saved or the editor is left, and so is one whose pick ends after the editor is left.
  - An edit that drops a stored photo releases it, and so does deleting its card or its deck, each in the transaction of its write, as a deck's image is. What an edit drops is read from the stored card, not from the copy the editor was given.
  - A photo, or a deck's image, is released only when no other live card and no live deck on the device still holds its media id, checked in the same transaction after the write. A card copied within a deck, or from one's own public deck, keeps the media id of the card it came from.
  - The check reads the device's database alone. A card that holds the id on another device, and has not synced to this one, is not seen, so its photo can be released while that card still names it.
- **The server read.** Any signed-in user reads a card's photo from its owner's folder while a live card of the owner's, in a deck that is public, not hidden and not deleted, holds an image block naming it, on its front or its back. So a reader of a public deck, and anyone who copied it, reads the photo the copy still names. Migration `20261027100000_media_card_read.sql` adds this as a second read policy on `storage.objects`, through a `security definer` function with its `search_path` pinned, so the reader's own row-level security on cards and decks does not decide it.
- **The card key.** An image block's text is its media id followed by its boxes' answers, so two photo cards are never duplicates of each other.
- **The web** draws the frame at the image's aspect ratio, at most 60% of the viewport's height, with its boxes, on `ground`, until its follow-up issue reads the bucket, as ADR 0107 left the deck's image.
- **The block needs no migration.** A side is a JSON array of any blocks (ADR 0068, ADR 0106). The one migration is the server read above.

## Consequences

- A photo card covers the same part of the photo on every phone, in either orientation, and on the web.
- The photo shows on the device that took it at once, and on another device once both have synced.
- Until the web reads the bucket, the web shows a photo card's boxes over an empty frame.
- A copy of another user's public deck carries a card's image block naming the owner's file. The copier reads it while the owner's card is in a public deck; once the owner deletes the card, hides or unpublishes the deck, the copy shows the frame and its boxes.
- A drag that starts on the photo in the editor draws or moves a box rather than scrolling the page.

## Signs the decision was wrong

- Users ask to crop or rotate a photo after drawing boxes. That would ask for the crop step and the flagging above.
- Boxes drawn on one device are reported to cover something else on another. That would mean a transform other than the one the frame applies is in use somewhere.
- Copied photo cards often lose their photo once the source deck changes. That would ask for a copy to store the file under the copier's own id.
