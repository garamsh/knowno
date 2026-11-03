"use client";

import { Camera, ImageIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";

import { type DeckIcon, deckIconNames, deckIcons } from "../deck-icon";
import type { DeckColor } from "../deck-tint";
import { prepareImage, type PreparedImage } from "../prepare-image";
import { DeckColorPicker } from "./deck-color-picker";
import { IconDrawing, type Tile } from "./deck-tile";

/** The photo a look holds: the deck's own, none, or one picked and not yet stored. */
export type Photo =
  { kind: "stored" } | { kind: "none" } | { kind: "picked"; image: PreparedImage; url: string };

/** A deck's look while it is chosen, as the phone's `DeckLook`. */
export type Look = { icon: DeckIcon; color: DeckColor | undefined; photo: Photo };

/** The tile [look] draws, a stored photo being [stored]'s, for the tile's preview. */
export function lookedTile(look: Look, stored?: string): Tile {
  const { photo } = look;
  return {
    icon: look.icon,
    color: look.color,
    imageUrl: photo.kind === "picked" ? photo.url : photo.kind === "stored" ? stored : undefined,
  };
}

/** [look]'s photo as a form's `image` and `sha256`, as `decorateDeck` reads them. */
export function setPhoto(form: FormData, photo: Photo) {
  if (photo.kind === "picked") {
    form.set("image", photo.image.jpeg, "image.jpg");
    form.set("sha256", photo.image.sha256);
  } else form.set("image", photo.kind === "stored" ? "keep" : "remove");
}

const secondary =
  "pressable flex min-h-button w-full cursor-pointer items-center justify-center gap-2 rounded-button bg-surface px-4 text-button focus-within:outline-2 focus-within:outline-ink";

/**
 * The choices of a deck's look, as the phone's `DeckAppearanceFields` and 노트 꾸미기 and 새 노트
 * offer them, each a group: "아이콘", the fourteen icons in the app's order; "색", the four offered
 * colours; and "사진", "앨범에서 고르기" and "사진 찍기", each the browser's picker of one image,
 * cropped to its centred square. While [look] holds a photo the icon and colour fold, and "사진"
 * offers "다른 사진" and "사진 빼기". Each choice hands the new look to [change]; a photo the browser
 * cannot decode says so under the photo's buttons, where [problem], the caller's failure, shows too.
 */
export function DeckAppearanceFields({
  look,
  change,
  busy,
  problem,
}: {
  look: Look;
  change: (look: Look) => void;
  busy: boolean;
  problem?: string;
}) {
  const [picking, setPicking] = useState(false);
  const [unreadable, setUnreadable] = useState(false);
  const iconLegend = useId();
  const pickedUrl = look.photo.kind === "picked" ? look.photo.url : null;
  useEffect(
    () => () => {
      if (pickedUrl) URL.revokeObjectURL(pickedUrl);
    },
    [pickedUrl],
  );
  const disabled = busy || picking;
  const photo = look.photo.kind !== "none";
  async function pick(file: File | undefined) {
    if (!file) return;
    setPicking(true);
    setUnreadable(false);
    const image = await prepareImage(file, "square");
    setPicking(false);
    if (!image) {
      setUnreadable(true);
      return;
    }
    change({ ...look, photo: { kind: "picked", image, url: URL.createObjectURL(image.jpeg) } });
  }
  const said = problem || (unreadable ? "사진을 불러오지 못했어요. 다시 시도해 주세요." : "");
  const picker = (label: string, camera: boolean) => (
    <label
      key={label}
      className={`${secondary} ${disabled ? "pointer-events-none opacity-50" : ""}`}
    >
      {camera ? (
        <Camera aria-hidden className="size-5 shrink-0" strokeWidth={2.4} />
      ) : (
        <ImageIcon aria-hidden className="size-5 shrink-0" strokeWidth={2.4} />
      )}
      {label}
      <input
        aria-label={label}
        type="file"
        accept="image/*"
        capture={camera ? "environment" : undefined}
        disabled={disabled}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          void pick(file);
        }}
        className="sr-only"
      />
    </label>
  );
  return (
    <div className="flex flex-col gap-3">
      {/* A photo covers the icon and the colour, so they fold while one is shown. */}
      {!photo && (
        <>
          <fieldset
            aria-labelledby={iconLegend}
            className="flex flex-col gap-3 rounded-group bg-surface px-4 py-4"
          >
            <span id={iconLegend} className="text-caption text-muted">
              아이콘
            </span>
            <div className="flex flex-wrap gap-2">
              {deckIcons.map((offered) => (
                <label
                  key={offered}
                  className="flex size-[calc(var(--spacing-tap-target)+4px)] cursor-pointer items-center justify-center rounded-field border border-outline bg-ground text-ink has-checked:border-2 has-checked:border-accent has-checked:bg-brand-tint has-focus-visible:outline-2 has-focus-visible:outline-ink"
                >
                  <input
                    type="radio"
                    name="icon"
                    value={offered}
                    aria-label={deckIconNames[offered]}
                    checked={look.icon === offered}
                    onChange={() => {
                      change({ ...look, icon: offered });
                    }}
                    className="sr-only"
                  />
                  <IconDrawing icon={offered} className="size-6" />
                </label>
              ))}
            </div>
          </fieldset>
          <DeckColorPicker
            legend="색"
            selected={look.color}
            pick={(color) => {
              change({ ...look, color });
            }}
          />
        </>
      )}
      <div
        role="group"
        aria-label="사진"
        className="flex flex-col gap-3 rounded-group bg-surface px-4 py-4"
      >
        <span aria-hidden className="text-caption text-muted">
          사진
        </span>
        <div className="flex flex-col gap-2">
          {picker(photo ? "다른 사진" : "앨범에서 고르기", false)}
          {photo ? (
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                change({ ...look, photo: { kind: "none" } });
              }}
              className="pressable min-h-button w-full rounded-button bg-surface px-4 text-button disabled:opacity-50"
            >
              사진 빼기
            </button>
          ) : (
            picker("사진 찍기", true)
          )}
        </div>
        {said && (
          <p role="alert" className="text-caption text-dont-know-text">
            {said}
          </p>
        )}
      </div>
    </div>
  );
}
