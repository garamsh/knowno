"use client";

import { useEffect, useEffectEvent, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, CircleAlert, Clock, ImagePlus, LoaderCircle } from "lucide-react";
import { v7 } from "uuid";
import { createDeck, readAllowance, readCardKeys, savePhotoCards } from "../actions";
import { frameKey } from "../authoring";
import { parseCells } from "../card-content";
import { preparePhoto, sendPhoto } from "../extract-photo";
import { describeFailure, isRetakeable, isRetryable, type PhotoFailure } from "../photo-failure";
import { appendCandidates, type Candidate } from "../photo-candidates";
import type { Deck } from "../library";
import {
  cardsOf,
  defaultForm,
  formFor,
  readForms,
  rememberForms,
  type Section,
  type SectionForm,
  sectionsOf,
} from "../section-form";
import { AuthoringSheet } from "./authoring-sheet";
import { CardFields } from "./card-fields";
import { ImportList } from "./import-list";

import { Mascot } from "@/design/brand";

/** A photo's place in the job, as the phone's `PhotoState`. */
type PhotoState =
  | { kind: "waiting" }
  | { kind: "reading" }
  | { kind: "read"; cards: Candidate[] }
  | { kind: "failed"; failure: PhotoFailure };
/** A photo, with the cards read off its page so far when a failure stopped it before the end. */
type Photo = {
  id: string;
  file: File;
  url: string;
  upload?: File;
  readSoFar?: Candidate[];
  state: PhotoState;
};

/** The most photos one import holds, as the phone's `maxPhotosPerImport`. */
const maxPhotos = 50;
const privacyNote = "사진은 카드를 만드는 데만 쓰고 서버에 남기지 않아요";

/**
 * A browser-bound photo job drawn as the phone's photo import: one photo at 카드를 찾고 있어요 or
 * its failure, several at 사진 n장 중 k장 읽음 with a row per photo, then the list to review, whose
 * cards go into [deck] or a new deck.
 */
export function PhotoImport({
  deck,
  camera,
  files,
  close,
}: {
  deck: Deck;
  camera: boolean;
  files: File[];
  close: () => void;
}) {
  const [photos, setPhotos] = useState(() => photosOf(files, maxPhotos));
  const photosRef = useRef(photos);
  const [jobFailure, setJobFailure] = useState<PhotoFailure | null>(null);
  const [note, setNote] = useState("");
  const [listOpen, setListOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [target, setTarget] = useState<string>(deck.id);
  const [name, setName] = useState("");
  const [naming, setNaming] = useState(false);
  const [choosing, setChoosing] = useState(false);
  // Each section's form once set, by section id; one not set takes the deck's remembered form.
  const [forms, setForms] = useState<Record<string, SectionForm>>({});
  const [remembered] = useState(readForms);
  // The card keys the chosen deck holds, by deck id; a deck not read yet marks nothing.
  const [held, setHeld] = useState<Record<string, ReadonlySet<string>>>({});
  useEffect(() => {
    if (target === "new") return;
    let current = true;
    // A deck whose keys cannot be read marks nothing, and a duplicate merges on saving.
    void readCardKeys(target)
      .catch(() => null)
      .then((keys) => {
        if (current && keys) setHeld((all) => ({ ...all, [target]: new Set(keys) }));
      });
    return () => {
      current = false;
    };
  }, [target]);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [editing, setEditing] = useState<Candidate | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const [pending, start] = useTransition();
  const pumping = useRef(false);
  const closed = useRef(false);
  const started = useRef(false);
  const busy = useRef(false);
  const newDeckId = useRef(v7());
  const [created, setCreated] = useState(false);
  const router = useRouter();

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
  function remove(keep: (photo: Photo) => boolean) {
    for (const photo of photosRef.current) if (!keep(photo)) URL.revokeObjectURL(photo.url);
    change((current) => current.filter(keep));
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
    setMessage("");
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
        if (toList) setMessage(describeFailure(failure));
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

  const unfinished = photos.some((photo) => photo.state.kind !== "read");

  const read = photos.filter((photo) => photo.state.kind === "read");
  const candidates = read.flatMap((photo) =>
    photo.state.kind === "read" ? photo.state.cards : [],
  );
  const groups = read.map((photo) => ({
    id: photo.id,
    url: photo.url,
    sections: sectionsOf(photo.id, photo.state.kind === "read" ? photo.state.cards : []),
  }));
  const sections = groups.flatMap((group) => group.sections);
  function formOf(section: Section): SectionForm {
    return (
      forms[section.id] ??
      formFor(section, remembered[target]?.[section.key]) ??
      defaultForm(section.kind, section.identify)
    );
  }
  /** Whether the chosen deck holds [card]'s first card in its form, as the phone's `isDuplicate`. */
  function inDeck(card: Candidate, section: Section): boolean {
    const [first] = cardsOf(card, formOf(section));
    return !!first && !!held[target]?.has(frameKey(parseCells(first.blocks) ?? []));
  }
  /** Whether [card] is saved: as the user set it, else unless it is an identify card or in the deck. */
  function included(card: Candidate, section: Section): boolean {
    return card.selected ?? (!card.identify && !inDeck(card, section));
  }
  // The cards saving writes: each included candidate's, in its section's form.
  const toSave = sections.flatMap((section) =>
    section.cards
      .filter((card) => included(card, section))
      .flatMap((card) => cardsOf(card, formOf(section))),
  );
  // One per card key, as the phone's `cardCount`: cards of one key merge into one.
  const cardCount = new Set(toSave.map((card) => frameKey(parseCells(card.blocks) ?? []))).size;
  /** Chooses the deck the cards go into, taking that deck's remembered forms where it has them. */
  function chooseTarget(next: string) {
    setForms(
      Object.fromEntries(
        sections.map((section) => [
          section.id,
          formFor(section, remembered[next]?.[section.key]) ?? formOf(section),
        ]),
      ),
    );
    setTarget(next);
    setChoosing(false);
  }
  function leave() {
    if (candidates.length) setDiscarding(true);
    else close();
  }
  function cancel() {
    if (listOpen) remove((photo) => photo.state.kind === "read");
    else leave();
  }
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
  /** Includes every card of [section], or leaves every one out when any is included. */
  function toggleSection(section: Section) {
    const include = !section.cards.some((card) => included(card, section));
    for (const card of section.cards) changeCandidate({ ...card, selected: include });
  }
  /** Adds the cards; a new deck is named first, in its own sheet, as the phone's save asks. */
  function add() {
    if (target === "new" && !created) setNaming(true);
    else save();
  }
  function save() {
    if (busy.current) return;
    busy.current = true;
    start(async () => {
      try {
        let deckId = target;
        if (target === "new") {
          deckId = newDeckId.current;
          if (!created) {
            const result = await createDeck(deckId, name);
            if (!result.saved) {
              setMessage(result.message);
              return;
            }
            setCreated(true);
          }
        }
        setNaming(false);
        for (let offset = 0; offset < toSave.length; offset += 25) {
          const result = await savePhotoCards(deckId, toSave.slice(offset, offset + 25));
          if (!result.saved) {
            setMessage(result.message);
            return;
          }
        }
        rememberForms(
          deckId,
          Object.fromEntries(sections.map((section) => [section.key, formOf(section)])),
        );
        close();
        router.push(`/decks/${deckId}`);
        router.refresh();
      } catch {
        setMessage("카드를 저장하지 못했어요. 다시 시도해 주세요.");
      } finally {
        busy.current = false;
      }
    });
  }

  const source = camera ? "사진 찍기" : "앨범에서 고르기";
  const single = !listOpen && photos.length === 1 ? photos[0] : undefined;
  const singleFailure = single?.state.kind === "failed" ? single.state.failure : null;
  const failure = jobFailure ?? singleFailure;
  const failed = photos.filter((photo) => photo.state.kind === "failed").length;
  const waiting = photos.some(
    (photo) => photo.state.kind === "waiting" || photo.state.kind === "reading",
  );
  const readingTitle =
    waiting || failed === 0
      ? `사진 ${String(photos.length)}장 중 ${String(read.length)}장 읽음`
      : `사진 ${String(failed)}장을 읽지 못했어요`;
  const vocabulary =
    candidates.length > 0 && candidates.every((card) => card.kind === "vocabulary");
  const title = failure
    ? source
    : single
      ? "카드를 찾고 있어요"
      : unfinished || photos.length === 0
        ? readingTitle
        : vocabulary
          ? "단어를 찾았어요"
          : `카드 ${String(candidates.length)}장을 만들었어요`;

  return (
    <AuthoringSheet title={title} close={unfinished && !failure ? cancel : leave}>
      {failure ? (
        <div className="flex min-w-0 flex-col">
          <div className="flex flex-col items-center gap-4 py-10">
            <Mascot expression="sad" className="size-mascot-medium" />
            <p aria-live="polite" className="text-center text-body-strong break-keep">
              {describeFailure(failure)}
            </p>
          </div>
          {note && !jobFailure && (
            <p className="pb-4 text-center text-body break-keep text-ink-2">{note}</p>
          )}
          {(isRetakeable(failure) || (single && isRetryable(failure))) && (
            <div className="sticky -bottom-4 flex gap-3 bg-ground pt-3 pb-7">
              {isRetakeable(failure) && (
                <PhotoPicker
                  label={camera ? "다시 찍기" : "다른 사진 고르기"}
                  camera={camera}
                  multiple={false}
                  primary={!(single && isRetryable(failure))}
                  pick={replace}
                />
              )}
              {single && isRetryable(failure) && (
                <button
                  type="button"
                  onClick={() => {
                    retry(single);
                  }}
                  className="pressable min-h-cta flex-1 rounded-button bg-primary px-4 text-button text-on-primary"
                >
                  다시 시도
                </button>
              )}
            </div>
          )}
        </div>
      ) : single ? (
        <div className="flex min-w-0 flex-col gap-5">
          <div className="flex items-center gap-4">
            <Thumbnail url={single.url} className="h-24 w-18" />
            <div
              role="progressbar"
              aria-label="카드를 찾고 있어요"
              className="h-2 flex-1 overflow-hidden rounded-full bg-edge"
            >
              <div className="h-full w-full rounded-full bg-accent motion-safe:animate-skeleton" />
            </div>
            <Mascot expression="thinking" className="size-mascot-guide shrink-0" />
          </div>
          {note && <p className="text-body break-keep text-ink-2">{note}</p>}
          <div aria-hidden className="flex flex-col gap-row-gap">
            {[0, 1, 2, 3].map((row) => (
              <div
                key={row}
                className="flex gap-4 rounded-group bg-surface p-5 motion-safe:animate-skeleton"
              >
                <span className="h-3 w-[35%] rounded-full bg-hairline" />
                <span className="ml-auto h-3 w-[25%] rounded-full bg-hairline" />
              </div>
            ))}
          </div>
          <p className="text-center text-caption break-keep text-muted">{privacyNote}</p>
          <CancelBar cancel={cancel} />
        </div>
      ) : unfinished ? (
        <div className="flex min-w-0 flex-col gap-5">
          <p role="status" className="sr-only">
            {readingTitle}
          </p>
          <div className="flex items-center gap-4">
            <div aria-hidden className="h-2 flex-1 overflow-hidden rounded-full bg-edge">
              <div
                className="h-full rounded-full bg-accent transition-[width]"
                style={{
                  width: `${String(photos.length ? (100 * read.length) / photos.length : 0)}%`,
                }}
              />
            </div>
            {waiting && failed === 0 && (
              <Mascot expression="thinking" className="size-mascot-guide shrink-0" />
            )}
          </div>
          {note && <p className="text-body break-keep text-ink-2">{note}</p>}
          <ul className="flex flex-col gap-row-gap">
            {photos.map((photo, at) => (
              <PhotoRow
                key={photo.id}
                photo={photo}
                number={at + 1}
                retry={() => {
                  retry(photo);
                }}
                drop={() => {
                  remove((item) => item.id !== photo.id);
                  // With every photo left out, the screen closes.
                  if (!photosRef.current.length) close();
                }}
              />
            ))}
          </ul>
          <p className="text-center text-caption break-keep text-muted">{privacyNote}</p>
          <CancelBar
            cancel={cancel}
            retryFailed={
              photos.some(
                (photo) => photo.state.kind === "failed" && isRetryable(photo.state.failure),
              )
                ? retryFailed
                : undefined
            }
          />
        </div>
      ) : (
        <div className="flex min-w-0 flex-col">
          <ImportList
            groups={groups}
            deckName={target === "new" ? null : deck.name}
            chooseDeck={() => {
              setChoosing(true);
            }}
            formOf={formOf}
            changeForm={(section, form) => {
              setForms({ ...forms, [section.id]: form });
            }}
            collapsed={collapsed}
            toggleGroup={(id) => {
              const next = new Set(collapsed);
              if (!next.delete(id)) next.add(id);
              setCollapsed(next);
            }}
            included={included}
            inDeck={inDeck}
            toggleCard={(card, section) => {
              changeCandidate({ ...card, selected: !included(card, section) });
            }}
            toggleSection={toggleSection}
            edit={(card, section) => {
              // An edit keeps the row as it was, so an edited duplicate is not left out.
              setEditing({ ...structuredClone(card), selected: included(card, section) });
            }}
          />
          {photos.length < maxPhotos && (
            <div className="flex pt-6">
              <PhotoPicker
                label="사진 더 추가"
                icon
                camera={false}
                multiple
                primary={false}
                disabled={pending}
                pick={(chosen) => {
                  void addBatch(chosen);
                }}
              />
            </div>
          )}
          {message && !naming && (
            <p role="alert" className="pt-4 text-caption break-keep text-dont-know-text">
              {message}
            </p>
          )}
          <div className="sticky -bottom-4 mt-4 bg-ground pt-3 pb-7">
            <button
              type="button"
              disabled={pending || toSave.length === 0}
              onClick={add}
              className="pressable min-h-cta w-full rounded-button bg-primary px-4 text-button text-on-primary disabled:opacity-50"
            >
              {pending ? "저장 중" : `카드 ${String(cardCount)}장 추가`}
            </button>
          </div>
        </div>
      )}
      {choosing && (
        <AuthoringSheet
          title="추가할 노트"
          close={() => {
            setChoosing(false);
          }}
        >
          <div
            role="radiogroup"
            aria-label="추가할 노트"
            className="divide-y divide-hairline overflow-hidden rounded-group bg-surface"
          >
            {[deck, { id: "new", name: "새 노트" }].map((item) => (
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-checked={item.id === target}
                disabled={created}
                onClick={() => {
                  chooseTarget(item.id);
                }}
                className="pressable flex min-h-button w-full items-center gap-3 px-4 py-3 text-left text-body break-keep disabled:opacity-50"
              >
                <span className="min-w-0 flex-1">{item.name}</span>
                {item.id === target && (
                  <Check aria-hidden className="size-small-icon shrink-0 text-ink" />
                )}
              </button>
            ))}
          </div>
        </AuthoringSheet>
      )}
      {naming && (
        <AuthoringSheet
          title="새 노트"
          close={() => {
            if (!busy.current) setNaming(false);
          }}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
            className="flex flex-col gap-4"
          >
            <label className="text-section text-muted">
              이름
              <input
                autoFocus
                required
                maxLength={500}
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                }}
                className="mt-2 min-h-field w-full rounded-field border border-outline bg-surface px-4 text-body text-ink focus:outline-2 focus:outline-ink"
              />
            </label>
            {message && (
              <p role="alert" className="text-caption break-keep text-dont-know-text">
                {message}
              </p>
            )}
            <button
              disabled={pending || !name.trim()}
              className="pressable min-h-cta rounded-button bg-primary px-5 text-button text-on-primary disabled:opacity-50"
            >
              {pending ? "만드는 중" : "만들기"}
            </button>
          </form>
        </AuthoringSheet>
      )}
      {editing && (
        <AuthoringSheet
          title="카드 편집"
          close={() => {
            setEditing(null);
          }}
        >
          <CardFields
            draft={editing}
            change={(draft) => {
              setEditing({ ...editing, ...draft });
            }}
          />
          <button
            type="button"
            onClick={() => {
              changeCandidate(editing);
              setEditing(null);
            }}
            className="pressable mt-5 min-h-cta w-full rounded-button bg-primary text-button text-on-primary"
          >
            완료
          </button>
        </AuthoringSheet>
      )}
      {discarding && (
        <AuthoringSheet
          title="찾은 카드를 버릴까요?"
          close={() => {
            setDiscarding(false);
          }}
        >
          <p className="text-secondary break-keep text-muted">
            찾은 카드 {candidates.length}장이 사라져요. 다시 읽으면 오늘 사진 한도가 다시 쓰여요.
          </p>
          <div className="mt-4 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => {
                setDiscarding(false);
              }}
              className="pressable min-h-button text-body"
            >
              취소
            </button>
            <button
              type="button"
              onClick={close}
              className="pressable min-h-button rounded-button bg-dont-know text-button text-on-ink"
            >
              버리기
            </button>
          </div>
        </AuthoringSheet>
      )}
    </AuthoringSheet>
  );
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

/** A prepared photo's thumbnail, drawn upright; a photo the browser cannot show is its hairline. */
function Thumbnail({ url, className }: { url: string; className: string }) {
  return (
    <span
      aria-hidden
      className={`${className} block shrink-0 rounded-button bg-hairline bg-cover bg-center`}
      style={{ backgroundImage: `url(${url})` }}
    />
  );
}

/** "취소" at the bottom of the reading screens, and "실패한 사진 다시 시도" beside it while one can be sent again. */
function CancelBar({ cancel, retryFailed }: { cancel: () => void; retryFailed?: () => void }) {
  return (
    <div className="sticky -bottom-4 flex gap-3 bg-ground pt-3 pb-7">
      <button
        type="button"
        onClick={cancel}
        className="pressable min-h-cta flex-1 rounded-button bg-surface px-4 text-button"
      >
        취소
      </button>
      {retryFailed && (
        <button
          type="button"
          onClick={retryFailed}
          className="pressable min-h-cta flex-[2] rounded-button bg-primary px-4 text-button break-keep text-on-primary"
        >
          실패한 사진 다시 시도
        </button>
      )}
    </div>
  );
}

/** One photo: its thumbnail, "사진 n" and its state in words with an icon; a failed one its actions. */
function PhotoRow({
  photo,
  number,
  retry,
  drop,
}: {
  photo: Photo;
  number: number;
  retry: () => void;
  drop: () => void;
}) {
  const { state } = photo;
  const status =
    state.kind === "waiting"
      ? "기다리는 중"
      : state.kind === "reading"
        ? "읽는 중"
        : state.kind === "read"
          ? `카드 ${String(state.cards.length)}장`
          : describeFailure(state.failure);
  // Green means 안다 alone: a photo read is ink, its words saying so.
  const icon =
    state.kind === "waiting" ? (
      <Clock aria-hidden className="size-small-icon shrink-0 text-muted" />
    ) : state.kind === "reading" ? (
      <LoaderCircle
        aria-hidden
        className="size-small-icon shrink-0 text-ink motion-safe:animate-spin"
      />
    ) : state.kind === "read" ? (
      <Check aria-hidden className="size-small-icon shrink-0 text-ink" />
    ) : (
      <CircleAlert aria-hidden className="size-small-icon shrink-0 text-dont-know" />
    );
  return (
    <li className="flex min-w-0 flex-col gap-3 rounded-group bg-surface p-3">
      <div className="flex items-center gap-3">
        <Thumbnail url={photo.url} className="h-16 w-12" />
        <p className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-body-strong">사진 {number}</span>
          <span
            aria-live={state.kind === "failed" ? "polite" : undefined}
            className={`text-body break-keep ${state.kind === "failed" ? "text-ink" : "text-ink-2"}`}
          >
            {status}
          </span>
        </p>
        {icon}
      </div>
      {state.kind === "failed" && (
        <div className="flex gap-2">
          {isRetryable(state.failure) && (
            <button
              type="button"
              aria-label={`사진 ${String(number)} 다시 시도`}
              onClick={retry}
              className="pressable min-h-button flex-1 rounded-button bg-surface px-3 text-button"
            >
              다시 시도
            </button>
          )}
          <button
            type="button"
            aria-label={`사진 ${String(number)} 빼기`}
            onClick={drop}
            className="pressable min-h-button flex-1 rounded-button bg-surface px-3 text-button"
          >
            빼기
          </button>
        </div>
      )}
    </li>
  );
}

/** A file picker drawn as a button: any image, which the browser then prepares as JPEG. */
function PhotoPicker({
  label,
  camera,
  multiple,
  primary,
  pick,
  icon = false,
  disabled = false,
}: {
  label: string;
  camera: boolean;
  multiple: boolean;
  primary: boolean;
  pick: (files: File[]) => void;
  icon?: boolean;
  disabled?: boolean;
}) {
  return (
    <label
      className={`pressable flex min-h-cta flex-1 cursor-pointer items-center justify-center gap-2 rounded-button px-4 text-button focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ink ${primary ? "bg-primary text-on-primary" : "bg-surface"}`}
    >
      {icon && <ImagePlus aria-hidden className="size-small-icon" />}
      {label}
      <input
        type="file"
        accept="image/*"
        capture={camera ? "environment" : undefined}
        multiple={multiple}
        disabled={disabled}
        onChange={(event) => {
          const chosen = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
          // A cancelled picker opens nothing and shows no error.
          if (chosen.length) pick(chosen);
        }}
        className="sr-only"
      />
    </label>
  );
}
