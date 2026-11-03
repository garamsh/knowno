# ADR 0116: Draw an icon only where it says what the words beside it do not, or follows the platform

> Status: accepted; its list of the places the mascot appears superseded by ADR-0141; its "Otherwise text alone" for the card editor's add sheet superseded by [ADR 0171](0171-give-every-type-in-the-add-sheet-an-icon-and-a-line-and-keep-a-field-s-selection-through-a-scrolling-drag.md), keeping its tinted squares out
> Date: 2026-10-27

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #444.** The owner asked on 2026-10-27 for every screen to be checked for icons stuck on everywhere: the app should be intuitive and not look AI-made. An earlier direction kept the icons that are needed: the flame, play and the logo.
- [ADR 0027](0027-draw-both-clients-in-the-smartman-brand-and-the-v2-screens.md) decided which icons the app draws, Lucide's, and not where one belongs. Icons had gathered where a word already said the same:
  - a tinted square at the start of each option row of the new-deck and add-card sheets;
  - a leading icon and a second line on the 덱 tab's "새 덱 만들기" and "공개 덱 둘러보기";
  - a check badge on the backlog card's mascot and three z's beside the done card's;
  - a check in "목표 n장 달성" and a plus in "오늘 n장 더 했어요";
  - a photo icon on the photo import bar;
  - a plus on the deck chooser's "새 덱", and a camera and an album on the "사진 더 추가" sheet;
  - a leading icon on the account screen's "로그아웃" and "계정 삭제";
  - a check, a cloud and an alert beside "동기화됨", "오프라인" and "동기화하지 못했어요";
  - the mascot on the completion card and on the cardless 오늘 tab.
- The completion card has a heading, a line of counts, a line on what is left and its button without the mascot. It does not read as empty, and its 200 px least height is still filled.
- **Alternatives considered:**
  - **Keep the icons and make them quieter**, smaller or in `muted`. The owner's objection is to their number, not their weight.
  - **Keep the mascot on every empty state.** It repeats the first-run home on screens the user meets daily, where the words and the action already say how to start.
  - **Drop every option row's second line.** "사진 찍기" alone does not say that the photo's cards are found for the user, which is the reason to choose it.

## Decision

- **The rule.** An icon stays only where it carries meaning a word next to it does not, or where it is the platform's convention:
  - the bottom tabs; back, close and search; play on a study button; the streak's flame; the logo, and the mascot on the first-run home;
  - each deck's own icon, which the user chose ([ADR 0103](0103-give-each-deck-an-icon-and-a-colour-stored-as-two-unchecked-keys-and-drawn-on-its-tile-in-place-of-the-initial.md));
  - the swipe hints' check and cross;
  - a drag handle, the ⋯ menu, a chevron that leads on, a selection's check, and a progress indicator while work runs.
- **Otherwise text alone.** In particular:
  - no icon in a tinted square at the start of an option row;
  - no icon inside a status chip, but the flame;
  - no decorative badge on the mascot;
  - no icon next to a row's title in a settings list;
  - no icon beside a status the words already name.
- **An option row's second line** stays only where the title alone does not say what happens: the new-deck sheet's "직접 만들기" loses its line, and "사진 찍기" and "앨범에서 고르기" keep theirs.
- **This change applies it to:**
  - the new-deck and add-card sheets, the deck chooser and the "사진 더 추가" sheet;
  - the 덱 tab: "새 덱 만들기" becomes an outlined button and "공개 덱 둘러보기" a text button under it, ranked as the first-run home ranks its two;
  - the 오늘 tab: the backlog card's mascot without its badge, the done card's without its z's, the goal and more-today chips as words, and the cardless tab without the mascot;
  - the photo import bar, which keeps its chevron;
  - the completion card, without the mascot;
  - the account screen's rows, and the sync status, which keeps its spinner while syncing.
- **Not yet applied.** The card editor's block-add sheet, in `app/lib/deck/src/`, keeps its tinted squares until #445, as does the add-card sheet's `icon` field, which the option sheet no longer draws.
- **Refines** ADR 0027's icons: Lucide's stays the one icon set, and this rule decides where one is drawn.

## Consequences

- A screen's words carry its meaning, and the icons left mark what words do not: a deck, a state, a direction or a gesture.
- A new screen or row starts without an icon, and one is added only by the rule above. A review can cite the rule.
- The mascot appears on the first-run home, the 오늘 tab's backlog and done cards and the account screen's foot, and not on the cardless 오늘 tab or the completion card.
- `AppListRow` keeps its `leading` slot, which the block-add sheet still uses until #445.

## Signs the decision was wrong

- Users take longer to find an action in the sheets or on the 덱 tab, or mistake "공개 덱 둘러보기" for a label.
- The completion card or the cardless 오늘 tab is reported as bare or unfinished.
- A status, such as a failed sync, is missed because it is told by its words and colour alone.
