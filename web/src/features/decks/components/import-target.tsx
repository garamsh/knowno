"use client";

import { Check } from "lucide-react";
import type { Deck } from "../library";
import { buttonClass } from "@/design/button";
import { Sheet } from "@/design/sheet";

/**
 * "추가할 노트": the deck the found cards go into, [deck] or a new one, with [target] checked. Once
 * the new deck is [created] the choice is fixed.
 */
export function TargetSheet({
  deck,
  target,
  created,
  choose,
  close,
}: {
  deck: Deck;
  target: string;
  created: boolean;
  choose: (target: string) => void;
  close: () => void;
}) {
  return (
    <Sheet title="추가할 노트" close={close}>
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
              choose(item.id);
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
    </Sheet>
  );
}

/** "새 노트": the new deck's [name], which "만들기" [create]s before the cards are saved into it. */
export function NewTargetSheet({
  name,
  rename,
  message,
  pending,
  create,
  close,
}: {
  name: string;
  rename: (name: string) => void;
  message: string;
  pending: boolean;
  create: () => void;
  close: () => void;
}) {
  return (
    <Sheet title="새 노트" close={close}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          create();
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
              rename(event.target.value);
            }}
            className="mt-2 min-h-field w-full rounded-field border border-outline bg-surface px-4 text-body text-ink focus:outline-2 focus:outline-ink"
          />
        </label>
        {message && (
          <p role="alert" className="text-caption break-keep text-dont-know-text">
            {message}
          </p>
        )}
        <button disabled={pending || !name.trim()} className={buttonClass("primary", "cta")}>
          {pending ? "만드는 중" : "만들기"}
        </button>
      </form>
    </Sheet>
  );
}
