import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { downscalePhoto } from "@/design/prepare-photo";

import type { AssistantClient, PreparedPhoto, SendResult } from "./assistant-client";
import { browserTimeZone } from "./browser-time-zone";
import {
  type AssistantTurn,
  checkedCount,
  type Conversation,
  emptyConversation,
  ended,
  jobDoneMessage,
  lastMessage,
  loadConversation,
  requestTurns,
  runningJob,
  type ShownProposal,
  storeConversation,
  withEvent,
} from "./conversation";
import { type Allowance, type JobProgress, type SendRefusal } from "./protocol";

/** How long a message refused as `busy` waits before it is sent again, and how often. */
export const busyRetryMs = 3000;
const busyRetries = 3;

/** How often a running photo job is asked how far it has read. */
export const jobPollMs = 3000;

/** The most photos a message attaches, as the function's `MAX_JOB_PHOTOS`. */
export const maxPhotos = 50;

/** A photo staged for the next message: prepared as a JPEG, with the address its thumbnail shows. */
export type StagedPhoto = PreparedPhoto & { url: string };

/** What the chat is doing: nothing, photos uploading, a reply streaming, waiting to resend, or refused. */
export type Status =
  | { kind: "idle" }
  | { kind: "uploading" }
  | { kind: "uploadFailed" }
  | { kind: "streaming" }
  | { kind: "waiting" }
  | { kind: "refused"; refusal: SendRefusal };

/** The last proposal shown, not yet added, in the reply that showed it, and how many cards are checked. */
export type OpenProposal = { turnId: string; shown: ShownProposal; count: number };

const newId = () => crypto.randomUUID();

const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });

/** A store that never changes, so its snapshot tells the server's render from the browser's. */
const noChange = () => () => undefined;

/**
 * The one conversation with 말랑이 as the chat reads it: its turns kept in this browser, its
 * status, the day's allowance, the photos staged, and the actions that send, retry, stop, add and
 * clear (ADR 0251, as the phone's `AssistantController`). The component draws it and calls the
 * actions. [readAllowance] is the day's tokens as the page read them; [client] is the assistant.
 */
export function useAssistantChat(client: AssistantClient, readAllowance: Allowance | null) {
  // The conversation is this browser's: read as the page starts here, drawn once hydrated.
  const [conversation, setConversation] = useState<Conversation>(() =>
    typeof window === "undefined" ? emptyConversation : loadConversation(),
  );
  const hydrated = useSyncExternalStore(
    noChange,
    () => true,
    () => false,
  );
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [allowance, setAllowance] = useState(readAllowance);
  const [committing, setCommitting] = useState(false);
  const [commitFailure, setCommitFailure] = useState<string | null>(null);
  const [staged, setStaged] = useState<StagedPhoto[]>([]);
  const [pickFailed, setPickFailed] = useState(false);
  const abort = useRef<AbortController | null>(null);
  // The latest conversation, for a send that runs across renders.
  const latest = useRef(conversation);
  // What a poll that outlives a render reads: whether a message is under way.
  const working = useRef(false);

  // Every change goes through here, so [latest] is never behind what a send reads next.
  const update = useCallback((change: (before: Conversation) => Conversation) => {
    const next = change(latest.current);
    latest.current = next;
    setConversation(next);
  }, []);

  // Leaving the chat stops a reply still streaming; the function records it as cancelled.
  useEffect(
    () => () => {
      abort.current?.abort();
    },
    [],
  );

  useEffect(() => {
    if (hydrated) storeConversation(conversation);
  }, [conversation, hydrated]);

  const replyTo = useCallback(async () => {
    const turns = latest.current.turns;
    if (lastMessage(turns)?.role !== "user") return;
    const controller = new AbortController();
    abort.current = controller;
    let result: SendResult;
    // A message refused as busy waits for the one before it to end, then goes again (ADR 0195).
    for (let attempt = 0; ; attempt += 1) {
      setStatus({ kind: attempt === 0 ? "streaming" : "waiting" });
      if (attempt > 0) await wait(busyRetryMs);
      if (controller.signal.aborted) {
        setStatus({ kind: "idle" });
        return;
      }
      try {
        const timeZone = browserTimeZone();
        result = await client.send(
          {
            messages: requestTurns(turns),
            ...(timeZone !== null && { context: { time_zone: timeZone } }),
          },
          controller.signal,
        );
      } catch {
        setStatus({ kind: "idle" });
        return;
      }
      if (result.kind !== "refused" || result.refusal.kind !== "busy" || attempt === busyRetries)
        break;
    }
    if (result.kind === "refused") {
      const { refusal } = result;
      if (refusal.kind === "rate_limited" && refusal.allowance) setAllowance(refusal.allowance);
      setStatus({ kind: "refused", refusal });
      return;
    }
    const id = newId();
    const reply: AssistantTurn = {
      role: "assistant",
      id,
      text: "",
      citations: [],
      proposals: [],
      choice: null,
      job: null,
      interim: null,
      ending: null,
    };
    update((before) => ({ ...before, turns: [...before.turns, reply] }));
    const change = (edit: (turn: AssistantTurn) => AssistantTurn) => {
      update((before) => ({
        ...before,
        turns: before.turns.map((turn) =>
          turn.id === id && turn.role === "assistant" ? edit(turn) : turn,
        ),
      }));
    };
    try {
      for await (const event of result.events) {
        if (event === "malformed") change((turn) => ended(turn, "model_error"));
        else {
          if (event.type === "usage") setAllowance(event.allowance);
          change((turn) => withEvent(turn, event));
        }
      }
      change((turn) => ended(turn, "ok"));
    } catch {
      change((turn) => ended(turn, controller.signal.aborted ? "stopped" : "model_error"));
    }
    setStatus({ kind: "idle" });
  }, [client, update]);

  const busy =
    status.kind === "uploading" || status.kind === "streaming" || status.kind === "waiting";
  // After every commit, not when [busy] changes: a send that ends one busy state and starts the
  // next in one batch leaves [busy] as it was.
  useLayoutEffect(() => {
    working.current = busy;
  });

  /** Sends [text], with the ids of the [photos] it attached, as the user's next message. */
  const sendMessage = useCallback(
    (text: string, photos: string[] = [], auto = false) => {
      const message = text.trim();
      if ((!message && photos.length === 0) || working.current) return;
      setCommitFailure(null);
      update((before) => ({
        draft: "",
        turns: [...before.turns, { role: "user", id: newId(), text: message, photos, auto }],
      }));
      void replyTo();
    },
    [replyTo, update],
  );
  const send = useCallback(
    (text: string) => {
      sendMessage(text);
    },
    [sendMessage],
  );

  /** Uploads the staged photos, then sends the draft with them; a photo that does not upload sends nothing. */
  const submit = useCallback(async () => {
    if (working.current) return;
    const { draft: text } = latest.current;
    if (staged.length === 0) {
      sendMessage(text);
      return;
    }
    working.current = true;
    setStatus({ kind: "uploading" });
    const stored = await client.upload(staged.map(({ id, jpeg }) => ({ id, jpeg })));
    working.current = false;
    if (!stored) {
      setStatus({ kind: "uploadFailed" });
      return;
    }
    setStatus({ kind: "idle" });
    for (const photo of staged) URL.revokeObjectURL(photo.url);
    setStaged([]);
    sendMessage(
      text,
      staged.map(({ id }) => id),
    );
  }, [client, sendMessage, staged]);

  /** Prepares the photos picked as JPEGs and stages them, as many as one message takes. */
  const attach = useCallback(
    async (files: File[]) => {
      setPickFailed(false);
      const room = maxPhotos - staged.length;
      const added: StagedPhoto[] = [];
      for (const file of files.slice(0, room)) {
        const prepared = await downscalePhoto(file);
        if (typeof prepared === "string") {
          setPickFailed(true);
          continue;
        }
        added.push({ id: newId(), jpeg: prepared, url: URL.createObjectURL(prepared) });
      }
      setStaged((before) => [...before, ...added].slice(0, maxPhotos));
    },
    [staged.length],
  );

  /** Takes the staged [photo] away. */
  const unstage = useCallback((photo: StagedPhoto) => {
    URL.revokeObjectURL(photo.url);
    setStaged((before) => before.filter((one) => one.id !== photo.id));
  }, []);

  /** Sends the last message again, in place of the reply that failed after it. */
  const retry = useCallback(() => {
    update((before) => {
      const last = lastMessage(before.turns);
      return last?.role === "assistant"
        ? { ...before, turns: before.turns.filter((turn) => turn.id !== last.id) }
        : before;
    });
    void replyTo();
  }, [replyTo, update]);

  /** Sends the message a refusal stopped, again. */
  const retryRefused = useCallback(() => {
    void replyTo();
  }, [replyTo]);

  /** Stops the reply streaming; it ends as stopped. */
  const stop = useCallback(() => {
    abort.current?.abort();
  }, []);

  const setDraft = useCallback(
    (draft: string) => {
      update((before) => ({ ...before, draft }));
    },
    [update],
  );

  const setJob = useCallback(
    (turnId: string, job: JobProgress) => {
      update((before) => ({
        ...before,
        turns: before.turns.map((turn) =>
          turn.id === turnId && turn.role === "assistant" ? { ...turn, job } : turn,
        ),
      }));
    },
    [update],
  );

  /** Asks how far the photo job [id] has read, and sends the turn that goes on once it is done. */
  const askAfterJob = useCallback(
    async (id: string) => {
      const poll = await client.pollJob(id);
      const reply = runningJob(latest.current.turns);
      // The conversation may have been cleared or the job cancelled meanwhile.
      if (!reply?.job || reply.job.id !== id || poll.kind === "failed") return;
      if (poll.kind === "missing") {
        setJob(reply.id, { ...reply.job, state: "cancelled" });
        return;
      }
      // A job done while a message is under way is told at the next ask.
      if (poll.progress.state === "done" && working.current) return;
      setJob(reply.id, poll.progress);
      if (poll.progress.state === "done" && lastMessage(latest.current.turns)?.id === reply.id)
        sendMessage(jobDoneMessage, [], true);
    },
    [client, sendMessage, setJob],
  );

  const runningId = runningJob(conversation.turns)?.job?.id;
  useEffect(() => {
    if (!hydrated || !runningId) return;
    const timer = window.setInterval(() => {
      void askAfterJob(runningId);
    }, jobPollMs);
    return () => {
      window.clearInterval(timer);
    };
  }, [hydrated, runningId, askAfterJob]);

  /** Cancels the photo job the conversation reads; one the function refuses keeps running. */
  const cancelJob = useCallback(async () => {
    const reply = runningJob(latest.current.turns);
    if (!reply?.job) return;
    if (await client.cancelJob(reply.job.id))
      setJob(reply.id, { ...reply.job, state: "cancelled" });
  }, [client, setJob]);

  const editProposal = useCallback(
    (turnId: string, proposalId: string, edit: (one: ShownProposal) => ShownProposal) => {
      update((before) => ({
        ...before,
        turns: before.turns.map((turn) =>
          turn.id === turnId && turn.role === "assistant"
            ? {
                ...turn,
                proposals: turn.proposals.map((one) =>
                  one.proposal.id === proposalId ? edit(one) : one,
                ),
              }
            : turn,
        ),
      }));
    },
    [update],
  );

  /** Checks exactly the cards [ids] of the group [groupId] in a shown proposal. */
  const check = useCallback(
    (turnId: string, proposalId: string, groupId: string, ids: string[]) => {
      editProposal(turnId, proposalId, (before) => ({
        ...before,
        checked: { ...before.checked, [groupId]: ids },
      }));
    },
    [editProposal],
  );

  const { turns, draft } = conversation;
  const last = lastMessage(turns);
  // The open proposal: the last one shown, not yet added, once its reply has ended.
  const lastReply = turns.findLast((turn): turn is AssistantTurn => turn.role === "assistant");
  const openShown = lastReply?.ending
    ? lastReply.proposals.findLast((one) => !one.added)
    : undefined;
  const open: OpenProposal | undefined =
    lastReply && openShown
      ? { turnId: lastReply.id, shown: openShown, count: checkedCount(openShown) }
      : undefined;
  // From the send until the reply's first text, drawn from the status and the last turn: the reply's
  // turn does not exist until the route's headers have arrived.
  const typing =
    (status.kind === "streaming" || status.kind === "waiting") &&
    (last?.role === "user" || (last?.role === "assistant" && last.ending === null && !last.text));

  /** Adds the open proposal's checked cards; a refusal is kept in [commitFailure] to add again. */
  const commit = async () => {
    if (!open || open.count === 0) return;
    setCommitting(true);
    setCommitFailure(null);
    const result = await client.commit(open.shown.proposal, open.shown.checked);
    setCommitting(false);
    if (result.kind === "failed") {
      setCommitFailure(result.message);
      return;
    }
    editProposal(open.turnId, open.shown.proposal.id, (one) => ({
      ...one,
      added: {
        deck: result.deck,
        count: result.count,
        skipped: result.skipped,
        refused: result.refused,
      },
    }));
  };

  /** Forgets the conversation and what hangs on it. */
  const clear = useCallback(() => {
    setStatus({ kind: "idle" });
    setCommitFailure(null);
    update(() => emptyConversation);
  }, [update]);

  return {
    hydrated,
    turns,
    draft,
    status,
    allowance,
    busy,
    typing,
    open,
    committing,
    commitFailure,
    staged,
    pickFailed,
    setDraft,
    send,
    submit,
    attach,
    unstage,
    retry,
    retryRefused,
    stop,
    cancelJob,
    check,
    commit,
    clear,
  };
}
