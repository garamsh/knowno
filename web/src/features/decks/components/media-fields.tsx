"use client";

import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronsDownUp,
  ChevronsLeftRight,
  ChevronsRightLeft,
  ChevronsUpDown,
  Volume2,
} from "lucide-react";
import { type PointerEvent, useEffect, useRef, useState } from "react";
import { v7 } from "uuid";

import type { BoxDraft, CellDraft } from "../authoring";
import { audioLength } from "../card-content";
import { boxStep, minBoxSide, movedBox, newBox, resizedBox, withBox } from "../photo-boxes";
import { prepareImage } from "../prepare-image";
import { maxSoundMs, prepareSound, type SoundProblem } from "../prepare-sound";
import { cellSection, firstField, focusLost, useEditing } from "./editing";

type Draft<K extends CellDraft["kind"]> = Extract<CellDraft, { kind: K }>;

/** A 칸's change: its next draft, or how to make it from the draft as it is by then. */
export type CellChange = (next: CellDraft | ((current: CellDraft) => CellDraft)) => void;

/** An outlined button the width it is given, as the phone's secondary `AppButton`. */
const secondary =
  "pressable flex min-h-button w-full cursor-pointer items-center justify-center rounded-button border border-outline bg-surface px-4 text-button text-ink focus-visible:outline-2 focus-visible:outline-ink has-focus-visible:outline-2 has-focus-visible:outline-ink disabled:opacity-40";

/** The editor's photo is at most this tall, so the tools under it stay near, as the phone's. */
const editorMaxHeight = "480px";

const problemText = "text-caption text-dont-know-text";

/** Revokes [url] once it is no longer drawn, when the browser made it from a picked file. */
function useObjectUrl(url: string | undefined) {
  useEffect(
    () => () => {
      if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
    },
    [url],
  );
}

/**
 * A 사진's fields, as the phone's `ImageBlockFields` (ADR 0109): "앨범에서 고르기" and "사진 찍기"
 * until a photo is picked, kept whole at its aspect ratio (`prepareImage`); then the photo, over
 * which a drag draws a box, a box is selected by a press, moved by a drag and resized by its
 * corner, each box a target at least 48 px a side named "빈칸 n"; "빈칸 추가"; while a box is
 * selected, its answer and tools that move, resize and delete it without a drag; and "다른 사진
 * 고르기" and "다시 찍기", which replace the photo under its boxes, and "사진 삭제".
 */
export function PhotoFields({ draft, change }: { draft: Draft<"image">; change: CellChange }) {
  const [busy, setBusy] = useState(false);
  const [unreadable, setUnreadable] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const addBox = useRef<HTMLButtonElement>(null);
  const editing = useEditing();
  const { photo, boxes } = draft;
  useObjectUrl(photo?.url);
  const section = () => cellSection(draft.id);
  const boxButton = (index: number) =>
    section()?.querySelector<HTMLElement>(`[aria-label="빈칸 ${String(index + 1)}"]`);

  async function pick(file: File | undefined, camera: boolean, label: string) {
    if (!file) return;
    setBusy(true);
    setUnreadable(false);
    const prepared = await prepareImage(file, "whole");
    setBusy(false);
    // The picker's button, or the one in its place once the photo is in, takes the focus back.
    const refocus = (name: string) => {
      editing.focusSoon(() =>
        focusLost(section())
          ? section()?.querySelector<HTMLElement>(`input[aria-label="${name}"]`)
          : null,
      );
    };
    if (!prepared) {
      setUnreadable(true);
      refocus(label);
      return;
    }
    const { jpeg, sha256, width, height } = prepared;
    const photo = { media: v7(), url: URL.createObjectURL(jpeg), upload: { file: jpeg, sha256 } };
    // The 칸 as it is once the photo is ready, not as it was when it was picked; a photo replaced
    // keeps its boxes, which are fractions of whichever photo is under them.
    change((current) =>
      current.kind === "image" ? { ...current, photo: { ...photo, width, height } } : current,
    );
    refocus(camera ? "다시 찍기" : "다른 사진 고르기");
  }

  // A photo held stacks its pickers full width, so no label breaks inside a word.
  const pickers = (labels: readonly [string, string], stacked = false) => (
    <div className={stacked ? "flex flex-col gap-2" : "grid grid-cols-2 gap-2"}>
      {labels.map((label, camera) => (
        <label
          key={label}
          className={`${secondary} ${busy ? "pointer-events-none opacity-40" : ""}`}
        >
          {label}
          <input
            aria-label={label}
            type="file"
            accept="image/*"
            capture={camera ? "environment" : undefined}
            disabled={busy}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              void pick(file, !!camera, label);
            }}
            className="sr-only"
          />
        </label>
      ))}
    </div>
  );
  const problem = (
    <p aria-live="polite" className={problemText}>
      {unreadable ? "사진을 불러오지 못했어요. 다시 시도해 주세요." : ""}
    </p>
  );

  if (!photo)
    return (
      <div className="flex flex-col gap-2 px-4 pb-3">
        {pickers(["앨범에서 고르기", "사진 찍기"])}
        {problem}
      </div>
    );

  const changeBoxes = (next: BoxDraft[]) => {
    change({ ...draft, boxes: next });
  };
  const box = selected === null ? undefined : boxes[selected];
  return (
    <div className="flex flex-col gap-2 px-4 pb-3">
      <PhotoBoxes
        photo={photo}
        boxes={boxes}
        selected={box ? selected : null}
        select={setSelected}
        change={changeBoxes}
      />
      <p className="text-caption text-muted">
        사진 위를 끌어서 빈칸을 그리거나 &apos;빈칸 추가&apos;를 눌러요
      </p>
      <button
        ref={addBox}
        type="button"
        onClick={() => {
          changeBoxes(withBox(boxes, newBox));
          setSelected(boxes.length);
        }}
        className={secondary}
      >
        빈칸 추가
      </button>
      {box && selected !== null && (
        <BoxTools
          index={selected}
          box={box}
          boxes={boxes}
          change={changeBoxes}
          remove={() => {
            const index = selected;
            setSelected(null);
            editing.remove({
              said: "빈칸을 삭제했어요",
              before: draft,
              after: { ...draft, boxes: boxes.filter((_, at) => at !== index) },
              next: () =>
                (index < boxes.length - 1 ? boxButton(index) : boxButton(index - 1)) ??
                addBox.current,
              back: () => boxButton(index),
            });
          }}
        />
      )}
      {pickers(["다른 사진 고르기", "다시 찍기"], true)}
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setSelected(null);
          editing.remove({
            said: "사진을 삭제했어요",
            before: draft,
            after: { ...draft, photo: null, boxes: [] },
            next: () => firstField(section()),
            back: () => firstField(section()),
          });
        }}
        className={secondary}
      >
        사진 삭제
      </button>
      {problem}
    </div>
  );
}

type Point = { x: number; y: number };

/** What a pointer pressed on the photo is doing: drawing a box, or moving or resizing one. */
type Drag =
  | { kind: "draw"; start: Point; end: Point }
  | { kind: "move" | "resize"; index: number; last: Point };

/**
 * The photo at its aspect ratio, at most [editorMaxHeight] tall, inside a margin of half a target
 * so the targets of boxes at its edges are whole, with each box over it. A drag over the photo
 * draws or moves rather than scrolling the page.
 */
function PhotoBoxes({
  photo,
  boxes,
  selected,
  select,
  change,
}: {
  photo: { width: number; height: number; url?: string };
  boxes: BoxDraft[];
  selected: number | null;
  select: (index: number | null) => void;
  change: (next: BoxDraft[]) => void;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [drawing, setDrawing] = useState<{ start: Point; end: Point } | null>(null);

  /** [event]'s point as fractions of the photo, held inside it. */
  function fraction(event: PointerEvent): Point {
    const rect = frame.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    const clamp = (value: number) => Math.min(Math.max(value, 0), 1);
    return {
      x: clamp((event.clientX - rect.left) / rect.width),
      y: clamp((event.clientY - rect.top) / rect.height),
    };
  }

  function press(event: PointerEvent, next: Drag) {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = next;
    if (next.kind === "draw") setDrawing({ start: next.start, end: next.end });
  }

  function follow(event: PointerEvent) {
    const now = drag.current;
    if (!now) return;
    const at = fraction(event);
    if (now.kind === "draw") {
      drag.current = { ...now, end: at };
      setDrawing({ start: now.start, end: at });
      return;
    }
    const [dx, dy] = [at.x - now.last.x, at.y - now.last.y];
    drag.current = { ...now, last: at };
    change(
      now.kind === "move"
        ? movedBox(boxes, now.index, dx, dy)
        : resizedBox(boxes, now.index, dx, dy),
    );
  }

  function lift() {
    const ended = drag.current;
    drag.current = null;
    setDrawing(null);
    if (ended?.kind !== "draw") return;
    const rect = drawn(ended);
    if (rect.w < minBoxSide || rect.h < minBoxSide) {
      // A press that drew nothing is a tap on the photo, which leaves no box selected.
      select(null);
      return;
    }
    change(withBox(boxes, rect));
    select(boxes.length);
  }

  const handle = selected === null ? undefined : boxes[selected];
  return (
    <div
      className="touch-none p-6 select-none"
      onPointerMove={follow}
      onPointerUp={lift}
      onPointerCancel={lift}
    >
      <div
        ref={frame}
        data-photo
        onPointerDown={(event) => {
          const at = fraction(event);
          press(event, { kind: "draw", start: at, end: at });
        }}
        className="relative mx-auto w-full rounded-sm bg-ground bg-cover bg-center"
        style={{
          aspectRatio: `${String(photo.width)} / ${String(photo.height)}`,
          maxWidth: `calc(${editorMaxHeight} * ${String(photo.width)} / ${String(photo.height)})`,
          ...(photo.url && { backgroundImage: `url("${photo.url}")` }),
        }}
      >
        {drawing && (
          <span
            aria-hidden
            className="pointer-events-none absolute rounded-sm border-2 border-brand"
            style={place(drawn(drawing))}
          />
        )}
        {boxes.map((box, index) => (
          <span
            key={box.id}
            aria-hidden
            data-box={box.id}
            className={`pointer-events-none absolute rounded-sm bg-brand/25 ${index === selected ? "border-3 border-ink" : "border-2 border-brand"}`}
            style={place(box)}
          />
        ))}
        {boxes.map((box, index) => (
          <button
            key={box.id}
            type="button"
            aria-label={`빈칸 ${String(index + 1)}`}
            aria-pressed={index === selected}
            onPointerDown={(event) => {
              event.stopPropagation();
              select(index);
              press(event, { kind: "move", index, last: fraction(event) });
            }}
            onClick={() => {
              select(index);
            }}
            className="absolute -translate-1/2 rounded-sm focus-visible:outline-2 focus-visible:outline-ink"
            style={target(box.x + box.w / 2, box.y + box.h / 2, box.w, box.h)}
          />
        ))}
        {handle && selected !== null && (
          <span
            aria-hidden
            data-handle
            onPointerDown={(event) => {
              event.stopPropagation();
              press(event, { kind: "resize", index: selected, last: fraction(event) });
            }}
            className="absolute flex -translate-1/2 items-center justify-center"
            style={target(handle.x + handle.w, handle.y + handle.h, 0, 0)}
          >
            <span className="size-3 rounded-full border-2 border-surface bg-ink" />
          </span>
        )}
      </div>
    </div>
  );
}

/** The box a drag from [start] to [end] draws, in fractions of the photo. */
function drawn({ start, end }: { start: Point; end: Point }) {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    w: Math.abs(end.x - start.x),
    h: Math.abs(end.y - start.y),
  };
}

const percent = (fraction: number) => `${String(fraction * 100)}%`;

/** [box]'s place over the photo, in percentages of it. */
function place(box: { x: number; y: number; w: number; h: number }) {
  return {
    left: percent(box.x),
    top: percent(box.y),
    width: percent(box.w),
    height: percent(box.h),
  };
}

/** A target centred on [x], [y] at least 48 px a side, or [w] by [h] of the photo where larger. */
function target(x: number, y: number, w: number, h: number) {
  return {
    left: percent(x),
    top: percent(y),
    width: `max(48px, ${percent(w)})`,
    height: `max(48px, ${percent(h)})`,
  };
}

/** The selected box's answer, and the tools that move, resize and delete it without a drag. */
function BoxTools({
  index,
  box,
  boxes,
  change,
  remove,
}: {
  index: number;
  box: BoxDraft;
  boxes: BoxDraft[];
  change: (next: BoxDraft[]) => void;
  remove: () => void;
}) {
  const tools = [
    ["왼쪽으로 옮기기", ArrowLeft, () => movedBox(boxes, index, -boxStep, 0)],
    ["위로 옮기기", ArrowUp, () => movedBox(boxes, index, 0, -boxStep)],
    ["아래로 옮기기", ArrowDown, () => movedBox(boxes, index, 0, boxStep)],
    ["오른쪽으로 옮기기", ArrowRight, () => movedBox(boxes, index, boxStep, 0)],
    ["가로 늘리기", ChevronsLeftRight, () => resizedBox(boxes, index, boxStep, 0)],
    ["가로 줄이기", ChevronsRightLeft, () => resizedBox(boxes, index, -boxStep, 0)],
    ["세로 늘리기", ChevronsUpDown, () => resizedBox(boxes, index, 0, boxStep)],
    ["세로 줄이기", ChevronsDownUp, () => resizedBox(boxes, index, 0, -boxStep)],
  ] as const;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-secondary text-muted">빈칸 {index + 1}</p>
      <label className="flex flex-col gap-1 text-caption text-muted">
        정답 (선택)
        <input
          key={box.id}
          value={box.answer}
          onChange={(event) => {
            const answer = event.target.value;
            change(boxes.map((each, at) => (at === index ? { ...each, answer } : each)));
          }}
          className="min-h-field w-full rounded-field border border-outline bg-surface px-4 text-body text-ink focus:outline-2 focus:outline-ink"
        />
      </label>
      <div className="flex flex-wrap">
        {tools.map(([label, Icon, moved]) => (
          <button
            key={label}
            type="button"
            aria-label={label}
            title={label}
            onClick={() => {
              change(moved());
            }}
            className="pressable flex size-12 items-center justify-center rounded-button text-ink-2 focus-visible:outline-2 focus-visible:outline-ink"
          >
            <Icon aria-hidden className="size-6" strokeWidth={2} />
          </button>
        ))}
      </div>
      <button type="button" onClick={remove} className={secondary}>
        빈칸 삭제
      </button>
    </div>
  );
}

/** The type a recording is made in where the browser can: AAC in MPEG-4, as the phone records. */
const recordType = "audio/mp4;codecs=mp4a.40.2";

/** Whether this browser records AAC in MPEG-4, decided by what it can do, not by its name. */
function canRecord(): boolean {
  return typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(recordType);
}

const soundProblems: Record<SoundProblem | "microphone", string> = {
  unreadable: "소리를 불러오지 못했어요. 다시 시도해 주세요.",
  tooLarge: "60초, 5MB까지인 파일을 골라 주세요",
  microphone: "마이크를 쓸 수 없어요. 설정에서 마이크 접근을 허용해 주세요.",
};

/** A recording under way: its recorder, its stream, when it began and the seconds so far. */
type Recording = { recorder: MediaRecorder; stream: MediaStream; started: number };

/**
 * A 소리's fields, as the phone's `AudioBlockFields` (ADR 0112): "녹음하기", where the browser
 * records AAC, and "파일에서 고르기" until a sound is in it; while recording, the time so far
 * against the minute and "녹음 끝내기", which the minute presses itself; then the sound's play
 * control and length, "다시 녹음", "다른 파일 고르기" and "소리 삭제". One 칸 records at a
 * time: [recorderTaken] while another does, and [holdRecorder] says when this one starts and stops.
 */
export function SoundFields({
  draft,
  change,
  recorderTaken,
  holdRecorder,
}: {
  draft: Draft<"audio">;
  change: CellChange;
  recorderTaken: boolean;
  holdRecorder: (holding: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<SoundProblem | "microphone" | null>(null);
  const [recorded, setRecorded] = useState<number | null>(null);
  const recording = useRef<Recording | null>(null);
  const editing = useEditing();
  const recordable = canRecord();
  const { sound } = draft;
  useObjectUrl(sound?.url);
  /** Focuses the 칸's control [selector] names once drawn, unless the focus went elsewhere. */
  const refocus = (selector: string) => {
    editing.focusSoon(() => {
      const section = cellSection(draft.id);
      return focusLost(section) ? section?.querySelector<HTMLElement>(selector) : null;
    });
  };
  // A recording under way when the 칸 goes is let go of, and keeps nothing.
  useEffect(
    () => () => {
      const under = recording.current;
      if (!under) return;
      under.recorder.ondataavailable = null;
      under.recorder.onstop = null;
      if (under.recorder.state !== "inactive") under.recorder.stop();
      for (const track of under.stream.getTracks()) track.stop();
    },
    [],
  );
  // The seconds so far, and the minute stopping the recording itself.
  useEffect(() => {
    if (recorded === null) return;
    const tick = setTimeout(() => {
      const under = recording.current;
      if (!under) return;
      const seconds = Math.floor((Date.now() - under.started) / 1000);
      if (seconds * 1000 >= maxSoundMs) stop();
      else setRecorded(seconds);
    }, 1000);
    return () => {
      clearTimeout(tick);
    };
  });

  async function take(file: Blob, durationMs?: number) {
    const prepared = await prepareSound(file, durationMs);
    setBusy(false);
    // A pick's input, or the recorder's button, in the place of the one pressed.
    refocus(durationMs === undefined ? "input[type=file]" : "[data-record]");
    if (typeof prepared === "string") {
      setProblem(prepared);
      return;
    }
    const sound = {
      media: v7(),
      url: URL.createObjectURL(prepared.file),
      upload: { file: prepared.file, sha256: prepared.sha256 },
      durationMs: prepared.durationMs,
    };
    // The 칸 as it is once the sound is ready: a recording runs while other 칸 are edited.
    change((current) => (current.kind === "audio" ? { ...current, sound } : current));
  }

  async function record() {
    setBusy(true);
    setProblem(null);
    holdRecorder(true);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
    } catch (cause) {
      setBusy(false);
      holdRecorder(false);
      refocus("[data-record]");
      setProblem(
        cause instanceof DOMException && cause.name === "NotAllowedError"
          ? "microphone"
          : "unreadable",
      );
      return;
    }
    const recorder = new MediaRecorder(stream, {
      mimeType: recordType,
      audioBitsPerSecond: 64_000,
    });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      chunks.push(event.data);
    };
    recorder.onstop = () => {
      const under = recording.current;
      recording.current = null;
      for (const track of stream.getTracks()) track.stop();
      holdRecorder(false);
      const elapsed = under ? Date.now() - under.started : 0;
      // The minute stops the recording itself, so a few milliseconds over it are the stop's own.
      void take(new Blob(chunks, { type: "audio/mp4" }), Math.min(elapsed, maxSoundMs));
    };
    recording.current = { recorder, stream, started: Date.now() };
    recorder.start();
    setBusy(false);
    setRecorded(0);
    refocus("[data-record]");
  }

  function stop() {
    const under = recording.current;
    setRecorded(null);
    if (!under) return;
    setBusy(true);
    under.recorder.stop();
  }

  const fileButton = (label: string) => (
    <label className={`${secondary} ${busy ? "pointer-events-none opacity-40" : ""}`}>
      {label}
      <input
        aria-label={label}
        type="file"
        accept=".m4a,.mp3,audio/mp4,audio/mpeg"
        disabled={busy}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (!file) return;
          setBusy(true);
          setProblem(null);
          void take(file);
        }}
        className="sr-only"
      />
    </label>
  );
  const recordButton = (label: string) =>
    recordable && (
      <button
        type="button"
        data-record
        disabled={busy || recorderTaken}
        onClick={() => {
          void record();
        }}
        className={secondary}
      >
        {label}
      </button>
    );
  return (
    <div className="flex flex-col gap-2 px-4 pb-3">
      {recorded !== null ? (
        <>
          <p className="text-center text-body-strong">
            녹음 중 {audioLength(recorded * 1000)} / {audioLength(maxSoundMs)}
          </p>
          <button type="button" data-record onClick={stop} className={secondary}>
            녹음 끝내기
          </button>
        </>
      ) : sound ? (
        <>
          <SoundPlay url={sound.url} length={audioLength(sound.durationMs)} />
          {/* Stacked full width, so no label breaks inside a word. */}
          {recordButton("다시 녹음")}
          {fileButton("다른 파일 고르기")}
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              editing.remove({
                said: "소리를 삭제했어요",
                before: draft,
                after: { ...draft, sound: null },
                next: () => firstField(cellSection(draft.id)),
                back: () => firstField(cellSection(draft.id)),
              });
            }}
            className={secondary}
          >
            소리 삭제
          </button>
        </>
      ) : (
        <div className={recordable ? "grid grid-cols-2 gap-2" : "flex"}>
          {recordButton("녹음하기")}
          {fileButton("파일에서 고르기")}
        </div>
      )}
      <p aria-live="polite" className={problemText}>
        {problem ? soundProblems[problem] : ""}
      </p>
    </div>
  );
}

/**
 * A sound's round control named "소리 듣기" with its length under it, as the phone's
 * `AudioBlockView`, playing it from [url], or saying so when it has none or the browser cannot.
 */
export function SoundPlay({ url, length }: { url: string | undefined; length: string }) {
  const player = useRef<HTMLAudioElement | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(
    () => () => {
      player.current?.pause();
    },
    [],
  );
  async function play() {
    setFailed(false);
    if (!url) {
      setFailed(true);
      return;
    }
    if (player.current?.src !== url) {
      player.current?.pause();
      player.current = new Audio(url);
    }
    player.current.currentTime = 0;
    try {
      await player.current.play();
    } catch {
      // A refused or unreadable sound: the control says it could not play.
      setFailed(true);
    }
  }
  return (
    <div className="flex flex-col items-center gap-1">
      <button
        type="button"
        aria-label="소리 듣기"
        onClick={() => {
          void play();
        }}
        className="pressable flex size-16 items-center justify-center rounded-full bg-brand-tint text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
      >
        <Volume2 aria-hidden className="size-8" strokeWidth={2} />
      </button>
      <span aria-hidden className="text-caption text-muted tabular-nums">
        {length}
      </span>
      <p aria-live="polite" className={problemText}>
        {failed ? "소리를 재생하지 못했어요" : ""}
      </p>
    </div>
  );
}
