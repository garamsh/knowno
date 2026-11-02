# ADR 0141: Polish the coral mascot, make coral the primary action, and place its expressions on both clients

> Status: accepted; its colours and coral primary superseded by ADR-0147
> Date: 2026-11-02

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #551**, stage 2 of #541. The PM, as the owner's designer, decided that the coral character carries the product's mood: a polished mascot, coral in the primary role, and its expressions at the moments that matter.
- **[ADR 0139](0139-draw-both-clients-around-the-coral-mascot-with-warm-colour-tokens-and-rounder-taller-buttons.md)'s redraw is narrow**, and its arm reads as stray lines beside the reference, Canva media `MAHZsI_Pb-k`. The expressions' reference is Canva media `MAHZsBm1XIM`.
- **The primary stayed ink** in ADR 0139, which left the coral fill open: a cocoa label on the coral is 5.42:1, and needs a fill token apart from `ink`. `ink` also fills bars, a selection's check, the segmented control, the switch and the avatar, none of them a primary action.
- **Two rules stood against the expressions.** [ADR 0116](0116-draw-an-icon-only-where-it-says-what-the-words-beside-it-do-not-or-follows-the-platform.md) took the mascot off the completion card and every empty state but the first-run home, and `design.md` §Details forbids an illustration as decoration.
- **Only `home/` could draw the mascot**, since its widget lived there and a domain may not import the shell, and study and photo import need it.
- **Alternatives considered:**
  - **A darker coral under a white label.** It reads as a destructive red, as ADR 0139 found.
  - **A coral fill for every `ink` fill.** A bar, a check and an avatar are not actions; the fill would stop marking the one primary on a screen.
  - **Keep `onPrimary` for the ink fills and name the new pair apart.** The name would then say the opposite of what it draws: a primary button's label would be `onPrimaryFill` beside an `onPrimary` it never uses.
  - **Keep the cream circle under each expression.** The circle reads as a sticker on a card or on a dark ground, and the sleepy mascot's z's and the happy one's arms leave it. The reference draws the character on no shape.
  - **Render the SVGs on the phone with `flutter_svg`.** It is a new dependency for four still images; the PNGs at 1x to 3x are the idiom the marks already use.
  - **Draw a separate SVG per expression.** Four copies of one body drift apart; each expression draws `body.svg` where it says.
  - **Move 모른다 again.** Beside the coral fill, the light theme's crimson `#B3123F` is 2.50:1 against it and 23° of hue away, and the dark theme's rose `#FF8FB0` 1.28:1 and 24° away, a pink beside an orange that no screen draws touching, with the words always there. It stands.

## Decision

- **The mascot is redrawn** from the reference, wider and softer: a broad bean body, big round eyes looking up, pink cheeks, little feet and one clean rounded arm to the chin, with no fingers. `tools/brand/body.svg` is the body, and `mark.svg`, `happy.svg`, `sad.svg` and `sleepy.svg` each draw it. `mark.svg` is the mark and the thinking expression. `tools/brand/generate.mjs` writes every asset from them.
- **The launcher icon and the favicon** are the mark close up, on the cream, its body running off the foot: at 16 px the eyes read there and not on a circle.
- **Coral is the primary action.**
  - `primary` is the mascot's `#FB7262` in both themes, under `onPrimary`, the cocoa `#3B2118`, 5.42:1, and 4.69:1 under a press.
  - The token that went on the ink fills is renamed `onInk`, white on the light theme's ink and cocoa on the dark's. Every other ink fill stays.
  - A secondary action stays outlined, and a destructive final step stays red.
  - On a light ground the fill is 2.55:1, under the 3:1 of WCAG's non-text contrast. The control is identified by its label, which is the case that criterion excepts, and the fill is 5.9:1 and more on the dark grounds.
- **모른다 keeps its crimson and rose**, and 안다 its green. Each red is at least 21° of hue from the coral fill, and the words always carry the meaning.
- **`Mascot` takes an expression, draws no circle, and moves to the `design` foundation**, on the web to `design/brand.tsx` as before, so that `home/`, `study` and `photo_import` draw it through one widget.
- **The expressions are placed the same on both clients**:

  | Expression | Where | Size |
  |---|---|---|
  | thinking | a photo being read, beside its words, while no row shows a failure | 64 |
  | happy | the completion card; the 오늘 tab's done card | 96 |
  | happy | the cardless 오늘 tab: the first deck is made, and its first card is next | 128 |
  | sad | a failed photo's screen, "no cards found" among its failures | 96 |
  | sleepy | study with nothing today; an empty deck | 96 |

  The mark stays where ADR 0116 left it: 128 on the first-run home and 64 on the backlog card.
- **The rules on a placement:** at most one mascot on a screen; never on a study card; never beside an error's red, so a batch with a failed row loses the thinking mascot; sized so the words stay the hero; still, so reduce motion asks nothing of it; hidden from screen readers, so it says nothing the words do not.
- **The exception to ADR 0116 and to §Details.** The expressions are not decoration under either rule: each states the app's mood at a moment the words state its facts, at a place listed above, and nowhere else. ADR 0116's rule for icons stands. Its "no mascot on the completion card or an empty state" does not. §Details's "illustration as decoration" still forbids any drawing outside the table.
- **Supersedes** ADR 0139's "the primary fill stays ink" and its cream circle under the mascot on a screen, which the lockups keep, and ADR 0116's list of the places the mascot appears.

## Consequences

- A screen's one primary is the brightest thing on it, in the character's colour.
- `AppColors` and the web's tokens gain `primary` and `onInk`, and `onPrimary` changes its meaning. The web's token test holds them equal.
- `app/lib/home/src/mascot.dart`, `AppBrand.circle`, `AppSize.mascotSmall` and the `knowno-circle` and `knowno-mark` files are gone. The medium size is 96 on both clients, where the phone drew 96 and the web 84.
- A new expression is one SVG over `body.svg`, one name in `generate.mjs` and one `MascotExpression`.

## Signs the decision was wrong

- Users find the mascot childish on a study screen, or it slows them on a screen they meet daily.
- A coral primary beside 모른다's crimson or rose is taken for an answer.
- The owner or a user reads the coral fill as a warning.
- Dark-theme users cannot tell a red final button from a coral one at a glance.
