/**
 * The icons a deck's tile can hold, by the key a deck stores, in the app's order (`DeckIcon` in
 * app/lib/deck/src/model.dart), each with the name the phone's `deckIconName` gives it.
 */
export const deckIconNames = {
  layers: "카드 묶음",
  book: "책",
  languages: "언어",
  pencil: "연필",
  flask: "실험",
  calculator: "계산기",
  globe: "지구본",
  music: "음악",
  palette: "팔레트",
  brain: "두뇌",
  code: "코드",
  landmark: "건축물",
  briefcase: "서류 가방",
  star: "별",
} as const;

/** An icon a deck's tile can hold, by the key a deck stores. */
export type DeckIcon = keyof typeof deckIconNames;

/** The icons, in the app's order. */
export const deckIcons = Object.keys(deckIconNames) as DeckIcon[];

/** The icon [key] names, or null for none, or for a key this version does not know. */
export function parseDeckIcon(key: unknown): DeckIcon | null {
  return typeof key === "string" && Object.hasOwn(deckIconNames, key) ? (key as DeckIcon) : null;
}
