import "server-only";

import { revalidatePath } from "next/cache";

import { parseDeckId } from "@/features/decks";
import { classifyFailure, requestTimeoutMs, type ServerFailure } from "@/supabase/failure";
import { createClient } from "@/supabase/server";

/** What an admin action shows when it returns: whether it changed something, and the sentence. */
export type ActionResult = { changed: boolean; message: string };

/** The sentence an admin action returns for each way it can fail. */
export const failureMessages: Record<ServerFailure | "unreadable" | "malformed", string> = {
  rejected: "관리자만 할 수 있어요.",
  unreachable: "서버에 연결할 수 없어요. 연결을 확인하고 다시 시도해 주세요.",
  failed: "하지 못했어요. 잠시 후 다시 시도해 주세요.",
  unreadable: "하지 못했어요. 잠시 후 다시 시도해 주세요.",
  malformed: "하지 못했어요. 잠시 후 다시 시도해 주세요.",
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Calls the deck function [name] for [deckId] with [args], which answers whether it changed the
 * deck, and returns [message]'s sentence for that.
 */
export async function deckAction(
  name: string,
  deckId: string,
  args: Record<string, unknown>,
  message: (changed: boolean) => string,
): Promise<ActionResult> {
  // The argument crossed the network, whatever its declared type.
  const id = parseDeckId(deckId);
  if (id === null) return refused("malformed");
  const result = await call(name, { deck_id: id, ...args });
  if ("failure" in result) return refused(result.failure);
  if (typeof result.data !== "boolean") return refused("unreadable");
  if (result.data) revalidatePath("/admin", "layout");
  return { changed: result.data, message: message(result.data) };
}

/**
 * Calls the deck function [name] for [deckId] with [args], which answers a word, and returns the
 * outcome [outcomes] has for it; a word it does not know is unreadable.
 */
export async function deckOutcomeAction(
  name: string,
  deckId: string,
  args: Record<string, unknown>,
  outcomes: Record<string, ActionResult>,
): Promise<ActionResult> {
  const id = parseDeckId(deckId);
  if (id === null) return refused("malformed");
  const result = await call(name, { deck_id: id, ...args });
  if ("failure" in result) return refused(result.failure);
  const outcome = typeof result.data === "string" ? outcomes[result.data] : undefined;
  if (!outcome) return refused("unreadable");
  if (outcome.changed) revalidatePath("/admin", "layout");
  return outcome;
}

/** Calls the server function [name] with [args] as the signed-in user. */
export async function call(
  name: string,
  args: Record<string, unknown> = {},
): Promise<{ data: unknown } | { failure: ServerFailure }> {
  const supabase = await createClient();
  const result = await supabase.rpc(name, args).abortSignal(AbortSignal.timeout(requestTimeoutMs));
  if (result.error) return { failure: classifyFailure(result.error, result.status) };
  const data: unknown = result.data;
  return { data };
}

/** An action's result for [failure]: nothing changed, and its sentence. */
export function refused(failure: keyof typeof failureMessages): ActionResult {
  return { changed: false, message: failureMessages[failure] };
}

/**
 * [value], which crossed the network or an address, as a user's id: a uuid in canonical form, as
 * `auth.users` keys users; null otherwise. A deck's or card's id goes through `parseDeckId` or
 * `parseCardId` instead.
 */
export function parseUserId(value: unknown): string | null {
  return typeof value === "string" && uuid.test(value) ? value : null;
}
