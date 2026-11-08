"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { v7 } from "uuid";
import { type CellDraft, cellProblem, type MediaFile } from "../authoring";
import type { CellSide } from "../card-content";
import type { PastePart } from "../markdown-paste";
import { prepareImage } from "../prepare-image";
import { ClozeGroup } from "./cloze-fields";
import {
  cellSection,
  type Editing,
  EditingContext,
  type Find,
  firstField,
  UndoSnack,
} from "./editing";
import { Choices, type Draft, Field, Problem } from "./editor-field";
import { AnkiGroup, MarkupField } from "./markup-fields";
import { type CellChange, PhotoFields, SoundFields } from "./media-fields";
import { RowMenu } from "@/design/row-menu";
import { TableGroup } from "./table-fields";
import { WordGroup } from "./word-fields";

function TextGroup({
  draft,
  change,
  paste,
}: {
  draft: Draft<"text">;
  change: (next: CellDraft) => void;
  paste: (parts: PastePart[]) => void;
}) {
  return (
    <div className="divide-y divide-hairline">
      {(["front", "back"] as const).map((side) => (
        <div key={side} className="flex items-start gap-1 px-3 py-1">
          <span aria-hidden className="w-10 shrink-0 px-1 py-2 text-body text-muted">
            {side === "front" ? "앞면" : "뒷면"}
          </span>
          {draft.markup ? (
            <MarkupField
              label={side === "front" ? "앞면" : "뒷면"}
              value={draft[side]}
              paste={paste}
              change={(value) => {
                change({ ...draft, [side]: value });
              }}
            />
          ) : (
            <Field
              label={side === "front" ? "앞면" : "뒷면"}
              value={draft[side]}
              change={(value) => {
                change({ ...draft, [side]: value });
              }}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function kindName(draft: CellDraft): string {
  switch (draft.kind) {
    case "text":
      return "글";
    case "word":
      return "단어";
    case "cloze":
    case "anki":
      return "빈칸 문장";
    case "table":
      return "표";
    case "image":
      return "사진";
    case "audio":
      return "소리";
  }
}

/** The row of "앞면" and "뒷면" chips choosing the side a 사진 or a 소리 sits on. */
function SideChoices({
  draft,
  change,
}: {
  draft: Draft<"image" | "audio">;
  change: (next: CellDraft) => void;
}) {
  return (
    <Choices<CellSide>
      name="보일 면"
      choices={[
        ["front", "앞면"],
        ["back", "뒷면"],
      ]}
      value={draft.side}
      change={(side) => {
        change({ ...draft, side });
      }}
    />
  );
}

/** One group per 칸, headed by its type's name with its ⋯, as the phone's editor (ADR 0137). */
function CellGroup({
  draft,
  at,
  count,
  showErrors,
  recorder,
  change,
  paste,
  move,
  remove,
}: {
  draft: CellDraft;
  at: number;
  count: number;
  showErrors: boolean;
  recorder: { taken: boolean; hold: (holding: boolean) => void };
  change: CellChange;
  paste: (parts: PastePart[]) => void;
  move: (by: number) => void;
  remove: () => void;
}) {
  const heading = useId();
  const problem = cellProblem(draft);
  return (
    <section aria-labelledby={heading} data-cell={draft.id} className="min-w-0">
      <div className="rounded-group bg-surface">
        <div className="flex min-h-tap-target items-center justify-between pl-4">
          <h3 id={heading} className="text-section text-muted">
            {kindName(draft)}
          </h3>
          <RowMenu
            label={`${String(at + 1)}번째 칸 메뉴`}
            items={[
              {
                label: "위로",
                disabled: at === 0,
                pick: () => {
                  move(-1);
                },
              },
              {
                label: "아래로",
                disabled: at === count - 1,
                pick: () => {
                  move(1);
                },
              },
              { label: "삭제", danger: true, pick: remove },
            ]}
          />
        </div>
        {draft.kind === "text" && <TextGroup draft={draft} change={change} paste={paste} />}
        {draft.kind === "word" && (
          <WordGroup draft={draft} showErrors={showErrors} change={change} />
        )}
        {draft.kind === "anki" && <AnkiGroup draft={draft} change={change} paste={paste} />}
        {draft.kind === "cloze" && <ClozeGroup draft={draft} change={change} />}
        {draft.kind === "table" && (
          <TableGroup draft={draft} showErrors={showErrors} change={change} />
        )}
        {draft.kind === "image" && (
          <>
            <PhotoFields draft={draft} change={change} />
            {draft.photo && draft.boxes.length === 0 && (
              <SideChoices draft={draft} change={change} />
            )}
          </>
        )}
        {draft.kind === "audio" && (
          <>
            <SoundFields
              draft={draft}
              change={change}
              recorderTaken={recorder.taken}
              holdRecorder={recorder.hold}
            />
            <SideChoices draft={draft} change={change} />
          </>
        )}
        {showErrors && problem && draft.kind !== "word" && <Problem>{problem}</Problem>}
      </div>
    </section>
  );
}

/**
 * [draft] with each file it picked drawn from a new object URL, for one put back after its own
 * was revoked as it left the editor.
 */
function revived(draft: CellDraft): CellDraft {
  const fresh = <F extends MediaFile>(file: F | null) =>
    file?.upload ? { ...file, url: URL.createObjectURL(file.upload.file) } : file;
  if (draft.kind === "image") return { ...draft, photo: fresh(draft.photo) };
  if (draft.kind === "audio") return { ...draft, sound: fresh(draft.sound) };
  return draft;
}

/**
 * A delete the snack offers back: [restore] puts the 칸 [put] back while [valid] holds, which is
 * while nothing it would undo has changed since, and [back] finds what then takes the focus.
 */
type Offer = {
  said: string;
  put: CellDraft;
  valid: (drafts: CellDraft[]) => boolean;
  restore: (drafts: CellDraft[], put: CellDraft) => CellDraft[];
  back: Find;
};

/**
 * A card's 칸 as a column of groups; "+ 칸 추가" comes after the last, as on the phone. Every delete
 * acts at once and the snack offers the latest back (design/principles.md §Correct, don't confirm).
 */
export function CellFields({
  drafts,
  showErrors,
  change,
  add,
}: {
  drafts: CellDraft[];
  showErrors: boolean;
  change: (update: (drafts: CellDraft[]) => CellDraft[]) => void;
  add: () => void;
}) {
  // The 칸 recording, one at a time, as the phone's one recorder.
  const [recording, setRecording] = useState<string | null>(null);
  const [offer, setOffer] = useState<{ key: number; offer: Offer } | null>(null);
  const [focusing, setFocusing] = useState<{ find: Find } | null>(null);
  // Whether a pasted image's picture could not be fetched, told once in a live region.
  const [pasteFailed, setPasteFailed] = useState(false);
  const addButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const field = focusing?.find();
    field?.focus();
    // A focus scrolls no grid sideways in Chromium, so a new column's header is brought in too.
    if (field && "scrollIntoView" in field)
      field.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [focusing]);
  const dismiss = useCallback(() => {
    setOffer(null);
  }, []);
  const offerBack = (next: Offer) => {
    setOffer((now) => ({ key: (now?.key ?? 0) + 1, offer: next }));
  };
  const editing: Editing = {
    remove: ({ said, before, after, next, back }) => {
      change((current) => current.map((item) => (item.id === before.id ? after : item)));
      offerBack({
        said,
        put: before,
        valid: (current) => current.some((item) => item === after),
        restore: (current, put) => current.map((item) => (item === after ? put : item)),
        back,
      });
      setFocusing({ find: next });
    },
    focusSoon: (find) => {
      setFocusing({ find });
    },
  };
  /**
   * A paste into a 글 or a 빈칸 문장 that held a table or an image: each part becomes a 칸 after
   * the one pasted into, or in its place where that holds nothing, a table a 표, an image link a
   * 사진 whose picture is fetched into it, and the rest a 글.
   */
  function paste(id: string, parts: PastePart[]) {
    const images: { id: string; url: string }[] = [];
    const made = parts.map((part): CellDraft => {
      switch (part.kind) {
        case "text":
          return { kind: "text", id: v7(), front: part.text, back: "", markup: true };
        case "table":
          return {
            kind: "table",
            id: v7(),
            columns: part.columns,
            rows: part.rows,
            blanks: [],
            spans: [],
          };
        case "image": {
          const draft: CellDraft = {
            kind: "image",
            id: v7(),
            side: "front",
            photo: null,
            boxes: [],
          };
          images.push({ id: draft.id, url: part.url });
          return draft;
        }
      }
    });
    setPasteFailed(false);
    change((current) => {
      const at = current.findIndex((item) => item.id === id);
      const source = current[at];
      if (!source) return current;
      const empty =
        source.kind === "text" && source.front.trim() === "" && source.back.trim() === "";
      const next = [...current];
      next.splice(empty ? at : at + 1, empty ? 1 : 0, ...made);
      return next;
    });
    for (const image of images) void fetchPhoto(image.id, image.url);
  }
  async function fetchPhoto(id: string, url: string) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`the picture answered ${String(response.status)}`);
      const prepared = await prepareImage(await response.blob(), "whole");
      if (!prepared) throw new Error("the picture cannot be read");
      const { jpeg, sha256, width, height } = prepared;
      const photo = {
        media: v7(),
        url: URL.createObjectURL(jpeg),
        upload: { file: jpeg, sha256 },
        width,
        height,
      };
      change((current) =>
        current.map((item) =>
          item.id === id && item.kind === "image" ? { ...item, photo } : item,
        ),
      );
    } catch {
      setPasteFailed(true);
    }
  }
  const shown = offer?.offer.valid(drafts) ? offer : null;
  return (
    <EditingContext value={editing}>
      <div className="flex flex-col gap-3">
        {drafts.map((draft, at) => (
          <CellGroup
            key={draft.id}
            draft={draft}
            at={at}
            count={drafts.length}
            showErrors={showErrors}
            recorder={{
              taken: recording !== null && recording !== draft.id,
              hold: (holding) => {
                setRecording((holder) =>
                  holding ? draft.id : holder === draft.id ? null : holder,
                );
              },
            }}
            paste={(parts) => {
              paste(draft.id, parts);
            }}
            change={(next) => {
              change((current) =>
                current.map((item) =>
                  item.id === draft.id ? (typeof next === "function" ? next(item) : next) : item,
                ),
              );
            }}
            move={(by) => {
              change((current) => {
                const next = current.filter((item) => item.id !== draft.id);
                next.splice(at + by, 0, current.find((item) => item.id === draft.id) ?? draft);
                return next;
              });
            }}
            remove={() => {
              const following = drafts[at + 1]?.id;
              const preceding = drafts[at - 1]?.id;
              const others = drafts.filter((item) => item !== draft).map((item) => item.id);
              change((current) => current.filter((item) => item.id !== draft.id));
              offerBack({
                said: "칸을 삭제했어요",
                put: draft,
                // A card saved and started again holds none of the 칸 this one was beside.
                valid: (current) =>
                  !current.some((item) => item.id === draft.id) &&
                  (others.length === 0 || current.some((item) => others.includes(item.id))),
                restore: (current, put) => {
                  const next = [...current];
                  const after = next.findIndex((item) => item.id === following);
                  const before = next.findIndex((item) => item.id === preceding);
                  next.splice(after >= 0 ? after : before + 1, 0, put);
                  return next;
                },
                back: () => {
                  const section = cellSection(draft.id);
                  return firstField(section) ?? section?.querySelector("[aria-haspopup]");
                },
              });
              setFocusing({
                find: () =>
                  firstField(cellSection(following)) ??
                  firstField(cellSection(preceding)) ??
                  addButton.current,
              });
            }}
          />
        ))}
        <button
          ref={addButton}
          type="button"
          onClick={add}
          className="pressable min-h-tap-target w-full px-1 text-left text-body text-ink-2"
        >
          + 칸 추가
        </button>
        {pasteFailed && (
          <p role="status" className="px-1 text-caption text-dont-know-text">
            붙여넣은 사진을 가져오지 못했어요
          </p>
        )}
        {shown && (
          <UndoSnack
            key={shown.key}
            said={shown.offer.said}
            dismiss={dismiss}
            undo={() => {
              const { put, restore } = shown.offer;
              // Made once here, not in the update, which may run twice.
              const back = revived(put);
              change((current) => restore(current, back));
              setOffer(null);
              setFocusing({ find: shown.offer.back });
            }}
          />
        )}
      </div>
    </EditingContext>
  );
}
