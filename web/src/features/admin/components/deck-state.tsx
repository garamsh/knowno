import { Chip } from "@/design/chip";

import type { DeckState } from "../read-admin";

/** A deck's state in words: deleted, or public or private, and hidden. */
export function deckStateWords(state: DeckState): string[] {
  if (state.deleted) return ["삭제됨"];
  return [state.visibility === "public" ? "공개" : "비공개", ...(state.hidden ? ["숨김"] : [])];
}

/** A deck's state as chips, the one chip of `design/components.md`; a hidden deck's in amber. */
export function DeckStateChips({ state }: { state: DeckState }) {
  return (
    <span className="flex flex-wrap gap-1">
      {deckStateWords(state).map((word) => (
        <Chip key={word} tone={word === "숨김" ? "amber" : "neutral"}>
          {word}
        </Chip>
      ))}
    </span>
  );
}
