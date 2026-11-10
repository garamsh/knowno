import "server-only";

import { field, parseTime } from "@/supabase/row";

import { call } from "./action-call";
import { type AdminFailure, type AdminRead, parseProvider, type Provider } from "./read-admin";

/**
 * The triage model's verdict on a note's current text: a category (`spam`, `ad`, `inappropriate`,
 * `copyright`, `severe`, `other`, `ok` or `unjudged`), how sure it was, the words it quoted and
 * where they are, named as the server writes `field`: `name`, `description`, `front` or `back`,
 * with a path after a colon for a string inside a block.
 */
export type Verdict = {
  category: string;
  confidence: number;
  /** The words the model quoted; null where it quoted none. */
  passage: string | null;
  /** Where in the note the passage is, as the server wrote it; null where it is not named. */
  field: string | null;
  tier: string;
  model: string;
  costUsd: number;
  judgedAt: number;
};

/** A note two or more users reported, with the model's verdict on its current text. */
export type TriageNote = {
  id: string;
  name: string;
  ownerId: string;
  hidden: boolean;
  publication: string;
  reporters: number;
  reasons: string[];
  lastReportedAt: number;
  /** Null while the note's current text is unjudged. */
  verdict: Verdict | null;
  /** The standing AI action on the note, if any. */
  actionId: number | null;
  appealed: boolean;
  failures: number;
};

/** One thing the AI did to a note, with what became of it. */
export type TriageAction = {
  actionId: number;
  deckId: string;
  name: string;
  action: string;
  category: string;
  confidence: number;
  model: string;
  reason: string;
  createdAt: number;
  sampled: boolean;
  recheckedAt: number | null;
  recheckAgreed: boolean | null;
  undoneAt: number | null;
};

/** The triage's switches and what the day has used. */
export type TriageSettings = {
  mode: string;
  actThreshold: number;
  dailyCapUsd: number;
  dailyNotes: number;
  samplePercent: number;
  reporterDailyCap: number;
  undoWindowHours: number;
  undoThreshold: number;
  undoMinActions: number;
  pausedAt: number | null;
  pausedReason: string | null;
  spentTodayUsd: number;
  judgedToday: number;
  actionsInWindow: number;
  /** The share of the window's actions an admin undid; null with none. */
  undoRate: number | null;
};

/** How often the model's verdicts of one category agreed with what an admin then decided. */
export type Agreement = { category: string; compared: number; agreed: number };

/** An owner's appeal of an AI action, not yet decided. */
export type TriageAppeal = {
  deckId: string;
  name: string;
  ownerId: string;
  appealedAt: number;
  actionId: number;
  category: string;
  confidence: number;
  passage: string | null;
  field: string | null;
};

/** A tier of the triage model: provider, model and its price a million tokens. */
export type TriageTier = { provider: Provider; model: string; inUsd: number; outUsd: number };

/** A labelled configuration of the triage: its two tiers, prompt and limits. */
export type TriageConfiguration = {
  label: "active" | "test";
  id: number;
  cheap: TriageTier;
  strong: TriageTier;
  prompt: string;
  escalateBelow: number;
  payloadTokens: number;
  sampleCards: number;
  setAt: number;
  setByEmail: string | null;
};

/**
 * A deck's name where the server joins decks without leaving out the deleted: the purge empties a
 * deleted deck's name, which reads as "삭제된 노트" rather than as an unreadable row.
 */
function deckName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value === "" ? "삭제된 노트" : value;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/** [value] as a number: PostgREST answers a `numeric` as a number, or a string where it is exact. */
function num(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** [value] as a confidence: a number from 0 to 1. */
function confidenceOf(value: unknown): number | null {
  const parsed = num(value);
  return parsed !== null && parsed >= 0 && parsed <= 1 ? parsed : null;
}

function whole(value: unknown): number | null {
  const parsed = num(value);
  return parsed !== null && Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

/** [value] when it is a string or null. */
function optionalText(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  return typeof value === "string" ? (value === "" ? null : value) : undefined;
}

function rows<T>(value: unknown, parse: (row: unknown) => T | null): T[] | null {
  if (!Array.isArray(value)) return null;
  const list: T[] = [];
  for (const row of value as unknown[]) {
    const one = parse(row);
    if (one === null) return null;
    list.push(one);
  }
  return list;
}

function parsedList<T>(
  read: { data: unknown } | { failure: AdminFailure },
  parse: (row: unknown) => T | null,
): AdminRead<T[]> {
  if ("failure" in read) return read;
  const list = rows(read.data, parse);
  return list ? { data: list } : { failure: "unreadable" };
}

function parseTriageNote(row: unknown): TriageNote | null {
  const id = text(field(row, "deck_id"));
  const name = text(field(row, "name"));
  const ownerId = text(field(row, "owner_id"));
  const hidden = field(row, "hidden");
  const publication = text(field(row, "publication"));
  const reporters = whole(field(row, "reporters"));
  const reasons = field(row, "reasons");
  const lastReportedAt = parseTime(field(row, "last_reported_at"));
  const appealed = field(row, "appealed");
  // The server counts failed tries from a row that stands only while a note is claimed, so a note
  // not claimed and one judged both answer null: no failure.
  const failuresRaw = field(row, "failures");
  const failures = failuresRaw === null || failuresRaw === undefined ? 0 : whole(failuresRaw);
  const actionRaw = field(row, "action_id");
  const actionId = actionRaw === null || actionRaw === undefined ? null : whole(actionRaw);
  if (id === null || name === null || ownerId === null || publication === null) return null;
  if (typeof hidden !== "boolean" || typeof appealed !== "boolean") return null;
  if (reporters === null || lastReportedAt === null || failures === null) return null;
  if (!Array.isArray(reasons) || reasons.some((reason) => typeof reason !== "string")) return null;
  if (actionRaw !== null && actionRaw !== undefined && actionId === null) return null;
  const judgedAt = field(row, "judged_at");
  let verdict: Verdict | null = null;
  if (judgedAt !== null && judgedAt !== undefined) {
    const at = parseTime(judgedAt);
    const category = text(field(row, "category"));
    const confidence = confidenceOf(field(row, "confidence"));
    const passage = optionalText(field(row, "passage"));
    const where = optionalText(field(row, "field"));
    const tier = text(field(row, "tier"));
    const model = text(field(row, "model"));
    const cost = num(field(row, "cost_usd"));
    if (at === null || category === null || confidence === null) return null;
    if (passage === undefined || where === undefined || tier === null || model === null) {
      return null;
    }
    if (cost === null) return null;
    verdict = {
      category,
      confidence,
      passage,
      field: where,
      tier,
      model,
      costUsd: cost,
      judgedAt: at,
    };
  }
  return {
    id,
    name,
    ownerId,
    hidden,
    publication,
    reporters,
    reasons: reasons as string[],
    lastReportedAt,
    verdict,
    actionId,
    appealed,
    failures,
  };
}

/** The reported notes with a verdict each, as the server answers them. The list's order is `NoteList`'s. */
export async function readTriageQueue(): Promise<AdminRead<TriageNote[]>> {
  return parsedList(await call("admin_triage_queue"), parseTriageNote);
}

function parseTriageAction(row: unknown): TriageAction | null {
  const actionId = whole(field(row, "action_id"));
  const deckId = text(field(row, "deck_id"));
  const name = deckName(field(row, "name"));
  const action = text(field(row, "action"));
  const category = text(field(row, "category"));
  const confidence = confidenceOf(field(row, "confidence"));
  const model = text(field(row, "model"));
  const reason = typeof field(row, "reason") === "string" ? (field(row, "reason") as string) : null;
  const createdAt = parseTime(field(row, "created_at"));
  const sampled = field(row, "sampled");
  const rechecked = field(row, "rechecked_at");
  const agreed = field(row, "recheck_agreed");
  const undone = field(row, "undone_at");
  if (actionId === null || deckId === null || name === null || action === null) return null;
  if (category === null || confidence === null || model === null || reason === null) return null;
  if (createdAt === null || typeof sampled !== "boolean") return null;
  if (agreed !== null && agreed !== undefined && typeof agreed !== "boolean") return null;
  const recheckedAt = rechecked === null || rechecked === undefined ? null : parseTime(rechecked);
  const undoneAt = undone === null || undone === undefined ? null : parseTime(undone);
  if (rechecked !== null && rechecked !== undefined && recheckedAt === null) return null;
  if (undone !== null && undone !== undefined && undoneAt === null) return null;
  return {
    actionId,
    deckId,
    name,
    action,
    category,
    confidence,
    model,
    reason,
    createdAt,
    sampled,
    recheckedAt,
    recheckAgreed: typeof agreed === "boolean" ? agreed : null,
    undoneAt,
  };
}

/** What the AI did in the last [days] days, the newest first. */
export async function readTriageActions(days = 30): Promise<AdminRead<TriageAction[]>> {
  return parsedList(await call("admin_triage_actions", { days }), parseTriageAction);
}

/** The sampled actions an admin has not yet re-checked. */
export async function readTriageSample(): Promise<AdminRead<TriageAction[]>> {
  return parsedList(await call("admin_triage_sample"), parseTriageAction);
}

/** The settings row with the day's use, or why it cannot be read. */
export async function readTriageSettings(): Promise<AdminRead<TriageSettings>> {
  const read = await call("admin_triage_settings");
  if ("failure" in read) return read;
  const row: unknown =
    Array.isArray(read.data) && read.data.length === 1 ? read.data[0] : undefined;
  const mode = text(field(row, "mode"));
  const actThreshold = num(field(row, "act_threshold"));
  const dailyCapUsd = num(field(row, "daily_cap_usd"));
  const dailyNotes = whole(field(row, "daily_notes"));
  const samplePercent = whole(field(row, "sample_percent"));
  const reporterDailyCap = whole(field(row, "reporter_daily_cap"));
  const undoWindowHours = whole(field(row, "undo_window_hours"));
  const undoThreshold = num(field(row, "undo_threshold"));
  const undoMinActions = whole(field(row, "undo_min_actions"));
  const pausedRaw = field(row, "paused_at");
  const pausedAt = pausedRaw === null || pausedRaw === undefined ? null : parseTime(pausedRaw);
  const pausedReason = optionalText(field(row, "paused_reason"));
  const spent = num(field(row, "spent_today_usd"));
  const judged = whole(field(row, "judged_today"));
  const actions = whole(field(row, "actions_in_window"));
  const rateRaw = field(row, "undo_rate");
  const undoRate = rateRaw === null || rateRaw === undefined ? null : num(rateRaw);
  if (mode === null || actThreshold === null || dailyCapUsd === null || dailyNotes === null) {
    return { failure: "unreadable" };
  }
  if (samplePercent === null || reporterDailyCap === null || undoWindowHours === null) {
    return { failure: "unreadable" };
  }
  if (undoThreshold === null || undoMinActions === null || spent === null) {
    return { failure: "unreadable" };
  }
  if (judged === null || actions === null || pausedReason === undefined) {
    return { failure: "unreadable" };
  }
  if (pausedRaw !== null && pausedRaw !== undefined && pausedAt === null) {
    return { failure: "unreadable" };
  }
  if (rateRaw !== null && rateRaw !== undefined && undoRate === null) {
    return { failure: "unreadable" };
  }
  return {
    data: {
      mode,
      actThreshold,
      dailyCapUsd,
      dailyNotes,
      samplePercent,
      reporterDailyCap,
      undoWindowHours,
      undoThreshold,
      undoMinActions,
      pausedAt,
      pausedReason,
      spentTodayUsd: spent,
      judgedToday: judged,
      actionsInWindow: actions,
      undoRate,
    },
  };
}

/** How the model's verdicts agreed with an admin's decisions in the last [days] days, a row for each category. */
export async function readTriageAgreement(days = 30): Promise<AdminRead<Agreement[]>> {
  return parsedList(await call("admin_triage_agreement", { days }), (row) => {
    const category = text(field(row, "category"));
    const compared = whole(field(row, "compared"));
    const agreed = whole(field(row, "agreed"));
    return category === null || compared === null || agreed === null
      ? null
      : { category, compared, agreed };
  });
}

/** The appeals no admin has decided, the oldest first. */
export async function readTriageAppeals(): Promise<AdminRead<TriageAppeal[]>> {
  return parsedList(await call("admin_triage_appeals"), (row) => {
    const deckId = text(field(row, "deck_id"));
    const name = deckName(field(row, "name"));
    const ownerId = text(field(row, "owner_id"));
    const appealedAt = parseTime(field(row, "appealed_at"));
    const actionId = whole(field(row, "action_id"));
    const category = text(field(row, "category"));
    const confidence = confidenceOf(field(row, "confidence"));
    const passage = optionalText(field(row, "passage"));
    const where = optionalText(field(row, "field"));
    if (deckId === null || name === null || ownerId === null || appealedAt === null) return null;
    if (actionId === null || category === null || confidence === null) return null;
    if (passage === undefined || where === undefined) return null;
    return {
      deckId,
      name,
      ownerId,
      appealedAt,
      actionId,
      category,
      confidence,
      passage,
      field: where,
    };
  });
}

function parseTier(row: unknown, prefix: "cheap" | "strong"): TriageTier | null {
  const provider = parseProvider(field(row, `${prefix}_provider`));
  const model = text(field(row, `${prefix}_model`));
  const inUsd = num(field(row, `${prefix}_in_usd`));
  const outUsd = num(field(row, `${prefix}_out_usd`));
  if (provider === null || model === null || inUsd === null || outUsd === null) return null;
  return { provider, model, inUsd, outUsd };
}

/** The triage's active configuration and its draft, each with its prompt, prices and limits. */
export async function readTriageConfigurations(): Promise<AdminRead<TriageConfiguration[]>> {
  return parsedList(await call("admin_triage_configurations"), (row) => {
    const label = field(row, "label");
    const id = whole(field(row, "configuration_id"));
    const cheap = parseTier(row, "cheap");
    const strong = parseTier(row, "strong");
    const prompt = text(field(row, "prompt"));
    const escalateBelow = num(field(row, "escalate_below"));
    const payloadTokens = whole(field(row, "payload_tokens"));
    const sampleCards = whole(field(row, "sample_cards"));
    const setAt = parseTime(field(row, "set_at"));
    const setBy = optionalText(field(row, "set_by_email"));
    if (label !== "active" && label !== "test") return null;
    if (id === null || cheap === null || strong === null || prompt === null) return null;
    if (escalateBelow === null || payloadTokens === null || sampleCards === null) return null;
    if (setAt === null || setBy === undefined) return null;
    return {
      label,
      id,
      cheap,
      strong,
      prompt,
      escalateBelow,
      payloadTokens,
      sampleCards,
      setAt,
      setByEmail: setBy,
    };
  });
}
