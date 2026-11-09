"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { v5, v7 } from "uuid";
import { createDeck, saveAnkiCards, storeCardMedia } from "../actions";
import { cellsOf, imagesOf, importedDeck, type ImportedDeck, type Photo } from "../anki-cards";
import type { AnkiPackage } from "../anki-package";
import { encodeCells, type Block } from "../authoring";
import { prepareImage } from "../prepare-image";
import { leaveThen } from "@/design/use-back-entry";
import { buttonClass } from "@/design/button";
import { Confirm } from "@/design/confirm";
import { Sheet } from "@/design/sheet";
import { AuthoringScreen } from "./authoring-sheet";

type Opened = { name: string; pkg: AnkiPackage; decks: ImportedDeck[] };
/** The most cards one save request carries, `saveAnkiCards`' own bound. */
const batch = 100;
/** The most characters of cards one request carries, under the server's 1,000,000. */
const batchChars = 900_000;

const notSaved = "카드를 저장하지 못했어요. 다시 시도해 주세요.";

/** [cards] in requests of at most [batch] cards and [batchChars] characters. */
function batches<T extends { blocks: Block[] }>(cards: T[]): T[][] {
  const parts: T[][] = [];
  let size = 0;
  for (const card of cards) {
    const length = JSON.stringify(card).length;
    const last = parts[parts.length - 1];
    if (last && last.length < batch && size + length <= batchChars) {
      last.push(card);
      size += length;
    } else {
      parts.push([card]);
      size = length;
    }
  }
  return parts;
}

/**
 * An Anki `.apkg` read in the browser, one note per Anki deck, written only once the user has
 * reviewed what it holds (ADR 0222).
 */
export function AnkiImport({ close }: { close: () => void }) {
  const [opened, setOpened] = useState<Opened | null>(null);
  const [opening, setOpening] = useState(false);
  const [message, setMessage] = useState("");
  const [duplicate, setDuplicate] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  // Set once the write is done and something was left out: the notes made, and what the user is told.
  const [done, setDone] = useState<{ ids: string[]; left: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [pending, start] = useTransition();
  const busy = useRef(false);
  const [job] = useState(() => v7());
  // What a retry does not do again: the notes made, the photos stored, the cards written.
  const made = useRef(new Set<string>());
  const photos = useRef(new Map<string, Photo | null>());
  const written = useRef(new Set<string>());
  const router = useRouter();

  const cards = opened?.decks.reduce((sum, deck) => sum + deck.cards.length, 0) ?? 0;
  const converted = opened?.decks.reduce((sum, deck) => sum + deck.converted, 0) ?? 0;
  const skipped = opened?.decks.reduce((sum, deck) => sum + deck.skipped, 0) ?? 0;

  async function open(file: File) {
    setOpening(true);
    setMessage("");
    try {
      const { openAnkiPackage } = await import("../anki-package");
      const pkg = await openAnkiPackage(file);
      if ("refused" in pkg) {
        setMessage(pkg.refused);
        return;
      }
      const decks = pkg.decks.map(importedDeck).filter((deck) => deck.cards.length > 0);
      if (decks.length === 0) {
        setMessage("카드로 만들 수 있는 노트가 없어요. 앞면과 뒷면이 있는 노트를 내보내 주세요.");
        return;
      }
      setOpened({ name: file.name, pkg, decks });
    } catch {
      setMessage("Anki 패키지를 읽지 못했어요. 다시 골라 주세요.");
    } finally {
      setOpening(false);
    }
  }

  /** The sentence for the photos the import could not read or prepare and the cards left without them; "" when none. */
  function leftOut(decks: ImportedDeck[]): string {
    const photosLeft = imagesOf(decks).filter((name) => photos.current.get(name) === null).length;
    const cardsLeft = decks.reduce(
      (sum, deck) => sum + deck.cards.filter((card) => !cellsOf(card, photos.current)).length,
      0,
    );
    if (photosLeft === 0 && cardsLeft === 0) return "";
    const why = photosLeft > 0 ? `사진 ${String(photosLeft)}장을 읽지 못해 ` : "";
    return cardsLeft > 0
      ? `${why}카드 ${String(cardsLeft)}장은 추가하지 못했어요.`
      : `${why}카드에 넣지 못했어요.`;
  }

  /** Stores the photos a note's cards show once each, as photo import stores one; false on a failed store. */
  async function store(pkg: AnkiPackage, deck: ImportedDeck): Promise<boolean> {
    for (const name of imagesOf([deck])) {
      if (photos.current.has(name)) continue;
      const bytes = pkg.readMedia(name);
      const image = bytes && (await prepareImage(new Blob([bytes as BlobPart]), "whole"));
      if (!image) {
        photos.current.set(name, null);
        continue;
      }
      const media = v5(image.sha256, job);
      const form = new FormData();
      form.set("media", media);
      form.set("kind", "image");
      form.set("file", image.jpeg);
      form.set("sha256", image.sha256);
      const stored = await storeCardMedia(form);
      if (!stored.stored) {
        setMessage(stored.message);
        return false;
      }
      photos.current.set(name, { media, width: image.width, height: image.height });
    }
    return true;
  }

  function save(allowDuplicate: boolean) {
    if (busy.current || !opened) return;
    busy.current = true;
    setMessage("");
    setDuplicate(false);
    setSaving(true);
    start(async () => {
      try {
        const { pkg, decks } = opened;
        const ids: string[] = [];
        for (const deck of decks) {
          const deckId = v5(`deck:${deck.name}`, job);
          if (!made.current.has(deckId)) {
            const created = await createDeck(deckId, deck.name);
            if (!created.saved) {
              setMessage(created.message);
              return;
            }
            made.current.add(deckId);
          }
          ids.push(deckId);
          if (!(await store(pkg, deck))) return;
          const pendingCards = deck.cards.flatMap((card) => {
            const id = v5(`${deck.name}:${String(card.noteId)}`, job);
            const cells = written.current.has(id) ? null : cellsOf(card, photos.current);
            return cells ? [{ id, blocks: encodeCells(cells) }] : [];
          });
          for (const part of batches(pendingCards)) {
            const result = await saveAnkiCards(deckId, part, allowDuplicate);
            if (!result.saved) {
              setDuplicate(result.duplicate !== undefined);
              setMessage(
                result.duplicate !== undefined
                  ? `'${deck.name}'에 앞면이 같은 카드가 있어요`
                  : result.message,
              );
              return;
            }
            for (const { id } of part) written.current.add(id);
          }
        }
        const left = leftOut(decks);
        if (left) setDone({ ids, left });
        else finish(ids);
      } catch {
        setMessage(notSaved);
      } finally {
        busy.current = false;
        setSaving(false);
      }
    });
  }

  /** Closes the sheet and shows the notes made: the one note's page, or the list again. */
  function finish(ids: string[]) {
    leaveThen(() => {
      close();
      if (ids.length === 1) router.push(`/decks/${ids[0] ?? ""}`);
      else router.refresh();
    });
  }

  function leave() {
    if (busy.current) return;
    if (done) {
      finish(done.ids);
      return;
    }
    if (opened && written.current.size === 0) setDiscarding(true);
    else close();
  }

  const status = message && (
    <div className="flex flex-col gap-1">
      <p role="alert" className="text-caption break-keep text-dont-know">
        {message}
      </p>
      {duplicate && (
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            save(true);
          }}
          className="pressable min-h-tap-target self-start px-2 text-body"
        >
          그래도 추가
        </button>
      )}
    </div>
  );

  if (!opened)
    return (
      <Sheet title="Anki에서 노트 가져오기" close={close}>
        <div className="flex min-w-0 flex-col gap-4">
          <p className="text-secondary break-keep text-muted">
            Anki에서 내보낸 .apkg 파일의 Anki 묶음 하나가 노트 하나가 돼요. 파일은 100MB, 묶음마다
            노트 1,000개까지 읽어요.
          </p>
          <label className={`${buttonClass("primary", "cta")} ${opening ? "opacity-50" : ""}`}>
            {opening ? "읽는 중" : "파일 고르기"}
            <input
              aria-label="파일 고르기"
              type="file"
              accept=".apkg"
              disabled={opening}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file) void open(file);
              }}
              className="sr-only"
            />
          </label>
          {status}
        </div>
      </Sheet>
    );
  return (
    <AuthoringScreen
      title="노트 확인"
      heading="body"
      close={leave}
      actions={
        <button
          type="button"
          disabled={saving || pending}
          onClick={() => {
            if (done) finish(done.ids);
            else save(false);
          }}
          className={`${buttonClass("primary", "cta")} w-full`}
        >
          {done
            ? "확인"
            : saving
              ? "저장 중"
              : `노트 ${String(opened.decks.length)}개, 카드 ${String(cards)}장 추가`}
        </button>
      }
    >
      <div className="flex min-w-0 flex-col gap-4">
        <p className="min-w-0 truncate text-body-strong text-muted">{opened.name}</p>
        <ul className="flex flex-col gap-2">
          {opened.decks.map((deck) => (
            <li key={deck.name} className="flex min-w-0 justify-between gap-3 text-body">
              <span className="min-w-0 truncate">{deck.name}</span>
              <span className="shrink-0 text-muted">카드 {deck.cards.length}장</span>
            </li>
          ))}
        </ul>
        {converted > 0 && (
          <p className="text-caption break-keep text-muted">
            기본·빈칸 노트가 아닌 노트에서 바꾼 카드가 {converted}장 있어요. 첫 두 칸을 앞면과
            뒷면으로 읽었어요.
          </p>
        )}
        {skipped > 0 && (
          <p className="text-caption break-keep text-muted">
            앞면이나 뒷면이 비어서 카드로 만들지 못한 노트가 {skipped}개 있어요.
          </p>
        )}
        {done && (
          <p role="status" className="text-caption break-keep text-dont-know">
            {`카드를 추가했어요. ${done.left}`}
          </p>
        )}
        {status}
      </div>
      {discarding && (
        <Confirm
          title="읽은 노트를 버릴까요?"
          consequence="저장하지 않은 카드는 사라져요."
          confirmLabel="버리기"
          destructive
          onConfirm={close}
          close={() => {
            setDiscarding(false);
          }}
        />
      )}
    </AuthoringScreen>
  );
}
