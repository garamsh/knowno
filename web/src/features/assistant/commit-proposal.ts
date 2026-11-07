"use server";

import { revalidatePath } from "next/cache";

import { env } from "@/env";
import { createClient } from "@/supabase/server";
import { readUserId } from "@/supabase/session";

import { assistantUrl } from "./forward-message";
import { parseProposal } from "./protocol";

/** What adding a proposal returns: the note and how many cards were written, or why not. */
export type CommitResult =
  | { kind: "added"; deck: { id: string; name: string }; count: number }
  | { kind: "failed"; message: string };

const messages = {
  refused: "카드를 추가하지 못했어요. 말랑이에게 다시 만들어 달라고 해 주세요.",
  signIn: "로그인이 끝나 카드를 추가하지 못했어요. 다시 로그인해 주세요.",
  failed: "카드를 추가하지 못했어요. 잠시 후 다시 시도해 주세요.",
} as const;

/** How long a commit may take: a note made and up to 100 cards written, photos fetched among them. */
const commitTimeoutMs = 60_000;

/**
 * Writes the cards of [proposal] that [checked] names under their group, as the verified user,
 * through the function's commit (`assistant.md` §Commit), and revalidates the pages that show
 * notes. Both arguments crossed the network, so each is read before anything is sent.
 */
export async function commitProposal(proposal: unknown, checked: unknown): Promise<CommitResult> {
  const parsed = parseProposal(proposal);
  const picked =
    typeof checked === "object" && checked !== null && !Array.isArray(checked)
      ? Object.entries(checked)
      : null;
  if (
    !parsed ||
    !picked ||
    !picked.every(
      ([, ids]: [string, unknown]) =>
        Array.isArray(ids) && ids.every((id) => typeof id === "string"),
    )
  )
    return { kind: "failed", message: messages.refused };
  const client = await createClient();
  const user = await readUserId(client);
  if ("failure" in user)
    return {
      kind: "failed",
      message: user.failure === "rejected" ? messages.signIn : messages.failed,
    };
  const token = (await client.auth.getSession()).data.session?.access_token;
  if (!token) return { kind: "failed", message: messages.signIn };
  let status: number;
  let body: unknown;
  try {
    const response = await fetch(assistantUrl("/commit"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: env.supabasePublishableKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ proposal: parsed, checked: Object.fromEntries(picked) }),
      signal: AbortSignal.timeout(commitTimeoutMs),
    });
    status = response.status;
    body = await response.json().catch(() => null);
  } catch {
    return { kind: "failed", message: messages.failed };
  }
  console.info(JSON.stringify({ event: "assistant_commit", status, kind: parsed.kind }));
  if (status === 401) return { kind: "failed", message: messages.signIn };
  if (status === 400 || status === 422) return { kind: "failed", message: messages.refused };
  const written = writtenOf(body);
  if (status !== 200 || !written) return { kind: "failed", message: messages.failed };
  revalidatePath("/", "layout");
  return { kind: "added", ...written };
}

/** The note and the count of cards a commit's answer says it wrote, or null when it is not one. */
function writtenOf(body: unknown): { deck: { id: string; name: string }; count: number } | null {
  if (typeof body !== "object" || body === null || !("deck" in body)) return null;
  const deck: unknown = body.deck;
  if (typeof deck !== "object" || deck === null || !("id" in deck) || !("name" in deck))
    return null;
  const { id, name } = deck;
  if (typeof id !== "string" || typeof name !== "string") return null;
  const list: unknown = "added" in body ? body.added : "updated" in body ? body.updated : null;
  if (!Array.isArray(list)) return null;
  return { deck: { id, name }, count: list.length };
}
