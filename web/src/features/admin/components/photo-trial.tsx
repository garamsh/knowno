"use client";

import { useId, useTransition } from "react";

import { encodePhoto } from "../encode-photo";
import type { TrialCard } from "../trial";
import { button } from "./admin-section";

/**
 * The form of a one-photo trial: the photo, turned upright and scaled as the app does, then
 * [read], or [fail] with why when it cannot be read; [reset] clears the last trial as it starts.
 * The button says [pendingLabel] while it runs.
 */
export function PhotoForm({
  pendingLabel,
  reset,
  read,
  fail,
}: {
  pendingLabel: string;
  reset: () => void;
  read: (photo: FormData) => Promise<void>;
  fail: (message: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const id = useId();
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const input = event.currentTarget.elements.namedItem("photo");
        const file = input instanceof HTMLInputElement ? input.files?.[0] : undefined;
        if (file === undefined) return;
        reset();
        startTransition(async () => {
          const photo = await encodePhoto(file);
          if (photo === null) {
            fail("이 사진을 읽지 못했어요. 다른 사진을 골라 주세요.");
            return;
          }
          const form = new FormData();
          form.set("photo", photo);
          await read(form);
        });
      }}
    >
      <label htmlFor={id} className="sr-only">
        사진
      </label>
      <input
        id={id}
        name="photo"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="min-w-0 text-caption text-ink-2 file:mr-3 file:rounded-button file:border file:border-outline file:bg-surface file:px-3 file:py-2 file:text-body file:text-ink"
      />
      <button type="submit" disabled={pending} className={`${button.row} self-start`}>
        {pending ? pendingLabel : "시험하기"}
      </button>
    </form>
  );
}

/** The cards a trial made, each its front over its back, named [label]. */
export function TrialCards({ cards, label }: { cards: TrialCard[]; label?: string }) {
  return (
    <ul aria-label={label} className="flex flex-col divide-y divide-hairline">
      {cards.map((made, index) => (
        <li key={index} className="flex flex-col gap-1 py-2">
          <span className="text-body-strong">{made.front}</span>
          <span className="text-body whitespace-pre-wrap">{made.back}</span>
        </li>
      ))}
    </ul>
  );
}
