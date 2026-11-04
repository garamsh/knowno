"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { v7 } from "uuid";
import { readAllowance } from "../actions";
import { preparePhoto, sendPhoto } from "../extract-photo";
import { describeFailure, isRetryable, type PhotoFailure } from "../photo-failure";
import { appendCandidates, type Candidate } from "../photo-candidates";

/** A photo's place in the job, as the phone's `PhotoState`. */
export type PhotoState =
  | { kind: "waiting" }
  | { kind: "reading" }
  | { kind: "read"; cards: Candidate[] }
  | { kind: "failed"; failure: PhotoFailure };
/** A photo, with the cards read off its page so far when a failure stopped it before the end. */
export type Photo = {
  id: string;
  file: File;
  url: string;
  upload?: File;
  readSoFar?: Candidate[];
  state: PhotoState;
};

/** The most photos one import holds, as the phone's `maxPhotosPerImport`. */
export const maxPhotos = 50;

/**
 * The photo import's photos and their reading: [files] start it, read in order one call at a time
 * within the user's allowance, and the list opens once every photo is read. [say] shows a message
 * under the list, cleared as a batch starts and set when the allowance refuses one added there.
 */
export function usePhotoReading(files: File[], say: (message: string) => void) {
  const [photos, setPhotos] = useState(() => photosOf(files, maxPhotos));
  const photosRef = useRef(photos);
  const [jobFailure, setJobFailure] = useState<PhotoFailure | null>(null);
  const [note, setNote] = useState("");
  const [listOpen, setListOpen] = useState(false);
  const pumping = useRef(false);
  const closed = useRef(false);
  const started = useRef(false);

  function change(next: (current: Photo[]) => Photo[]) {
    photosRef.current = next(photosRef.current);
    setPhotos(photosRef.current);
    // Once every photo is read, the list opens; photos added later return to it.
    if (photosRef.current.length && photosRef.current.every((photo) => photo.state.kind === "read"))
      setListOpen(true);
  }
  function update(id: string, fields: Partial<Photo>) {
    change((current) =>
      current.map((photo) => (photo.id === id ? { ...photo, ...fields } : photo)),
    );
  }
  /** Leaves out the photos [keep] refuses, and returns the photos left. */
  function remove(keep: (photo: Photo) => boolean): Photo[] {
    for (const photo of photosRef.current) if (!keep(photo)) URL.revokeObjectURL(photo.url);
    change((current) => current.filter(keep));
    return photosRef.current;
  }
  async function readOne(photo: Photo): Promise<PhotoState> {
    let upload = photo.upload;
    if (!upload) {
      const prepared = await preparePhoto(photo.file);
      if (!(prepared instanceof File)) return { kind: "failed", failure: prepared };
      upload = prepared;
      update(photo.id, { upload });
    }
    // A page the function leaves unread past a request's cards is read on with its cursor, with the
    // same photo, until it is read to its end (ADR 0138).
    let cards = photo.readSoFar ?? [];
    let cursor: string | null = null;
    do {
      const result = await sendPhoto(upload, cursor);
      if ("failure" in result) {
        // The cursor is spent; reading the photo again starts over and adds to these cards.
        update(photo.id, { readSoFar: cards });
        return { kind: "failed", failure: result.failure };
      }
      cards = appendCandidates(cards, result.cards);
      cursor = result.cursor;
    } while (
      cursor &&
      !closed.current &&
      photosRef.current.some((current) => current.id === photo.id)
    );
    return { kind: "read", cards };
  }
  // Reads the waiting photos in order, one call at a time, as Server Actions run one at a time.
  async function pump() {
    if (pumping.current) return;
    pumping.current = true;
    try {
      for (;;) {
        const next = photosRef.current.find((photo) => photo.state.kind === "waiting");
        if (closed.current || !next) break;
        update(next.id, { state: { kind: "reading" } });
        const state = await readOne(next);
        // A photo left out or cancelled while it was read keeps nothing of its answer.
        if (photosRef.current.some((photo) => photo.id === next.id)) update(next.id, { state });
      }
    } finally {
      pumping.current = false;
    }
  }
  async function addBatch(chosen: File[]) {
    const batch = photosOf(chosen, maxPhotos - photosRef.current.length);
    if (!batch.length) return;
    change((current) => [...current, ...batch]);
    await startBatch(batch, true);
  }
  async function startBatch(batch: Photo[], toList: boolean) {
    say("");
    setNote("");
    // Where the allowance cannot be read every photo is sent, and a refusal shows on its photo.
    const allowance = await readAllowance().catch(() => null);
    if (closed.current) return;
    if (allowance?.kind === "limited" && allowance.remaining < batch.length) {
      const left = new Set(batch.slice(allowance.remaining).map((photo) => photo.id));
      remove((photo) => !left.has(photo.id));
      if (allowance.remaining === 0) {
        const failure: PhotoFailure = {
          kind: "limit",
          limit: allowance.limit,
          period: allowance.period,
        };
        if (toList) say(describeFailure(failure));
        else setJobFailure(failure);
        return;
      }
      const count = String(allowance.remaining);
      setNote(
        `${allowance.period === "day" ? "오늘" : "이번 달"} ${count}장 더 만들 수 있어요. 처음 ${count}장만 읽어요.`,
      );
    }
    void pump();
  }
  function replace(chosen: File[]) {
    setJobFailure(null);
    remove(() => false);
    const batch = photosOf(chosen, maxPhotos);
    change(() => batch);
    void startBatch(batch, false);
  }
  /** Reads [chosen] in place of the photos read, back on the reading screens. */
  function retake(chosen: File[]) {
    setListOpen(false);
    replace(chosen);
  }
  // The photos chosen before the sheet opened start the job, once.
  const begin = useEffectEvent(() => {
    if (started.current) return;
    started.current = true;
    void startBatch(photosRef.current, false);
  });
  useEffect(() => {
    closed.current = false;
    begin();
    return () => {
      closed.current = true;
    };
  }, []);
  useEffect(
    () => () => {
      for (const photo of photosRef.current) URL.revokeObjectURL(photo.url);
    },
    [],
  );

  function retry(photo: Photo) {
    update(photo.id, { state: { kind: "waiting" } });
    void pump();
  }
  // Sends every photo whose failure sending again can help, as one action beside each row's own.
  function retryFailed() {
    change((current) =>
      current.map((photo) =>
        photo.state.kind === "failed" && isRetryable(photo.state.failure)
          ? { ...photo, state: { kind: "waiting" } }
          : photo,
      ),
    );
    void pump();
  }
  function changeCandidate(card: Candidate) {
    change((current) =>
      current.map((photo) =>
        photo.state.kind === "read"
          ? {
              ...photo,
              state: {
                ...photo.state,
                cards: photo.state.cards.map((item) => (item.id === card.id ? card : item)),
              },
            }
          : photo,
      ),
    );
  }

  return {
    photos,
    jobFailure,
    note,
    listOpen,
    remove,
    addBatch,
    replace,
    retake,
    retry,
    retryFailed,
    changeCandidate,
  };
}

/** Up to [room] chosen files as photos waiting to be read, each with a URL for its thumbnail. */
function photosOf(files: File[], room: number): Photo[] {
  return files.slice(0, Math.max(0, room)).map((file) => ({
    id: v7(),
    file,
    url: URL.createObjectURL(file),
    state: { kind: "waiting" },
  }));
}
