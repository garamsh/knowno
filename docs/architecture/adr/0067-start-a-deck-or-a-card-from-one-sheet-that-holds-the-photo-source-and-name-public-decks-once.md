# ADR 0067: Start a deck or a card from one sheet that holds the photo source, and name public decks once

> Status: accepted
> Date: 2026-10-19

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- Issues #206, #207 and #208 record findings read on `main` at `bc96f43be22b6ef4d79b8a2a14c4ba8e64a50ac7`.
  - **#206.** The 덱 tab offers public decks twice: its "공개 덱 둘러보기" row, and "공개 덱에서 가져오기" in the new-deck sheet beside it, with the browse screen titled "둘러보기", so one place has three names. The manual path's name sheet is titled "새 덱 만들기", the same as the row and the sheet before it, while photo import's is "새 덱".
  - **#207.** A photo import passes through two stacked sheets before the camera: the new-deck sheet or "카드 추가", then "사진 가져오기" ([ADR 0054](0054-take-the-photo-with-the-system-camera-or-from-the-library-and-remove-the-in-app-camera-view.md)).
    - One choice has different names on the two sheets: "직접 만들기" and "직접 입력", "사진으로 만들기" and "사진".
    - "다시 찍기" reopens the source sheet even for an album photo.
    - The failure screen offers two closes when nothing else applies.
  - **#208.** `sharing.md` names a home "둘러보기" icon button that does not exist, and `design/components.md`'s list of Material widgets misses `DropdownMenu` and `RadioListTile`, which the public-deck import sheet uses.
- **The PM's direction** (the issues' triage, 2026-10-19):
  - keep the 덱 tab's "공개 덱 둘러보기" row ([ADR 0050](0050-make-a-deck-from-a-button-under-the-deck-list-and-remove-the-deck-selection-mode.md)), and drop "공개 덱에서 가져오기" from the new-deck sheet;
  - title the browse screen "공개 덱", with "공개 덱 둘러보기" as its entry everywhere;
  - name the new-deck name sheet "새 덱" on both paths;
  - one sheet offers "직접 만들기", "사진 찍기" and "앨범에서 고르기", on the new-deck sheet and on the deck screen's "카드 추가" alike;
  - "다시 찍기" reads "다른 사진 고르기" for an album photo;
  - the failure screen shows one close.
- **The PM's answer on the first-run home**, on the worker's question: it keeps two actions, a primary "덱 만들기" that opens the one new-deck sheet, and the text "공개 덱 둘러보기". Its separate "직접 만들기" goes, since the sheet offers it.
- Alternatives considered:
  - **Two photo buttons on the first-run home**, "사진 찍기" and "앨범에서 고르기", beside "직접 만들기". Four actions on one screen.
  - **Keeping the source sheet for the first-run home alone.** It would keep alive the second sheet this change removes.
  - **A retake that offers both sources again.** It is the second sheet again, after the photo's source was already chosen.

## Decision

- **One sheet.** The new-deck sheet and the deck screen's "카드 추가" sheet each offer "직접 만들기", then, with photo import, "사진 찍기" (the system camera) and "앨범에서 고르기" (the library), with one line under each. A photo row starts photo import from its source at once; there is no "사진 가져오기" sheet. `PhotoImport` takes the source, a `PhotoOrigin`.
  - The new-deck sheet no longer offers public decks. The 덱 tab's "공개 덱 둘러보기" row is their one way in there.
  - The sheets' titles stay: "새 덱 만들기", as the row that opens it names it, and "카드 추가".
- **The first-run home** keeps the mascot and its words, with a primary "덱 만들기", which opens the new-deck sheet, and, with sharing, the text "공개 덱 둘러보기".
- **Names.**
  - The browse screen is titled "공개 덱", and every entry to it reads "공개 덱 둘러보기".
  - The name sheet for a new deck is "새 덱" on the manual path, as it is on photo import's.
- **Retake.** On the import list and a failure, the retake takes another photo from the same source with no sheet. It reads "다시 찍기" for the camera and "다른 사진 고르기" for the album. Where the camera cannot open, it reads "앨범에서 고르기" and picks from the album, and later retakes follow the album.
- **Failure screen.** The top bar's close is its one way out. The bottom bar holds the retry, the retake or the way to Settings where one applies, and is absent where none does.
- **Docs (#208).** `sharing.md` names the browse screen's actual entries, and `design/components.md`'s list of Material widgets names `DropdownMenu` and `RadioListTile`.
- **Supersessions.**
  - This replaces ADR 0054's source sheet, "사진 가져오기", and its retake that reopened it.
  - It replaces ADR 0036's new-deck sheet option "공개 덱에서 가져오기" and its "사진으로 만들기", and the first-run home's three buttons.
  - It replaces the public-deck option of the new-deck sheet that ADR 0050 kept.

## Consequences

- The camera or the album is one sheet from the 덱 tab and from a deck, one tap fewer on every photo import.
- One choice has one name on both sheets, and the public decks one name everywhere.
- A user who wants the other source after a photo backs out and chooses it on the sheet, rather than at the retake.

## Signs the decision was wrong

- Users who took a photo look for a way to pick from the album instead from the retake.
- Users who reached the new-deck sheet look in it for the public decks.
- Users on the first-run home do not open "덱 만들기", where "사진으로 만들기" drew them before.
