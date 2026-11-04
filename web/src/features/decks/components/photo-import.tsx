"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { v7 } from "uuid";
import { createDeck, savePhotoCards } from "../actions";
import { isRetakeable, isRetryable } from "../photo-failure";
import type { Candidate } from "../photo-candidates";
import type { Deck } from "../library";
import { rememberForms, type Section, sectionsOf } from "../section-form";
import { maxPhotos, usePhotoReading } from "../hooks/use-photo-reading";
import { usePhotoReview } from "../hooks/use-photo-review";
import { leaveThen } from "@/design/use-back-entry";
import { buttonClass } from "@/design/button";
import { Confirm } from "@/design/confirm";
import { AuthoringScreen } from "./authoring-sheet";
import { CardEditSheet } from "./card-fields";
import { ImportBar } from "./import-bar";
import { ImportList } from "./import-list";
import { NewTargetSheet, TargetSheet } from "./import-target";
import {
  CancelBar,
  PhotoPicker,
  ReadingFailure,
  ReadingList,
  SingleReading,
} from "./photo-reading";
import { RowMenu } from "./row-menu";

/**
 * A browser-bound photo job drawn as the phone's photo import: one photo at 카드를 찾고 있어요 or
 * its failure, several at 사진 n장 중 k장 읽음 with a row per photo, then the list to review, whose
 * cards go into [deck] or a new deck. While photo import is unavailable, [addInstead] leaves it for
 * adding [deck]'s cards by hand or from a spreadsheet. It reads on while not [shown], drawn then as
 * the bar at the top of the page, which [open] shows it from; its close and the browser's back
 * [hide] it while photos are left to read, and [close] ends it (ADR 0183).
 */
export function PhotoImport({
  deck,
  camera,
  files,
  shown,
  open,
  hide,
  close,
  addInstead,
}: {
  deck: Deck;
  camera: boolean;
  files: File[];
  shown: boolean;
  open: () => void;
  hide: () => void;
  close: () => void;
  addInstead: (way: "manual" | "file") => void;
}) {
  const [message, setMessage] = useState("");
  const {
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
  } = usePhotoReading(files, setMessage);
  const [name, setName] = useState("");
  const [naming, setNaming] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [editing, setEditing] = useState<Candidate | null>(null);
  // What 버리기 goes on to do once the found cards may go; null while nothing asks.
  const [discarding, setDiscarding] = useState<(() => void) | null>(null);
  const retakeInput = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const busy = useRef(false);
  const newDeckId = useRef(v7());
  const [created, setCreated] = useState(false);
  const router = useRouter();

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
  const {
    target,
    chooseTarget,
    formOf,
    changeForm,
    inDeck,
    included,
    toSave,
    cardCount,
    collapsed,
    toggleGroup,
  } = usePhotoReview(deck.id, sections);
  // Does [then] at once, or once the user agrees that the found cards go.
  function discardThen(then: () => void) {
    if (candidates.length) setDiscarding(() => then);
    else then();
  }
  function leave() {
    discardThen(close);
  }
  function cancel() {
    if (listOpen) remove((photo) => photo.state.kind === "read");
    else leave();
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
        leaveThen(() => {
          close();
          router.push(`/decks/${deckId}`);
        });
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
  // Unavailable for the one photo, or for every photo of the batch, as the phone's: the photos
  // chosen first, or those added to an open list and not read.
  const batch = listOpen ? photos.filter((photo) => photo.state.kind !== "read") : photos;
  const unavailable = failure
    ? failure.kind === "unavailable"
    : batch.length > 0 &&
      batch.every(
        (photo) => photo.state.kind === "failed" && photo.state.failure.kind === "unavailable",
      );
  const insteadBar = unavailable && (
    <div className="flex gap-3">
      {(["file", "manual"] as const).map((way) => (
        <button
          key={way}
          type="button"
          onClick={() => {
            discardThen(() => {
              addInstead(way);
            });
          }}
          className={`${buttonClass(way === "manual" ? "primary" : "secondary", "cta")} flex-1`}
        >
          {way === "manual" ? "직접 입력" : "엑셀·CSV 파일"}
        </button>
      ))}
    </div>
  );
  // The phone's ⋯ on a list read from one photo: its retake, asking first once cards are found.
  const retakeMenu = listOpen && !unfinished && photos.length === 1 && (
    <RowMenu
      label="사진 작업"
      trigger="pressable flex size-tap-target shrink-0 items-center justify-center rounded-button text-ink focus-visible:outline-2 focus-visible:outline-ink"
      items={[
        {
          label: camera ? "다시 찍기" : "다시 선택",
          pick: () => {
            discardThen(() => retakeInput.current?.click());
          },
        },
      ]}
    />
  );
  const failed = photos.filter((photo) => photo.state.kind === "failed").length;
  const waiting = photos.some(
    (photo) => photo.state.kind === "waiting" || photo.state.kind === "reading",
  );
  // A job with only failed photos, and no list, is dismissed on leaving, as nothing is left to
  // read (#690); any other with photos left to read is left reading.
  const dismissed =
    jobFailure !== null ||
    (!listOpen && photos.length > 0 && photos.every((photo) => photo.state.kind === "failed"));
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

  const actions = insteadBar ? (
    insteadBar
  ) : failure ? (
    (isRetakeable(failure) || (single && isRetryable(failure))) && (
      <div className="flex gap-3">
        {isRetakeable(failure) && (
          <PhotoPicker
            label={camera ? "다시 찍기" : "다시 선택"}
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
            className={`${buttonClass("primary", "cta")} flex-1`}
          >
            다시 시도
          </button>
        )}
      </div>
    )
  ) : single ? (
    <CancelBar cancel={cancel} />
  ) : unfinished ? (
    <CancelBar
      cancel={cancel}
      retryFailed={
        photos.some((photo) => photo.state.kind === "failed" && isRetryable(photo.state.failure))
          ? retryFailed
          : undefined
      }
    />
  ) : (
    <button
      type="button"
      disabled={pending || toSave.length === 0}
      onClick={add}
      className={`${buttonClass("primary", "cta")} w-full`}
    >
      {pending ? "저장 중" : `카드 ${String(cardCount)}장 추가`}
    </button>
  );

  if (!shown) {
    const label = waiting
      ? `사진 읽는 중 ${String(read.length)}/${String(photos.length)}`
      : jobFailure
        ? "사진을 읽지 못했어요"
        : unfinished
          ? `사진 ${String(failed)}장을 읽지 못했어요`
          : `카드 ${String(cardCount)}장 확인하기`;
    return (
      <ImportBar
        label={label}
        progress={waiting && photos.length ? read.length / photos.length : null}
        open={open}
      />
    );
  }

  return (
    <AuthoringScreen
      title={title}
      // The phone heads each of these screens' content, and its failure screen has no title.
      // The phone heads these screens' content: one photo's title in the row beside its
      // thumbnail, which the screen draws itself, and its failure screen has no title.
      heading={failure || single ? "none" : "body"}
      menu={retakeMenu}
      actions={actions}
      close={unfinished && !dismissed ? hide : leave}
    >
      <input
        ref={retakeInput}
        type="file"
        accept="image/*"
        capture={camera ? "environment" : undefined}
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          const chosen = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
          if (!chosen.length) return;
          retake(chosen);
        }}
        className="sr-only"
      />
      {failure ? (
        <ReadingFailure failure={failure} note={jobFailure ? "" : note} />
      ) : single ? (
        <SingleReading photo={single} title={title} note={note} />
      ) : unfinished ? (
        <ReadingList
          photos={photos}
          read={read.length}
          waiting={waiting}
          failed={failed}
          title={readingTitle}
          note={note}
          retry={retry}
          drop={(photo) => {
            // With every photo left out, the screen closes.
            if (!remove((item) => item.id !== photo.id).length) close();
          }}
        />
      ) : (
        <div className="flex min-w-0 flex-col">
          <ImportList
            groups={groups}
            deckName={target === "new" ? null : deck.name}
            chooseDeck={() => {
              setChoosing(true);
            }}
            formOf={formOf}
            changeForm={changeForm}
            collapsed={collapsed}
            toggleGroup={toggleGroup}
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
        </div>
      )}
      {choosing && (
        <TargetSheet
          deck={deck}
          target={target}
          created={created}
          choose={(next) => {
            chooseTarget(next);
            setChoosing(false);
          }}
          close={() => {
            setChoosing(false);
          }}
        />
      )}
      {naming && (
        <NewTargetSheet
          name={name}
          rename={setName}
          message={message}
          pending={pending}
          create={save}
          close={() => {
            if (!busy.current) setNaming(false);
          }}
        />
      )}
      {editing && (
        <CardEditSheet
          card={editing}
          done={(card) => {
            changeCandidate(card);
            setEditing(null);
          }}
          close={() => {
            setEditing(null);
          }}
        />
      )}
      {discarding && (
        <Confirm
          title="찾은 카드를 버릴까요?"
          consequence={`찾은 카드 ${String(candidates.length)}장이 사라져요. 다시 읽으면 오늘 사진 한도가 다시 쓰여요.`}
          confirmLabel="버리기"
          destructive
          onConfirm={() => {
            setDiscarding(null);
            discarding();
          }}
          close={() => {
            setDiscarding(null);
          }}
        />
      )}
    </AuthoringScreen>
  );
}
