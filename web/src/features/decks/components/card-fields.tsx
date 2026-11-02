"use client";

import { block, type CardDraft, labelsFromText, type Block } from "../authoring";
import { labelShown, parseContent } from "../card-content";
import { WholeCard } from "./whole-card";

const fieldClass =
  "min-h-field w-full min-w-0 resize-y rounded-field bg-transparent px-4 py-[calc((var(--spacing-field)-var(--text-body--line-height))/2)] text-body placeholder:text-muted focus:outline-2 focus:-outline-offset-2 focus:outline-ink";

/** Front/back groups edit only the chosen blocks, retaining all other stored fields. */
export function CardFields({
  draft,
  change,
}: {
  draft: CardDraft;
  change: (draft: CardDraft) => void;
}) {
  function replace(side: "front" | "back", index: number, updated: Block) {
    change({ ...draft, [side]: draft[side].map((item, at) => (at === index ? updated : item)) });
  }
  return (
    <div className="flex flex-col gap-section-gap">
      {(["front", "back"] as const).map((side) => (
        <section key={side} className="flex min-w-0 flex-col gap-2">
          <h3 className="text-section text-muted">{side === "front" ? "앞면" : "뒷면"}</h3>
          <div className="divide-y divide-hairline overflow-hidden rounded-group bg-surface">
            {draft[side].map((item, at) => {
              const parsed = editableContent(item);
              return (
                <div key={item.id} className="min-w-0 p-3">
                  {parsed?.kind === "text" ? (
                    <textarea
                      aria-label={`${side === "front" ? "앞면" : "뒷면"} 글 ${String(at + 1)}`}
                      value={parsed.text}
                      rows={2}
                      onChange={(event) => {
                        replace(side, at, {
                          ...item,
                          payload: { ...item.payload, text: event.target.value },
                        });
                      }}
                      className={fieldClass}
                    />
                  ) : parsed?.kind === "senses" ? (
                    <>
                      <p className="mb-2 text-section text-muted">뜻 목록</p>
                      {parsed.senses.map((sense, index) => (
                        <div key={index} className="border-t border-hairline py-2 first:border-0">
                          <div className="flex min-w-0 items-start gap-2">
                            <input
                              aria-label={`뜻 ${String(index + 1)} 라벨`}
                              value={sense.labels.map(labelShown).join(" ")}
                              onChange={(event) => {
                                replace(side, at, {
                                  ...item,
                                  payload: {
                                    ...item.payload,
                                    senses: parsed.senses.map((current, i) =>
                                      i === index
                                        ? { ...current, labels: labelsFromText(event.target.value) }
                                        : current,
                                    ),
                                  },
                                });
                              }}
                              className="min-h-tap-target w-20 shrink-0 rounded-chip bg-brand-tint px-2 text-body focus:outline-2 focus:outline-ink"
                              placeholder="라벨"
                            />
                            <textarea
                              aria-label={`뜻 ${String(index + 1)}`}
                              value={sense.meaning}
                              rows={2}
                              onChange={(event) => {
                                replace(side, at, {
                                  ...item,
                                  payload: {
                                    ...item.payload,
                                    senses: parsed.senses.map((current, i) =>
                                      i === index
                                        ? { ...current, meaning: event.target.value }
                                        : current,
                                    ),
                                  },
                                });
                              }}
                              className={fieldClass}
                              placeholder="뜻"
                            />
                          </div>
                          {sense.examples.length > 0 && (
                            <textarea
                              aria-label={`뜻 ${String(index + 1)} 예문`}
                              value={sense.examples.join("\n")}
                              onChange={(event) => {
                                replace(side, at, {
                                  ...item,
                                  payload: {
                                    ...item.payload,
                                    senses: parsed.senses.map((current, i) =>
                                      i === index
                                        ? {
                                            ...current,
                                            examples: event.target.value
                                              .split("\n")
                                              .filter(Boolean),
                                          }
                                        : current,
                                    ),
                                  },
                                });
                              }}
                              className={fieldClass}
                            />
                          )}
                          {parsed.senses.length > 1 && (
                            <details className="text-secondary">
                              <summary
                                aria-label={`${String(index + 1)}번째 뜻 메뉴`}
                                className="pressable min-h-tap-target list-none py-3 text-right"
                              >
                                ⋯
                              </summary>
                              <div className="flex flex-wrap justify-end gap-2">
                                {["위로", "아래로", "삭제"].map((label, move) => (
                                  <button
                                    type="button"
                                    key={label}
                                    disabled={
                                      (move === 0 && index === 0) ||
                                      (move === 1 && index === parsed.senses.length - 1)
                                    }
                                    className="pressable min-h-tap-target px-3 disabled:opacity-40"
                                    onClick={() => {
                                      const senses = [...parsed.senses];
                                      const to = move === 0 ? index - 1 : index + 1;
                                      if (move === 2) senses.splice(index, 1);
                                      else {
                                        const current = senses[index];
                                        const target = senses[to];
                                        if (current && target) {
                                          senses[index] = target;
                                          senses[to] = current;
                                        }
                                      }
                                      replace(side, at, {
                                        ...item,
                                        payload: { ...item.payload, senses },
                                      });
                                    }}
                                  >
                                    {label}
                                  </button>
                                ))}
                              </div>
                            </details>
                          )}
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() => {
                          replace(side, at, {
                            ...item,
                            payload: {
                              ...item.payload,
                              senses: [...parsed.senses, { labels: [], meaning: "", examples: [] }],
                            },
                          });
                        }}
                        className="pressable min-h-tap-target px-2 text-body text-ink-2"
                      >
                        + 뜻 추가
                      </button>
                    </>
                  ) : parsed ? (
                    <div className="overflow-x-auto">
                      <WholeCard blocks={[parsed]} revealed />
                    </div>
                  ) : (
                    <p className="text-muted">내용을 확인해 주세요</p>
                  )}
                  {draft[side].length > 1 && (
                    <button
                      type="button"
                      aria-label={`${side === "front" ? "앞면" : "뒷면"} ${String(at + 1)}번째 블록 삭제`}
                      onClick={() => {
                        change({
                          ...draft,
                          [side]: draft[side].filter((_, index) => index !== at),
                        });
                      }}
                      className="pressable min-h-tap-target px-2 text-secondary text-dont-know"
                    >
                      삭제
                    </button>
                  )}
                </div>
              );
            })}
            <details className="p-2">
              <summary className="pressable list-none min-h-tap-target p-2 text-body text-muted">
                + 추가
              </summary>
              <div className="flex flex-wrap gap-2">
                {["글", "뜻 목록"].map((type) => (
                  <button
                    type="button"
                    key={type}
                    className="pressable min-h-tap-target px-3 text-body"
                    onClick={() => {
                      change({
                        ...draft,
                        [side]: [
                          ...draft[side],
                          type === "글"
                            ? block("text", { text: "" })
                            : block("senses", {
                                senses: [{ labels: [], meaning: "", examples: [] }],
                              }),
                        ],
                      });
                    }}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </details>
          </div>
        </section>
      ))}
    </div>
  );
}

function editableContent(item: Block) {
  if (item.type !== "senses" || !Array.isArray(item.payload.senses))
    return parseContent([item])?.[0];
  const values: unknown[] = item.payload.senses;
  const blanks = new Set<number>();
  const senses = values.map((value, index) => {
    if (value && typeof value === "object" && "meaning" in value && value.meaning === "") {
      blanks.add(index);
      return { ...value, meaning: "editing" };
    }
    return value;
  });
  const parsed = parseContent([{ ...item, payload: { ...item.payload, senses } }])?.[0];
  return parsed?.kind === "senses"
    ? {
        ...parsed,
        senses: parsed.senses.map((sense, index) =>
          blanks.has(index) ? { ...sense, meaning: "" } : sense,
        ),
      }
    : parsed;
}
