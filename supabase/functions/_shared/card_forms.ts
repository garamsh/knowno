/**
 * The card-form skills (ADR 0197): one per form a card can take, each a one-line summary of when it
 * fits and a guide to making it. Their texts are versions in the database, edited in admin; the
 * assistant and the MCP server read the ones served to the caller through `card_form_skills`.
 */

import { SupabaseError } from "./auth.ts";
import { BLOCK_TYPES } from "./input.ts";
import { cardFormRows, type Store } from "./store.ts";

/** The forms a card takes: each 칸 type the validator accepts, and two or more of them combined. */
export const FORMS = [...BLOCK_TYPES, "mixed"] as const;
export type Form = (typeof FORMS)[number];

/**
 * A card's form, by the types of its blocks: the one type it holds besides text, `text` when it
 * holds text alone, and `mixed` when it holds two or more others. A type no form names, such as a
 * kept sound, accompanies the card as text does.
 */
export function formOf(types: readonly string[]): Form {
  const kinds = new Set(
    types.flatMap((type) =>
      FORMS.find((form) => form === type && form !== "text") ?? []
    ),
  );
  const [only] = kinds;
  return kinds.size > 1 ? "mixed" : only ?? "text";
}

/** A form's skill as served: the version, when the form fits, and how to make it. */
export type Skill = {
  readonly versionId: number;
  readonly summary: string;
  readonly text: string;
};

export type Skills = Readonly<Record<Form, Skill>>;

/** How long one caller's skills are reused before they are read again. */
export const SKILL_CACHE_MS = 60_000;

/** The skills served to a caller: an admin's tested version of a form while one is set. */
export type CardForms = {
  readonly read: (store: Store) => Promise<Skills>;
};

/** One skill of each form from `card_form_skills`' rows, or a failure naming what is wrong. */
function skillsOf(rows: readonly Record<string, unknown>[]): Skills {
  const read: Partial<Record<Form, Skill>> = {};
  for (const row of rows) {
    const form = FORMS.find((known) => known === row.form);
    if (
      form === undefined || read[form] !== undefined ||
      typeof row.version_id !== "number" || typeof row.summary !== "string" ||
      typeof row.text !== "string"
    ) {
      throw new SupabaseError("card_form_skills answered a row it should not");
    }
    read[form] = {
      versionId: row.version_id,
      summary: row.summary,
      text: row.text,
    };
  }
  const missing = FORMS.filter((form) => read[form] === undefined);
  if (missing.length > 0) {
    throw new SupabaseError(`card_form_skills has no ${missing.join(", ")}`);
  }
  return read as Skills;
}

/** The skills, each caller's kept for `SKILL_CACHE_MS` by [now]'s clock. */
export function cardFormSkills(now: () => number): CardForms {
  const kept = new Map<string, { skills: Skills; until: number }>();
  return {
    read: async (store) => {
      const hit = kept.get(store.userId);
      if (hit !== undefined && hit.until > now()) return hit.skills;
      const skills = skillsOf(await cardFormRows(store));
      for (const [user, entry] of kept) {
        if (entry.until <= now()) kept.delete(user);
      }
      kept.set(store.userId, { skills, until: now() + SKILL_CACHE_MS });
      return skills;
    },
  };
}

/**
 * The index every reader sees first: what a card is, then each form with when it fits and, from
 * [link], where its guide is; [closing] says how to read one.
 */
export function cardFormIndex(
  skills: Skills,
  link: (form: Form) => string,
  closing: string,
): string {
  const lines = FORMS.map((form) =>
    `- **${form}** — ${skills[form].summary}${link(form)}`
  );
  return `# Card forms

A card is {"blocks": [...]}, one or more blocks in order. It needs something shown first and something added at the reveal; a cloze, a table or a picture with boxes counts for both. A card's form is the one block type it holds besides text: text when it holds text alone, and mixed when it holds two or more others.

${lines.join("\n")}

${closing}
`;
}

/** The MCP resource of the index, which links each form's guide. */
export const GUIDE_URI = "knowno://guide/card-forms";

/** The MCP resource of [form]'s guide. */
export const formUri = (form: Form) => `${GUIDE_URI}/${form}`;
