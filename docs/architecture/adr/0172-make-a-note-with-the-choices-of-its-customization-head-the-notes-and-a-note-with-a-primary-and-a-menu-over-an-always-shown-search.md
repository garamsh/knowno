# ADR 0172: Make a note with the choices of its customization, and head the notes and a note with a primary and a menu over an always-shown search

> Status: accepted
> Date: 2026-11-03

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #628.** The owner's iPhone shots of main at b7ffcdd2 (iPhone 13 Pro) showed the 노트 tab's 새 노트 as a small white chip that read as secondary and did not say "add". They also showed 새 노트 with its "노트 이름" label against the field's edge, a tall empty field, and only the four colours: no icon, no photo, no preview. The owner wrote "노트 추가 버튼과 추가시 기능이랑 ui가 부족한듯. 글씨 잘리는등 사진 기능도 없고".
- **The owner's later comments on #628** asked the 노트 tab to take the note screen's header form ("노트 들어가서 카드추가 버튼있고 돋보기 있고 ... 있듯이"), then dropped the magnifier on both screens ("돋보기는 기본적으로 빼자 그리고 기본적으로 노트처럼 검색을 바로 보이게 하자"). The owner then chose the PM's mockup (https://claude.ai/artifact/278KmJ63jVw7FYNTeVrv8B, sections 1 and 2) as the visual target.
- **The cause of the clipped label.** `NewDeckScreen` put a labelled `AppTextField` inside an `EditorGroup`, whose field theme draws no border and no fill of its own. The field had no visible edge, and the label, drawn flush with the field's left edge, sat 4 px (`groupInset`) from the group's edge. Every other labelled `AppTextField` draws over the theme's outlined field, where its label lines up with the outline. So the defect was the screen's, not the component's.
- **Before this record**, 새 노트 offered the four colours alone and stored the fallback icon ([ADR 0150](0150-open-on-a-home-of-today-on-the-hero-with-the-notes-in-a-drawer-keep-the-menu-on-a-note-and-make-a-note-on-a-full-screen.md)). 노트 꾸미기 offered icon, colour and photo ([ADR 0103](0103-give-each-deck-an-icon-and-a-colour-stored-as-two-unchecked-keys-and-drawn-on-its-tile-in-place-of-the-initial.md), [ADR 0107](0107-store-media-in-a-private-supabase-storage-bucket-named-by-media-id-and-give-each-deck-an-image.md), [ADR 0159](0159-give-the-web-s-note-page-the-phone-s-note-settings-and-the-web-one-media-path-acting-as-the-user.md)). The 노트 tab had "새 노트" as a chip and "공개 노트 둘러보기" under its rows ([ADR 0165](0165-open-on-today-over-the-last-seven-days-move-the-notes-to-a-tab-and-open-settings-from-the-profile-button.md)). The note screen had a magnifier that opened its search, and one "카드 추가" fixed at its foot ([ADR 0150](0150-open-on-a-home-of-today-on-the-hero-with-the-notes-in-a-drawer-keep-the-menu-on-a-note-and-make-a-note-on-a-full-screen.md)).
- **Alternatives considered:**
  - **Inset the label inside `AppTextField`.** It would move every labelled field's label off its outline on the screens where it is right.
  - **A second copy of 노트 꾸미기's choices in 새 노트.** Two copies drift. The owner's issue asks for one.
  - **A hand-built 44 pt primary in the header.** It would be a second primary button beside `AppButton`. A size of `AppButton` keeps one.
  - **Keep 카드 추가 at the note's foot and give only the 노트 tab a header action.** The two screens would then differ in the one place the owner asked them to match.

## Decision

- **One appearance editor.** `deck`'s `DeckAppearanceFields`, and the web's `DeckAppearanceFields` in `features/decks`, are the choices of a deck's look, each in a white group:
  - "아이콘": the fourteen icons;
  - "색": the four offered colours;
  - "사진": "앨범에서 고르기" and "사진 찍기".
  While a photo is shown, the icon and the colour fold, since the photo covers them, and "사진" offers "다른 사진" and "사진 빼기". 노트 꾸미기 and 새 노트 are both built from it. A deck's look is one value, `DeckLook` on the phone, which `DeckTile` draws.
- **새 노트**, top to bottom:
  - the tile the note will get, at twice its size, over its name as typed, or "노트 이름" muted while there is none;
  - "노트 이름" in a white group, its label at the group's inset over a field on the ground, one line high, hinted "예: 토익 단어" and focused on opening;
  - the appearance editor;
  - at its foot, as before, "저장" beside "저장하고 카드 추가".
  On the phone the deck is made with its icon, colour and photo in one write, the photo stored through `media` first. On the web the note is made, then a chosen icon or photo is stored through 노트 꾸미기's `decorateDeck`. A retry keeps the note's id, so it makes no second note.
- **The header form [action] + ⋯**, shared by the 노트 tab and a note's screen, on both clients:
  - The screen's title has its one primary at its right, "+" and its name, 44 high: "+ 새 노트" on the 노트 tab and "+ 카드 추가" on a note.
  - Then the screen's ⋯, where it has other actions. On a note it is "노트 설정", as before. On the phone's 노트 tab, with sharing, it is "노트 탭 메뉴", whose one item is "공개 노트 둘러보기". It is not drawn with sharing off, nor on the web's 노트 page, which has no browse screen.
  - The phone builds it from `home/`'s `ListHeaderActions`, and `AppButton` gains the size `header`, `AppSize.tapTarget`. The web builds it from `features/decks`' `ListHeader`.
- **One always-shown search** under the header: "노트 검색" on the 노트 tab while there is a note, and "카드 검색" on a note while it holds a card. It is `home/`'s `ListSearchField` on the phone and `ListSearch` on the web. The magnifier, "검색 닫기" and the back that closed the search are deleted.
- **A note's screen has no foot bar.** "카드 추가" is in the header in every state, an empty note included, whose body is the sleepy mascot and its sentence.

## Consequences

- A note can be given its look as it is made, and 노트 꾸미기 changes the same choices later.
- Both screens head their content the same way, and their search needs no tap to open.
- On a note, adding a card is at the top of the screen, out of the thumb's reach that the foot bar gave.
- `senses_block.dart`'s 예문 field, a labelled `AppTextField` inside an `EditorGroup`, has the clipped label 새 노트 had. It is left to the card editor's issue (#622).

## Signs the decision was wrong

- Users miss 공개 노트 둘러보기 inside ⋯, or the web needs a ⋯ for something added later.
- "+ 카드 추가" at the top is reported as hard to reach, or users look for it at the foot.
- An always-shown search is reported as noise on a note with few cards.
