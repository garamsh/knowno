# ADR 0250: Draw 말랑이's chat as a messenger with a profile by each run of its turns, three dots from send to the first text, and no mascot in the top bar

> Status: accepted
> Date: 2026-11-11

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #926**, the app's part of the owner's request that 말랑이's chat on the phone read like a messenger conversation and that a reply being made never be a blank screen.
- **Before.** [ADR 0201](0201-chat-with-malangi-on-the-phone-in-an-assistant-domain-kept-in-the-app-s-preferences-and-opened-from-home-s-mascot.md) put the mascot in the top bar beside the name, and `design/brand.md` placed the chat's mascot there. The waiting sign was the line "말랑이가 생각하는 중이에요" under the reply's turn, and the owner did not see it while a reply was made.
- **Why the line was not seen.** The turn is added when the stream starts, and the stream starts when the function's response headers arrive. The function answers the headers only after it has authenticated the call, checked that the account is not suspended, read the skills and begun the message. In that window the chat's status is streaming, so the Stop button shows, but no turn exists, and the line lived inside the turn's view. A trace of the chat on the previous screen with a response held back read: line absent and Stop present before the headers, line present after them. The existing tests answered at once, so the window was never exercised. The line was also small muted text.
- **Alternatives considered:**
  - **Draw the old line from the status.** Rejected: the owner asked for the messenger's own sign, and a line of small text was already the one not seen.
  - **Keep the mascot in the top bar and add the profile.** Rejected: the owner's decision is that the icon leaves the bar.
  - **A profile on every bubble.** Rejected: a messenger draws it once per run, and the owner decided so.

## Decision

- **The top bar holds the way back, "말랑이" with the share left under it, centred, and ⋯.** It holds no mascot.
- **말랑이's turns are drawn with a profile:** a rounded-square tile of the theme's light coral ground (`deckPeach`) holding the mascot, at the left of the first bubble of each run of its turns, with "말랑이" above that bubble. A later bubble of the run has neither. The user's bubbles are unchanged.
- **The last run's profile takes the face the top bar took:** thinking, sleepy once the day's tokens are used, sad on a failure, happy once a proposal is added. An earlier run's profile shows thinking. A refusal is drawn beside a profile so that the sleepy and sad faces show when there is no reply.
- **From send until the reply's first text, the profile and a bubble of three dots show.** The dots rise in turn and stand still under reduce motion. They go on the first text, on a refusal and on stop. An interim line may show beside them. They replace "말랑이가 생각하는 중이에요" as the waiting sign, and the bubble keeps that text as its name to a screen reader alone. They are drawn from the chat's status and its last turn, not from the reply's turn, so they show in the window above.
- **The empty chat shows a large profile with "말랑이" and "무엇을 외워 볼까요?" above the input.**
- **A proposal, a question's options, a citation and a photo job keep their content and align with 말랑이's bubbles, right of the profile.**
- **Sizes are the app's to choose where the owner's mockup was not seen:** the profile is 40 px with the mascot at 80% of it, 96 px in the empty chat; the dots are 8 px, rise 4 px in a 1200 ms loop; the profile's corners are the field radius, and the large one's the card radius. The ⋯ keeps a 48 px tap target so the title centres.
- **Amends** `design/brand.md`'s placement of the chat's mascot on the phone, from the top bar to the profile. The stored conversation and the assistant's protocol are unchanged.
- **The web follows in #927.**

## Consequences

- A reply being made shows a sign from the send, including while the function has not yet answered its headers.
- The tests that waited for a reply to settle cannot settle while the dots repeat, so a test of an open reply pumps frames and does not wait.
- The light coral ground reuses `deckPeach`; `design/theme.md` keeps coral as the mascot's alone, and the PR raises whether the profile's ground is an exception.
- Not verified here: the chat on a device; the widget tests and the screenshot frames are renders of the test's.

## Signs the decision was wrong

- A person still reads a reply being made as stalled, or sends again during it.
- The profile on each run makes a long reply of several bubbles harder to follow than before.
- The dots are read as an error or a loading failure rather than as 말랑이 typing.
