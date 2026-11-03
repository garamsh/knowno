"use server";

import { parseCardId } from "@/features/decks";
import { classifyFailure, requestTimeoutMs, type ServerFailure } from "@/supabase/failure";
import { field } from "@/supabase/row";
import { createClient } from "@/supabase/server";
import { readUserId } from "@/supabase/session";

import {
  type RecordedAnswer,
  type SessionReview,
  writeFailureMessages,
  type WriteResult,
} from "./answer-write";
import type { CardState } from "./queue";

/**
 * Stores an answer or a toggle as the phone's sync would push it: an answer inserts its review,
 * a toggle moves its review's rating where the server's edit is older, and either then upserts
 * the card's state. The insert ignores a review already stored, so a retried write is safe.
 * Each row is the signed-in user's, edited at the write's time; the server sets its revision.
 */
export async function recordAnswer(input: RecordedAnswer): Promise<WriteResult> {
  // The argument crossed the network, whatever its declared type.
  const answer = parseAnswer(input);
  if (!answer) return refuse("failed", "the answer is malformed");

  const supabase = await createClient();
  const session = await readUserId(supabase);
  if ("failure" in session) return refuse(session.failure, "no verified session");
  const { userId } = session;

  const { review, state } = answer;
  const editedAt = iso(answer.editedAt);
  const reviews = supabase.from("reviews");
  const reviewWrite =
    answer.change === "answer"
      ? await reviews
          .upsert(
            {
              id: review.id,
              user_id: userId,
              card_id: answer.cardId,
              rating: rating(review),
              reviewed_at: iso(review.reviewedAt),
              duration_ms: review.durationMs,
              fuzz_factor: review.fuzzFactor,
              updated_at: editedAt,
            },
            { onConflict: "id", ignoreDuplicates: true },
          )
          .abortSignal(AbortSignal.timeout(requestTimeoutMs))
      : await reviews
          .update({ rating: rating(review), updated_at: editedAt })
          .eq("id", review.id)
          .lt("updated_at", editedAt)
          .abortSignal(AbortSignal.timeout(requestTimeoutMs));
  if (reviewWrite.error) {
    return refuse(classifyFailure(reviewWrite.error, reviewWrite.status), reviewWrite.error.code);
  }

  const stateWrite = await supabase
    .from("card_states")
    .upsert(
      {
        user_id: userId,
        card_id: answer.cardId,
        stability: state.stability,
        difficulty: state.difficulty,
        last_review: iso(state.lastReview),
        due: iso(state.due),
        updated_at: editedAt,
      },
      { onConflict: "user_id,card_id" },
    )
    .abortSignal(AbortSignal.timeout(requestTimeoutMs));
  if (stateWrite.error) {
    return refuse(classifyFailure(stateWrite.error, stateWrite.status), stateWrite.error.code);
  }
  return { saved: true };
}

function refuse(failure: ServerFailure, detail: string): WriteResult {
  console.error(`recordAnswer: ${failure}: ${detail}`);
  return { saved: false, message: writeFailureMessages[failure] };
}

function rating(review: SessionReview): "good" | "again" {
  return review.answer === "know" ? "good" : "again";
}

function iso(milliseconds: number): string {
  return new Date(milliseconds).toISOString();
}

function parseAnswer(input: unknown): RecordedAnswer | null {
  const cardId = parseCardId(field(input, "cardId"));
  const review = parseReview(field(input, "review"));
  const change = field(input, "change");
  const state = parseState(field(input, "state"));
  const editedAt = field(input, "editedAt");
  if (!cardId || !review || !state || !isTime(editedAt)) return null;
  if (change !== "answer" && change !== "toggle") return null;
  return { cardId, review, change, state, editedAt };
}

function parseReview(value: unknown): SessionReview | null {
  const id = field(value, "id");
  const answer = field(value, "answer");
  const reviewedAt = field(value, "reviewedAt");
  const durationMs = field(value, "durationMs");
  const fuzzFactor = field(value, "fuzzFactor");
  if (typeof id !== "string" || (answer !== "know" && answer !== "dontKnow")) return null;
  if (!isTime(reviewedAt) || !isTime(durationMs)) return null;
  if (typeof fuzzFactor !== "number" || !(fuzzFactor >= 0 && fuzzFactor < 1)) return null;
  return { id, answer, reviewedAt, durationMs, fuzzFactor };
}

function parseState(value: unknown): CardState | null {
  const stability = field(value, "stability");
  const difficulty = field(value, "difficulty");
  const lastReview = field(value, "lastReview");
  const due = field(value, "due");
  if (typeof stability !== "number" || !Number.isFinite(stability)) return null;
  if (typeof difficulty !== "number" || !Number.isFinite(difficulty)) return null;
  if (!isTime(lastReview) || !isTime(due)) return null;
  return { stability, difficulty, lastReview, due };
}

/** A whole, non-negative number of milliseconds. */
function isTime(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
