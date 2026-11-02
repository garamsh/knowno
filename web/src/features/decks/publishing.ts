/** The longest description a public deck takes, in characters, as the phone's `maxDescriptionLength`. */
export const maxDescriptionLength = 300;

/** How many characters [text] holds, counted as the phone's `runes` counts them: code points. */
export function characters(text: string): number {
  return Array.from(text).length;
}

/**
 * [input] trimmed as a display name, the name shown with the user's public decks, or null when it
 * is not 2 to 20 characters, as the phone's `DisplayName.tryParse`.
 */
export function parseDisplayName(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  const length = characters(trimmed);
  return length >= 2 && length <= 20 ? trimmed : null;
}
