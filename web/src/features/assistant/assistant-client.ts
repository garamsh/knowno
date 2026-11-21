import { unstable_isUnrecognizedActionError as isStaleAction } from "next/navigation";

import { createClient } from "@/supabase/browser";

import { cancelPhotoJob } from "./cancel-job";
import { type CommitResult, commitProposal } from "./commit-proposal";
import type { RequestTurn } from "./conversation";
import { readEvents } from "./event-stream";
import {
  type AssistantEvent,
  type JobProgress,
  type Proposal,
  parseEvent,
  parsePoll,
  parseRefusal,
  type SendRefusal,
} from "./protocol";

export type { CommitResult };

/** What cancelling a photo job came to: it is cancelled, the function kept it running, or the call threw. */
export type CancelResult =
  { kind: "cancelled" } | { kind: "kept" } | { kind: "failed"; message: string };

/**
 * A message: the turns, oldest first, the last the user's, and its context: the browser's time
 * zone, where known.
 */
export type MessageRequest = {
  messages: RequestTurn[];
  context?: { time_zone?: string };
};

/** A photo made ready to attach: its id, which names its object, and its JPEG. */
export type PreparedPhoto = { id: string; jpeg: Blob };

/** What asking after a photo job answers: how far it has read, that it is gone, or nothing. */
export type JobPoll =
  { kind: "polled"; progress: JobProgress } | { kind: "missing" } | { kind: "failed" };

/** A started message's events, a known event's malformed data among them; or why it did not start. */
export type SendResult =
  | { kind: "stream"; events: AsyncIterable<AssistantEvent | "malformed"> }
  | { kind: "refused"; refusal: SendRefusal };

/**
 * What the chat asks of the assistant: a seam, so its tests stand a fake in for the function. A
 * send aborted through its signal rejects, or ends its events, with an `AbortError`.
 */
export type AssistantClient = {
  send: (request: MessageRequest, signal: AbortSignal) => Promise<SendResult>;
  commit: (proposal: Proposal, checked: Record<string, string[]>) => Promise<CommitResult>;
  /** Uploads each of [photos] to the chat's private bucket; whether every one is stored. */
  upload: (photos: PreparedPhoto[]) => Promise<boolean>;
  pollJob: (id: string) => Promise<JobPoll>;
  /** Cancels the photo job [id]. */
  cancelJob: (id: string) => Promise<CancelResult>;
};

/** The bucket the function reads a message's photos from (`assistant.md` §Photo jobs). */
const photoBucket = "assistant-photos";

async function* eventsOf(body: ReadableStream<Uint8Array>) {
  for await (const raw of readEvents(body)) {
    const event = parseEvent(raw.name, raw.data);
    if (event !== "unknown") yield event;
  }
}

/** What a commit that threw says: the action is gone after a deploy, or the call never arrived. */
const commitMessages = {
  stale: "새 버전이 나왔어요. 페이지를 새로고침한 뒤 다시 추가해 주세요.",
  unreachable: "카드를 추가하지 못했어요. 잠시 후 다시 시도해 주세요.",
} as const;

/** What a cancel that threw says, as a commit's does. */
const cancelMessages = {
  stale: "새 버전이 나왔어요. 페이지를 새로고침한 뒤 다시 시도해 주세요.",
  unreachable: "사진 읽기를 취소하지 못했어요. 잠시 후 다시 시도해 주세요.",
} as const;

/** The assistant through this app's `/api/assistant` route and its commit action. */
export const httpAssistantClient: AssistantClient = {
  async send(request, signal) {
    let response: Response;
    try {
      response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal,
      });
    } catch (cause) {
      if (signal.aborted) throw cause;
      return { kind: "refused", refusal: { kind: "unreachable" } };
    }
    if (response.status === 200 && response.body)
      return { kind: "stream", events: eventsOf(response.body) };
    const body: unknown = await response.json().catch(() => null);
    return { kind: "refused", refusal: parseRefusal(response.status, body) };
  },
  async commit(proposal, checked) {
    try {
      return await commitProposal(proposal, checked);
    } catch (cause) {
      // A deploy that landed under the open page leaves the action unknown to the server.
      return {
        kind: "failed",
        message: isStaleAction(cause) ? commitMessages.stale : commitMessages.unreachable,
      };
    }
  },
  async upload(photos) {
    try {
      const supabase = createClient();
      const userId = (await supabase.auth.getSession()).data.session?.user.id;
      if (!userId) return false;
      for (const photo of photos) {
        const { error } = await supabase.storage
          .from(photoBucket)
          .upload(`${userId}/${photo.id}`, photo.jpeg, { contentType: "image/jpeg" });
        if (error) return false;
      }
      return true;
    } catch {
      return false;
    }
  },
  async pollJob(id) {
    try {
      const response = await fetch(`/api/assistant/jobs/${encodeURIComponent(id)}`, {
        cache: "no-store",
      });
      if (response.status === 404) return { kind: "missing" };
      const progress = response.status === 200 ? parsePoll(await response.json()) : null;
      return progress ? { kind: "polled", progress } : { kind: "failed" };
    } catch {
      return { kind: "failed" };
    }
  },
  async cancelJob(id) {
    try {
      return (await cancelPhotoJob(id)) ? { kind: "cancelled" } : { kind: "kept" };
    } catch (cause) {
      return {
        kind: "failed",
        message: isStaleAction(cause) ? cancelMessages.stale : cancelMessages.unreachable,
      };
    }
  },
};
