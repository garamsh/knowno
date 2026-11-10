/**
 * The rules layer of a note's screening before it is public (ADR 0238, ADR 0239): personal data, ads and
 * spam, and the banned words. It reads a claim of `public.screening_claim` and answers a verdict
 * whose findings point at the text by card hash, face, block and UTF-16 offsets in the original
 * text, and never hold the text itself. Bump [RULES_VERSION] with any change to a pattern, so
 * the stored verdicts of the old rules are checked again.
 */

export const RULES_VERSION = "3";

/**
 * A rule's category. `resident_number` and `account` are severe; the others but `term` refuse the
 * note. A banned `term` alone refuses nothing: the AI layer reads the note for it (ADR 0239).
 */
export type Category =
  | "resident_number"
  | "account"
  | "phone"
  | "link"
  | "kakao_id"
  | "contact"
  | "repeat"
  | "term";

const SEVERE: readonly Category[] = ["resident_number", "account"];

/** Where a finding is: the card by its hash (null for the name and the description). */
export type Finding = {
  readonly card: string | null;
  readonly where: "name" | "description" | "front" | "back";
  readonly block: number | null;
  /** The dotted path of the string in the block's payload, null for the name and the description. */
  readonly field: string | null;
  readonly category: Category;
  readonly start: number;
  readonly end: number;
};

export type Verdict = {
  readonly outcome: "clean" | "unsure" | "refused" | "severe";
  readonly findings: readonly Finding[];
};

/** What `public.screening_claim` answers for a note. */
export type Claim = {
  readonly name: string;
  readonly description: string | null;
  readonly cards: readonly {
    readonly hash: string;
    readonly front: unknown;
    readonly back: unknown;
  }[];
  readonly terms: readonly string[];
};

/** The most findings a verdict keeps. */
export const MAX_FINDINGS = 50;
/**
 * A text repeated on this many cards, at least this long, is spam only where the note also holds
 * a phone, link, messenger or contact finding: a fixed prompt or source line is normal in a
 * flashcard deck, and an ad is the repeated text that points somewhere.
 */
export const REPEAT_CARDS = 5;
export const REPEAT_LENGTH = 20;

type Segment = Omit<Finding, "category" | "start" | "end"> & {
  readonly text: string;
};

/** Payload keys that hold structure, never text the user wrote. */
const STRUCTURE = new Set([
  "media",
  "id",
  "kind",
  "category",
  "type",
  "v",
  "spans",
  "blanks",
  "width",
  "height",
  "duration_ms",
  "x",
  "y",
  "w",
  "h",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collect(
  value: unknown,
  path: string,
  into: { field: string; text: string }[],
): void {
  if (typeof value === "string") {
    if (value !== "") into.push({ field: path, text: value });
  } else if (Array.isArray(value)) {
    value.forEach((item, i) =>
      collect(item, path === "" ? String(i) : `${path}.${i}`, into)
    );
  } else if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (!STRUCTURE.has(key)) {
        collect(item, path === "" ? key : `${path}.${key}`, into);
      }
    }
  }
}

/** Every string the user wrote in the note, each with where it is. */
export function segments(claim: Claim): Segment[] {
  const found: Segment[] = [{
    card: null,
    where: "name",
    block: null,
    field: null,
    text: claim.name,
  }];
  if (claim.description !== null && claim.description !== "") {
    found.push({
      card: null,
      where: "description",
      block: null,
      field: null,
      text: claim.description,
    });
  }
  for (const card of claim.cards) {
    for (const where of ["front", "back"] as const) {
      const blocks = card[where];
      if (!Array.isArray(blocks)) continue;
      blocks.forEach((block, index) => {
        if (!isRecord(block)) return;
        const strings: { field: string; text: string }[] = [];
        collect(block.payload, "", strings);
        for (const { field, text } of strings) {
          found.push({ card: card.hash, where, block: index, field, text });
        }
      });
    }
  }
  return found;
}

/** Text after NFKC, with each kept character's span in the original text. */
type Folded = {
  readonly text: string;
  readonly starts: readonly number[];
  readonly ends: readonly number[];
};

/** [text] in NFKC, dropping the characters [drop] matches and lowering case when [lower]. */
export function fold(
  text: string,
  drop: RegExp | null,
  lower: boolean,
): Folded {
  let out = "";
  const starts: number[] = [];
  const ends: number[] = [];
  let at = 0;
  for (const point of text) {
    const next = at + point.length;
    let normal = point.normalize("NFKC");
    if (lower) normal = normal.toLowerCase();
    for (const char of normal) {
      if (drop !== null && drop.test(char)) continue;
      for (let i = 0; i < char.length; i++) {
        out += char[i];
        starts.push(at);
        ends.push(next);
      }
    }
    at = next;
  }
  return { text: out, starts, ends };
}

const SEPARATOR = /^[\p{Z}\p{P}\p{S}\p{C}]$/u;

/** The span in the original text of [from, to) of a folded text. */
function span(folded: Folded, from: number, to: number): [number, number] {
  return [folded.starts[from] ?? 0, folded.ends[to - 1] ?? 0];
}

type Hit = readonly [category: Category, start: number, end: number];

const MOBILE =
  /(?<![\p{N}])01[016789][^\p{L}\p{N}]{0,3}\d{3,4}[^\p{L}\p{N}]{0,3}\d{4}(?![\p{N}])/gu;
const LANDLINE =
  /(?<![\p{N}])0(?:2|[3-6]\d)[^\p{L}\p{N}]{0,3}\d{3,4}[^\p{L}\p{N}]{0,3}\d{4}(?![\p{N}])/gu;
const INTERNATIONAL =
  /(?<![\p{N}])\+?82[^\p{L}\p{N}]{0,3}\(?0?\)?[^\p{L}\p{N}]{0,2}(?:10|[2-6]\d?)[^\p{L}\p{N}]{0,3}\d{3,4}[^\p{L}\p{N}]{0,3}\d{4}(?![\p{N}])/gu;
/** A service number (1588-1234) is a phone only beside a cue: otherwise it is a year range. */
const SERVICE = /(?<![\p{N}])1[5-9]\d{2}-\d{4}(?![\p{N}])/gu;
const SERVICE_CUE =
  /대표\s*번호|전화|연락처|고객\s*센터|콜\s*센터|문의|\btel\b|\bphone\b|\bcall\b|☎|☏|📞/iu;
const RESIDENT =
  /(?<![\p{N}])(\d{2})(\d{2})(\d{2})[^\p{L}\p{N}]{0,2}([1-8])(\d{6})(?![\p{N}])/gu;
const DIGIT_RUN = /(?<![\p{N}])\d{2,6}(?:[\s\-.]\d{2,8}){1,3}(?![\p{N}])/gu;
/** Names no sentence uses for anything else: a number near one is an account. */
const BANKS =
  /우리은행|하나은행|농협|기업은행|카카오뱅크|토스뱅크|케이뱅크|우체국|새마을|수협|부산은행|대구은행|광주은행|전북은행|경남은행|제주은행|산업은행|sc제일|계좌|\bbank\b|은행/giu;
/** Names a sentence also uses (국민 is "citizen"): a number is an account only right after one. */
const BANK_BEFORE =
  /(?:국민|신한|씨티|우리|하나|기업|농협|카카오뱅크|토스뱅크|케이뱅크|우체국|새마을|수협|sc제일|계좌(?:\s*번호)?|\bbank\b|은행)(?:은행)?[^\p{L}\p{N}]{0,4}$/iu;
const PLAIN_RUN = /(?<![\p{N}])\d{10,14}(?![\p{N}])/gu;
/** Whether every group of [run] is a year, as in a list of dates or of citations. */
const YEARS = /^(?:(?:1[5-9]|20)\d{2}[\s\-.]?)+$/u;
const URL_SCHEME = /\b(?:https?|ftp):\/\/\S+|\bwww\.[a-z0-9-]+\.\S+/giu;
const DOMAIN =
  /(?<![\p{L}\p{N}.-])[a-z0-9][a-z0-9-]{1,62}(?:\.[a-z0-9-]{2,63})*\.(?:com|net|org|kr|io|me|ly|gl|link|shop|store|site|xyz|info|biz|cc|tv|vip|top|club)(?![a-z0-9])(?:\/\S*)?/giu;
/** Product names that end like a domain. */
const NOT_DOMAIN = /^(?:asp|vb|ado|dot)\.net$/iu;
/**
 * A messenger name and an id after it. A Korean name may take a bare colon; a Latin word needs a
 * boundary before it and an `id` or `@` after it, or "Deadline: tomorrow" is a contact.
 */
const KAKAO_ID = new RegExp(
  "(?:카톡|카카오톡?|오픈채팅|오픈카톡|텔레그램|텔레|위챗|인스타그램|인스타)" +
    "(?:\\s*(?:아이디|id|친추|친구추가|문의)\\s*[:：=@]?|\\s*[:：=@])\\s*@?[a-z0-9][a-z0-9._-]{3,}" +
    "|(?<![\\p{L}\\p{N}])(?:kakao(?:talk)?|telegram|wechat|instagram|insta|line)" +
    "(?:\\s*(?:id|친추|친구추가)\\s*[:：=@]?|\\s*@)\\s*@?[a-z0-9][a-z0-9._-]{3,}",
  "giu",
);
const CONTACT =
  /(?:연락|문의|상담)\s*(?:주세요|바랍니다|부탁|환영)|(?:카톡|전화|문자|dm|디엠)\s*(?:주세요|주시면|바랍니다|환영)|친구\s*추가|친추|(?:contact|dm|message)\s+me\b|(?:call|text)\s+me\s+(?:at|on|via|anytime|asap|now)\b/giu;

/** Whether [digits] is a resident registration number, by its date and its check digit. */
function residentNumber(
  [year, month, day, sex, rest]: readonly [
    string,
    string,
    string,
    string,
    string,
  ],
): boolean {
  const m = Number(month);
  const d = Number(day);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  void year;
  const digits = `${year}${month}${day}${sex}${rest}`.split("").map(Number);
  const weights = [2, 3, 4, 5, 6, 7, 8, 9, 2, 3, 4, 5];
  const sum = weights.reduce((acc, w, i) => acc + w * (digits[i] ?? 0), 0);
  const check = (11 - sum % 11) % 10;
  const last = digits[12] ?? -1;
  // A foreigner's number (5 to 8) carries the same check, shifted by two.
  return Number(sex) <= 4 ? check === last : (check + 2) % 10 === last;
}

function matches(text: string, pattern: RegExp): RegExpExecArray[] {
  return [...text.matchAll(new RegExp(pattern.source, pattern.flags))];
}

/** The hits of every pattern rule in one string; spans are in the original text. */
function patternHits(original: string): Hit[] {
  const kept = fold(original, null, false);
  const hits: Hit[] = [];
  const add = (category: Category, at: number, length: number) => {
    const [start, end] = span(kept, at, at + length);
    hits.push([category, start, end]);
  };
  for (const found of matches(kept.text, RESIDENT)) {
    const parts = [found[1], found[2], found[3], found[4], found[5]];
    if (parts.every((p) => p !== undefined)) {
      if (residentNumber(parts as [string, string, string, string, string])) {
        add("resident_number", found.index, found[0].length);
      }
    }
  }
  for (const pattern of [MOBILE, LANDLINE, INTERNATIONAL]) {
    for (const found of matches(kept.text, pattern)) {
      add("phone", found.index, found[0].length);
    }
  }
  for (const found of matches(kept.text, SERVICE)) {
    const around = kept.text.slice(
      Math.max(0, found.index - 12),
      found.index + found[0].length + 12,
    );
    if (SERVICE_CUE.test(around)) add("phone", found.index, found[0].length);
  }
  for (const found of matches(kept.text, DIGIT_RUN)) {
    const count = found[0].replace(/\D/g, "").length;
    if (count < 10 || count > 16 || YEARS.test(found[0])) continue;
    const near = kept.text.slice(
      Math.max(0, found.index - 20),
      found.index + found[0].length + 20,
    );
    const before = kept.text.slice(Math.max(0, found.index - 12), found.index);
    if (
      new RegExp(BANKS.source, BANKS.flags).test(near) ||
      BANK_BEFORE.test(before)
    ) {
      add("account", found.index, found[0].length);
    }
  }
  // An account written with no separator is a number only right after a bank's name.
  for (const found of matches(kept.text, PLAIN_RUN)) {
    const before = kept.text.slice(Math.max(0, found.index - 12), found.index);
    if (BANK_BEFORE.test(before)) add("account", found.index, found[0].length);
  }
  for (const pattern of [URL_SCHEME, DOMAIN]) {
    for (const found of matches(kept.text, pattern)) {
      if (NOT_DOMAIN.test(found[0])) continue;
      add("link", found.index, found[0].length);
    }
  }
  for (const found of matches(kept.text, KAKAO_ID)) {
    add("kakao_id", found.index, found[0].length);
  }
  for (const found of matches(kept.text, CONTACT)) {
    add("contact", found.index, found[0].length);
  }
  // Two patterns of a category may find one thing: keep the hit that holds the other.
  return hits.filter(([category, start, end], i) =>
    !hits.some(([c, s, e], j) =>
      c === category && s <= start && end <= e &&
      (e - s > end - start || (e - s === end - start && j < i))
    )
  );
}

/** The banned [terms] in [original], matched with no separator or case, as the term is folded. */
function termHits(original: string, terms: readonly string[]): Hit[] {
  const folded = fold(original, SEPARATOR, true);
  const hits: Hit[] = [];
  for (const term of terms) {
    const needle = fold(term, SEPARATOR, true).text;
    if (needle === "") continue;
    for (let at = folded.text.indexOf(needle); at !== -1;) {
      const [start, end] = span(folded, at, at + needle.length);
      hits.push(["term", start, end]);
      at = folded.text.indexOf(needle, at + needle.length);
    }
  }
  return hits;
}

/** Screens [claim]: a verdict of findings by place, none of them holding text. */
export function screen(claim: Claim): Verdict {
  const found: Finding[] = [];
  const all = segments(claim);
  for (const segment of all) {
    const { text, ...place } = segment;
    for (const [category, start, end] of patternHits(text)) {
      found.push({ ...place, category, start, end });
    }
    for (const [category, start, end] of termHits(text, claim.terms)) {
      found.push({ ...place, category, start, end });
    }
  }
  // A long text on many cards, in a note that also points somewhere: one finding on each occurrence.
  const points = found.some((f) =>
    f.category === "phone" || f.category === "link" ||
    f.category === "kakao_id" || f.category === "contact"
  );
  const seen = new Map<string, Segment[]>();
  for (const segment of all) {
    if (segment.card === null) continue;
    const key = fold(segment.text, SEPARATOR, true).text;
    if (key.length < REPEAT_LENGTH) continue;
    seen.set(key, [...(seen.get(key) ?? []), segment]);
  }
  for (const group of seen.values()) {
    if (!points || new Set(group.map((s) => s.card)).size < REPEAT_CARDS) {
      continue;
    }
    for (const segment of group) {
      const { text, ...place } = segment;
      found.push({ ...place, category: "repeat", start: 0, end: text.length });
    }
  }
  const findings = found.slice(0, MAX_FINDINGS);
  const outcome = found.some((f) => SEVERE.includes(f.category))
    ? "severe"
    : found.some((f) => f.category !== "term")
    ? "refused"
    : found.length > 0
    ? "unsure"
    : "clean";
  return { outcome, findings };
}
