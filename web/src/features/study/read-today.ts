import "server-only";

import { cookies } from "next/headers";

import type { CardId } from "@/features/decks";
import { classifyFailure, requestTimeoutMs, type ServerFailure } from "@/supabase/failure";
import { field, parseTime } from "@/supabase/row";
import { selectAll } from "@/supabase/select-all";
import { createClient } from "@/supabase/server";
import { readUserId } from "@/supabase/session";
import { parseTimeZone, timeZoneCookie } from "./time-zone";

import type { Answer } from "./answer-write";
import {
  answerCapMs,
  type CardStates,
  defaultDailyMinutes,
  maxDailyMinutes,
  minDailyMinutes,
  type StudyDay,
  studyDay,
  studyDayEnd,
  studyDayStart,
  studyDayWindow,
} from "./queue";
import { readCardStates } from "./read-states";
import { dailyNewCards, type Pace, paceOf, type StudyDayTotal } from "./study-time";

/** An answer stored in today's study day. Times are milliseconds since the epoch. */
export type TodayAnswer = {
  cardId: CardId;
  answer: Answer;
  reviewedAt: number;
  durationMs: number;
};

/**
 * Today's study day for the signed-in user: the day, with the new cards it has left, every
 * answer stored in it, across every deck, oldest first, the user's pace, and the stored state of
 * every reviewed card with the time it was read. With [streak], also how many study days in a
 * row before today hold an answer. The day is read in the zone the browser names in its cookie,
 * or `fallbackTimeZone` without one.
 */
export type Today = {
  day: StudyDay;
  answers: TodayAnswer[];
  pace: Pace;
  /** The daily study minutes the user set, or `defaultDailyMinutes` while none is stored. */
  dailyMinutes: number;
  /** The reviews due today as the day stood when it started, which the minutes leave room for. */
  dueAtStart: number;
  /** The cards first answered today, across every deck, which today's new cards include. */
  startedToday: number;
  states: CardStates;
  readAt: number;
  streakBefore: number;
  /** The time zone the day is read in. */
  timeZone: string;
};

/** How many card ids one request filters on, so its URL stays short. */
const idsPerRequest = 100;

/** Reads [Today], or a server failure, or `unreadable` for a row this version cannot read. */
export async function readToday(
  options: { streak: boolean } = { streak: false },
): Promise<{ today: Today } | { failure: ServerFailure | "unreadable" }> {
  const supabase = await createClient();
  const session = await readUserId(supabase);
  if ("failure" in session) return session;
  const timeZone = parseTimeZone(
    (await cookies()).getAll().find((cookie) => cookie.name === timeZoneCookie)?.value,
  );
  const now = Date.now();
  const start = studyDayStart(now, timeZone);
  const reviews = (columns: string, counted: boolean) =>
    supabase
      .from("reviews")
      .select(columns, counted ? { count: "exact" } : {})
      .eq("user_id", session.userId);

  const [read, before, states, window, minutes] = await Promise.all([
    selectAll((from, to, counted) =>
      reviews("id, card_id, rating, reviewed_at, duration_ms", counted)
        .gte("reviewed_at", new Date(start).toISOString())
        .order("id")
        .range(from, to)
        .abortSignal(AbortSignal.timeout(requestTimeoutMs)),
    ),
    options.streak ? readStreakBefore(supabase, start, timeZone) : { streak: 0 },
    readCardStates(),
    readStudyDays(supabase, start, timeZone),
    readDailyMinutes(supabase, session.userId),
  ]);
  if ("failure" in read) return read;
  if ("failure" in before) return before;
  if ("failure" in states) return states;
  if ("failure" in window) return window;
  if ("failure" in minutes) return minutes;
  const answers: TodayAnswer[] = [];
  for (const row of read.rows) {
    const answer = parseAnswer(row);
    if (!answer) return { failure: "unreadable" };
    answers.push(answer);
  }
  answers.sort((a, b) => a.reviewedAt - b.reviewedAt);

  // A card answered today is new today unless it was also answered before.
  const ids = [...new Set(answers.map((answer) => answer.cardId))];
  const chunks: CardId[][] = [];
  for (let at = 0; at < ids.length; at += idsPerRequest) {
    chunks.push(ids.slice(at, at + idsPerRequest));
  }
  const earlier = await Promise.all(
    chunks.map((chunk) =>
      selectAll((from, to, counted) =>
        reviews("id, card_id, reviewed_at", counted)
          .lt("reviewed_at", new Date(start).toISOString())
          .in("card_id", chunk)
          .order("id")
          .range(from, to)
          .abortSignal(AbortSignal.timeout(requestTimeoutMs)),
      ),
    ),
  );
  // The latest answer before today of each card answered today that has one.
  const lastBefore = new Map<CardId, number>();
  for (const chunk of earlier) {
    if ("failure" in chunk) return chunk;
    for (const row of chunk.rows) {
      const read = field(row, "card_id");
      const reviewedAt = parseTime(field(row, "reviewed_at"));
      if (typeof read !== "string" || reviewedAt === null) return { failure: "unreadable" };
      const cardId = read as CardId;
      lastBefore.set(cardId, Math.max(lastBefore.get(cardId) ?? reviewedAt, reviewedAt));
    }
  }
  const firstToday = new Map<CardId, number>();
  for (const answer of answers) {
    if (!firstToday.has(answer.cardId)) firstToday.set(answer.cardId, answer.reviewedAt);
  }
  const firstAnswers = [...firstToday].flatMap(([cardId, at]) =>
    lastBefore.has(cardId) ? [] : [{ cardId, at }],
  );
  const pace = paceOf(window.days);
  const due = dueAtStart(states.states, firstToday, lastBefore, start, timeZone);
  return {
    today: {
      day: studyDay(
        now,
        firstAnswers,
        timeZone,
        dailyNewCards({ minutes: minutes.dailyMinutes, due, pace }),
      ),
      answers,
      pace,
      dailyMinutes: minutes.dailyMinutes,
      dueAtStart: due,
      startedToday: firstAnswers.length,
      states: states.states,
      readAt: states.readAt,
      streakBefore: before.streak,
      timeZone,
    },
  };
}

/**
 * The reviews due in the study day starting at [start] as they stood when it started, so
 * answering during it does not change them: the cards due before it ends that were not answered
 * in it, in [firstToday], and the cards answered in it that had an answer before it, in
 * [lastBefore].
 */
function dueAtStart(
  states: CardStates,
  firstToday: ReadonlyMap<CardId, number>,
  lastBefore: ReadonlyMap<CardId, number>,
  start: number,
  timeZone: string,
): number {
  const end = studyDayEnd(start, timeZone);
  let due = [...lastBefore.keys()].filter((cardId) => firstToday.has(cardId)).length;
  for (const [cardId, state] of Object.entries(states)) {
    if (state && !firstToday.has(cardId as CardId) && state.due < end) due += 1;
  }
  return due;
}

/**
 * The daily study minutes the user set, read from its own `study_settings` row, or
 * `defaultDailyMinutes` with none.
 */
async function readDailyMinutes(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<{ dailyMinutes: number } | { failure: ServerFailure | "unreadable" }> {
  const read = await supabase
    .from("study_settings")
    .select("daily_minutes")
    .eq("user_id", userId)
    .abortSignal(AbortSignal.timeout(requestTimeoutMs))
    .maybeSingle();
  if (read.error) return { failure: classifyFailure(read.error, read.status) };
  if (read.data === null) return { dailyMinutes: defaultDailyMinutes };
  const minutes = count(field(read.data, "daily_minutes"));
  return minutes === null || minutes < minDailyMinutes || minutes > maxDailyMinutes
    ? { failure: "unreadable" }
    : { dailyMinutes: minutes };
}

/**
 * The latest `studyDayWindow` study days before [start], oldest first, which the server's
 * `study_days_before` reads in one request, each answer counted up to `answerCapMs`.
 */
async function readStudyDays(
  supabase: Awaited<ReturnType<typeof createClient>>,
  start: number,
  timeZone: string,
): Promise<{ days: StudyDayTotal[] } | { failure: ServerFailure | "unreadable" }> {
  const read = await supabase
    .rpc("study_days_before", {
      time_zone: timeZone,
      before: new Date(start).toISOString(),
      days: studyDayWindow,
      cap_ms: answerCapMs,
    })
    .abortSignal(AbortSignal.timeout(requestTimeoutMs));
  if (read.error) return { failure: classifyFailure(read.error, read.status) };
  const rows: unknown = read.data;
  if (!Array.isArray(rows)) return { failure: "unreadable" };
  const days: StudyDayTotal[] = [];
  for (const row of rows) {
    const reviewMs = count(field(row, "review_ms"));
    const reviews = count(field(row, "reviews"));
    const firstMs = count(field(row, "first_ms"));
    const firstAnswers = count(field(row, "first_answers"));
    if (reviewMs === null || reviews === null || firstMs === null || firstAnswers === null) {
      return { failure: "unreadable" };
    }
    days.push({ reviewMs, reviews, firstMs, firstAnswers });
  }
  return { days };
}

/** [value] when it is a whole number at least zero, or null. */
function count(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

/**
 * How many study days in a row end the day before [start] with an answer, which the server's
 * `study_streak_before` counts in one request.
 */
async function readStreakBefore(
  supabase: Awaited<ReturnType<typeof createClient>>,
  start: number,
  timeZone: string,
): Promise<{ streak: number } | { failure: ServerFailure | "unreadable" }> {
  const counted = await supabase
    .rpc("study_streak_before", { time_zone: timeZone, before: new Date(start).toISOString() })
    .abortSignal(AbortSignal.timeout(requestTimeoutMs));
  if (counted.error) return { failure: classifyFailure(counted.error, counted.status) };
  const streak: unknown = counted.data;
  if (typeof streak !== "number" || !Number.isInteger(streak) || streak < 0) {
    return { failure: "unreadable" };
  }
  return { streak };
}

function parseAnswer(row: unknown): TodayAnswer | null {
  const cardId = field(row, "card_id");
  const rating = field(row, "rating");
  const reviewedAt = parseTime(field(row, "reviewed_at"));
  const durationMs = field(row, "duration_ms");
  if (typeof cardId !== "string" || reviewedAt === null || typeof durationMs !== "number") {
    return null;
  }
  const answer = rating === "good" ? "know" : rating === "again" ? "dontKnow" : null;
  if (!answer) return null;
  return { cardId: cardId as CardId, answer, reviewedAt, durationMs };
}
