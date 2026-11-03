import "server-only";

import { cookies } from "next/headers";

import { describeContent, parseCells, parseContent, sidesOf } from "@/features/decks";
import { parseTimeZone, timeZoneCookie } from "@/features/study";
import { classifyFailure, requestTimeoutMs, type ServerFailure } from "@/supabase/failure";
import { field, parseTime } from "@/supabase/row";
import { createClient } from "@/supabase/server";
import { readUserId } from "@/supabase/session";

import { type CallFailure, type ExtractionCall, type Outcome, type OutcomeDay } from "./outcomes";
import type { BreakdownRow } from "./usage";

/** Why an admin read failed: the server's failure, `rejected` for a caller who is not an admin, or a row this version cannot read. */
export type AdminFailure = ServerFailure | "unreadable";

/** An admin read's result: its value, or why there is none. */
export type AdminRead<T> = { data: T } | { failure: AdminFailure };

/** A deck's place in the public listing: public or private, hidden by moderation, deleted by its owner. */
export type DeckState = { visibility: "public" | "private"; hidden: boolean; deleted: boolean };

/** Who owns a deck: the account's email and, once the owner published, its display name. */
export type Owner = { id: string; email: string; name: string | null };

/** A view of the 노트 section's list (ADR 0155). */
export type NoteView = "reported" | "public" | "hidden";

/** A public note as the 노트 section lists it. */
export type NoteRow = {
  id: string;
  name: string;
  owner: Owner;
  hidden: boolean;
  cards: number;
  copies: number;
  reports: number;
  reasons: string[];
  /** When its oldest standing report was made; null with none. */
  firstReportedAt: number | null;
  publishedAt: number | null;
};

/** The open reports: how many notes others can still see carry one, and the oldest one's age in whole days. */
export type OpenReports = { notes: number; oldestDays: number | null };

/** One figure of the last 7 days and of the 7 before. */
export type WeekPair = { current: number; previous: number };

/** The last 7 study days against the 7 before: new users, and the daily average who studied. */
export type WeekActivity = { newUsers: WeekPair; studiedDaily: WeekPair };

/** A prompt label that is set, its version, and the whole days since it was set. */
export type PromptLabelSet = { label: PromptLabel; versionId: number; daysSince: number };

export type PublicDeck = {
  id: string;
  name: string;
  owner: Owner;
  hidden: boolean;
  cards: number;
  copies: number;
  reports: number;
  publishedAt: number | null;
};

export type AdminDeck = {
  id: string;
  name: string;
  description: string | null;
  owner: Owner;
  state: DeckState;
  copies: number;
  reports: number;
  reasons: string[];
  /** Its removal from sharing for good, when an admin removed it (ADR 0072). */
  removal: { reason: string; removedAt: number } | null;
  /** The live cards, oldest first, each side as the one line of text it shows. */
  cards: { id: string; front: string; back: string }[];
};

export type UserMatch = { id: string; email: string; createdAt: number; suspended: boolean };

/** A page of the users a search matched, and how many it matched in all. */
export type UserPage = { users: UserMatch[]; total: number };

/** A user's deck as the user's page lists it. */
export type UserDeck = {
  id: string;
  name: string;
  visibility: "public" | "private";
  hidden: boolean;
  removed: boolean;
  cards: number;
  /** Its reports, read for a public note; 0 for a private one. */
  reports: number;
};

/** Why, when and by whom a user was suspended. */
export type Suspension = { reason: string; suspendedAt: number; suspendedByEmail: string | null };

/** A plan, as the server names it. */
export type PlanId = "free" | "pro" | "max";

/**
 * How a plan version counts photos: [amount] a calendar month or a day in Asia/Seoul, or
 * unlimited with [amount] the fair-use cap a day (ADR 0097).
 */
export type Quota = "monthly" | "daily" | "unlimited";

/** One version of a plan's terms, as an admin created it. */
export type PlanVersion = {
  id: number;
  plan: PlanId;
  quota: Quota;
  amount: number;
  startsAt: number;
  /** Whether existing users take it from its start rather than at their renewal. */
  appliesToAll: boolean;
  /** Whether a user subscribing now takes it. */
  current: boolean;
  createdAt: number;
  createdByEmail: string | null;
};

/**
 * A user's plan now: the version's terms and the photos counted in its period, null while the plan
 * has no version, and the grant behind it, when there is one; an ended Max grant shows beside Free.
 */
export type UserPlan = {
  entitlement: {
    plan: PlanId;
    quota: Quota;
    amount: number;
    /** The plan's active AI configuration, null while it has none (ADR 0162). */
    serving: { provider: Provider; model: string } | null;
    used: number;
  } | null;
  grant: {
    plan: "pro" | "max";
    endsAt: number | null;
    grantedAt: number;
    grantedByEmail: string | null;
  } | null;
};

/**
 * Whether no photo limit applies to a user now, as the server decides it (ADR 0157): an admin, or
 * a 무제한 grant that has not ended; and the grant, ended or not, when there is one.
 */
export type UserUnlimited = {
  unlimited: boolean;
  grant: {
    endsAt: number | null;
    /** Whether its end has passed when it was read. */
    ended: boolean;
    grantedAt: number;
    grantedByEmail: string | null;
  } | null;
};

export type AdminUser = {
  id: string;
  email: string;
  createdAt: number;
  lastAnswerAt: number | null;
  decks: number;
  cards: number;
  admin: boolean;
  plan: UserPlan;
  unlimited: UserUnlimited;
  suspension: Suspension | null;
  /** Every live deck of the user, public or private, newest first. */
  allDecks: UserDeck[];
  /** The next renewal, when the user takes the plan's version then in effect, as "2026-12-01". */
  renewal: string;
};

export type AdminMember = {
  id: string;
  email: string;
  grantedAt: number;
  grantedByEmail: string | null;
  /** Whether this is the signed-in admin, whose own role the area does not offer to revoke. */
  self: boolean;
};

export type AuditEntry = {
  id: number;
  at: number;
  adminEmail: string;
  action: string;
  targetKind: string;
  targetId: string;
  detail: Record<string, unknown>;
};

/** The whole days from [time] to now. */
function wholeDaysSince(time: number): number {
  return Math.floor((Date.now() - time) / 86_400_000);
}

/**
 * The renewal after [now]: the 1st of the next month in Asia/Seoul, when each user takes the
 * version then in effect (ADR 0097; `private.entitlement_of` on the server), as "2026-12-01".
 */
function nextRenewal(now: number): string {
  const [year = 0, month = 0] = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" })
    .format(now)
    .split("-")
    .map(Number);
  const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  return `${String(next.year)}-${String(next.month).padStart(2, "0")}-01`;
}

/** The zone the browser names in its cookie, in which the admin area shows times, or the fallback. */
export async function adminTimeZone(): Promise<string> {
  return parseTimeZone(
    (await cookies()).getAll().find((cookie) => cookie.name === timeZoneCookie)?.value,
  );
}

/**
 * Whether the signed-in user is an admin, as the server's `is_admin` answers; false without a
 * session the server accepts. A server that cannot be reached, or an answer this version cannot
 * read, is a failure.
 */
export async function readIsAdmin(): Promise<boolean | { failure: AdminFailure }> {
  const read = await call("is_admin");
  if ("failure" in read) return read.failure === "rejected" ? false : read;
  return typeof read.data === "boolean" ? read.data : { failure: "unreadable" };
}

/** The last 7 study days, from 04:00 in the zone the browser names, against the 7 before. */
export async function readWeekActivity(): Promise<AdminRead<WeekActivity>> {
  const read = await call("admin_week_activity", { time_zone: await adminTimeZone() });
  if ("failure" in read) return read;
  const row = only(read.data);
  const [newThis, newLast, studiedThis, studiedLast] = [
    "new_users_this",
    "new_users_last",
    "studied_this",
    "studied_last",
  ].map((key) => count(field(row, key)));
  if (newThis == null || newLast == null || studiedThis == null || studiedLast == null) {
    return { failure: "unreadable" };
  }
  // The server counts each user once a study day over the 7; the page shows a day's average.
  return {
    data: {
      newUsers: { current: newThis, previous: newLast },
      studiedDaily: { current: studiedThis / 7, previous: studiedLast / 7 },
    },
  };
}

/** The public notes of [view] whose name or owner's email holds [search] (ADR 0155). */
export async function readNotes(view: NoteView, search: string): Promise<AdminRead<NoteRow[]>> {
  return parsed(await call("admin_note_list", { view, search }), (row) => {
    const id = text(field(row, "deck_id"));
    const name = text(field(row, "name"));
    const owner = parseOwner(row);
    const hidden = field(row, "hidden");
    const cards = count(field(row, "cards"));
    const copies = count(field(row, "copy_count"));
    const reports = count(field(row, "reports"));
    const reasons = strings(field(row, "reasons"));
    const first = field(row, "first_reported_at");
    const firstReportedAt = first === null ? null : parseTime(first);
    const published = field(row, "published_at");
    const publishedAt = published === null ? null : parseTime(published);
    if (id === null || name === null || !owner || typeof hidden !== "boolean") return null;
    if (cards === null || copies === null || reports === null || !reasons) return null;
    if (first !== null && firstReportedAt === null) return null;
    if (published !== null && publishedAt === null) return null;
    return {
      id,
      name,
      owner,
      hidden,
      cards,
      copies,
      reports,
      reasons,
      firstReportedAt,
      publishedAt,
    };
  });
}

/** The open reports: the reported notes others can still see, and the oldest report among them. */
export async function readOpenReports(): Promise<AdminRead<OpenReports>> {
  const read = await readNotes("reported", "");
  if ("failure" in read) return read;
  const times = read.data.flatMap((note) => note.firstReportedAt ?? []);
  return {
    data: {
      notes: read.data.length,
      oldestDays: times.length === 0 ? null : wholeDaysSince(Math.min(...times)),
    },
  };
}

/** Every public deck of [owner], each with its reports. */
async function readPublicDecks(owner: string): Promise<AdminRead<PublicDeck[]>> {
  return parsed(await call("admin_public_decks", { owner }), parsePublicDeck);
}

/** Any deck with its live cards and its removal from sharing, or null for a deck that does not exist. */
export async function readDeck(id: string): Promise<AdminRead<AdminDeck | null>> {
  const [deckRead, cardsRead] = await Promise.all([
    call("admin_user_deck", { deck_id: id }),
    call("admin_user_deck_cards", { deck_id: id }),
  ]);
  if ("failure" in deckRead) return deckRead;
  if ("failure" in cardsRead) return cardsRead;
  if (Array.isArray(deckRead.data) && deckRead.data.length === 0) return { data: null };
  const row = only(deckRead.data);
  const name = text(field(row, "name"));
  const description = field(row, "description");
  const owner = parseOwner(row);
  const state = parseState(row);
  const copies = count(field(row, "copy_count"));
  const reports = count(field(row, "reports"));
  const reasons = strings(field(row, "reasons"));
  const removalReason = field(row, "removal_reason");
  const removedAt = parseTime(field(row, "removed_at"));
  const removal =
    typeof removalReason === "string" && removedAt !== null
      ? { reason: removalReason, removedAt }
      : null;
  if (removalReason !== null && removal === null) return { failure: "unreadable" };
  const cards = rows(cardsRead.data, (cardRow) => {
    const cardId = text(field(cardRow, "card_id"));
    // The call returns no template: a 칸 list reads an earlier front as it was drawn, and a 칸
    // card's stored back is empty.
    const cells = parseCells(field(cardRow, "front"));
    const back = parseContent(field(cardRow, "back"));
    if (cardId === null || !cells || !back) return null;
    const sides = sidesOf(cells);
    return {
      id: cardId,
      front: describeContent(sides.front),
      back: describeContent([...sides.back, ...back]),
    };
  });
  if (name === null || (description !== null && typeof description !== "string")) {
    return { failure: "unreadable" };
  }
  if (!owner || !state || copies === null || reports === null || !reasons || !cards) {
    return { failure: "unreadable" };
  }
  return {
    data: { id, name, description, owner, state, copies, reports, reasons, removal, cards },
  };
}

/**
 * The search's pages 0 to [last], as one page: the users of each in order and the matches in
 * all, read as "더 보기" would have read them. Past the matches' last page it reads no further.
 */
export async function searchUsersThrough(
  query: string,
  last: number,
): Promise<AdminRead<UserPage>> {
  const first = await searchUsers(query, 0);
  if ("failure" in first) return first;
  const pages = Math.min(last, Math.ceil(first.data.total / userPageSize) - 1);
  const rest = await Promise.all(
    Array.from({ length: Math.max(pages, 0) }, (_, index) => searchUsers(query, index + 1)),
  );
  const users = [...first.data.users];
  for (const page of rest) {
    if ("failure" in page) return page;
    users.push(...page.data.users);
  }
  return { data: { users, total: first.data.total } };
}

/** How many users a page of the search holds. */
const userPageSize = 20;

/**
 * The [page]th page of the users whose email holds [query], ignoring case, those it starts first,
 * with the matches in all.
 */
export async function searchUsers(query: string, page: number): Promise<AdminRead<UserPage>> {
  const read = await call("admin_search_users", {
    query,
    page_size: userPageSize,
    page_offset: page * userPageSize,
  });
  if ("failure" in read) return read;
  let total = 0;
  const users = rows(read.data, (row) => {
    const id = text(field(row, "user_id"));
    const email = text(field(row, "email"));
    const createdAt = parseTime(field(row, "created_at"));
    const suspended = field(row, "suspended");
    const matches = count(field(row, "total"));
    if (id === null || email === null || createdAt === null || matches === null) return null;
    if (typeof suspended !== "boolean") return null;
    total = matches;
    return { id, email, createdAt, suspended };
  });
  return users ? { data: { users, total } } : { failure: "unreadable" };
}

/** One user with their public decks, or null when no user has [id]. */
export async function readUser(id: string): Promise<AdminRead<AdminUser | null>> {
  const [userRead, decksRead, planRead, unlimitedRead, suspensionRead, allDecksRead] =
    await Promise.all([
      call("admin_user", { user_id: id }),
      readPublicDecks(id),
      call("admin_user_plan", { user_id: id }),
      call("admin_user_unlimited", { user_id: id }),
      call("admin_user_suspension", { user_id: id }),
      call("admin_user_decks", { user_id: id }),
    ]);
  if ("failure" in userRead) return userRead;
  if ("failure" in decksRead) return decksRead;
  if ("failure" in planRead) return planRead;
  if ("failure" in unlimitedRead) return unlimitedRead;
  if ("failure" in suspensionRead) return suspensionRead;
  if ("failure" in allDecksRead) return allDecksRead;
  const suspensions = rows(suspensionRead.data, parseSuspension);
  const allDecks = rows(allDecksRead.data, parseUserDeck);
  if (!suspensions || !allDecks) return { failure: "unreadable" };
  const reports = new Map(decksRead.data.map((deck) => [deck.id, deck.reports]));
  if (Array.isArray(userRead.data) && userRead.data.length === 0) return { data: null };
  const plan = parseUserPlan(only(planRead.data));
  const unlimited = parseUserUnlimited(only(unlimitedRead.data), Date.now());
  if (!plan || !unlimited) return { failure: "unreadable" };
  const row = only(userRead.data);
  const email = text(field(row, "email"));
  const createdAt = parseTime(field(row, "created_at"));
  const lastAnswer = field(row, "last_answer_at");
  const lastAnswerAt = lastAnswer === null ? null : parseTime(lastAnswer);
  const decks = count(field(row, "decks"));
  const cards = count(field(row, "cards"));
  const admin = field(row, "admin");
  if (email === null || createdAt === null || (lastAnswer !== null && lastAnswerAt === null)) {
    return { failure: "unreadable" };
  }
  if (decks === null || cards === null || typeof admin !== "boolean") {
    return { failure: "unreadable" };
  }
  return {
    data: {
      id,
      email,
      createdAt,
      lastAnswerAt,
      decks,
      cards,
      admin,
      plan,
      unlimited,
      suspension: suspensions[0] ?? null,
      allDecks: allDecks.map((deck) => ({ ...deck, reports: reports.get(deck.id) ?? 0 })),
      renewal: nextRenewal(Date.now()),
    },
  };
}

/** An AI provider a plan's configuration may name (ADR 0162). */
export type Provider = "openrouter" | "openai" | "anthropic";

export const providers: readonly Provider[] = ["openrouter", "openai", "anthropic"];

/** [value], which crossed the network, as a provider; null for any other. */
export function parseProvider(value: unknown): Provider | null {
  return providers.find((known) => known === value) ?? null;
}

/**
 * One provider's key as the admin area sees it: its last four characters, who set it and when,
 * null while Vault holds none, and whether an active configuration uses it. Never the key.
 */
export type ProviderKey = {
  provider: Provider;
  key: { lastFour: string; setAt: number; setByEmail: string | null } | null;
  inUse: boolean;
};

/** A plan's labelled configuration: its active one, or its draft served to admins ('test'). */
export type AiConfiguration = {
  plan: PlanId;
  label: "active" | "test";
  id: number;
  provider: Provider;
  model: string;
  createdAt: number;
  createdByEmail: string | null;
};

/** Each provider's key state, OpenRouter's first. */
export async function readProviderKeys(): Promise<AdminRead<ProviderKey[]>> {
  return parsed(await call("admin_provider_keys"), (row) => {
    const provider = parseProvider(field(row, "provider"));
    const lastFour = field(row, "last_four");
    const setAt = field(row, "set_at");
    const setBy = field(row, "set_by_email");
    const inUse = field(row, "in_use");
    if (provider === null || typeof inUse !== "boolean") return null;
    if (lastFour === null) return { provider, key: null, inUse };
    const at = parseTime(setAt);
    if (typeof lastFour !== "string" || at === null) return null;
    if (setBy !== null && typeof setBy !== "string") return null;
    return { provider, key: { lastFour, setAt: at, setByEmail: setBy }, inUse };
  });
}

/** Each plan's active configuration and draft. */
export async function readAiConfigurations(): Promise<AdminRead<AiConfiguration[]>> {
  return parsed(await call("admin_ai_configurations"), (row) => {
    const plan = planId(field(row, "plan"));
    const label = field(row, "label");
    const id = count(field(row, "configuration_id"));
    const provider = parseProvider(field(row, "provider"));
    const model = text(field(row, "model"));
    const createdAt = parseTime(field(row, "created_at"));
    const createdBy = field(row, "created_by_email");
    if (plan === null || id === null || provider === null || model === null) return null;
    if ((label !== "active" && label !== "test") || createdAt === null) return null;
    if (createdBy !== null && typeof createdBy !== "string") return null;
    return { plan, label, id, provider, model, createdAt, createdByEmail: createdBy };
  });
}

/** Every plan version, Free's first, then Pro's and Max's, each plan's latest start first. */
export async function readPlanVersions(): Promise<AdminRead<PlanVersion[]>> {
  return parsed(await call("admin_plan_versions"), (row) => {
    const id = count(field(row, "id"));
    const plan = planId(field(row, "plan"));
    const kind = quota(field(row, "quota"));
    const amount = count(field(row, "amount"));
    const startsAt = parseTime(field(row, "starts_at"));
    const appliesToAll = field(row, "applies_to_all");
    const current = field(row, "current");
    const createdAt = parseTime(field(row, "created_at"));
    const createdBy = field(row, "created_by_email");
    if (id === null || plan === null || kind === null || amount === null) return null;
    if (startsAt === null || createdAt === null) return null;
    if (typeof appliesToAll !== "boolean" || typeof current !== "boolean") return null;
    if (createdBy !== null && typeof createdBy !== "string") return null;
    return {
      id,
      plan,
      quota: kind,
      amount,
      startsAt,
      appliesToAll,
      current,
      createdAt,
      createdByEmail: createdBy,
    };
  });
}

function parseUserPlan(row: unknown): UserPlan | null {
  const plan = field(row, "plan");
  const granted = field(row, "granted_plan");
  const endsAtValue = field(row, "ends_at");
  const grantedAtValue = field(row, "granted_at");
  const grantedBy = field(row, "granted_by_email");
  // The entitlement's columns are null together, while the plan has no version.
  let entitlement: UserPlan["entitlement"] = null;
  if (plan !== null) {
    const id = planId(plan);
    const kind = quota(field(row, "quota"));
    const amount = count(field(row, "amount"));
    const used = count(field(row, "used"));
    const providerValue = field(row, "provider");
    const modelValue = field(row, "model");
    if (id === null || kind === null || amount === null || used === null) return null;
    // Provider and model are null together, while the plan has no active configuration.
    let serving: { provider: Provider; model: string } | null = null;
    if (providerValue !== null || modelValue !== null) {
      const provider = parseProvider(providerValue);
      const model = text(modelValue);
      if (provider === null || model === null) return null;
      serving = { provider, model };
    }
    entitlement = { plan: id, quota: kind, amount, serving, used };
  }
  if (granted === null) return { entitlement, grant: null };
  const endsAt = endsAtValue === null ? null : parseTime(endsAtValue);
  const grantedAt = parseTime(grantedAtValue);
  if (granted !== "pro" && granted !== "max") return null;
  if ((endsAtValue !== null && endsAt === null) || grantedAt === null) return null;
  if (grantedBy !== null && typeof grantedBy !== "string") return null;
  return { entitlement, grant: { plan: granted, endsAt, grantedAt, grantedByEmail: grantedBy } };
}

function parseUserUnlimited(row: unknown, now: number): UserUnlimited | null {
  const unlimited = field(row, "unlimited");
  const endsAtValue = field(row, "ends_at");
  const grantedAtValue = field(row, "granted_at");
  const grantedBy = field(row, "granted_by_email");
  if (typeof unlimited !== "boolean") return null;
  // The grant's columns are null together, while the user has no grant.
  if (grantedAtValue === null) return { unlimited, grant: null };
  const endsAt = endsAtValue === null ? null : parseTime(endsAtValue);
  const grantedAt = parseTime(grantedAtValue);
  if ((endsAtValue !== null && endsAt === null) || grantedAt === null) return null;
  if (grantedBy !== null && typeof grantedBy !== "string") return null;
  const ended = endsAt !== null && endsAt <= now;
  return { unlimited, grant: { endsAt, ended, grantedAt, grantedByEmail: grantedBy } };
}

function parseSuspension(row: unknown): Suspension | null {
  const reason = text(field(row, "reason"));
  const suspendedAt = parseTime(field(row, "suspended_at"));
  const by = field(row, "suspended_by_email");
  if (reason === null || suspendedAt === null) return null;
  if (by !== null && typeof by !== "string") return null;
  return { reason, suspendedAt, suspendedByEmail: by };
}

function parseUserDeck(row: unknown): Omit<UserDeck, "reports"> | null {
  const id = text(field(row, "deck_id"));
  const name = field(row, "name");
  const visibility = field(row, "visibility");
  const hidden = field(row, "hidden");
  const removed = field(row, "removed");
  const cards = count(field(row, "cards"));
  if (id === null || typeof name !== "string" || cards === null) return null;
  if (visibility !== "public" && visibility !== "private") return null;
  if (typeof hidden !== "boolean" || typeof removed !== "boolean") return null;
  return { id, name, visibility, hidden, removed, cards };
}

function planId(value: unknown): PlanId | null {
  return value === "free" || value === "pro" || value === "max" ? value : null;
}

function quota(value: unknown): Quota | null {
  return value === "monthly" || value === "daily" || value === "unlimited" ? value : null;
}

/** The admins, earliest granted first, the signed-in one marked. */
export async function readAdmins(): Promise<AdminRead<AdminMember[]>> {
  const supabase = await createClient();
  const session = await readUserId(supabase);
  if ("failure" in session) return session;
  return parsed(await call("admin_admins"), (row) => {
    const id = text(field(row, "user_id"));
    const email = text(field(row, "email"));
    const grantedAt = parseTime(field(row, "granted_at"));
    const grantedBy = field(row, "granted_by_email");
    if (id === null || email === null || grantedAt === null) return null;
    if (grantedBy !== null && typeof grantedBy !== "string") return null;
    return { id, email, grantedAt, grantedByEmail: grantedBy, self: id === session.userId };
  });
}

/** The latest 100 entries of the audit log, newest first. */
export async function readAuditLog(): Promise<AdminRead<AuditEntry[]>> {
  return parsed(await call("admin_audit_log"), (row) => {
    const id = count(field(row, "id"));
    const at = parseTime(field(row, "created_at"));
    const adminEmail = field(row, "admin_email");
    const action = text(field(row, "action"));
    const targetKind = text(field(row, "target_kind"));
    const targetId = text(field(row, "target_id"));
    const detail = field(row, "detail");
    if (id === null || at === null || typeof adminEmail !== "string" || action === null) {
      return null;
    }
    if (targetKind === null || targetId === null || !isRecord(detail)) return null;
    return { id, at, adminEmail, action, targetKind, targetId, detail };
  });
}

/** The last [days] UTC days' photos by the plan, model and prompt version that served them. */
export async function readExtractionBreakdown(days: number): Promise<AdminRead<BreakdownRow[]>> {
  return parsed(await call("admin_extraction_breakdown", { days }), (row) => {
    const date = field(row, "day");
    const plan = field(row, "plan");
    const model = field(row, "model");
    const version = field(row, "prompt_version_id");
    const photos = count(field(row, "photos"));
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || photos === null)
      return null;
    // A photo counted before calls were recorded has none of the three.
    if (plan === null && model === null && version === null) {
      return { day: date, plan: null, model: null, promptVersion: null, photos };
    }
    const id = planId(plan);
    const versionId = count(version);
    if (id === null || typeof model !== "string" || versionId === null) return null;
    return { day: date, plan: id, model, promptVersion: versionId, photos };
  });
}

/** How many recorded extractions a page of a version's calls lists. */
export const extractionPageSize = 50;

/**
 * The extractions prompt version [versionId] served, newest first, a page of them before the usage
 * id [before], or the newest page when it is null. The user each served is not read.
 */
export async function readVersionCalls(
  versionId: number,
  before: number | null,
): Promise<AdminRead<ExtractionCall[]>> {
  return parsed(
    await call("admin_version_calls", {
      version_id: versionId,
      before,
      page_size: extractionPageSize,
    }),
    (row) => {
      const usageId = count(field(row, "usage_id"));
      const at = parseTime(field(row, "created_at"));
      const plan = text(field(row, "plan"));
      if (usageId === null || at === null || plan === null) return null;
      const outcome = field(row, "outcome");
      const attempts = field(row, "attempts");
      const latencyMs = count(field(row, "latency_ms"));
      const cardsReturned = count(field(row, "cards_returned"));
      const cardsDropped = count(field(row, "cards_dropped"));
      const failures = callFailures(field(row, "failures"));
      // The outcome's columns are null together, for a call without an outcome.
      if (outcome === null) {
        const rest = [attempts, latencyMs, cardsReturned, cardsDropped, failures];
        return rest.every((value) => value === null) ? { usageId, at, plan, result: null } : null;
      }
      if (!isOutcome(outcome) || (attempts !== 1 && attempts !== 2)) return null;
      if (latencyMs === null || cardsReturned === null || cardsDropped === null || !failures) {
        return null;
      }
      return {
        usageId,
        at,
        plan,
        result: { outcome, attempts, latencyMs, cardsReturned, cardsDropped, failures },
      };
    },
  );
}

/** Each UTC day's recorded extractions over the last [days] days, by prompt version. */
export async function readExtractionOutcomes(days: number): Promise<AdminRead<OutcomeDay[]>> {
  return parsed(await call("admin_extraction_failures", { days }), (row) => {
    const day = field(row, "day");
    const promptVersion = count(field(row, "prompt_version_id"));
    const [calls, ok, noCards, invalidOutput, modelError, retried, recovered, unrecorded] = [
      "calls",
      "ok",
      "no_cards",
      "invalid_output",
      "model_error",
      "retried",
      "recovered",
      "unrecorded",
    ].map((key) => count(field(row, key)));
    if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day) || promptVersion === null) {
      return null;
    }
    if (
      calls == null ||
      ok == null ||
      noCards == null ||
      invalidOutput == null ||
      modelError == null ||
      retried == null ||
      recovered == null ||
      unrecorded == null
    ) {
      return null;
    }
    return {
      day,
      promptVersion,
      calls,
      ok,
      noCards,
      invalidOutput,
      modelError,
      retried,
      recovered,
      unrecorded,
    };
  });
}

function isOutcome(value: unknown): value is Outcome {
  return (
    value === "ok" || value === "no_cards" || value === "invalid_output" || value === "model_error"
  );
}

function callFailures(value: unknown): CallFailure[] | null {
  const list = strings(value);
  if (list === null) return null;
  const kinds: CallFailure[] = [];
  for (const kind of list) {
    if (kind !== "invalid_output" && kind !== "model_error" && kind !== "timeout") return null;
    kinds.push(kind);
  }
  return kinds;
}

/** A prompt label: `active` serves every user, `test` the admins (ADR 0073). */
export type PromptLabel = "active" | "test";

/** A saved prompt version, as the prompts page lists it. */
export type PromptVersion = {
  id: number;
  note: string;
  length: number;
  createdByEmail: string | null;
  createdAt: number;
  labels: PromptLabel[];
};

/** One version with its text, and the active version's beside it for the diff. */
export type PromptDetail = PromptVersion & {
  text: string;
  active: { id: number; text: string } | null;
};

/** Every saved prompt version, newest first. */
export async function readPromptVersions(): Promise<AdminRead<PromptVersion[]>> {
  return parsed(await call("admin_prompt_versions"), (row) =>
    parsePromptVersion(row, count(field(row, "length"))),
  );
}

/** Version [id] with its text and the active version's, or null when there is no such version. */
export async function readPromptVersion(id: number): Promise<AdminRead<PromptDetail | null>> {
  const read = parsed(await call("admin_prompt_version", { version_id: id }), (row) => {
    const text = field(row, "text");
    if (typeof text !== "string") return null;
    const version = parsePromptVersion(row, text.length);
    const activeId = field(row, "active_id");
    const activeText = field(row, "active_text");
    if (version === null) return null;
    // Both are null together while no version is active.
    if (activeId === null && activeText === null) return { ...version, text, active: null };
    const active = count(activeId);
    if (active === null || typeof activeText !== "string") return null;
    return { ...version, text, active: { id: active, text: activeText } };
  });
  if ("failure" in read) return read;
  return { data: read.data[0] ?? null };
}

/** Each prompt label that is set, with its version and when it was set. */
export async function readPromptLabels(): Promise<AdminRead<PromptLabelSet[]>> {
  return parsed(await call("admin_prompt_labels"), (row) => {
    const label = field(row, "label");
    const versionId = count(field(row, "version_id"));
    const setAt = parseTime(field(row, "set_at"));
    if ((label !== "active" && label !== "test") || versionId === null || setAt === null) {
      return null;
    }
    return { label, versionId, daysSince: wholeDaysSince(setAt) };
  });
}

function parsePromptVersion(row: unknown, length: number | null): PromptVersion | null {
  const id = count(field(row, "id"));
  const note = field(row, "note");
  const createdBy = field(row, "created_by_email");
  const createdAt = parseTime(field(row, "created_at"));
  const labels = promptLabels(field(row, "labels"));
  if (id === null || typeof note !== "string" || length === null || createdAt === null) return null;
  if ((createdBy !== null && typeof createdBy !== "string") || labels === null) return null;
  return { id, note, length, createdByEmail: createdBy, createdAt, labels };
}

function promptLabels(value: unknown): PromptLabel[] | null {
  const list = strings(value);
  if (list === null) return null;
  const labels: PromptLabel[] = [];
  for (const label of list) {
    if (label !== "active" && label !== "test") return null;
    labels.push(label);
  }
  return labels;
}

/** Calls the server function [name] with [args] as the signed-in user. */
async function call(
  name: string,
  args?: Record<string, unknown>,
): Promise<{ data: unknown } | { failure: AdminFailure }> {
  const supabase = await createClient();
  const result = await supabase.rpc(name, args).abortSignal(AbortSignal.timeout(requestTimeoutMs));
  if (result.error) return { failure: classifyFailure(result.error, result.status) };
  const data: unknown = result.data;
  return { data };
}

function parsed<T>(
  read: { data: unknown } | { failure: AdminFailure },
  parse: (row: unknown) => T | null,
): AdminRead<T[]> {
  if ("failure" in read) return read;
  const list = rows(read.data, parse);
  return list ? { data: list } : { failure: "unreadable" };
}

function parsePublicDeck(row: unknown): PublicDeck | null {
  const id = text(field(row, "deck_id"));
  const name = text(field(row, "name"));
  const owner = parseOwner(row);
  const hidden = field(row, "hidden");
  const cards = count(field(row, "cards"));
  const copies = count(field(row, "copy_count"));
  const reports = count(field(row, "reports"));
  const published = field(row, "published_at");
  const publishedAt = published === null ? null : parseTime(published);
  if (id === null || name === null || !owner || typeof hidden !== "boolean") return null;
  if (cards === null || copies === null || reports === null) return null;
  if (published !== null && publishedAt === null) return null;
  return { id, name, owner, hidden, cards, copies, reports, publishedAt };
}

function parseOwner(row: unknown): Owner | null {
  const id = text(field(row, "owner_id"));
  const email = field(row, "owner_email");
  const name = field(row, "owner_name");
  if (id === null || typeof email !== "string") return null;
  if (name !== null && typeof name !== "string") return null;
  return { id, email, name };
}

function parseState(row: unknown): DeckState | null {
  const visibility = field(row, "visibility");
  const hidden = field(row, "hidden");
  const deleted = field(row, "deleted");
  if (visibility !== "public" && visibility !== "private") return null;
  if (typeof hidden !== "boolean" || typeof deleted !== "boolean") return null;
  return { visibility, hidden, deleted };
}

/** Each of [value]'s rows parsed by [parse], or null when it is not an array or one does not parse. */
function rows<T>(value: unknown, parse: (row: unknown) => T | null): T[] | null {
  if (!Array.isArray(value)) return null;
  const parsedRows: T[] = [];
  for (const row of value) {
    const one = parse(row);
    if (one === null) return null;
    parsedRows.push(one);
  }
  return parsedRows;
}

/** The one row of a function that returns a table of one row, or undefined. */
function only(value: unknown): unknown {
  return Array.isArray(value) && value.length === 1 ? (value[0] as unknown) : undefined;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function strings(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const list: string[] = [];
  for (const item of value as unknown[]) {
    if (typeof item !== "string") return null;
    list.push(item);
  }
  return list;
}

/** [value] when it is a whole number at least zero, or null. */
function count(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
