import {
  type AssistantEvent,
  type Choice,
  type JobProgress,
  type Proposal,
  parseProposal,
} from "./protocol";

/** A web source a reply cites. */
export type Citation = { url: string; title: string };

/**
 * What a commit wrote: the note and how many of its cards, and how many it left out because the
 * note held them already ([skipped]) or the write refused them ([refused]).
 */
export type Added = {
  deck: { id: string; name: string };
  count: number;
  skipped: number;
  refused: number;
};

/** A proposal as the chat shows it: the cards checked in each group, and what adding it wrote. */
export type ShownProposal = {
  proposal: Proposal;
  checked: Record<string, string[]>;
  added: Added | null;
};

/**
 * How a reply ended: whole, failed at the model, cut at the output limit, stopped by the user, or
 * at the turn's depth or time limit with nothing to show.
 */
export type Ending = "ok" | "model_error" | "cut" | "stopped" | "limit";

/**
 * The user's message: the ids of the [photos] it uploaded, and [auto] for the one the chat sends
 * itself when a photo job is done, which the thread does not draw.
 */
export type UserTurn = {
  role: "user";
  id: string;
  text: string;
  photos: string[];
  auto: boolean;
};

/** The line naming the note the chat was opened from: in the thread, never sent as a turn. */
export type ContextTurn = { role: "context"; id: string; deckId: string; name: string };

/** What the chat sends in the user's place when a photo job is done (the phone's, #721). */
export const jobDoneMessage = "사진 읽기가 끝났어요. 이어서 해 주세요.";

/**
 * 말랑이's turn; its [ending] is null while it streams. Its [interim] is the passing status line,
 * the last interim text folded to one line, kept only while the reply has not begun and the turn
 * has not ended, and never stored or sent.
 */
export type AssistantTurn = {
  role: "assistant";
  id: string;
  text: string;
  citations: Citation[];
  proposals: ShownProposal[];
  choice: Choice | null;
  job: JobProgress | null;
  interim: string | null;
  ending: Ending | null;
};

export type Turn = UserTurn | AssistantTurn | ContextTurn;

/** The one conversation, kept in this browser (#711 decision 4), and the message being written. */
export type Conversation = { turns: Turn[]; draft: string };

export const emptyConversation: Conversation = { turns: [], draft: "" };

/** The most turns a message carries, as the function's `MAX_TURNS`. */
export const maxTurns = 40;

/** The longest a user's message may be, as the function's `MAX_TURN_TEXT`. */
export const maxMessageLength = 4000;

/** [proposal] shown with every card checked. */
export function shown(proposal: Proposal): ShownProposal {
  return {
    proposal,
    checked: Object.fromEntries(
      proposal.groups.map((group) => [group.id, group.cards.map((card) => card.id)]),
    ),
    added: null,
  };
}

/**
 * [proposal] sent again under the id [before] showed, a group remade: each group that kept its
 * cards keeps its checks, and a remade one is checked whole.
 */
function reshown(before: ShownProposal, proposal: Proposal): ShownProposal {
  const fresh = shown(proposal);
  for (const group of proposal.groups) {
    const kept = before.checked[group.id];
    const ids = group.cards.map((card) => card.id);
    const old = before.proposal.groups.find((one) => one.id === group.id);
    if (
      kept &&
      old &&
      old.cards.length === ids.length &&
      old.cards.every((c) => ids.includes(c.id))
    )
      fresh.checked[group.id] = kept;
  }
  return fresh;
}

/** [text] with every run of whitespace folded to one space and the ends trimmed. */
const folded = (text: string) => text.replace(/\s+/g, " ").trim();

/**
 * [turn] ended as [ending]: its status line goes with it, and a turn already ended keeps its first
 * ending.
 */
export function ended(turn: AssistantTurn, ending: Ending): AssistantTurn {
  return turn.ending ? turn : { ...turn, ending, interim: null };
}

/** Whether [turn] holds a reply, a proposal, a question or a job. */
const hasContent = (turn: AssistantTurn) =>
  turn.text !== "" || turn.proposals.length > 0 || turn.choice !== null || turn.job !== null;

/**
 * [turn] with [event] of its stream applied; `usage` ends a turn that stopped at a limit with
 * nothing to show as `limit`, and changes no other.
 */
export function withEvent(turn: AssistantTurn, event: AssistantEvent): AssistantTurn {
  switch (event.type) {
    case "text": {
      // A reply's leading whitespace is the separator the function sends before a call's text,
      // which belongs to the text after it (ADR 0224).
      const shownText = turn.text === "" ? event.delta.trimStart() : event.delta;
      return shownText === "" ? turn : { ...turn, text: turn.text + shownText, interim: null };
    }
    case "interim": {
      const line = folded(turn.text);
      return line === "" ? { ...turn, text: "" } : { ...turn, text: "", interim: line };
    }
    case "citation":
      return turn.citations.some((one) => one.url === event.url)
        ? turn
        : { ...turn, citations: [...turn.citations, { url: event.url, title: event.title }] };
    case "proposal": {
      const at = turn.proposals.findIndex((one) => one.proposal.id === event.proposal.id);
      const before = turn.proposals[at];
      if (!before) return { ...turn, proposals: [...turn.proposals, shown(event.proposal)] };
      const proposals = [...turn.proposals];
      proposals[at] = reshown(before, event.proposal);
      return { ...turn, proposals };
    }
    case "choice":
      return { ...turn, choice: event.choice };
    case "job":
      return {
        ...turn,
        job: { id: event.id, photos: event.photos, finished: 0, state: "running" },
      };
    case "error":
      return { ...turn, ending: event.error, interim: null };
    case "usage":
      return event.atLimit && !hasContent(turn) && turn.ending === null
        ? { ...turn, ending: "limit", interim: null }
        : turn;
  }
}

/** A turn as a message request carries it (`assistant.md` §Requests). */
export type RequestTurn =
  | { role: "user"; text: string; photos?: string[] }
  | {
      role: "assistant";
      text: string;
      proposals?: Proposal[];
      choice?: Choice;
      job?: { id: string; photos: number };
    };

/**
 * The last [maxTurns] of [turns] as a message sends them, oldest first: a user's with the photos
 * it attached, a reply's with its proposals, question and photo job. A context line is no turn.
 */
export function requestTurns(turns: readonly Turn[]): RequestTurn[] {
  return turns
    .filter((turn) => turn.role !== "context")
    .slice(-maxTurns)
    .map((turn) =>
      turn.role === "user"
        ? { role: "user", text: turn.text, ...(turn.photos.length > 0 && { photos: turn.photos }) }
        : {
            role: "assistant",
            text: turn.text,
            ...(turn.proposals.length > 0 && {
              proposals: turn.proposals.map((one) => one.proposal),
            }),
            ...(turn.choice && { choice: turn.choice }),
            ...(turn.job && { job: { id: turn.job.id, photos: turn.job.photos } }),
          },
    );
}

/** The last turn that is a message, not a context line. */
export function lastMessage(turns: readonly Turn[]): UserTurn | AssistantTurn | undefined {
  return turns.findLast((turn): turn is UserTurn | AssistantTurn => turn.role !== "context");
}

/** The reply whose photo job is still reading, the latest, or undefined. */
export function runningJob(turns: readonly Turn[]): AssistantTurn | undefined {
  return turns.findLast(
    (turn): turn is AssistantTurn => turn.role === "assistant" && turn.job?.state === "running",
  );
}

/** How many cards [one] would add or change: those checked in its groups. */
export function checkedCount(one: ShownProposal): number {
  return Object.values(one.checked).reduce((sum, ids) => sum + ids.length, 0);
}

/**
 * The proposal 말랑이 has ready: the last one shown, while it is not added and the reply that
 * showed it has ended; null otherwise.
 */
export function readyProposal(conversation: Conversation): ShownProposal | null {
  const last = conversation.turns.findLast(
    (turn): turn is AssistantTurn => turn.role === "assistant" && turn.proposals.length > 0,
  );
  const proposal = last?.proposals.at(-1);
  return last?.ending && proposal && proposal.added === null ? proposal : null;
}

/**
 * [conversation] opened from [note]: its name said once in the thread, unless the thread's last
 * line already says it (#711).
 */
export function enteredFrom(
  conversation: Conversation,
  note: { id: string; name: string },
  id: string,
): Conversation {
  const last = conversation.turns.at(-1);
  if (last?.role === "context" && last.deckId === note.id) return conversation;
  return {
    ...conversation,
    turns: [...conversation.turns, { role: "context", id, deckId: note.id, name: note.name }],
  };
}

const storageKey = "knowno.assistant";

type Fields = Record<string, unknown>;
const isFields = (value: unknown): value is Fields =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === "string";

function shownOf(value: unknown): ShownProposal | null {
  if (!isFields(value) || !isFields(value.checked)) return null;
  const proposal = parseProposal(value.proposal);
  if (!proposal) return null;
  const checked: Record<string, string[]> = {};
  for (const [group, ids] of Object.entries(value.checked)) {
    if (!Array.isArray(ids) || !ids.every(isText)) return null;
    checked[group] = ids;
  }
  const added = value.added;
  if (added === null) return { proposal, checked, added: null };
  if (
    !isFields(added) ||
    typeof added.count !== "number" ||
    !isFields(added.deck) ||
    !isText(added.deck.id) ||
    !isText(added.deck.name)
  )
    return null;
  return {
    proposal,
    checked,
    added: {
      deck: { id: added.deck.id, name: added.deck.name },
      count: added.count,
      skipped: typeof added.skipped === "number" ? added.skipped : 0,
      refused: typeof added.refused === "number" ? added.refused : 0,
    },
  };
}

function jobOf(value: unknown): JobProgress | null {
  if (!isFields(value) || !isText(value.id)) return null;
  const { photos, finished, state } = value;
  if (typeof photos !== "number" || typeof finished !== "number") return null;
  if (state !== "running" && state !== "done" && state !== "cancelled") return null;
  return { id: value.id, photos, finished, state };
}

function turnOf(value: unknown): Turn | null {
  if (!isFields(value) || !isText(value.id)) return null;
  if (value.role === "context")
    return isText(value.deckId) && isText(value.name)
      ? { role: "context", id: value.id, deckId: value.deckId, name: value.name }
      : null;
  if (!isText(value.text)) return null;
  if (value.role === "user") {
    const photos = Array.isArray(value.photos) ? value.photos.filter(isText) : [];
    return { role: "user", id: value.id, text: value.text, photos, auto: value.auto === true };
  }
  if (value.role !== "assistant") return null;
  const citations = Array.isArray(value.citations)
    ? value.citations.filter(
        (one): one is Citation => isFields(one) && isText(one.url) && isText(one.title),
      )
    : [];
  const proposals = Array.isArray(value.proposals) ? value.proposals.map(shownOf) : [];
  if (proposals.some((one) => one === null)) return null;
  const choice = value.choice;
  const ending = value.ending;
  return {
    role: "assistant",
    id: value.id,
    text: value.text,
    citations,
    proposals: proposals.filter((one) => one !== null),
    choice:
      isFields(choice) &&
      isText(choice.prompt) &&
      Array.isArray(choice.options) &&
      choice.options.every(isText)
        ? { prompt: choice.prompt, options: choice.options }
        : null,
    job: jobOf(value.job),
    interim: null,
    // A reply stored mid-stream, its page closed, ended there.
    ending:
      ending === "model_error" || ending === "cut" || ending === "ok" || ending === "limit"
        ? ending
        : "stopped",
  };
}

/** [text] read as a stored conversation, or the empty one when it is none. */
export function parseConversation(text: string | null): Conversation {
  if (text === null) return emptyConversation;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return emptyConversation;
  }
  if (!isFields(value) || value.version !== 1 || !Array.isArray(value.turns))
    return emptyConversation;
  const turns = value.turns.map(turnOf);
  if (turns.some((turn) => turn === null)) return emptyConversation;
  return {
    turns: turns.filter((turn) => turn !== null),
    draft: isText(value.draft) ? value.draft : "",
  };
}

/** The conversation this browser keeps, or the empty one where storage cannot be read. */
export function loadConversation(): Conversation {
  try {
    return parseConversation(window.localStorage.getItem(storageKey));
  } catch {
    return emptyConversation;
  }
}

/** [conversation] as it is stored: the reply alone, no turn's passing status line. */
function stored(conversation: Conversation): Conversation {
  return {
    ...conversation,
    turns: conversation.turns.map((turn) =>
      turn.role === "assistant" ? { ...turn, interim: null } : turn,
    ),
  };
}

/** Keeps [conversation] in this browser; whether the browser kept it. */
export function storeConversation(conversation: Conversation): boolean {
  try {
    if (conversation.turns.length === 0 && conversation.draft === "")
      window.localStorage.removeItem(storageKey);
    else
      window.localStorage.setItem(
        storageKey,
        JSON.stringify({ version: 1, ...stored(conversation) }),
      );
    return true;
  } catch {
    return false;
  }
}

/** The storage key, for a listener that hears another tab change it. */
export const conversationKey = storageKey;
