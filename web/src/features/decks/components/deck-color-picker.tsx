"use client";

import { colorNames, type DeckColor, deckFill, offeredColors } from "../deck-tint";

/**
 * The four offered note colours as named choices in a group headed by [legend], [selected] ringed,
 * as the phone's `DeckColorPicker` in 새 노트 and 노트 꾸미기; a choice hands its colour to [pick].
 * A stored colour that is not offered rings none.
 */
export function DeckColorPicker({
  legend,
  selected,
  pick,
}: {
  legend: string;
  selected: DeckColor | undefined;
  pick: (color: DeckColor) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-3 rounded-group bg-surface px-4 py-4">
      <legend className="float-left text-caption text-muted">{legend}</legend>
      <div className="clear-left flex flex-wrap gap-3">
        {offeredColors.map((offered) => (
          <label
            key={offered}
            className={`flex size-tap-target cursor-pointer items-center justify-center rounded-chip ${deckFill(offered)} has-checked:outline-3 has-checked:outline-offset-2 has-checked:outline-accent has-focus-visible:outline-ink`}
          >
            <input
              type="radio"
              name="color"
              value={offered}
              aria-label={colorNames[offered]}
              checked={selected === offered}
              onChange={() => {
                pick(offered);
              }}
              className="sr-only"
            />
          </label>
        ))}
      </div>
    </fieldset>
  );
}
