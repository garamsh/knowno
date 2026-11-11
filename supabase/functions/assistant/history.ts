/**
 * A message request read (ADR 0190, ADR 0195): its turns for the model, the proposals they hold,
 * the note open and the photos attached, with a resent reply shortened.
 */

import type { IdSource } from "../_shared/cards.ts";
import { readCard } from "../_shared/input.ts";
import { MAX_JOB_PHOTOS } from "./jobs.ts";
import { isRecord, UUID } from "./answer.ts";
import type { Turn } from "./providers.ts";
import { parseProposal, type Proposal } from "./tools.ts";

/** The most turns a request carries; the client keeps the rest of the chat. */
export const MAX_TURNS = 40;
/** The longest a user turn's text may be, and the length an assistant turn's is shortened to. */
export const MAX_TURN_TEXT = 4000;
/** The longest one turn may be once the proposals and the choice it showed are described in it. */
export const MAX_DESCRIBED_TURN = 16_000;
/** The most characters of a card's front an earlier proposal's description shows. */
const FRONT_SHOWN = 80;

/**
 * A message request read: the turns for the model, the proposals they hold, the note open, the
 * user's time zone, and the photos of the latest user turn that attached any.
 */
export type Incoming = {
  readonly turns: readonly Turn[];
  readonly proposals: readonly Proposal[];
  readonly deckId: string | null;
  readonly timeZone: string | null;
  readonly attached: readonly string[];
};

/** The shape of an IANA name, Area/Location or UTC, which leaves out an offset such as +05:00. */
const TIME_ZONE = /^(?:UTC|[A-Za-z]+(?:\/[A-Za-z0-9_+-]+){1,2})$/;

/**
 * An earlier proposal as the model reads it: its ids and sizes, and each group's first [fronts]
 * fronts, or with [fronts] null, its groups counted and not named.
 */
function describe(
  proposal: Proposal,
  ids: IdSource,
  fronts: number | null,
): string {
  const header = `[proposal ${proposal.id} of ${
    proposal.kind === "cards" ? "new cards" : "changes"
  } for the note "${proposal.deck.name}"`;
  if (fronts === null) {
    const cards = proposal.groups.reduce((n, g) => n + g.cards.length, 0);
    return `${header}: ${proposal.groups.length} groups of ${cards} cards]`;
  }
  const groups = proposal.groups.map((group) => {
    const shown = group.cards.slice(0, fronts).map(({ card }) => {
      const read = readCard(card, ids);
      return typeof read === "string"
        ? "?"
        : [...read.front].slice(0, FRONT_SHOWN).join("");
    });
    return `group ${group.id} "${group.title}" (${group.format}, ${group.cards.length} cards${
      shown.length === 0 ? "" : `: ${shown.join(" / ")}`
    })`;
  });
  return `${header}: ${groups.join("; ")}]`;
}

/** How many fronts of each group a turn's proposals show, most first. */
const FRONTS_SHOWN = [5, 1, 0] as const;

/**
 * A turn as the model reads it: [text], its proposals and [notes], such as the question it asked,
 * each proposal described in as much detail as fits `MAX_DESCRIBED_TURN` and those that still do
 * not fit counted. Null when nothing is said, or when the text and the notes alone are over the cap.
 */
function describeTurn(
  text: string,
  proposals: readonly Proposal[],
  notes: readonly string[],
  ids: IdSource,
): string | null {
  const join = (described: readonly string[]) =>
    [text, ...described, ...notes]
      .filter((part) => part.trim() !== "").join("\n\n");
  const fits = (joined: string) => [...joined].length <= MAX_DESCRIBED_TURN;
  for (const fronts of FRONTS_SHOWN) {
    const joined = join(
      proposals.map((proposal) => describe(proposal, ids, fronts)),
    );
    if (fits(joined)) return joined === "" ? null : joined;
  }
  const counted = proposals.map((proposal) => describe(proposal, ids, null));
  for (let shown = counted.length; shown >= 0; shown--) {
    const rest = counted.length - shown;
    const joined = join([
      ...counted.slice(0, shown),
      ...(rest === 0 ? [] : [`[and ${rest} more proposals]`]),
    ]);
    if (fits(joined)) return joined;
  }
  return null;
}

/**
 * [text] within `MAX_TURN_TEXT` characters: whole when it fits, and otherwise its head and tail
 * around a marker counting the characters left out.
 */
function shorten(text: string): string {
  const chars = [...text];
  if (chars.length <= MAX_TURN_TEXT) return text;
  const marker = (left: number) => `\n\n[… ${left} characters left out …]\n\n`;
  // The marker for the whole text is the longest any omission needs.
  const kept = MAX_TURN_TEXT - [...marker(chars.length)].length;
  const head = Math.ceil(kept / 2);
  const tail = kept - head;
  return chars.slice(0, head).join("") + marker(chars.length - kept) +
    chars.slice(chars.length - tail).join("");
}

/** [body] with each assistant turn's text shortened, its other parts as they were. */
export function shortenReplies(body: unknown): unknown {
  if (!isRecord(body) || !Array.isArray(body.messages)) return body;
  return {
    ...body,
    messages: body.messages.map((message: unknown) =>
      isRecord(message) && message.role === "assistant" &&
        typeof message.text === "string"
        ? { ...message, text: shorten(message.text) }
        : message
    ),
  };
}

/** The turns, their proposals and the open note, or null when the body is not such a request. */
export function readMessage(body: unknown, ids: IdSource): Incoming | null {
  if (!isRecord(body) || !Array.isArray(body.messages)) return null;
  const messages = body.messages;
  if (messages.length === 0 || messages.length > MAX_TURNS) return null;
  const turns: Turn[] = [];
  const proposals: Proposal[] = [];
  let attached: readonly string[] = [];
  for (const message of messages) {
    if (
      !isRecord(message) ||
      (message.role !== "user" && message.role !== "assistant")
    ) {
      return null;
    }
    const text = typeof message.text === "string" ? message.text : null;
    // An assistant turn's text is already shortened (`shortenReplies`); a user's longer is refused.
    if (text === null || [...text].length > MAX_TURN_TEXT) return null;
    const shown: Proposal[] = [];
    const notes: string[] = [];
    if (message.role === "assistant") {
      for (
        const value of Array.isArray(message.proposals) ? message.proposals : []
      ) {
        const proposal = parseProposal(value);
        if (proposal === null) return null;
        shown.push(proposal);
      }
      if (message.choice !== undefined) {
        const choice = message.choice;
        if (
          !isRecord(choice) || typeof choice.prompt !== "string" ||
          !Array.isArray(choice.options) || !choice.options.every((o) =>
            typeof o === "string"
          )
        ) return null;
        notes.push(
          `[asked: ${choice.prompt} (${choice.options.join(" / ")})]`,
        );
      }
      if (message.job !== undefined) {
        const job = readJobShown(message.job);
        if (job === null) return null;
        notes.push(`[photo job ${job.id} started over ${job.photos} photos]`);
      }
      if (message.photos !== undefined) return null;
    } else if (
      message.proposals !== undefined || message.choice !== undefined ||
      message.job !== undefined
    ) {
      return null;
    } else if (message.photos !== undefined) {
      const photos = readPhotos(message.photos);
      if (photos === null) return null;
      attached = photos;
      notes.push(`[${photos.length} photos attached]`);
    }
    const described = describeTurn(text, shown, notes, ids);
    if (described === null) {
      // An assistant turn that said nothing, as one does when its user left or its model failed
      // before any text, is no turn: clients send it back. A user turn that said nothing, and a
      // turn over the cap, are refused.
      const empty = text.trim() === "" && shown.length === 0 &&
        notes.length === 0;
      if (message.role === "user" || !empty) return null;
      continue;
    }
    proposals.push(...shown);
    const last = turns.at(-1);
    if (message.role === "assistant" && last === undefined) {
      // Anthropic requires a history that does not start with an assistant turn, as a window of the last 40 can.
      continue;
    }
    if (message.role === "user" && last?.role === "user") {
      // The turns dropped between two user turns leave them adjacent; the providers take alternation.
      turns[turns.length - 1] = {
        ...last,
        text: `${last.text}\n\n${described}`,
      };
      continue;
    }
    turns.push({ role: message.role, text: described });
  }
  if (turns.at(-1)?.role !== "user") return null;
  const context = body.context;
  let deckId: string | null = null;
  let timeZone: string | null = null;
  if (context !== undefined) {
    if (!isRecord(context)) return null;
    if (context.deck_id !== undefined) {
      const id = typeof context.deck_id === "string"
        ? context.deck_id.toLowerCase()
        : null;
      if (id === null || !UUID.test(id)) return null;
      deckId = id;
    }
    if (context.time_zone !== undefined) {
      const zone = readTimeZone(context.time_zone);
      if (zone === "refused") return null;
      timeZone = zone;
    }
  }
  return { turns, proposals, deckId, timeZone, attached };
}

/**
 * An IANA zone name as the runtime spells it; null when `Intl` does not know the name, which is
 * read as no zone; `"refused"` for what is no IANA name at all: not a string, or an offset or an
 * abbreviation.
 */
function readTimeZone(value: unknown): string | null | "refused" {
  if (typeof value !== "string" || !TIME_ZONE.test(value)) return "refused";
  try {
    return new Intl.DateTimeFormat(undefined, { timeZone: value })
      .resolvedOptions().timeZone;
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
}

/** A user turn's photo ids: 1 to `MAX_JOB_PHOTOS` distinct uuids, or null. */
function readPhotos(value: unknown): readonly string[] | null {
  if (
    !Array.isArray(value) || value.length === 0 ||
    value.length > MAX_JOB_PHOTOS
  ) return null;
  const ids: string[] = [];
  for (const id of value) {
    const read = typeof id === "string" ? id.toLowerCase() : "";
    if (!UUID.test(read) || ids.includes(read)) return null;
    ids.push(read);
  }
  return ids;
}

/** An assistant turn's job, as the `job` event sent it, or null when it is not one. */
function readJobShown(value: unknown): { id: string; photos: number } | null {
  if (!isRecord(value) || typeof value.id !== "string") return null;
  const id = value.id.toLowerCase();
  const photos = value.photos;
  if (
    !UUID.test(id) || typeof photos !== "number" ||
    !Number.isSafeInteger(photos) || photos < 1 || photos > MAX_JOB_PHOTOS
  ) return null;
  return { id, photos };
}
