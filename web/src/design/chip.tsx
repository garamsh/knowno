import type { ReactNode } from "react";

/** A chip's tones, as the phone's `AppChipTone`: its fill, its line and its text. */
const tones = {
  neutral: "border-outline bg-surface text-ink",
  brand: "border-brand-tint bg-brand-tint text-ink",
  amber: "border-tint-amber bg-tint-amber text-ink",
  know: "border-know bg-know text-on-know",
  /** A gain, as the 기록 tab draws one beside its figure: the green tint. */
  knowTint: "border-tint-green bg-tint-green text-on-know-tint",
  dontKnow: "border-dont-know-text bg-dont-know-text text-on-dont-know-text",
} as const;

/**
 * The one chip, as the phone's `AppChip` draws it (ADR 0119): the `chip` radius, the `section`
 * type, 12 by 4 around its words, in a tone, after an optional leading mark such as a grade's.
 */
export function Chip({
  tone = "neutral",
  leading,
  children,
}: {
  tone?: keyof typeof tones;
  leading?: ReactNode;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-chip border px-3 py-1 text-section ${tones[tone]}`}
    >
      {leading}
      {children}
    </span>
  );
}
