"use client";

import { Check } from "lucide-react";
import { useId, useState } from "react";
import { block, type Block, type CardDraft } from "../authoring";
import { labelShown, parseContent, type Sense } from "../card-content";
import { buttonClass } from "@/design/button";
import { Sheet } from "@/design/sheet";
import { RowMenu } from "./row-menu";

const fieldClass =
  "mt-2 min-h-field w-full rounded-field border border-outline bg-surface px-4 py-3 text-body text-ink focus:outline-2 focus:outline-ink";

/** A meaning as the sheet edits it: its own key, so its row moves with it, and whether it is kept. */
type SenseDraft = { key: number; sense: Sense; meaning: string; kept: boolean };

/**
 * "카드 편집" over a photo's candidate, as the phone's edit sheet: its "앞면", then a vocabulary
 * entry's meanings, each kept or left out by its round check, edited, and moved up or down through
 * its ⋯, or a note's "뒷면". "완료" hands [done] the card with the edits, a field left empty
 * keeping its text and each meaning's round check in `keptSenses`, so the card saves the kept ones
 * and the sheet opens again with the others unchecked; it is disabled while every meaning is left
 * out. Closing applies none.
 */
export function CardEditSheet<Card extends CardDraft & { keptSenses?: boolean[] }>({
  card,
  done,
  close,
}: {
  card: Card;
  done: (card: Card) => void;
  close: () => void;
}) {
  const senses = sensesOf(card.back);
  const [front, setFront] = useState(() => textOf(card.front));
  const [back, setBack] = useState(() => textOf(card.back));
  const [drafts, setDrafts] = useState<SenseDraft[]>(() =>
    (senses ?? []).map((sense, key) => ({
      key,
      sense,
      meaning: sense.meaning,
      kept: card.keptSenses?.[key] !== false,
    })),
  );
  const savable = !senses || drafts.some((draft) => draft.kept);

  function apply() {
    const written = senses
      ? card.back.map((item) =>
          item.type === "senses"
            ? {
                ...item,
                payload: {
                  ...item.payload,
                  senses: drafts.map((draft) => ({
                    ...draft.sense,
                    meaning: draft.meaning.trim() || draft.sense.meaning,
                  })),
                },
              }
            : item,
        )
      : withText(card.back, back);
    done({
      ...card,
      front: withText(card.front, front),
      back: written,
      ...(senses && { keptSenses: drafts.map((draft) => draft.kept) }),
    });
  }

  function move(at: number, by: number) {
    const next = [...drafts];
    const [draft] = next.splice(at, 1);
    if (!draft) return;
    next.splice(at + by, 0, draft);
    setDrafts(next);
  }

  return (
    <Sheet title="카드 편집" close={close}>
      <div className="flex flex-col gap-4">
        <label className="text-section text-muted">
          앞면
          <input
            value={front}
            onChange={(event) => {
              setFront(event.target.value);
            }}
            className={fieldClass}
          />
        </label>
        {senses ? (
          <>
            <p className="text-section text-ink">뜻</p>
            {drafts.map((draft, at) => (
              <SenseRow
                key={draft.key}
                draft={draft}
                number={at + 1}
                first={at === 0}
                last={at === drafts.length - 1}
                change={(next) => {
                  setDrafts(drafts.map((item) => (item.key === draft.key ? next : item)));
                }}
                move={(by) => {
                  move(at, by);
                }}
              />
            ))}
          </>
        ) : (
          <label className="text-section text-muted">
            뒷면
            <textarea
              value={back}
              rows={3}
              onChange={(event) => {
                setBack(event.target.value);
              }}
              className={`${fieldClass} resize-y`}
            />
          </label>
        )}
        <button
          type="button"
          disabled={!savable}
          onClick={apply}
          className={`${buttonClass("primary", "cta")} mt-1 w-full`}
        >
          완료
        </button>
      </div>
    </Sheet>
  );
}

/** One meaning: the list's round check, its field named by its place and labels, and its ⋯. */
function SenseRow({
  draft,
  number,
  first,
  last,
  change,
  move,
}: {
  draft: SenseDraft;
  number: number;
  first: boolean;
  last: boolean;
  change: (draft: SenseDraft) => void;
  move: (by: number) => void;
}) {
  const field = useId();
  const labels = draft.sense.labels.map((label) => `[${labelShown(label)}]`).join(" ");
  return (
    <div className="flex min-w-0 items-end gap-1">
      <button
        type="button"
        role="checkbox"
        aria-checked={draft.kept}
        aria-label={`${String(number)}번째 뜻 넣기`}
        onClick={() => {
          change({ ...draft, kept: !draft.kept });
        }}
        className="pressable flex size-12 shrink-0 items-center justify-center rounded-full"
      >
        <span
          aria-hidden
          className={`flex size-6 items-center justify-center rounded-full border ${draft.kept ? "border-ink bg-ink text-on-ink" : "border-outline"}`}
        >
          {draft.kept && <Check className="size-4" />}
        </span>
      </button>
      <div className="min-w-0 flex-1">
        <label htmlFor={field} className="text-section text-muted">
          {[`${String(number)}번째 뜻`, labels].filter(Boolean).join(" · ")}
        </label>
        <input
          id={field}
          value={draft.meaning}
          onChange={(event) => {
            change({ ...draft, meaning: event.target.value });
          }}
          className={fieldClass}
        />
      </div>
      <RowMenu
        label={`${String(number)}번째 뜻 메뉴`}
        items={[
          {
            label: "위로",
            disabled: first,
            pick: () => {
              move(-1);
            },
          },
          {
            label: "아래로",
            disabled: last,
            pick: () => {
              move(1);
            },
          },
        ]}
      />
    </div>
  );
}

/** The senses of [back]'s senses block, or null for a back that holds none. */
function sensesOf(back: Block[]): Sense[] | null {
  for (const content of parseContent(back) ?? []) {
    if (content.kind === "senses") return content.senses;
  }
  return null;
}

/** The text of [blocks]' text blocks, a line each. */
function textOf(blocks: Block[]): string {
  return (parseContent(blocks) ?? [])
    .flatMap((content) => (content.kind === "text" ? [content.text] : []))
    .join("\n");
}

/** [blocks] with their text blocks as one holding [text] where it is not empty, the rest kept. */
function withText(blocks: Block[], text: string): Block[] {
  const trimmed = text.trim();
  if (!trimmed) return blocks;
  const at = blocks.findIndex((item) => item.type === "text");
  const rest = blocks.filter((item) => item.type !== "text");
  const written = block("text", { text: trimmed });
  if (at < 0) return [written, ...rest];
  return [...rest.slice(0, at), written, ...rest.slice(at)];
}
