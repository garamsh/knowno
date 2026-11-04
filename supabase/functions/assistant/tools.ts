/**
 * The assistant's tools (ADR 0190, ADR 0197): the MCP read tools, called as `mcp` calls them; a
 * card form's guide; the proposal tools, which validate as `add_cards` and `update_cards` do, hold
 * each group to one form and write nothing; a group's regeneration; and a question with choices. A
 * proposal is shown to the user, who adds it.
 */

import {
  type Form,
  formOf,
  FORMS,
  type Skills,
} from "../_shared/card_forms.ts";
import { type IdSource, uuidV7 } from "../_shared/cards.ts";
import { keptOf, readCard } from "../_shared/input.ts";
import { deckKeys, readCards, readDeck, type Store } from "../_shared/store.ts";
import { callTool, MAX_CARDS, type ToolDeps, TOOLS } from "../_shared/tools.ts";
import type { ToolSpec } from "./providers.ts";

/** A card of a proposal: its id, and the card as `add_cards` or `update_cards` takes it. */
export type ProposedCard = {
  readonly id: string;
  readonly card: Record<string, unknown>;
};

export type Group = {
  readonly id: string;
  readonly title: string;
  /** The form every card of the group takes. */
  readonly format: Form;
  readonly cards: readonly ProposedCard[];
};

/**
 * A draft the user adds or not: new cards for a deck, a new deck when its id is null, or changes
 * to existing cards, whose card ids are theirs. Nothing in it is saved.
 */
export type Proposal = {
  readonly id: string;
  readonly kind: "cards" | "changes";
  readonly deck: { readonly id: string | null; readonly name: string };
  readonly groups: readonly Group[];
};

/** A question the user answers by picking one option or typing; the turn ends with it. */
export type Choice = {
  readonly prompt: string;
  readonly options: readonly string[];
};

/** What a tool shows the user beside its answer to the model. */
export type Shown =
  | { readonly kind: "proposal"; readonly proposal: Proposal }
  | { readonly kind: "choice"; readonly choice: Choice };

/** A tool's answer to the model, and what it shows the user, if anything. */
export type Ran = {
  readonly content: Record<string, unknown> | string;
  readonly isError: boolean;
  readonly shown: Shown | null;
};

const READ_TOOLS = ["list_decks", "list_cards", "search_cards"] as const;
const MAX_GROUPS = 20;
const MAX_TITLE = 60;
const MAX_NAME = 500;
const MAX_OPTIONS = 6;
const MAX_OPTION = 40;
const MAX_PROMPT = 200;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const definition = (name: string) => {
  const tool = TOOLS.find((known) => known.name === name);
  if (tool === undefined) throw new Error(`no shared tool named ${name}`);
  return tool;
};

/** The card form [name] takes, so a proposed card is exactly what add_cards or update_cards takes. */
function cardForm(name: "add_cards" | "update_cards") {
  const properties = definition(name).inputSchema.properties;
  if (!("cards" in properties)) throw new Error(`${name} takes no cards`);
  return properties.cards.items;
}

const addCard = cardForm("add_cards");
const changedCard = cardForm("update_cards");

const groupsField = (card: unknown) => ({
  type: "array",
  minItems: 1,
  maxItems: MAX_GROUPS,
  description:
    `The cards by area or topic, ${MAX_CARDS} cards at most over all groups. Every card of a group takes the group's form; cards of another form go in a group of their own.`,
  items: {
    type: "object",
    properties: {
      title: {
        type: "string",
        minLength: 1,
        maxLength: MAX_TITLE,
        description:
          "The area or topic, as the user will see it, such as 1단원 or 동사.",
      },
      format: {
        type: "string",
        enum: FORMS,
        description:
          "The card form every card of the group takes, as the card forms index names it.",
      },
      cards: { type: "array", minItems: 1, maxItems: MAX_CARDS, items: card },
    },
    required: ["title", "format", "cards"],
    additionalProperties: false,
  },
});

const deckIdField = {
  type: "string",
  format: "uuid",
  description: "The note's id, as list_decks returned it.",
};

/** The tools the model is offered, the shared read tools first. */
export const ASSISTANT_TOOLS: readonly ToolSpec[] = [
  ...READ_TOOLS.map((name) => {
    const tool = definition(name);
    return {
      name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    };
  }),
  {
    name: "read_card_form",
    description:
      "Reads one card form's guide: its rules, a good and a bad example, and its edge cases. Read the guide of each form you will use before proposing cards of it.",
    inputSchema: {
      type: "object",
      properties: { form: { type: "string", enum: FORMS } },
      required: ["form"],
      additionalProperties: false,
    },
  },
  {
    name: "propose_deck",
    description:
      `Shows the user a new note (deck) with its cards as a draft. Nothing is saved: the user adds the cards they check. Cards take add_cards' forms.`,
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          minLength: 1,
          maxLength: MAX_NAME,
          description: "The note's name.",
        },
        groups: groupsField(addCard),
      },
      required: ["name", "groups"],
      additionalProperties: false,
    },
  },
  {
    name: "propose_cards",
    description:
      `Shows the user new cards for one of their notes as a draft. Nothing is saved: the user adds the cards they check. Cards take add_cards' forms; a card matching one in the note is left out as a duplicate.`,
    inputSchema: {
      type: "object",
      properties: { deck_id: deckIdField, groups: groupsField(addCard) },
      required: ["deck_id", "groups"],
      additionalProperties: false,
    },
  },
  {
    name: "propose_changes",
    description:
      `Shows the user changes to cards of one of their notes as a draft. Nothing is saved: the user applies the changes they check. Each card is its id with its new blocks, as update_cards takes it; read the cards first.`,
    inputSchema: {
      type: "object",
      properties: { deck_id: deckIdField, groups: groupsField(changedCard) },
      required: ["deck_id", "groups"],
      additionalProperties: false,
    },
  },
  {
    name: "regenerate_group",
    description:
      "Remakes one group of a proposal shown earlier in this conversation in the given format, keeping the proposal's other groups as they are. Give the proposal's and the group's ids as the conversation names them.",
    inputSchema: {
      type: "object",
      properties: {
        proposal_id: { type: "string", format: "uuid" },
        group_id: { type: "string", format: "uuid" },
        format: { type: "string", enum: FORMS },
        cards: {
          type: "array",
          minItems: 1,
          maxItems: MAX_CARDS,
          items: addCard,
        },
      },
      required: ["proposal_id", "group_id", "format", "cards"],
      additionalProperties: false,
    },
  },
  {
    name: "ask_choice",
    description:
      `Asks the user one question with ${MAX_OPTIONS} or fewer short options to tap, such as the format, the area or the amount, before generating. The turn ends here; the user's pick, or a typed answer, comes as their next message.`,
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", minLength: 1, maxLength: MAX_PROMPT },
        options: {
          type: "array",
          minItems: 2,
          maxItems: MAX_OPTIONS,
          items: { type: "string", minLength: 1, maxLength: MAX_OPTION },
        },
      },
      required: ["prompt", "options"],
      additionalProperties: false,
    },
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const idOf = (value: unknown): string | null =>
  typeof value === "string" && UUID.test(value.toLowerCase())
    ? value.toLowerCase()
    : null;

const trimmed = (value: unknown, max: number): string | null => {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text === "" || [...text].length > max ? null : text;
};

const refuse = (message: string): Ran => ({
  content: message,
  isError: true,
  shown: null,
});

/** A proposal as the client sent it back, or null when it is not one. */
export function parseProposal(value: unknown): Proposal | null {
  if (
    !isRecord(value) || !isRecord(value.deck) || !Array.isArray(value.groups)
  ) return null;
  const id = idOf(value.id);
  const kind = value.kind === "cards" || value.kind === "changes"
    ? value.kind
    : null;
  const deckId = value.deck.id === null ? null : idOf(value.deck.id);
  const name = trimmed(value.deck.name, MAX_NAME);
  if (
    id === null || kind === null || name === null ||
    (deckId === null && (value.deck.id !== null || kind === "changes")) ||
    value.groups.length === 0 || value.groups.length > MAX_GROUPS
  ) return null;
  const groups: Group[] = [];
  let total = 0;
  for (const group of value.groups) {
    if (!isRecord(group) || !Array.isArray(group.cards)) return null;
    const groupId = idOf(group.id);
    const title = trimmed(group.title, MAX_TITLE);
    const format = FORMS.find((known) => known === group.format);
    if (groupId === null || title === null || format === undefined) return null;
    const cards: ProposedCard[] = [];
    for (const proposed of group.cards) {
      const cardId = isRecord(proposed) ? idOf(proposed.id) : null;
      if (cardId === null || !isRecord(proposed) || !isRecord(proposed.card)) {
        return null;
      }
      cards.push({ id: cardId, card: proposed.card });
    }
    total += cards.length;
    groups.push({ id: groupId, title, format, cards });
  }
  if (total === 0 || total > MAX_CARDS) return null;
  return { id, kind, deck: { id: deckId, name }, groups };
}

type Skipped = { group: number; index: number; front: string; reason: string };
type Refused = { group: number; index: number; reason: string };
/** A card whose form is not its group's. */
type Misplaced = { group: number; index: number; form: Form };

/** A group as the model gave it. */
type GroupInput = { title: string; format: Form; cards: unknown[] };

/**
 * The refusal of a proposal whose groups mix forms, naming each card out of its group's form, or
 * null when every card takes its group's.
 */
function mixedForms(
  groups: readonly GroupInput[],
  misplaced: readonly Misplaced[],
): Ran | null {
  if (misplaced.length === 0) return null;
  const named = misplaced.map(({ group, index, form }) =>
    `card ${index} of group ${group} (${groups[group]?.title}, ${
      groups[group]?.format
    }) is a ${form} card`
  );
  return refuse(
    `Nothing was shown: a group holds cards of one form, and ${
      named.join("; ")
    }. Move each into a group of its form, one group a form, or rewrite it in its group's form; read_card_form says what each form holds.`,
  );
}

/**
 * Reads each group's cards as `add_cards` reads them, leaving out duplicates of [keys] and of the
 * cards before, and names each card out of its group's form; keeps the groups with a card left.
 * [ids] names the groups kept as before, by index.
 */
function readGroups(
  input: readonly GroupInput[],
  keys: Map<string, string>,
  deps: IdSource,
  groupIds: readonly (string | undefined)[],
): {
  groups: Group[];
  skipped: Skipped[];
  refused: Refused[];
  misplaced: Misplaced[];
} {
  const groups: Group[] = [];
  const skipped: Skipped[] = [];
  const refused: Refused[] = [];
  const misplaced: Misplaced[] = [];
  for (const [g, group] of input.entries()) {
    const cards: ProposedCard[] = [];
    for (const [index, value] of group.cards.entries()) {
      const card = readCard(value, deps);
      if (typeof card === "string" || !isRecord(value)) {
        refused.push({
          group: g,
          index,
          reason: typeof card === "string"
            ? card
            : "the card must be an object.",
        });
        continue;
      }
      const form = formOf(card.blocks.map((block) => block.type));
      if (form !== group.format) {
        misplaced.push({ group: g, index, form });
        continue;
      }
      if (keys.has(card.key)) {
        skipped.push({
          group: g,
          index,
          front: card.front,
          reason:
            "a card with the same first-shown text is already in the note or this proposal",
        });
        continue;
      }
      const id = uuidV7(deps);
      keys.set(card.key, id);
      cards.push({ id, card: value });
    }
    if (cards.length > 0) {
      groups.push({
        id: groupIds[g] ?? uuidV7(deps),
        title: group.title,
        format: group.format,
        cards,
      });
    }
  }
  return { groups, skipped, refused, misplaced };
}

/** The groups argument read, or a refusal naming what is wrong. */
function groupsOf(value: unknown): GroupInput[] | string {
  if (
    !Array.isArray(value) || value.length === 0 || value.length > MAX_GROUPS
  ) {
    return `groups must be a list of 1 to ${MAX_GROUPS} groups, each with a title, a format and cards.`;
  }
  const groups = [];
  let total = 0;
  for (const [index, group] of value.entries()) {
    const title = isRecord(group) ? trimmed(group.title, MAX_TITLE) : null;
    const format = isRecord(group)
      ? FORMS.find((known) => known === group.format)
      : undefined;
    if (
      !isRecord(group) || title === null || format === undefined ||
      !Array.isArray(group.cards) ||
      group.cards.length === 0
    ) {
      return `group ${index} must have a title of 1 to ${MAX_TITLE} characters, a format of ${
        FORMS.join(", ")
      } and at least one card.`;
    }
    total += group.cards.length;
    groups.push({ title, format, cards: group.cards });
  }
  if (total > MAX_CARDS) {
    return `A proposal holds at most ${MAX_CARDS} cards, and this one has ${total}. Nothing was shown. Propose ${MAX_CARDS} or fewer now and the rest in a later turn.`;
  }
  return groups;
}

/** The model's view of a proposal it made: its ids and each group's size. */
function summary(proposal: Proposal, skipped: Skipped[], refused: Refused[]) {
  return {
    proposal_id: proposal.id,
    deck: proposal.deck,
    groups: proposal.groups.map((group) => ({
      group_id: group.id,
      title: group.title,
      format: group.format,
      cards: group.cards.length,
    })),
    skipped,
    refused,
    shown_to_user:
      "Nothing is saved until the user taps 추가 and checks the cards to keep.",
  };
}

function shownProposal(
  proposal: Proposal,
  skipped: Skipped[],
  refused: Refused[],
): Ran {
  if (proposal.groups.length === 0) {
    return refuse(
      `No card could be shown; nothing was proposed. ${
        JSON.stringify({ skipped, refused })
      } Fix the refused cards and propose again.`,
    );
  }
  return {
    content: summary(proposal, skipped, refused),
    isError: false,
    shown: { kind: "proposal", proposal },
  };
}

const NOT_FOUND =
  "No note of the signed-in user has that deck_id, or it was deleted. Call list_decks for the ids of the user's notes.";

async function proposeCards(
  args: Record<string, unknown>,
  store: Store,
  deps: IdSource,
): Promise<Ran> {
  const groups = groupsOf(args.groups);
  if (typeof groups === "string") return refuse(groups);
  let deck: Proposal["deck"];
  let keys: Map<string, string>;
  if ("deck_id" in args) {
    const id = idOf(args.deck_id);
    const found = id === null ? null : await readDeck(store, id);
    if (found === null) return refuse(NOT_FOUND);
    deck = found;
    keys = await deckKeys(store, found.id);
  } else {
    const name = trimmed(args.name, MAX_NAME);
    if (name === null) {
      return refuse(`name must be 1 to ${MAX_NAME} characters.`);
    }
    deck = { id: null, name };
    keys = new Map();
  }
  const read = readGroups(groups, keys, deps, []);
  const mixed = mixedForms(groups, read.misplaced);
  if (mixed !== null) return mixed;
  return shownProposal(
    { id: uuidV7(deps), kind: "cards", deck, groups: read.groups },
    read.skipped,
    read.refused,
  );
}

async function proposeChanges(
  args: Record<string, unknown>,
  store: Store,
  deps: IdSource,
): Promise<Ran> {
  const id = idOf(args.deck_id);
  const deck = id === null ? null : await readDeck(store, id);
  if (deck === null) return refuse(NOT_FOUND);
  const input = groupsOf(args.groups);
  if (typeof input === "string") return refuse(input);
  const wanted = input.flatMap((group) =>
    group.cards.map((value) => isRecord(value) ? idOf(value.id) : null)
  );
  const stored = new Map(
    (await readCards(store, [...new Set(wanted.filter((one) => one !== null))]))
      .filter((card) => card.deck_id === deck.id)
      .map((card) => [card.id, card]),
  );
  const groups: Group[] = [];
  const refused: Refused[] = [];
  const misplaced: Misplaced[] = [];
  const changed = new Set<string>();
  for (const [g, group] of input.entries()) {
    const cards: ProposedCard[] = [];
    for (const [index, value] of group.cards.entries()) {
      const cardId = isRecord(value) ? idOf(value.id) : null;
      const card = cardId === null ? undefined : stored.get(cardId);
      if (cardId === null || card === undefined) {
        refused.push({
          group: g,
          index,
          reason: "no live card of this note has that id.",
        });
        continue;
      }
      if (changed.has(cardId)) {
        refused.push({
          group: g,
          index,
          reason: "the card is changed earlier in this call.",
        });
        continue;
      }
      const read = readCard(value, deps, keptOf(card));
      if (typeof read === "string" || !isRecord(value)) {
        refused.push({
          group: g,
          index,
          reason: typeof read === "string"
            ? read
            : "the card must be an object.",
        });
        continue;
      }
      const form = formOf(read.blocks.map((block) => block.type));
      if (form !== group.format) {
        misplaced.push({ group: g, index, form });
        continue;
      }
      changed.add(cardId);
      cards.push({ id: cardId, card: value });
    }
    if (cards.length > 0) {
      groups.push({
        id: uuidV7(deps),
        title: group.title,
        format: group.format,
        cards,
      });
    }
  }
  const mixed = mixedForms(input, misplaced);
  if (mixed !== null) return mixed;
  return shownProposal(
    { id: uuidV7(deps), kind: "changes", deck, groups },
    [],
    refused,
  );
}

async function regenerateGroup(
  args: Record<string, unknown>,
  store: Store,
  deps: IdSource,
  earlier: readonly Proposal[],
): Promise<Ran> {
  const proposal = earlier.find((one) => one.id === idOf(args.proposal_id));
  if (proposal === undefined) {
    return refuse("No proposal of this conversation has that proposal_id.");
  }
  const at = proposal.groups.findIndex((group) =>
    group.id === idOf(args.group_id)
  );
  const format = FORMS.find((known) => known === args.format);
  if (at === -1 || proposal.kind !== "cards") {
    return refuse(
      "That proposal has no group with that group_id whose cards are new.",
    );
  }
  if (format === undefined) {
    return refuse(`format must be one of ${FORMS.join(", ")}.`);
  }
  const kept = proposal.groups.filter((_, index) => index !== at);
  const cards = Array.isArray(args.cards) ? args.cards : [];
  const total = kept.reduce((sum, group) => sum + group.cards.length, 0) +
    cards.length;
  if (cards.length === 0 || total > MAX_CARDS) {
    return refuse(
      `cards must hold 1 card or more, and the proposal at most ${MAX_CARDS} over all its groups.`,
    );
  }
  // The other groups' cards and the note's stand as they are, so a new card may not repeat them.
  const keys = proposal.deck.id === null
    ? new Map()
    : await deckKeys(store, proposal.deck.id);
  for (const group of kept) {
    for (const { id, card } of group.cards) {
      const read = readCard(card, deps);
      if (typeof read !== "string") keys.set(read.key, id);
    }
  }
  const old = proposal.groups[at];
  if (old === undefined) {
    return refuse("That proposal has no group with that group_id.");
  }
  const remade = [{ title: old.title, format, cards }];
  const read = readGroups(remade, keys, deps, [old.id]);
  const mixed = mixedForms(remade, read.misplaced);
  if (mixed !== null) return mixed;
  const replaced = read.groups[0];
  if (replaced === undefined) {
    return shownProposal(
      { ...proposal, groups: [] },
      read.skipped,
      read.refused,
    );
  }
  return shownProposal(
    {
      ...proposal,
      groups: proposal.groups.map((group, index) =>
        index === at ? replaced : group
      ),
    },
    read.skipped,
    read.refused,
  );
}

function askChoice(args: Record<string, unknown>): Ran {
  const prompt = trimmed(args.prompt, MAX_PROMPT);
  const given = Array.isArray(args.options) ? args.options : [];
  const options = given.flatMap((option) => trimmed(option, MAX_OPTION) ?? []);
  if (
    prompt === null || options.length < 2 || options.length > MAX_OPTIONS ||
    options.length !== given.length
  ) {
    return refuse(
      `ask_choice takes a prompt of 1 to ${MAX_PROMPT} characters and 2 to ${MAX_OPTIONS} options of 1 to ${MAX_OPTION} characters.`,
    );
  }
  return {
    content: {
      shown_to_user:
        "The user picks an option or types an answer as their next message.",
    },
    isError: false,
    shown: { kind: "choice", choice: { prompt, options } },
  };
}

/**
 * Runs the tool [name] for the caller behind [store]; [earlier] is the conversation's proposals and
 * [skills] the card forms' guides served to the caller.
 */
export async function runTool(
  name: string,
  args: unknown,
  store: Store,
  deps: ToolDeps,
  earlier: readonly Proposal[],
  skills: Skills,
): Promise<Ran> {
  if (!isRecord(args)) return refuse("The arguments must be a JSON object.");
  switch (name) {
    case "read_card_form": {
      const form = FORMS.find((known) => known === args.form);
      return form === undefined
        ? refuse(`form must be one of ${FORMS.join(", ")}.`)
        : { content: skills[form].text, isError: false, shown: null };
    }
    case "list_decks":
    case "list_cards":
    case "search_cards": {
      const result = await callTool(name, args, store, deps);
      return result.kind === "refused"
        ? refuse(result.message)
        : { content: result.value, isError: false, shown: null };
    }
    case "propose_deck":
      if ("deck_id" in args) {
        return refuse(
          "propose_deck takes a name; use propose_cards for a note the user has.",
        );
      }
      return await proposeCards(args, store, deps);
    case "propose_cards":
      if (!("deck_id" in args)) return refuse(NOT_FOUND);
      return await proposeCards(args, store, deps);
    case "propose_changes":
      return await proposeChanges(args, store, deps);
    case "regenerate_group":
      return await regenerateGroup(args, store, deps, earlier);
    case "ask_choice":
      return askChoice(args);
    default:
      return refuse(
        `There is no tool named ${name}. The tools are ${
          ASSISTANT_TOOLS.map((tool) => tool.name).join(", ")
        }.`,
      );
  }
}
