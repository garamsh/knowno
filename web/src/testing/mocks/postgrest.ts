import { http, HttpResponse } from "msw";

import type { CardId } from "@/features/decks";
import { recordDays, streak, studyDayStart } from "@/features/study";

import { bearerUser, supabaseUrl, testUser } from "./handlers";

type Row = Record<string, unknown>;
type Table = "decks" | "cards" | "reviews" | "card_states" | "media" | "profiles";

const tables: readonly Table[] = ["decks", "cards", "reviews", "card_states", "media", "profiles"];

/** The columns each table's primary key holds, as server.md lists them. */
const keys: Record<Table, readonly string[]> = {
  decks: ["id"],
  cards: ["id"],
  reviews: ["id"],
  card_states: ["user_id", "card_id"],
  media: ["user_id", "id"],
  profiles: ["user_id"],
};

/** The columns a client may update in each table: every one but a review's, as server.md grants. */
const updatable: Record<Table, readonly string[] | null> = {
  decks: null,
  cards: null,
  reviews: ["rating", "updated_at"],
  card_states: null,
  media: [],
  profiles: ["display_name"],
};

/**
 * Every column of the tables whose requests the fake checks, as server.md lists them; a filter,
 * a selected column or a written one outside them is refused, as PostgREST refuses it.
 */
const columns: Record<Table, readonly string[] | null> = {
  decks: null,
  cards: null,
  reviews: [
    "id",
    "user_id",
    "card_id",
    "rating",
    "reviewed_at",
    "duration_ms",
    "fuzz_factor",
    "updated_at",
    "revision",
  ],
  card_states: [
    "user_id",
    "card_id",
    "stability",
    "difficulty",
    "last_review",
    "due",
    "updated_at",
    "revision",
  ],
  media: ["user_id", "id", "kind", "mime_type", "byte_size", "sha256", "created_at"],
  profiles: ["user_id", "display_name", "created_at"],
};

/** PostgREST's answer to a request naming a column [table] lacks, or null when it names none. */
function unknownColumn(table: Table, names: Iterable<string>): Response | null {
  const known = columns[table];
  if (!known) return null;
  for (const name of names) {
    if (!known.includes(name)) {
      return HttpResponse.json(
        { code: "42703", message: `column ${table}.${name} does not exist` },
        { status: 400 },
      );
    }
  }
  return null;
}

/** The columns a request's query string filters on or selects. */
function namedColumns(params: URLSearchParams): string[] {
  const selected = (params.get("select") ?? "*")
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "*");
  return [...[...params.keys()].filter((name) => !reserved.has(name)), ...selected];
}

function isTable(name: string | readonly string[] | undefined): name is Table {
  return typeof name === "string" && (tables as readonly string[]).includes(name);
}

/** Whether [row] passes one PostgREST filter, `<column>=<operator>.<value>`. */
function passes(row: Row, column: string, filter: string): boolean {
  const [operator, ...rest] = filter.split(".");
  const operand = rest.join(".");
  const value = row[column];
  switch (operator) {
    case "is":
      return operand === "null" ? value === null || value === undefined : false;
    case "eq":
      return String(value) === operand;
    case "in": {
      const list = operand.replace(/^\(|\)$/g, "").split(",");
      return list.map((item) => item.replace(/^"|"$/g, "")).includes(String(value));
    }
    case "lt":
      return typeof value === "string" && Date.parse(value) < Date.parse(operand);
    case "gte":
      return typeof value === "string" && Date.parse(value) >= Date.parse(operand);
    default:
      throw new Error(`the fake PostgREST does not know the filter ${column}=${filter}`);
  }
}

const reserved = new Set(["select", "order", "offset", "limit", "on_conflict", "columns"]);

/** The tables' uuid columns, as server.md lists them. */
const uuidColumns = new Set([
  "id",
  "user_id",
  "deck_id",
  "card_id",
  "origin_deck_id",
  "image_media_id",
]);

const uuidForm = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PostgREST's answer to an `eq` or `in` filter on a uuid column with a value that is not a uuid,
 * which Postgres refuses as `22P02` before reading a row, or null when every such value is one.
 */
function malformedUuid(params: URLSearchParams): Response | null {
  for (const [column, filter] of params) {
    if (!uuidColumns.has(column)) continue;
    const [operator, ...rest] = filter.split(".");
    const operand = rest.join(".");
    const values =
      operator === "eq"
        ? [operand]
        : operator === "in"
          ? operand
              .replace(/^\(|\)$/g, "")
              .split(",")
              .map((item) => item.replace(/^"|"$/g, ""))
          : [];
    const bad = values.find((value) => !uuidForm.test(value));
    if (bad !== undefined) {
      return HttpResponse.json(
        { code: "22P02", message: `invalid input syntax for type uuid: "${bad}"` },
        { status: 400 },
      );
    }
  }
  return null;
}

function matching(rows: Row[], params: URLSearchParams): Row[] {
  return rows.filter((row) =>
    [...params].every(([column, filter]) => reserved.has(column) || passes(row, column, filter)),
  );
}

/** [rows] in the order `order=<column>.<asc|desc>` asks for, or as stored without one. */
function ordered(rows: Row[], order: string | null): Row[] {
  if (order === null) return rows;
  const [column = "", direction] = order.split(".");
  const sign = direction === "desc" ? -1 : 1;
  const key = (row: Row) => String(row[column]);
  return rows.toSorted((a, b) => sign * (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

/** A write's answer: the rows it wrote under `Prefer: return=representation`, else none. */
function returned(request: Request, rows: Row[]): Response {
  return request.headers.get("prefer")?.includes("return=representation")
    ? HttpResponse.json(rows)
    : new HttpResponse(null, { status: 204 });
}

/** A request that waits until the test releases it. */
type Held = { release: () => void; released: Promise<void> };

/**
 * PostgREST over the four sync tables, `media` and `profiles`, in memory, for a session Supabase
 * Auth knows: what a test
 * seeds is what the app reads, and what the app writes lands in [rows]. A row a test seeds
 * for another user stands in for one row-level security lets every user read, as another
 * user's public deck and its cards; the request's filters decide whether it is returned. It applies the
 * filters the app sends, its order by one column, the paging of `offset` and `limit` with the
 * count `Prefer: count=exact` asks for, the server's revision on every write, an upsert's
 * `resolution`, the rows a write returns under `Prefer: return=representation`, a `profiles`
 * row's `user_id` defaulting to the caller as the server's does, and the reviews' column grant. It answers `study_streak_before` from the seeded
 * reviews with the web's own `streak`, as the server counts the same days, and
 * `study_days_before` with the web's own `studyDayStart`, as the server groups the same days;
 * `study_record_days` with the web's own `recordDays`, as the server counts the same days; and
 * `study_record_cards` from the seeded decks, cards, states and reviews, as the server joins them.
 * It holds each user's `study_settings` row, which a user reads only its own of, and answers
 * `save_study_settings` as the server does: the later edit wins.
 */
export class FakePostgrest {
  readonly rows: Record<Table, Row[]> = {
    decks: [],
    cards: [],
    reviews: [],
    card_states: [],
    media: [],
    profiles: [],
  };
  /** Each user's study settings, by user id, as `public.study_settings` holds them. */
  readonly studySettings = new Map<string, { daily_minutes: number; updated_at: string }>();
  /** Every request answered, as `<method> <table>`. */
  readonly requests: string[] = [];
  /** The columns each read selected, as `<table>: <select>`. */
  readonly selected: string[] = [];
  private revision = 0;
  private held: Partial<Record<Table, Held>> = {};
  private failing: Partial<Record<Table, number>> = {};

  /** Stores [rows] in [table] as the phone's sync would have, owned by [testUser] unless a row names its `user_id`. */
  seed(table: Table, ...rows: Row[]) {
    for (const row of rows) this.rows[table].push(this.stamp({ user_id: testUser.id, ...row }));
  }

  /** Holds every request to [table] unanswered until the returned function is called. */
  hold(table: Table): () => void {
    let release = () => undefined as void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.held[table] = { release, released };
    return () => {
      delete this.held[table];
      release();
    };
  }

  /** Fails every request to [table] with HTTP [status] until the returned function is called. */
  fail(table: Table, status: number): () => void {
    this.failing[table] = status;
    return () => {
      delete this.failing[table];
    };
  }

  private stamp(row: Row): Row {
    this.revision += 1;
    return { ...row, revision: this.revision };
  }

  private keyOf(table: Table, row: Row): string {
    return keys[table].map((column) => String(row[column])).join("/");
  }

  private async gate(table: Table): Promise<Response | null> {
    await this.held[table]?.released;
    const status = this.failing[table];
    if (status === undefined) return null;
    return HttpResponse.json({ code: "", message: "failing" }, { status });
  }

  readonly handlers = [
    http.get(`${supabaseUrl}/rest/v1/study_settings`, ({ request }) => {
      const user = bearerUser(request.headers.get("authorization"));
      if (!user) {
        return HttpResponse.json({ code: "42501", message: "permission denied" }, { status: 401 });
      }
      this.requests.push("GET study_settings");
      // Row-level security returns the caller's own row alone, whatever the filter names.
      const own = new URL(request.url).searchParams.get("user_id") === `eq.${user.id}`;
      const row = own ? this.studySettings.get(user.id) : undefined;
      const rows = row ? [{ user_id: user.id, ...row }] : [];
      if (request.headers.get("accept")?.includes("vnd.pgrst.object")) {
        return rows.length === 1
          ? HttpResponse.json(rows[0])
          : HttpResponse.json({ code: "PGRST116", message: "no row" }, { status: 406 });
      }
      return HttpResponse.json(rows);
    }),
    http.post(`${supabaseUrl}/rest/v1/rpc/save_study_settings`, async ({ request }) => {
      const user = bearerUser(request.headers.get("authorization"));
      if (!user) {
        return HttpResponse.json({ code: "42501", message: "permission denied" }, { status: 401 });
      }
      this.requests.push("POST rpc/save_study_settings");
      const body = (await request.json()) as { daily_minutes: number; updated_at: string };
      if (body.daily_minutes < 5 || body.daily_minutes > 180) {
        return HttpResponse.json({ code: "23514", message: "check" }, { status: 400 });
      }
      const stored = this.studySettings.get(user.id);
      if (stored && Date.parse(stored.updated_at) >= Date.parse(body.updated_at)) {
        return HttpResponse.json(false);
      }
      this.studySettings.set(user.id, {
        daily_minutes: body.daily_minutes,
        updated_at: body.updated_at,
      });
      return HttpResponse.json(true);
    }),
    http.post(`${supabaseUrl}/rest/v1/rpc/study_streak_before`, async ({ request }) => {
      const refused = await this.gate("reviews");
      if (refused) return refused;
      const user = bearerUser(request.headers.get("authorization"));
      if (!user) {
        return HttpResponse.json({ code: "42501", message: "permission denied" }, { status: 401 });
      }
      this.requests.push("POST rpc/study_streak_before");
      const { time_zone: timeZone, before } = (await request.json()) as {
        time_zone: string;
        before: string;
      };
      const start = studyDayStart(Date.parse(before), timeZone);
      const answers = this.rows.reviews
        .filter((row) => row.user_id === user.id)
        .map((row) => Date.parse(String(row.reviewed_at)))
        .filter((at) => at < start);
      // The day holding [start] has no answer here, so the count starts from the day before it.
      return HttpResponse.json(streak(answers, start, timeZone));
    }),
    http.post(`${supabaseUrl}/rest/v1/rpc/study_days_before`, async ({ request }) => {
      const refused = await this.gate("reviews");
      if (refused) return refused;
      const user = bearerUser(request.headers.get("authorization"));
      if (!user) {
        return HttpResponse.json({ code: "42501", message: "permission denied" }, { status: 401 });
      }
      this.requests.push("POST rpc/study_days_before");
      const body = (await request.json()) as {
        time_zone: string;
        before: string;
        days: number;
        cap_ms: number;
      };
      const live = this.rows.reviews
        .filter((row) => row.user_id === user.id)
        .map((row) => ({
          card: String(row.card_id),
          at: Date.parse(String(row.reviewed_at)),
          ms: Number(row.duration_ms),
        }));
      const before = Date.parse(body.before);
      const totals = new Map<number, Row>();
      for (const answer of live.filter(({ at }) => at < before)) {
        const day = studyDayStart(answer.at, body.time_zone);
        const total = totals.get(day) ?? {
          day_start: new Date(day).toISOString(),
          review_ms: 0,
          reviews: 0,
          first_ms: 0,
          first_answers: 0,
        };
        const first = !live.some(({ card, at }) => card === answer.card && at < answer.at);
        const ms = Math.min(answer.ms, body.cap_ms);
        if (first) {
          total.first_ms = Number(total.first_ms) + ms;
          total.first_answers = Number(total.first_answers) + 1;
        } else {
          total.review_ms = Number(total.review_ms) + ms;
          total.reviews = Number(total.reviews) + 1;
        }
        totals.set(day, total);
      }
      const days = [...totals.keys()].sort((a, b) => a - b).slice(-body.days);
      return HttpResponse.json(days.map((day) => totals.get(day)));
    }),
    http.post(`${supabaseUrl}/rest/v1/rpc/study_record_days`, async ({ request }) => {
      const refused = await this.gate("reviews");
      if (refused) return refused;
      const user = bearerUser(request.headers.get("authorization"));
      if (!user) {
        return HttpResponse.json({ code: "42501", message: "permission denied" }, { status: 401 });
      }
      this.requests.push("POST rpc/study_record_days");
      const body = (await request.json()) as { time_zone: string; before: string };
      const before = Date.parse(body.before);
      const answers = this.rows.reviews
        .filter((row) => row.user_id === user.id)
        .map((row) => ({
          cardId: String(row.card_id) as CardId,
          know: row.rating === "good",
          reviewedAt: Date.parse(String(row.reviewed_at)),
        }))
        .filter((answer) => answer.reviewedAt < before);
      return HttpResponse.json(
        recordDays(answers, body.time_zone).map((day) => ({
          day_start: new Date(day.dayStart).toISOString(),
          cards: day.cards,
          reviews: day.reviews,
          known: day.known,
        })),
      );
    }),
    http.post(`${supabaseUrl}/rest/v1/rpc/study_record_cards`, async ({ request }) => {
      const refused = await this.gate("reviews");
      if (refused) return refused;
      const user = bearerUser(request.headers.get("authorization"));
      if (!user) {
        return HttpResponse.json({ code: "42501", message: "permission denied" }, { status: 401 });
      }
      this.requests.push("POST rpc/study_record_cards");
      const own = (row: Row) => row.user_id === user.id && row.deleted_at == null;
      const decks = new Set(this.rows.decks.filter(own).map((row) => String(row.id)));
      const cards = this.rows.cards
        .filter((row) => own(row) && decks.has(String(row.deck_id)))
        .map((row) => String(row.id))
        .sort();
      const rows = cards.flatMap((card) => {
        const answers = this.rows.reviews
          .filter((row) => row.user_id === user.id && String(row.card_id) === card)
          .toSorted(
            (a, b) => Date.parse(String(a.reviewed_at)) - Date.parse(String(b.reviewed_at)),
          );
        if (answers.length === 0) return [];
        const state = this.rows.card_states.find(
          (row) => row.user_id === user.id && String(row.card_id) === card,
        );
        return [
          {
            card_id: card,
            stability: state?.stability ?? null,
            difficulty: state?.difficulty ?? null,
            last_review: state?.last_review ?? null,
            due: state?.due ?? null,
            ratings: answers.map((row) => row.rating),
            reviewed_at: answers.map((row) => row.reviewed_at),
            fuzz_factors: answers.map((row) => row.fuzz_factor ?? null),
          },
        ];
      });
      return HttpResponse.json(rows);
    }),
    http.get(`${supabaseUrl}/rest/v1/:table`, async ({ request, params }) => {
      const { table } = params;
      if (!isTable(table)) return HttpResponse.json({}, { status: 404 });
      const refused = await this.gate(table);
      if (refused) return refused;
      if (!bearerUser(request.headers.get("authorization"))) {
        return HttpResponse.json({ code: "42501", message: "permission denied" }, { status: 401 });
      }
      this.requests.push(`GET ${table}`);
      const url = new URL(request.url);
      const unknown = unknownColumn(table, namedColumns(url.searchParams));
      if (unknown) return unknown;
      this.selected.push(`${table}: ${url.searchParams.get("select") ?? "*"}`);
      const malformed = malformedUuid(url.searchParams);
      if (malformed) return malformed;
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const limit = Number(url.searchParams.get("limit") ?? Infinity);
      const rows = ordered(
        matching(this.rows[table], url.searchParams),
        url.searchParams.get("order"),
      );
      const page = rows.slice(offset, offset + limit);
      if (!request.headers.get("prefer")?.includes("count=exact")) return HttpResponse.json(page);
      const range = page.length > 0 ? `${String(offset)}-${String(offset + page.length - 1)}` : "*";
      return HttpResponse.json(page, {
        headers: { "content-range": `${range}/${String(rows.length)}` },
      });
    }),
    http.post(`${supabaseUrl}/rest/v1/:table`, async ({ request, params }) => {
      const { table } = params;
      if (!isTable(table)) return HttpResponse.json({}, { status: 404 });
      const refused = await this.gate(table);
      if (refused) return refused;
      this.requests.push(`POST ${table}`);
      const body: unknown = await request.json();
      const caller = bearerUser(request.headers.get("authorization"));
      const incoming = ((Array.isArray(body) ? body : [body]) as Row[]).map((row) =>
        table === "profiles" && caller ? { user_id: caller.id, ...row } : row,
      );
      const unknown = unknownColumn(
        table,
        incoming.flatMap((row) => Object.keys(row)),
      );
      if (unknown) return unknown;
      const ignore = request.headers.get("prefer")?.includes("resolution=ignore-duplicates");
      for (const row of incoming) {
        const at = this.rows[table].findIndex(
          (stored) => this.keyOf(table, stored) === this.keyOf(table, row),
        );
        if (at === -1) this.rows[table].push(this.stamp(row));
        else if (!ignore) this.rows[table][at] = this.stamp(row);
      }
      return new HttpResponse(null, { status: 201 });
    }),
    http.patch(`${supabaseUrl}/rest/v1/:table`, async ({ request, params }) => {
      const { table } = params;
      if (!isTable(table)) return HttpResponse.json({}, { status: 404 });
      const refused = await this.gate(table);
      if (refused) return refused;
      this.requests.push(`PATCH ${table}`);
      const body = (await request.json()) as Row;
      const url = new URL(request.url);
      const unknown = unknownColumn(table, [
        ...Object.keys(body),
        ...namedColumns(url.searchParams),
      ]);
      if (unknown) return unknown;
      const allowed = updatable[table];
      if (allowed && Object.keys(body).some((column) => !allowed.includes(column))) {
        return HttpResponse.json({ code: "42501", message: "permission denied" }, { status: 403 });
      }
      const malformed = malformedUuid(url.searchParams);
      if (malformed) return malformed;
      const written: Row[] = [];
      for (const row of matching(this.rows[table], url.searchParams)) {
        const at = this.rows[table].indexOf(row);
        const next = this.stamp({ ...row, ...body });
        this.rows[table][at] = next;
        written.push(next);
      }
      return returned(request, written);
    }),
    http.delete(`${supabaseUrl}/rest/v1/:table`, async ({ request, params }) => {
      const { table } = params;
      if (!isTable(table)) return HttpResponse.json({}, { status: 404 });
      const refused = await this.gate(table);
      if (refused) return refused;
      this.requests.push(`DELETE ${table}`);
      const url = new URL(request.url);
      const unknown = unknownColumn(table, namedColumns(url.searchParams));
      if (unknown) return unknown;
      const malformed = malformedUuid(url.searchParams);
      if (malformed) return malformed;
      const removed = matching(this.rows[table], url.searchParams);
      this.rows[table] = this.rows[table].filter((row) => !removed.includes(row));
      return returned(request, removed);
    }),
  ];
}
