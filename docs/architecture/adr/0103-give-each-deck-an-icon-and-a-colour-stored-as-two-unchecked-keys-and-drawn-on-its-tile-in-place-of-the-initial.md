# ADR 0103: Give each deck an icon and a colour, stored as two unchecked keys and drawn on its tile in place of the initial

> Status: accepted; its colour selected by the id superseded by ADR-0145
> Date: 2026-10-26

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- [ADR 0027](0027-draw-both-clients-in-the-smartman-brand-and-the-v2-screens.md) draws a deck's tile as the first letter of its name on one of four tints, `tintBlue`, `tintAmber`, `tintGreen` and `tintRed`. The tint is chosen from the deck's id: the sum of its UTF-16 code units modulo four (`deckTintIndex`), so the phone and the web pick the same one.
- On 2026-10-26 the owner asked for an icon and a colour the user chooses for each deck, shown on its tile in place of the initial (#382). The owner's terms:
  - the icon comes from a fixed set of line icons from the app's icon set, Lucide, and no emoji is offered;
  - the colour comes from a fixed palette;
  - a deck nobody has customised shows a default icon on the colour its id selects;
  - no stored row is rewritten.
- `design/principles.md` §One visual language reserves green and red for 안다 and 모른다, so two of the four tints cannot be in a palette the user picks from.
- A newer app may offer icons or colours this build does not know. The PM decided on #382 that the server checks neither key against a list, as #388 decided for a card's template, since a list check would refuse a newer app's sync.

## Decision

- **Stored keys.** A deck holds two nullable text keys, `icon` and `color`, on the server's `decks` and the app's local `decks` (schema v10).
  - **Server.** Migration `20261026120000_deck_appearance.sql` adds them with a length bound of 40 characters each and no check on their values, and grants `authenticated` their insert and update.
  - **Local.** The v9 to v10 migration adds both columns.
  - Neither migration rewrites a row, and existing decks hold neither key.
  - The keys sync as the deck's other columns do, under the deck's last-writer-wins rule.
- **Reading a key.** A key reads as `DeckIcon` or `DeckColor`. A null key, or one this build does not know, reads as none, and the tile draws the default. An edit that does not choose an appearance, such as a rename, writes only its own columns, so an unknown key survives it.
- **The icons.** Fourteen, from Lucide, each stored under its own key:

  | Key | Lucide icon | 한국어 name |
  |---|---|---|
  | `layers` | `layers` | 카드 묶음 |
  | `book` | `bookOpen` | 책 |
  | `languages` | `languages` | 언어 |
  | `pencil` | `pencil` | 연필 |
  | `flask` | `flaskConical` | 실험 |
  | `calculator` | `calculator` | 계산기 |
  | `globe` | `globe` | 지구본 |
  | `music` | `music` | 음악 |
  | `palette` | `palette` | 팔레트 |
  | `brain` | `brain` | 두뇌 |
  | `code` | `code` | 코드 |
  | `landmark` | `landmark` | 건축물 |
  | `briefcase` | `briefcase` | 서류 가방 |
  | `star` | `star` | 별 |

  The tile draws the icon in `ink` at half the tile's side.
- **The palette.** Six theme tokens, with no green and no red:

  | Key | Light | Dark |
  |---|---|---|
  | `blue` | `#E8ECF5` | `#2A3560` |
  | `sky` | `#E0F0FA` | `#1D3A50` |
  | `violet` | `#ECE7F8` | `#382D5C` |
  | `amber` | `#FFF1D6` | `#4A3B1E` |
  | `slate` | `#E9ECF1` | `#2D3445` |
  | `sand` | `#F4ECDF` | `#3F3527` |

  - The palette replaces `deckTints`. `tintGreen` and `tintRed` stay for the tint behind a dragged study card, and `tintAmber` for the backlog card's check.
  - The web holds the same six values as tokens, so its tiles can follow in their own issue.
- **The default.** A deck with no icon this build knows shows `layers`. A deck with no colour this build knows shows the palette colour at `deckTintIndex(id, 6)`, the same rule as before over the new palette.
- **Choosing.** The 덱 꾸미기 sheet offers the choice, from the deck page's menu and from the new-deck flow once a deck is named.
  - It previews the pair on the deck's tile.
  - It offers each icon and colour as a target at least 48 square, named by its 한국어 name and read as selected or not.
  - "저장" stores the pair, and dismissing the sheet stores nothing.
- **Alternatives considered:**
  - **Check each key against the app's list on the server.** That would refuse a newer app's new icon on sync, and it would need a migration for every addition.
  - **One appearance key such as `book/violet`.** It would join two independent choices into one value, and a client that knows one half but not the other would lose both.
  - **Keep the four tints and add icons.** Green and red mean 안다 and 모른다, and the owner asked for a palette.
  - **Store the default on each existing deck.** That would rewrite every row, against the owner's terms, and it would freeze a default this decision may later change.
  - **Emoji.** The owner excluded them.

## Consequences

- Every tile shows an icon, so an initial no longer stands in for a deck's name beside the name itself.
- The default colour of an existing deck can change, since its id now indexes six colours instead of four. No row changes.
- A newer app's icon or colour reaches an older app as the default, and survives the older app's edits to the deck's other columns.
- A new icon or colour needs a new key in the app, its 한국어 and English names, and a token for a colour, but no migration.
- Until the web follows, a deck's tile on the web keeps its initial and its four-tint colour.

## Signs the decision was wrong

- Users choose the same few icons for most decks, so the tiles stop telling decks apart.
- A key longer than 40 characters is wanted.
- The sheet after naming a deck is skipped so often that it reads as an obstacle.
