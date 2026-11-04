"use client";

import { Check, CircleAlert, Clock, ImagePlus, LoaderCircle } from "lucide-react";
import { describeFailure, isRetryable, type PhotoFailure } from "../photo-failure";
import type { Photo } from "../hooks/use-photo-reading";
import { Mascot } from "@/design/brand";
import { buttonClass } from "@/design/button";

const privacyNote = "사진은 카드를 만드는 데만 쓰고 서버에 남기지 않아요";
/** The web's job lives in the tab, so the reading screens say what ends it. */
const tabNote = "이 탭을 닫거나 새로 고치면 읽기를 멈춰요";

/** The failure screen, as the phone's: the mascot over [failure] in words, then any [note]. */
export function ReadingFailure({ failure, note }: { failure: PhotoFailure; note: string }) {
  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex flex-col items-center gap-4 py-10">
        <Mascot expression="sad" className="size-mascot-medium" />
        <p aria-live="polite" className="text-center text-body-strong break-keep">
          {describeFailure(failure)}
        </p>
      </div>
      {note && <p className="pb-4 text-center text-body break-keep text-ink-2">{note}</p>}
    </div>
  );
}

/** One photo being read: its thumbnail beside [title], a busy bar and the rows still to come. */
export function SingleReading({
  photo,
  title,
  note,
}: {
  photo: Photo;
  title: string;
  note: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex items-center gap-4">
        <Thumbnail url={photo.url} className="h-24 w-18" />
        {/* The dialog's own heading names the screen; this draws it, as the phone's row. */}
        <p aria-hidden className="min-w-0 flex-1 text-title break-keep">
          {title}
        </p>
        <Mascot expression="thinking" className="size-mascot-guide shrink-0" />
      </div>
      <div
        role="progressbar"
        aria-label="카드를 찾고 있어요"
        className="h-2 overflow-hidden rounded-full bg-edge"
      >
        <div className="h-full w-full rounded-full bg-accent motion-safe:animate-skeleton" />
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
      <p className="text-center text-caption break-keep text-muted">{tabNote}</p>
    </div>
  );
}

/**
 * Several photos being read: [title] announced, a bar of the [read] share, the mascot while photos
 * are [waiting] and none failed, then a row per photo, whose failed ones [retry] or [drop].
 */
export function ReadingList({
  photos,
  read,
  waiting,
  failed,
  title,
  note,
  retry,
  drop,
}: {
  photos: Photo[];
  read: number;
  waiting: boolean;
  failed: number;
  title: string;
  note: string;
  retry: (photo: Photo) => void;
  drop: (photo: Photo) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-5 pt-4">
      <p role="status" className="sr-only">
        {title}
      </p>
      <div className="flex items-center gap-4">
        <div aria-hidden className="h-2 flex-1 overflow-hidden rounded-full bg-edge">
          <div
            className="h-full rounded-full bg-accent transition-[width]"
            style={{
              width: `${String(photos.length ? (100 * read) / photos.length : 0)}%`,
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
              drop(photo);
            }}
          />
        ))}
      </ul>
      <p className="text-center text-caption break-keep text-muted">{privacyNote}</p>
      <p className="text-center text-caption break-keep text-muted">{tabNote}</p>
    </div>
  );
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

/** "취소" at the foot of the reading screens, and "실패한 사진 다시 시도" beside it while one can be sent again. */
export function CancelBar({
  cancel,
  retryFailed,
}: {
  cancel: () => void;
  retryFailed?: () => void;
}) {
  return (
    <div className="flex gap-3">
      <button
        type="button"
        onClick={cancel}
        className={`${buttonClass("secondary", "cta")} flex-1`}
      >
        취소
      </button>
      {retryFailed && (
        <button
          type="button"
          onClick={retryFailed}
          className={`${buttonClass("primary", "cta")} flex-[2]`}
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
              className={`${buttonClass("secondary")} flex-1`}
            >
              다시 시도
            </button>
          )}
          <button
            type="button"
            aria-label={`사진 ${String(number)} 빼기`}
            onClick={drop}
            className={`${buttonClass("secondary")} flex-1`}
          >
            빼기
          </button>
        </div>
      )}
    </li>
  );
}

/** A file picker drawn as a button: any image, which the browser then prepares as JPEG. */
export function PhotoPicker({
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
    <label className={`${buttonClass(primary ? "primary" : "secondary", "cta")} flex-1`}>
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
