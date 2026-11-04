/** What a card's blocks are built from: its labels, the duplicate key's normalization and its ids. */

/** Each part of speech a label may name, by the short form a card shows it as. */
const PARTS_OF_SPEECH: Record<string, string> = {
  "명": "noun",
  "동": "verb",
  "형": "adjective",
  "부": "adverb",
  "대": "pronoun",
  "전": "preposition",
  "접": "conjunction",
  "감": "interjection",
  "관": "determiner",
  "수": "numeral",
  "조": "particle",
  "조동": "auxiliary",
  "양": "classifier",
  "구": "phrase",
};

/** The short forms a label may take to be stored as a part of speech, for the tools' text. */
export const PART_OF_SPEECH_FORMS = Object.keys(PARTS_OF_SPEECH);

/** A sense's label as stored: a part of speech by its short form, or any other label. */
export type Label =
  | {
    readonly kind: "part_of_speech";
    readonly category: string;
    readonly text: string;
  }
  | { readonly kind: "other"; readonly category: null; readonly text: string };

/** Each word of [texts] as a label, a short part-of-speech form as that part of speech. */
export function labelsOf(texts: readonly string[]): Label[] {
  return texts.flatMap((text) => text.trim().split(/\s+/u)).filter((text) =>
    text !== ""
  )
    .map((text): Label => {
      const category = PARTS_OF_SPEECH[text];
      return category === undefined
        ? { kind: "other", category: null, text }
        : { kind: "part_of_speech", category, text };
    });
}

/** Whether [value] is a part of speech a label may be stored as. */
export function isPartOfSpeech(value: unknown): value is string {
  return Object.values(PARTS_OF_SPEECH).includes(value as string);
}

/** What a card shows inside a label's brackets: a part of speech's short form, else the label. */
export function labelShown(label: Label): string {
  return PART_OF_SPEECH_FORMS.find((form) =>
    PARTS_OF_SPEECH[form] === label.category
  ) ?? label.text;
}

/** The phone's duplicate key: the front's text in NFKC, its whitespace collapsed, lowercased. */
export function cardKey(front: string): string {
  return front.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}

/** Makes a version 7 uuid from a clock and a random source, as the phone and the web do. */
export type IdSource = {
  readonly now: () => number;
  readonly random: (bytes: number) => Uint8Array;
};

/** A version 7 uuid: 48 bits of [ids]' milliseconds, then its random bits with the version and variant. */
export function uuidV7(ids: IdSource): string {
  const bytes = new Uint8Array(16);
  let time = ids.now();
  for (let index = 5; index >= 0; index--) {
    bytes[index] = time % 256;
    time = Math.floor(time / 256);
  }
  bytes.set(ids.random(10), 6);
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${
    hex.slice(16, 20)
  }-${hex.slice(20)}`;
}
