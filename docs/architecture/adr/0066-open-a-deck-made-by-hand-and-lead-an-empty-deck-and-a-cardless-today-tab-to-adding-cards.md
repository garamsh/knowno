# ADR 0066: Open a deck made by hand, and lead an empty deck and a cardless 오늘 tab to adding cards

> Status: accepted
> Date: 2026-10-19

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- Issue #205 records a first run read on `main` at `bc96f43cbf7f4c205978c6f637e2e80d03024db2`: "직접 만들기", a name, then "만들기" creates the deck and leaves the user on the 오늘 tab.
  - With no card in any deck, that tab shows the done card, "오늘 할 카드를 다 했어요", and "학습하기".
  - The new deck's screen offers the navy card's white "학습하기" as its most prominent action, over an outlined "카드 추가".
  - A deck made from a photo, by contrast, opens.
- `design/principles.md` §One primary action per screen and §Plain-language states are both broken there. The tab says the day is done when nothing was ever studied, and the empty deck's primary leads to "오늘은 학습할 카드가 없어요".
- [ADR 0040](0040-keep-every-study-button-enabled-at-zero-cards-left.md) keeps every study button enabled at zero cards left. Its context is a day whose cards are done, not a deck that holds no card.
- **The PM's direction**, on the issue's triage (2026-10-19) and on the worker's question:
  - after "직접 만들기", the new deck opens, as the photo path does;
  - on a deck with no card, "카드 추가" is the one primary, and "학습하기" is hidden;
  - the 오늘 tab with no card at all shows how to start, and the web does the same;
  - that state reads "첫 카드를 만들어 볼까요?" with "덱에 카드를 추가해 시작해요". With one deck its one primary is "카드 추가", which opens that deck's add sheet, beside a quiet "덱 열기". With several, its one primary is "덱에서 카드 추가하기", which shows the 덱 tab.
- Alternatives considered:
  - **The first-run home as it is**, "첫 덱을 만들어 볼까요?". Its buttons each make a new deck, which a user who already has an empty deck does not need.
  - **Disabling "학습하기" on an empty deck.** That keeps a control that cannot act on screen, against principle 1, and would contradict ADR 0040's rule that no study button is disabled.

## Decision

- **A deck made by hand opens.** "직접 만들기", from the first-run home or the 덱 tab, creates the deck and opens its screen, as a photo import opens the deck it saved into.
- **An empty deck.** While a deck holds no card:
  - its navy card shows no "학습하기";
  - the bottom bar's "카드 추가" is the screen's one primary, in the primary fill.
  - Once it holds a card, the deck screen is as before: "학습하기" on the navy card, enabled at any count (ADR 0040), and "카드 추가" outlined.
- **A cardless 오늘 tab.** While no deck holds a card, the 오늘 tab shows how to start, in the first-run home's layout:
  - the mascot in a white circle;
  - "첫 카드를 만들어 볼까요?";
  - "덱에 카드를 추가해 시작해요";
  - with one deck, a primary "카드 추가", which opens the deck's screen with its add sheet up (or its card editor without photo import), and a quiet "덱 열기";
  - with several decks, a primary "덱에서 카드 추가하기", which shows the 덱 tab.
  - With a card in any deck, the tab is as before, the done card included.
- **The web**, which makes neither decks nor cards:
  - its 오늘 page with decks but no card shows the mascot, "첫 카드를 만들어 볼까요?" and "카드는 휴대폰 앱에서 덱에 추가해요. 추가한 카드는 여기에도 보여요.", with no action, as its first-run invitation does;
  - its deck page shows no "학습하기" while the deck holds no card.
- **Supersessions.** This replaces ADR 0040's always-shown study button for a deck that holds no card. Every study button with a card to its decks stays enabled at zero.

## Consequences

- The manual first run ends on the deck the user just named, with adding a card as its obvious next step.
- No screen tells a user with no card that their day is done.
- A study button no longer appears where it could only lead to nothing to study.

## Signs the decision was wrong

- Users who made a deck by hand back out of it and look for it on the 덱 tab, as if they expected to stay on 오늘.
- Users with an empty deck look for "학습하기" and do not find it.
- Users with several empty decks land on the 덱 tab from 오늘 and do not see where to add cards.
