/**
 * The assistant function's wire forms (`assistant.md` §Requests, §Stream, §Proposals), parsed at
 * the boundary: what a stream's events and a refusal's body hold once read.
 */

/** The card forms a proposal group takes, each card of the group in it (ADR 0197). */
export const formats = ["text", "senses", "cloze", "table", "image", "mixed"] as const;
export type Format = (typeof formats)[number];

/** A proposed card: its id and the card exactly as `add_cards` or `update_cards` takes it. */
export type ProposalCard = { id: string; card: Record<string, unknown> };

export type ProposalGroup = { id: string; title: string; format: Format; cards: ProposalCard[] };

/** New cards for a note, or a new note where `deck.id` is null; or changes to a note's cards. */
export type Proposal = {
  id: string;
  kind: "cards" | "changes";
  deck: { id: string | null; name: string };
  groups: ProposalGroup[];
};

/** A question 말랑이 asks, with 2 to 6 options. */
export type Choice = { prompt: string; options: string[] };

/** The day's tokens after a message: the plan's budget, null for none, and those charged. */
export type Allowance = { tokenBudget: number | null; tokensUsed: number };

/** One event of a message's stream. */
export type AssistantEvent =
  | { type: "text"; delta: string }
  | { type: "citation"; url: string; title: string }
  | { type: "proposal"; proposal: Proposal }
  | { type: "choice"; choice: Choice }
  | { type: "error"; error: "model_error" | "cut" }
  | { type: "usage"; allowance: Allowance };

/** Why a message was not started, or did not reach the function. */
export type SendRefusal =
  | { kind: "rate_limited"; allowance: Allowance | null }
  | { kind: "busy" }
  | { kind: "signIn" }
  | { kind: "suspended" }
  | { kind: "tooLong" }
  | { kind: "unavailable" }
  | { kind: "unreachable" };

type Fields = Record<string, unknown>;

function isFields(value: unknown): value is Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const isText = (value: unknown): value is string => typeof value === "string";

function formatOf(value: unknown): Format | null {
  return formats.find((format) => format === value) ?? null;
}

function cardOf(value: unknown): ProposalCard | null {
  if (!isFields(value) || !isText(value.id) || !isFields(value.card)) return null;
  return { id: value.id, card: value.card };
}

function groupOf(value: unknown): ProposalGroup | null {
  if (!isFields(value) || !isText(value.id) || !isText(value.title)) return null;
  const format = formatOf(value.format);
  if (format === null || !Array.isArray(value.cards)) return null;
  const cards = value.cards.map(cardOf);
  if (cards.some((card) => card === null)) return null;
  return { id: value.id, title: value.title, format, cards: cards.filter((card) => card !== null) };
}

/** [value] as a proposal, or null when it is not one. */
export function parseProposal(value: unknown): Proposal | null {
  if (!isFields(value) || !isText(value.id)) return null;
  if (value.kind !== "cards" && value.kind !== "changes") return null;
  const deck = value.deck;
  if (!isFields(deck) || !isText(deck.name) || !(deck.id === null || isText(deck.id))) return null;
  if (!Array.isArray(value.groups) || value.groups.length === 0) return null;
  const groups = value.groups.map(groupOf);
  if (groups.some((group) => group === null)) return null;
  return {
    id: value.id,
    kind: value.kind,
    deck: { id: deck.id, name: deck.name },
    groups: groups.filter((group) => group !== null),
  };
}

function allowanceOf(value: Fields): Allowance | null {
  const { token_budget: budget, tokens_used: used } = value;
  if (typeof used !== "number" || !(budget === null || typeof budget === "number")) return null;
  return { tokenBudget: budget, tokensUsed: used };
}

/**
 * The event named [name] carrying the JSON [data]: the event, `unknown` for a name this client does
 * not draw, or `malformed` for a known name whose data is not its form.
 */
export function parseEvent(name: string, data: string): AssistantEvent | "unknown" | "malformed" {
  const known = ["text", "citation", "proposal", "choice", "error", "usage"];
  if (!known.includes(name)) return "unknown";
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return "malformed";
  }
  if (!isFields(value)) return "malformed";
  switch (name) {
    case "text":
      return isText(value.delta) ? { type: "text", delta: value.delta } : "malformed";
    case "citation":
      return isText(value.url) && isText(value.title)
        ? { type: "citation", url: value.url, title: value.title }
        : "malformed";
    case "proposal": {
      const proposal = parseProposal(value);
      return proposal ? { type: "proposal", proposal } : "malformed";
    }
    case "choice": {
      const { prompt, options } = value;
      return isText(prompt) && Array.isArray(options) && options.length > 0 && options.every(isText)
        ? { type: "choice", choice: { prompt, options } }
        : "malformed";
    }
    case "error":
      return value.error === "model_error" || value.error === "cut"
        ? { type: "error", error: value.error }
        : "malformed";
    default: {
      const allowance = allowanceOf(value);
      return allowance ? { type: "usage", allowance } : "malformed";
    }
  }
}

/** The refusal a message's [status] and JSON [body] mean (`assistant.md` §Requests). */
export function parseRefusal(status: number, body: unknown): SendRefusal {
  const error = isFields(body) ? body.error : undefined;
  if (status === 429 && error === "busy") return { kind: "busy" };
  if (status === 429)
    return { kind: "rate_limited", allowance: isFields(body) ? allowanceOf(body) : null };
  if (status === 401) return { kind: "signIn" };
  if (status === 403) return { kind: "suspended" };
  if (status === 413) return { kind: "tooLong" };
  return { kind: "unavailable" };
}

/** The share of the day's budget [allowance] leaves, 0 to 100, or null without a budget. */
export function leftShare(allowance: Allowance): number | null {
  const { tokenBudget, tokensUsed } = allowance;
  if (tokenBudget === null) return null;
  if (tokenBudget <= 0) return 0;
  return Math.max(0, Math.min(100, Math.floor(((tokenBudget - tokensUsed) / tokenBudget) * 100)));
}
