"use client";

import { ArrowUp, ChevronLeft, Square } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { Mascot, type MascotExpression } from "@/design/brand";
import { buttonClass } from "@/design/button";
import { Confirm } from "@/design/confirm";
import { RowMenu } from "@/design/row-menu";

import { type AssistantClient, httpAssistantClient, type SendResult } from "../assistant-client";
import {
  type AssistantTurn,
  checkedCount,
  type Conversation,
  emptyConversation,
  loadConversation,
  maxMessageLength,
  requestTurns,
  type ShownProposal,
  storeConversation,
  type Turn,
  withEvent,
} from "../conversation";
import { type Allowance, leftShare, type SendRefusal } from "../protocol";
import { formatNames, ProposalView } from "./proposal-view";

/** Where the message list's scroll is kept while the chat is left for a note (#711). */
const scrollKey = "knowno.assistant.scroll";

/** How long a message refused as `busy` waits before it is sent again, and how often. */
export const busyRetryMs = 3000;
const busyRetries = 3;

/** What the chat is doing: nothing, a reply streaming, waiting to resend, or refused. */
type Status =
  | { kind: "idle" }
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
  client = httpAssistantClient,
}: {
  allowance: Allowance | null;
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
    if (turns.at(-1)?.role !== "user") return;
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
        result = await client.send({ messages: requestTurns(turns) }, controller.signal);
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
        if (event === "malformed") change((turn) => ({ ...turn, ending: "model_error" }));
        else if (event.type === "usage") setAllowance(event.allowance);
        else change((turn) => withEvent(turn, event));
      }
      change((turn) => (turn.ending ? turn : { ...turn, ending: "ok" }));
    } catch {
      change((turn) =>
        turn.ending
          ? turn
          : { ...turn, ending: controller.signal.aborted ? "stopped" : "model_error" },
      );
    }
    setStatus({ kind: "idle" });
  }, [client, update]);

  const busy = status.kind === "streaming" || status.kind === "waiting";

  const send = useCallback(
    (text: string) => {
      const message = text.trim();
      if (!message || busy) return;
      setCommitFailure(null);
      update((before) => ({
        draft: "",
        turns: [...before.turns, { role: "user", id: newId(), text: message }],
      }));
      void replyTo();
    },
    [busy, replyTo, update],
  );

  /** Sends the last message again, in place of the reply that failed after it. */
  const retry = useCallback(() => {
    update((before) => {
      const last = before.turns.at(-1);
      return last?.role === "assistant" ? { ...before, turns: before.turns.slice(0, -1) } : before;
    });
    void replyTo();
  }, [replyTo, update]);

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
  const last = turns.at(-1);
  // The open proposal: the last one shown, not yet added, once its reply has ended.
  const lastReply = turns.findLast((turn): turn is AssistantTurn => turn.role === "assistant");
  const open = lastReply?.ending ? lastReply.proposals.findLast((one) => !one.added) : undefined;
  const openCount = open ? checkedCount(open) : 0;

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
      added: { deck: result.deck, count: result.count },
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
        turns.length > 0 && !busy
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
          {turns.length === 0 && (
            <li className="py-12 text-center">
              <p className="text-body-strong break-keep">무엇을 외워 볼까요?</p>
            </li>
          )}
          {turns.map((turn) =>
            turn.role === "user" ? (
              <li key={turn.id} className="flex justify-end">
                <p className="max-w-[85%] rounded-row bg-brand-tint px-4 py-3 text-body break-keep whitespace-pre-wrap">
                  <span className="sr-only">나: </span>
                  {turn.text}
                </p>
              </li>
            ) : (
              <li key={turn.id} className="flex flex-col gap-3">
                <span className="sr-only">말랑이: </span>
                {turn.text && (
                  <p className="text-body break-keep whitespace-pre-wrap">{turn.text}</p>
                )}
                {turn.ending === null && !turn.text && (
                  <p role="status" className="text-secondary text-muted">
                    말랑이가 생각하는 중이에요
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
                    {turn.ending === "model_error" && turn === last && !busy && (
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
              send(draft);
            }}
            className="flex items-end gap-2 rounded-field bg-surface p-1 pl-4"
          >
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
                  send(draft);
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
                disabled={busy || !draft.trim()}
                className="pressable flex size-tap-target shrink-0 items-center justify-center rounded-button bg-primary text-on-primary disabled:opacity-50"
              >
                <ArrowUp aria-hidden className="size-5" />
              </button>
            )}
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
