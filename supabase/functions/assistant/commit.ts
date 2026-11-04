/**
 * Applies a proposal the user confirmed (ADR 0190): the cards checked in each group, through the
 * shared write path, `create_deck` and `add_cards` or `update_cards`, with their refusals.
 */

import type { Store } from "../_shared/store.ts";
import { callTool, type ToolDeps } from "../_shared/tools.ts";
import type { Proposal } from "./tools.ts";

/** A commit's answer: what the write tool answered, or why nothing was written. */
export type Committed =
  | {
    readonly kind: "written";
    readonly deck: { readonly id: string; readonly name: string };
    readonly result: Record<string, unknown>;
  }
  | { readonly kind: "bad_request"; readonly message: string }
  | { readonly kind: "refused"; readonly message: string };

/**
 * The cards of [proposal] whose ids [checked] names under their group, or why the selection is not
 * one: a group the proposal lacks, a card its group lacks, or nothing checked.
 */
function selection(
  proposal: Proposal,
  checked: unknown,
): Record<string, unknown>[] | string {
  if (
    typeof checked !== "object" || checked === null || Array.isArray(checked)
  ) {
    return "checked must map each group's id to the ids of its cards to add.";
  }
  const chosen: Record<string, unknown>[] = [];
  for (const [groupId, ids] of Object.entries(checked)) {
    const group = proposal.groups.find((one) => one.id === groupId);
    if (group === undefined) return `the proposal has no group ${groupId}.`;
    if (!Array.isArray(ids)) {
      return `checked.${groupId} must be a list of card ids.`;
    }
    for (const id of new Set(ids)) {
      const card = group.cards.find((one) => one.id === id);
      if (card === undefined) {
        return `group ${groupId} has no card ${String(id)}.`;
      }
      chosen.push(card.card);
    }
  }
  return chosen.length === 0 ? "no card is checked." : chosen;
}

/** Writes the checked cards of [proposal] for the caller behind [store]. */
export async function commit(
  proposal: Proposal,
  checked: unknown,
  store: Store,
  deps: ToolDeps,
): Promise<Committed> {
  const cards = selection(proposal, checked);
  if (typeof cards === "string") return { kind: "bad_request", message: cards };
  const deckId = proposal.deck.id;
  if (proposal.kind === "changes") {
    if (deckId === null) {
      return { kind: "bad_request", message: "changes name their note." };
    }
    const changed = await callTool("update_cards", { cards }, store, deps);
    return changed.kind === "refused"
      ? { kind: "refused", message: changed.message }
      : {
        kind: "written",
        deck: { id: deckId, name: proposal.deck.name },
        result: changed.value,
      };
  }
  let deck = deckId === null ? null : { id: deckId, name: proposal.deck.name };
  if (deck === null) {
    const created = await callTool(
      "create_deck",
      { name: proposal.deck.name },
      store,
      deps,
    );
    if (created.kind === "refused") {
      return { kind: "refused", message: created.message };
    }
    const made: unknown = created.value.deck;
    if (
      typeof made !== "object" || made === null || !("id" in made) ||
      !("name" in made) ||
      typeof made.id !== "string" || typeof made.name !== "string"
    ) throw new Error("create_deck answered no deck");
    deck = { id: made.id, name: made.name };
  }
  const added = await callTool(
    "add_cards",
    { deck_id: deck.id, cards },
    store,
    deps,
  );
  return added.kind === "refused"
    ? { kind: "refused", message: added.message }
    : { kind: "written", deck, result: added.value };
}
