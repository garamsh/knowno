# ADR 0145: Redraw the screens for the coral mascot: rounder, with one current tab, two chart colours and one way out of an empty state

> Status: accepted; its colours, shadows, radii, heights, type sizes and the current tab's pill superseded by ADR-0147
> Date: 2026-11-02

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #562**, stage 3 of #541. The owner, away, gave the layout decisions to the PM, whose review of the stage 2 contact sheets replaces the review page #541 planned. The owner's bar: "조잡한 UI를 만들지 말라고, 실제 유저의 사용성 및 UI/UX의 미적 기준을 고려해서 만들어."
- **Stage 2 recoloured the screens and left their shapes.** [ADR 0119](0119-draw-every-screen-from-one-radius-scale-one-chip-three-type-sizes-a-press-dim-and-three-haptics-and-a-hidden-blank-as-an-empty-underlined-gap.md)'s group of 14 and chip of 6 read as a tool beside a soft round character.
- **The done card put the coral button on the brand tint**, 2.23:1, where the fill is weakest.
- **Ochre stood for a forecast and a band**, in the streak's colour, though neither is a streak.
- **A deck with no colour took one by a hash of its id** ([ADR 0103](0103-give-each-deck-an-icon-and-a-colour-stored-as-two-unchecked-keys-and-drawn-on-its-tile-in-place-of-the-initial.md)), so a new user's first decks were blue and lavender on a warm screen, a choice nobody made.
- **Empty states differed.** The first-run home had a sentence and a paragraph, the cardless 오늘 tab a second action, the web's cardless 오늘 no action at all, and study with nothing today only the ✕.
- **ADR 0137 set a 글's front at 18 and its added part at 20**, so a whole card's answer was larger than its title (#554).
- **"칸을 골라 가려요"** on 표 sat beside "칸 추가" with a different meaning of 칸 (#560).
- **Alternatives considered:**
  - **Round each screen by hand.** The tokens exist so that a shape changes once, and photo import, in another's hands, takes them by itself.
  - **Keep `chip` 6 for the fields and the table that used it on the web, and add a round token for chips.** The issue says chips, and the name would go on meaning the opposite. Those few sites move to `field`, and a blank's tint to the small corner it had.
  - **Coral for the whole row of the current menu item.** It would be a second fill beside the page's one primary; the tint behind the icon alone says where you are.
  - **Replace the ochre band with a muted tone.** Three browns do not tell a band that needs attention from one that does not; the coral does, and its count is beside it.
  - **Coral and tint on the mastered weeks' bars too.** Those bars have no count of their own, so a tint at 1.2:1 would leave them unread. They stay in ink.
  - **Keep the hash as the fallback for a colour this build does not know.** Then the palette would still show colours nobody chose. A key this build does not know is no choice either.
  - **Rewrite stored colours.** A deck whose icon was saved before this change stores the hashed colour, which cannot be told from a chosen one, and no migration is worth guessing at it.

## Decision

- **Shape, in the tokens:** groups, cards, the previous card and a row alone 24; primary and secondary buttons 20 and 56 tall, `cta` and `button` both; sheets 28; chips and labels fully round, 12 by 4 around their words; fields and pull-down menus 16. The panel stays 40.
- **The current tab and menu item** on both clients: a coral-tinted pill, 56 by 32 and `brandTint`, behind its icon, and a bold ink label; the others `muted` at medium weight.
- **Charts:** today's bar coral and the other days `brandTint`, on the last seven days and, today first, on the catch-up. The recall bands' fading band is coral. The streak's flame keeps its amber, and the mastered weeks and the heatmap their ink. Every figure stays.
- **A fill under 3:1 is carried by its label.** `brandTint` on the surface is 1.20:1 light and 1.48:1 dark, and the coral on the light surface 2.67:1. A bar's count is above it, a band's count beside its name, the current tab's label bold in ink beside a muted other, and a button's label is the control, as ADR 0141 states.
- **오늘's done card is on `surface`** with the card shadow, the mascot above the sentence and the chips under it, so the coral button stands alone.
- **A deck tile with no colour chosen is `brandTint`.** The palette's colours appear only where the user chose one: `defaultDeckColor` and `deckTintIndex` go, 덱 꾸미기 opens with no swatch selected, and `setAppearance` stores no colour for a save that chose none. A deck already storing a hashed colour keeps it.
- **An empty state is the mascot, one sentence and the one action that leads out.**
  - The first-run home loses its paragraph, and keeps the quiet "공개 덱 둘러보기", since no tab leads there before the first deck.
  - The cardless 오늘 tab loses its line and "덱 열기". On the web it gains the action: "카드 추가" with one deck, "덱에서 카드 추가" with several.
  - Study with nothing today offers "닫기" as its primary, beside the ✕.
  - The web's empty deck is its one sentence, with "카드 추가" as the page's primary.
- **The web's first-run "새 덱 만들기" is primary**, through `AuthoringButton`'s `primary`, and the deck list's stays outlined.
- **A whole card's type:** a 글's front 20/28/700 and its added part 18/26/600 in `ink2`, `wholeFront` and `wholeAdded`, so the front stays the larger.
- **Wording:** 표's line is "가릴 부분을 골라요" on both clients, so 칸 keeps one meaning.
- **Motion:** none added.
- **Supersedes** ADR 0119's radii of 14, 6 and 22 and ADR 0139's button 18, 54 and 60, ADR 0137's 글 at the headline and its added part at the back's size, and ADR 0103's colour selected by the id. ADR 0141's places stand, with the done card's ground changed here.

## Consequences

- The system's shapes change in one file per client, and photo import follows without an edit.
- The phone's empty deck keeps its one string, "아직 카드가 없어요. 카드를 추가해 시작해 보세요.", two short sentences where the web draws one, until a change may touch that string.
- `emptyHomeBody`, `noCardsBody` and `openDeck` have no caller left, and stay in the `arb` files until a change may touch them.
- A deck that stored a hashed colour stays that colour until the user picks another. Nothing can tell it from a choice.
- `cta` and `button` are one value under two names; a change to either is now a choice to split them.

## Signs the decision was wrong

- A user cannot tell which days had study from the tint's bars, or reads the catch-up's first bar as more important than a count.
- Users do not see which tab they are on in the dark theme, where the pill is 1.48:1.
- A long Korean word on a chip reads worse as a wrapped pill than it did on a small corner.
- Users miss "덱 열기" on the cardless 오늘 tab, or the first-run paragraph that named the photo path.
