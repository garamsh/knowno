"use client";

import { emptySense, type CellDraft, type SenseDraft, senseRequired } from "../authoring";
import type { WordAsk } from "../card-content";
import { firstField, useEditing } from "./editing";
import { Choices, type Draft, Field, Problem } from "./editor-field";
import { RowMenu } from "./row-menu";

/** The row of meaning [key]. */
const senseRow = (key: string | undefined) =>
  key === undefined ? null : document.querySelector(`[data-sense="${key}"]`);

function SenseRow({
  sense,
  at,
  senses,
  showErrors,
  replace,
  remove,
}: {
  sense: SenseDraft;
  at: number;
  senses: SenseDraft[];
  showErrors: boolean;
  replace: (senses: SenseDraft[]) => void;
  remove: () => void;
}) {
  const many = senses.length > 1;
  const name = many ? `뜻 ${String(at + 1)}` : "뜻";
  const update = (fields: Partial<SenseDraft>) => {
    replace(senses.map((item) => (item === sense ? { ...item, ...fields } : item)));
  };
  const moved = (by: number) => {
    const next = [...senses];
    next.splice(at, 1);
    next.splice(at + by, 0, sense);
    replace(next);
  };
  return (
    <div data-sense={sense.key}>
      <div className="flex min-w-0 items-start gap-2 px-3 py-1">
        {/* Its target is the tap target's height: a press around the chip focuses it. */}
        <label className="-mt-0.5 shrink-0 cursor-text py-1.5">
          <input
            aria-label={many ? `${name} 라벨` : "라벨"}
            value={sense.label}
            placeholder="라벨"
            onChange={(event) => {
              update({ label: event.target.value });
            }}
            className="block h-8 w-14 rounded-chip bg-brand-tint px-2 text-center text-secondary placeholder:text-muted focus:outline-2 focus:outline-ink"
          />
        </label>
        <Field
          label={name}
          placeholder="뜻"
          value={sense.meaning}
          change={(meaning) => {
            update({ meaning });
          }}
        />
        {many && (
          <RowMenu
            label={`${String(at + 1)}번째 뜻 메뉴`}
            items={[
              {
                label: "위로",
                disabled: at === 0,
                pick: () => {
                  moved(-1);
                },
              },
              {
                label: "아래로",
                disabled: at === senses.length - 1,
                pick: () => {
                  moved(1);
                },
              },
              { label: "삭제", danger: true, pick: remove },
            ]}
          />
        )}
      </div>
      {sense.withExamples && (
        <div className="flex items-start gap-1 px-3 pb-1">
          <span aria-hidden className="w-10 shrink-0 px-1 py-2 text-body text-muted">
            예문
          </span>
          <Field
            label={`${name} 예문`}
            placeholder="한 줄에 하나씩, 없으면 비워 두세요"
            value={sense.examples}
            change={(examples) => {
              update({ examples });
            }}
          />
        </div>
      )}
      {showErrors && sense.meaning.trim() === "" && <Problem>{senseRequired(senses)}</Problem>}
    </div>
  );
}

/** A 단어: the word, each meaning with its label and examples, and what the front shows. */
export function WordGroup({
  draft,
  showErrors,
  change,
}: {
  draft: Draft<"word">;
  showErrors: boolean;
  change: (next: CellDraft) => void;
}) {
  const editing = useEditing();
  const replace = (senses: SenseDraft[]) => {
    change({ ...draft, senses });
  };
  return (
    <div className="divide-y divide-hairline">
      <div className="flex items-start gap-1 px-3 py-1">
        <span aria-hidden className="w-10 shrink-0 px-1 py-2 text-body text-muted">
          단어
        </span>
        <Field
          label="단어"
          value={draft.term}
          change={(term) => {
            change({ ...draft, term });
          }}
        />
      </div>
      {draft.senses.map((sense, at) => (
        <SenseRow
          key={sense.key}
          sense={sense}
          at={at}
          senses={draft.senses}
          showErrors={showErrors}
          replace={replace}
          remove={() => {
            const { senses } = draft;
            const nearest = senses[at + 1]?.key ?? senses[at - 1]?.key;
            editing.remove({
              said: "뜻을 삭제했어요",
              before: draft,
              after: { ...draft, senses: senses.filter((item) => item !== sense) },
              next: () => firstField(senseRow(nearest)),
              back: () => firstField(senseRow(sense.key)),
            });
          }}
        />
      ))}
      <button
        type="button"
        onClick={() => {
          const added = emptySense();
          replace([...draft.senses, added]);
          editing.focusSoon(() => senseRow(added.key)?.querySelector("textarea"));
        }}
        className="pressable min-h-tap-target w-full px-4 text-left text-body text-ink-2"
      >
        + 뜻 추가
      </button>
      <Choices<WordAsk>
        label="앞면에 보일 것"
        name="앞면에 보일 것"
        choices={[
          ["term", "단어"],
          ["meaning", "뜻"],
        ]}
        value={draft.ask}
        change={(ask) => {
          change({ ...draft, ask });
        }}
      />
    </div>
  );
}
