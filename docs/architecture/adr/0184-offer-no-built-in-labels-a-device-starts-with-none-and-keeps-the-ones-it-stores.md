# ADR 0184: Offer no built-in labels; a device starts with none and keeps the ones it stores

> Status: accepted
> Date: 2026-11-04

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #706.** The owner, 2026-11-04: "기본 라벨은 없애줘". [ADR 0100](0100-merge-the-word-kind-into-basic-type-each-sense-s-label-and-offer-the-user-s-labels-above-the-keyboard.md) has a device with no stored labels start from the fourteen short forms of ADR 0075, each named (명 → 명사, 동 → 동사 …), and offer them above the keyboard.
- **The PM's decisions on #706:**
  - a device with no stored labels has none, and the strip above the keyboard is not drawn while there are none;
  - the editor's "라벨" row still opens the "라벨" screen, which then shows its empty state and "+ 라벨 추가";
  - a device that stored its own list keeps it exactly;
  - labels already on a card's senses are card data and unchanged: only the suggestion list changes.
- **Alternatives considered:**
  - **Keep the defaults and let the user delete them.** The owner asked that the app offer none; a device would still start with fourteen to delete.
  - **Draw the strip with only "관리" while there are none.** A strip that offers nothing takes the keyboard's height for a link the "라벨" row already gives.

## Decision

- **No built-in labels.** A device with no stored labels, or one whose stored value cannot be read, has none. The fourteen short forms stay only as what decides whether a typed label is a part of speech (ADR 0075).
- **The strip is drawn only when there is a label to offer.** With none, a focused label field shows no strip.
- **The "라벨" screen with none** shows its sentence and the group's one row, "+ 라벨 추가".
- **A stored list is kept exactly,** an empty one included: a device whose user deleted every label does not get them back.
- **Cards are unchanged.** A card's labels are read and saved as they were.
- **Supersedes** ADR 0100's starting set, "A device with none starts from the fourteen short forms, each named", and its consequence that the fixed list stays as the presets' starting point. The rest of ADR 0100 stands.

## Consequences

- A new device offers no label until the user adds one on the "라벨" screen; a label is typed by hand until then.
- A device that has not stored a list loses the fourteen it was offered, unless it stored them; one that stored its list keeps it.
- The string naming each part of speech (`partOfSpeechName`) has no use and is removed.

## Signs the decision was wrong

- Users type the same labels on every device and ask for a starting set or for their labels to sync.
- Users do not find the "라벨" row, so labels go untyped and unused.
