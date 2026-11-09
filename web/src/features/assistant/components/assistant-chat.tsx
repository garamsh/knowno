"use client";

import { ArrowUp, ChevronLeft, ImagePlus, Square, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type ReactNode,
  useCallback,
  useEffect,
  lazy,
  Suspense,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { Mascot, type MascotExpression } from "@/design/brand";
import { buttonClass } from "@/design/button";
import { Confirm } from "@/design/confirm";
import { RowMenu } from "@/design/row-menu";
import { downscalePhoto } from "@/design/prepare-photo";

import {
  type AssistantClient,
  httpAssistantClient,
  type PreparedPhoto,
  type SendResult,
} from "../assistant-client";
import { browserTimeZone } from "../browser-time-zone";
import {
  type AssistantTurn,
  checkedCount,
  type Conversation,
  emptyConversation,
  enteredFrom,
  jobDoneMessage,
  lastMessage,
  loadConversation,
  maxMessageLength,
  requestTurns,
  runningJob,
  type ShownProposal,
  storeConversation,
  type Turn,
  ended,
  withEvent,
} from "../conversation";
import { type Allowance, type JobProgress, leftShare, type SendRefusal } from "../protocol";
import { formatNames, ProposalView } from "./proposal-view";

/** The Markdown renderer is a chunk of its own: a reply shows as plain text until it has loaded (ADR 0227). */
const ReplyMarkdown = lazy(() => import("./reply-markdown"));
/** The status line is read by the same chunk's parser, its words without marks (#830). */
const ReplyLine = lazy(() =>
  import("./reply-markdown").then((chunk) => ({ default: chunk.ReplyLine })),
);

/** Where the message list's scroll is kept while the chat is left for a note (#711). */
const scrollKey = "knowno.assistant.scroll";

/** How long a message refused as `busy` waits before it is sent again, and how often. */
export const busyRetryMs = 3000;
const busyRetries = 3;

/** How often a running photo job is asked how far it has read. */
export const jobPollMs = 3000;

/** The most photos a message attaches, as the function's `MAX_JOB_PHOTOS`. */
const maxPhotos = 50;

/** A photo staged for the next message: prepared as a JPEG, with the address its thumbnail shows. */
type StagedPhoto = PreparedPhoto & { url: string };

const waiting = "말랑이가 생각하는 중이에요";

/** What the chat is doing: nothing, photos uploading, a reply streaming, waiting to resend, or refused. */
type Status =
  | { kind: "idle" }
  | { kind: "uploading" }
  | { kind: "uploadFailed" }
  | { kind: "streaming" }
  | { kind: "waiting" }
  | { kind: "refused"; refusal: SendRefusal };

/** What each refusal says, and whether "다시 시도" sends the message again. */
const refusalNotices: Record<SendRefusal["kind"], { text: string; retry: boolean }> = {
  rate_limited: {
    text: "오늘 말랑이와 이야기할 수 있는 만큼 다 썼어요. 내일 다시 이야기해요.",
    retry: false,
  },
  busy: { text: "앞의 메시지를 아직 마무리하고 있어요. 잠시 후 다시 시도해 주세요.", retry: true },
  signIn: { text: "로그인이 끝났어요. 다시 로그인해 주세요.", retry: false },
  suspended: { text: "이 계정은 지금 말랑이와 이야기할 수 없어요.", retry: false },
  tooLong: { text: "대화가 너무 길어요. 대화를 지우고 다시 시작해 주세요.", retry: false },
  unavailable: { text: "말랑이가 지금 답할 수 없어요. 잠시 후 다시 시도해 주세요.", retry: true },
  unreachable: { text: "연결하지 못했어요. 연결을 확인하고 다시 시도해 주세요.", retry: true },
};

/** What a reply's ending adds under it. */
const endingNotices = {
  model_error: "말랑이가 답하지 못했어요. 다시 시도해 주세요.",
  cut: "답이 길어 중간에 멈췄어요. 이어서 해 달라고 해 보세요.",
  stopped: "멈췄어요.",
  limit: "할 일이 많아 여기서 멈췄어요. 다시 시도해 주세요.",
} as const;

const newId = () => crypto.randomUUID();

const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });

/** A store that never changes, so its snapshot tells the server's render from the browser's. */
const noChange = () => () => undefined;

/** The mascot's face for what the chat shows (#711): sleepy once the day is used, sad on a failure. */
function faceOf(status: Status, last: Turn | undefined): MascotExpression {
  if (status.kind === "refused") return status.refusal.kind === "rate_limited" ? "sleepy" : "sad";
  if (last?.role === "assistant" && last.ending === "model_error") return "sad";
  if (last?.role === "assistant" && last.proposals.some((one) => one.added)) return "happy";
  return "thinking";
}

/**
 * 말랑이's chat (#711, #722): one conversation kept in this browser, its turns, 말랑이's reply
 * streaming in, its sources, a question's choices, its proposals with their checks, and at the
 * foot the open proposal's "n장 추가" over the message field. Below 1024 px it covers the screen
 * as the phone's chat does; from 1024 px it sits beside the side menu (ADR 0200). [allowance] is
 * the day's tokens as the page read them; [client] stands in for the assistant in tests.
 */
export function AssistantChat({
  allowance: readAllowance,
  note = null,
  client = httpAssistantClient,
}: {
  allowance: Allowance | null;
  /** The note the chat was opened from, named once in the thread and sent with each message. */
  note?: { id: string; name: string } | null;
  client?: AssistantClient;
}) {
  const router = useRouter();
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
  const [clearing, setClearing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [commitFailure, setCommitFailure] = useState<string | null>(null);
  const [staged, setStaged] = useState<StagedPhoto[]>([]);
  const [pickFailed, setPickFailed] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const abort = useRef<AbortController | null>(null);
  // The latest conversation, for a send that runs across renders.
  const latest = useRef(conversation);

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

  // What a poll that outlives a render reads: whether a message is under way.
  const working = useRef(false);

  // Opened from a note, the thread names it once, unless its last line already does.
  useEffect(() => {
    if (hydrated && note) update((before) => enteredFrom(before, note, newId()));
  }, [hydrated, note, update]);

  useEffect(() => {
    if (hydrated) storeConversation(conversation);
  }, [conversation, hydrated]);

  // Back from a note lands where the list was (#711): on a fresh page, and when the router shows
  // the page it kept hidden again, which runs its effects anew.
  const restored = useRef(false);
  useLayoutEffect(() => {
    const element = list.current;
    if (!hydrated || !element) return;
    restored.current = true;
    let kept: string | null = null;
    try {
      kept = window.sessionStorage.getItem(scrollKey);
    } catch {
      // Storage refused: the list starts at its end.
    }
    // A kept place is the reader's: the list follows new replies only from its end.
    following.current = kept === null;
    element.scrollTop = kept === null ? element.scrollHeight : Number(kept);
  }, [hydrated]);

  // A reply arriving keeps the list at its end while the reader is there.
  useLayoutEffect(() => {
    const element = list.current;
    if (element && following.current && restored.current) element.scrollTop = element.scrollHeight;
  }, [conversation]);

  const replyTo = useCallback(async () => {
    const turns = latest.current.turns;
    if (lastMessage(turns)?.role !== "user") return;
    const controller = new AbortController();
    abort.current = controller;
    following.current = true;
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
        const context = {
          ...(note && { deck_id: note.id }),
          ...(timeZone !== null && { time_zone: timeZone }),
        };
        result = await client.send(
          {
            messages: requestTurns(turns),
            ...(Object.keys(context).length > 0 && { context }),
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
  }, [client, note, update]);

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

  if (!hydrated) return <ChatFrame face="thinking" allowance={allowance} />;

  const { turns, draft } = conversation;
  const last = lastMessage(turns);
  // The open proposal: the last one shown, not yet added, once its reply has ended.
  const lastReply = turns.findLast((turn): turn is AssistantTurn => turn.role === "assistant");
  const open = lastReply?.ending ? lastReply.proposals.findLast((one) => !one.added) : undefined;
  const openCount = open ? checkedCount(open) : 0;
  const canSend = (draft.trim() !== "" || staged.length > 0) && !busy;

  const commit = async () => {
    if (!open || !lastReply || openCount === 0) return;
    setCommitting(true);
    setCommitFailure(null);
    const result = await client.commit(open.proposal, open.checked);
    setCommitting(false);
    if (result.kind === "failed") {
      setCommitFailure(result.message);
      return;
    }
    editProposal(lastReply.id, open.proposal.id, (one) => ({
      ...one,
      added: {
        deck: result.deck,
        count: result.count,
        skipped: result.skipped,
        refused: result.refused,
      },
    }));
  };

  return (
    <ChatFrame
      face={faceOf(status, last)}
      allowance={allowance}
      onBack={() => {
        if (window.history.length > 1) router.back();
        else router.push("/");
      }}
      onClear={
        last && !busy
          ? () => {
              setClearing(true);
            }
          : undefined
      }
    >
      <div
        ref={list}
        onScroll={(event) => {
          const element = event.currentTarget;
          // A list hidden while its page is kept reports no place of the reader's.
          if (element.clientHeight === 0) return;
          following.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
          try {
            window.sessionStorage.setItem(scrollKey, String(element.scrollTop));
          } catch {
            // Storage refused: back from a note starts at the list's end.
          }
        }}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        <ol
          aria-label="대화"
          className="mx-auto flex w-full max-w-study flex-col gap-4 px-gutter py-4"
        >
          {last === undefined && (
            <li className="py-12 text-center">
              <p className="text-body-strong break-keep">무엇을 외워 볼까요?</p>
            </li>
          )}
          {turns.map((turn) =>
            turn.role === "context" ? (
              <li key={turn.id} className="text-secondary text-center break-keep text-muted">
                {turn.name} 노트에서
              </li>
            ) : turn.role === "user" ? (
              // The turn the chat sends itself when a photo job is done is not drawn.
              turn.auto ? null : (
                <li key={turn.id} className="flex justify-end">
                  <p className="flex max-w-[85%] flex-col gap-1 rounded-row bg-brand-tint px-4 py-3 text-body break-keep whitespace-pre-wrap">
                    <span className="sr-only">나: </span>
                    {turn.photos.length > 0 && (
                      <span className="text-secondary text-muted">사진 {turn.photos.length}장</span>
                    )}
                    {turn.text}
                  </p>
                </li>
              )
            ) : (
              <li key={turn.id} className="flex flex-col gap-3">
                <span className="sr-only">말랑이: </span>
                {turn.text && (
                  <div className="max-w-[92%] min-w-0 self-start rounded-row border border-hairline bg-surface px-4 py-3">
                    <Suspense
                      fallback={
                        <p className="text-body break-keep whitespace-pre-wrap">{turn.text}</p>
                      }
                    >
                      <ReplyMarkdown text={turn.text} />
                    </Suspense>
                  </div>
                )}
                {turn.ending === null && !turn.text && (
                  <p
                    role="status"
                    aria-live="polite"
                    className="text-secondary truncate text-muted"
                  >
                    {turn.interim === null ? (
                      waiting
                    ) : (
                      <Suspense fallback={waiting}>
                        <ReplyLine text={turn.interim} />
                      </Suspense>
                    )}
                  </p>
                )}
                {turn.citations.length > 0 && (
                  <ul aria-label="출처" className="flex flex-col gap-1">
                    {turn.citations.map((citation) => (
                      <li key={citation.url}>
                        <a
                          href={citation.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-secondary break-all text-muted underline"
                        >
                          {citation.title || citation.url}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
                {turn.job && <JobLine job={turn.job} onCancel={() => void cancelJob()} />}
                {turn.proposals.map((one) => (
                  <ProposalView
                    key={one.proposal.id}
                    shown={one}
                    disabled={busy || turn.ending === null}
                    onCheck={(groupId, ids) => {
                      editProposal(turn.id, one.proposal.id, (before) => ({
                        ...before,
                        checked: { ...before.checked, [groupId]: ids },
                      }));
                    }}
                    onRemake={(group, format) => {
                      send(`${group.title} 부분은 ${formatNames[format]} 형식으로 다시 만들어 줘`);
                    }}
                  />
                ))}
                {turn.choice && (
                  <div className="flex flex-col gap-2">
                    <p className="text-body-strong break-keep">{turn.choice.prompt}</p>
                    {turn === last && !busy && (
                      <div
                        role="group"
                        aria-label={turn.choice.prompt}
                        className="flex flex-wrap gap-2"
                      >
                        {turn.choice.options.map((option) => (
                          <button
                            key={option}
                            type="button"
                            onClick={() => {
                              send(option);
                            }}
                            className={buttonClass("secondary", "header")}
                          >
                            {option}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {turn.ending && turn.ending !== "ok" && (
                  <div className="flex flex-col items-start gap-2">
                    <p className="text-secondary break-keep text-muted">
                      {endingNotices[turn.ending]}
                    </p>
                    {(turn.ending === "model_error" || turn.ending === "limit") &&
                      turn === last &&
                      !busy && (
                        <button
                          type="button"
                          onClick={retry}
                          className={buttonClass("text", "header")}
                        >
                          다시 시도
                        </button>
                      )}
                  </div>
                )}
              </li>
            ),
          )}
          {status.kind === "uploading" && (
            <li role="status" className="text-secondary text-muted">
              사진을 올리는 중이에요
            </li>
          )}
          {status.kind === "uploadFailed" && (
            <li>
              <p role="alert" className="text-body break-keep">
                사진을 올리지 못했어요. 다시 시도해 주세요.
              </p>
            </li>
          )}
          {status.kind === "waiting" && (
            <li role="status" className="text-secondary text-muted">
              앞의 메시지를 마무리하고 있어요. 잠시 후 다시 보낼게요.
            </li>
          )}
          {status.kind === "refused" && (
            <li className="flex flex-col items-start gap-2">
              <p role="alert" className="text-body break-keep">
                {refusalNotices[status.refusal.kind].text}
              </p>
              {refusalNotices[status.refusal.kind].retry && (
                <button
                  type="button"
                  onClick={() => {
                    void replyTo();
                  }}
                  className={buttonClass("text", "header")}
                >
                  다시 시도
                </button>
              )}
              {status.refusal.kind === "signIn" && (
                <Link href="/login" className={buttonClass("text", "header")}>
                  로그인
                </Link>
              )}
            </li>
          )}
        </ol>
      </div>
      <div className="mx-auto flex w-full max-w-study shrink-0 flex-col gap-2 px-gutter pt-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {open && !busy && (
          <div className="flex flex-col gap-1">
            {commitFailure && (
              <p role="alert" className="text-secondary break-keep text-dont-know-text">
                {commitFailure}
              </p>
            )}
            <button
              type="button"
              disabled={openCount === 0 || committing}
              onClick={() => {
                void commit();
              }}
              className={buttonClass("primary", "cta")}
            >
              {open.proposal.kind === "changes"
                ? `${String(openCount)}장 바꾸기`
                : `${String(openCount)}장 추가`}
            </button>
          </div>
        )}
        {status.kind === "refused" && status.refusal.kind === "rate_limited" ? null : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
            className="flex flex-col gap-1 rounded-field bg-surface p-1 pl-4"
          >
            {(staged.length > 0 || pickFailed) && (
              <div className="flex flex-col gap-1 pt-2 pr-3">
                {pickFailed && (
                  <p role="alert" className="text-secondary break-keep text-dont-know-text">
                    사진을 가져오지 못했어요. 다시 시도해 주세요.
                  </p>
                )}
                {staged.length > 0 && (
                  <ul
                    aria-label={`사진 ${String(staged.length)}장`}
                    className="flex flex-wrap gap-2"
                  >
                    {staged.map((photo) => (
                      <li key={photo.id} className="relative">
                        <span
                          aria-hidden
                          style={{ backgroundImage: `url("${photo.url}")` }}
                          className="block size-14 rounded-row bg-cover bg-center"
                        />
                        <button
                          type="button"
                          aria-label="사진 삭제"
                          onClick={() => {
                            URL.revokeObjectURL(photo.url);
                            setStaged((before) => before.filter((one) => one.id !== photo.id));
                          }}
                          className="pressable absolute -top-3 -right-3 flex size-tap-target items-center justify-center"
                        >
                          <span className="flex size-6 items-center justify-center rounded-full bg-ink text-on-ink">
                            <X aria-hidden className="size-4" />
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <div className="flex items-end gap-2">
              <label className="pressable flex size-tap-target shrink-0 cursor-pointer items-center justify-center rounded-button text-ink focus-within:outline-2 focus-within:outline-ink">
                <ImagePlus aria-hidden className="size-5" />
                <input
                  type="file"
                  aria-label="사진 첨부"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  disabled={busy || staged.length >= maxPhotos}
                  onChange={(event) => {
                    const chosen = Array.from(event.currentTarget.files ?? []);
                    event.currentTarget.value = "";
                    if (chosen.length > 0) void attach(chosen);
                  }}
                  className="sr-only"
                />
              </label>
              <label htmlFor="assistant-message" className="sr-only">
                말랑이에게 보낼 메시지
              </label>
              <textarea
                id="assistant-message"
                rows={1}
                value={draft}
                maxLength={maxMessageLength}
                placeholder="말랑이에게 부탁해 보세요"
                onChange={(event) => {
                  const text = event.target.value;
                  update((before) => ({ ...before, draft: text }));
                }}
                onKeyDown={(event) => {
                  // Enter sends, Shift+Enter breaks the line; a Korean syllable being composed keeps its Enter.
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    void submit();
                  }
                }}
                className="max-h-40 min-h-tap-target flex-1 resize-none bg-transparent py-2.5 text-body outline-none placeholder:text-muted"
              />
              {status.kind === "streaming" ? (
                <button
                  type="button"
                  aria-label="멈추기"
                  onClick={() => {
                    abort.current?.abort();
                  }}
                  className="pressable flex size-tap-target shrink-0 items-center justify-center rounded-button bg-ink text-on-ink"
                >
                  <Square aria-hidden className="size-4" />
                </button>
              ) : (
                <button
                  type="submit"
                  aria-label="보내기"
                  disabled={!canSend}
                  className="pressable flex size-tap-target shrink-0 items-center justify-center rounded-button bg-primary text-on-primary disabled:opacity-50"
                >
                  <ArrowUp aria-hidden className="size-5" />
                </button>
              )}
            </div>
          </form>
        )}
      </div>
      {clearing && (
        <Confirm
          title="대화를 지울까요?"
          consequence="지운 대화는 되돌릴 수 없어요."
          confirmLabel="지우기"
          destructive
          close={() => {
            setClearing(false);
          }}
          onConfirm={() => {
            setClearing(false);
            setStatus({ kind: "idle" });
            setCommitFailure(null);
            update(() => emptyConversation);
            try {
              window.sessionStorage.removeItem(scrollKey);
            } catch {
              // Nothing kept to remove.
            }
          }}
        />
      )}
    </ChatFrame>
  );
}

/**
 * The chat's frame: below 1024 px the whole screen, from 1024 px the space beside the side menu,
 * under a bar of the way back, the mascot in [face] with "말랑이" and the day's share left, and ⋯
 * with "대화 지우기" while [onClear] is given.
 */
function ChatFrame({
  face,
  allowance,
  onBack,
  onClear,
  children,
}: {
  face: MascotExpression;
  allowance: Allowance | null;
  onBack?: () => void;
  onClear?: () => void;
  children?: ReactNode;
}) {
  const share = allowance ? leftShare(allowance) : null;
  return (
    <div className="fixed inset-x-0 top-(--photo-import-bar,0px) bottom-0 z-20 flex flex-col bg-ground pt-[env(safe-area-inset-top)] lg:left-60">
      <header className="mx-auto flex w-full max-w-study shrink-0 items-center gap-2 px-2 py-2 lg:px-gutter">
        <button
          type="button"
          aria-label="뒤로"
          disabled={!onBack}
          onClick={onBack}
          className="pressable flex size-tap-target shrink-0 items-center justify-center rounded-button"
        >
          <ChevronLeft aria-hidden className="size-6" />
        </button>
        <Mascot expression={face} className="size-10 shrink-0" />
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="text-body-strong">말랑이</h1>
          {share !== null && <p className="text-secondary text-muted">오늘 {share}% 남았어요</p>}
        </div>
        <RowMenu
          label="대화 메뉴"
          disabled={!onClear}
          items={[{ label: "대화 지우기", danger: true, pick: () => onClear?.() }]}
        />
      </header>
      {children}
    </div>
  );
}

/**
 * A photo job's line under 말랑이's reply: "n/m장 읽는 중" over a bar with "읽기 취소" while it
 * reads, then that it was read whole or cancelled.
 */
function JobLine({ job, onCancel }: { job: JobProgress; onCancel: () => void }) {
  if (job.state === "done")
    return (
      <p className="text-secondary break-keep text-muted">사진 {job.photos}장을 다 읽었어요</p>
    );
  if (job.state === "cancelled")
    return <p className="text-secondary break-keep text-muted">사진 읽기를 취소했어요</p>;
  return (
    <div className="flex flex-col items-start gap-2">
      <p role="status" className="text-secondary break-keep text-muted">
        {job.finished}/{job.photos}장 읽는 중
      </p>
      <progress
        max={Math.max(job.photos, 1)}
        value={job.finished}
        aria-label="사진 읽기"
        className="h-1.5 w-full max-w-60 accent-primary"
      />
      <button type="button" onClick={onCancel} className={buttonClass("text", "header")}>
        읽기 취소
      </button>
    </div>
  );
}
