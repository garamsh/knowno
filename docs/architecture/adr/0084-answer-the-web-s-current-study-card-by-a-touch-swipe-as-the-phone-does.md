# ADR 0084: Answer the web's current study card by a touch swipe, as the phone does

> Status: accepted
> Date: 2026-10-20

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- On the phone a horizontal swipe answers the current study card, and the answer buttons are its visible alternative (`design/principles.md` §Direct manipulation where it is natural, [`study.md`](../study.md)).
- [ADR 0042](0042-show-only-the-previous-and-the-current-study-card-at-one-size-re-decide-the-previous-card-by-a-swipe-and-open-it-on-a-tap.md) §Decision, Web: "← and → answer the current card". On `main` at `03e17faec3895caaa0aaae5e05f1afac11740aeb`, the web's current card took no gesture (`web-study.md` §Study screen: "Swipe on the current card is not offered").
- Below 1024 px the web uses the phone's layout, which is what a phone or tablet user sees. That user's habit from the app is to swipe the current card. On the web that swipe did nothing, and the one card that did take a swipe was the previous card above it, where a swipe changes an earlier answer. A touch user also has no keys.
- On a touch screen the web's coach moved the current card toward "안다" and "모른다" under a finger, showing a gesture the card did not take.
- The previous card already took a horizontal touch swipe with ADR 0035's threshold and fling (100 px, 0.7 px/ms), `touch-action: pan-y`, and no click after a swipe.
- The owner found the web less intuitive than the phone. The PM accepted issue #277 on 2026-10-19 as a supersession of ADR 0042's web rule, keeping the keys and buttons.

## Decision

- **The web's current card takes the phone's swipe.** A horizontal touch swipe (`pointerType` `touch`) answers the current card by the phone's rules. The card follows the finger and tilts over the tint and name of the answer it would give. A release past 100 px, or a fling faster than 0.7 px/ms, toward an answer gives that answer. A vertical touch scrolls the page (`touch-action: pan-y`), and a mouse or pen drags nothing. The buttons, the arrow keys and every other control stay.
- **One gesture.** The previous card and the current card share one implementation, `study`'s `useSwipe`. A swipe moves only the card it started on. The current card has no answer yet, so neither direction resists.
- **The coach speaks to the input.** Where the page is used by touch (`(pointer: coarse)`), the coach's lines are the phone's: "알면 오른쪽으로 밀어요", "모르면 왼쪽으로 밀어요" and "응답한 카드는 위로 올라와요. 밀어서 응답을 바꿀 수 있어요". Otherwise they name the buttons, keys and "마지막 응답 바꾸기" as before.
- **Supersessions.** This replaces ADR 0042's web rule that only ← and → (and the buttons) answer the current card. Its other web decisions stand.

## Consequences

- A phone user studies on the web as in the app, and the coach's motion matches what the card does.
- Two cards 28 px apart now take a horizontal swipe. Each moves only under a touch that starts on it, as on the phone (`design/principles.md` §Direct manipulation where it is natural: "a drag on either card moves that card alone").
- The swipe code lives in one hook, so a change to the phone's threshold or fling moves both web cards together.

## Signs the decision was wrong

- Touch users answer cards they meant to scroll past or re-decide. That would show as answers changed right after a swipe, through the previous card's swipe or "마지막 응답 바꾸기".
- A tablet with a mouse reports `(pointer: coarse)`, or a touch laptop does not, so the coach names the wrong input.
