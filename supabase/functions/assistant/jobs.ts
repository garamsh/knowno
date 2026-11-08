/**
 * A photo job's records and photos (ADR 0198): the database functions that start a job, take its
 * photos off the queue as steps and record them, cancel it and read it, and the Storage calls that
 * give a model a photo's address and delete a job's photos.
 */

import {
  type SupabaseDeps,
  SupabaseError,
  type UserId,
} from "../_shared/auth.ts";
import { type Provider, PROVIDERS } from "../_shared/keys.ts";
import { type Effort, EFFORTS, rpc } from "./supabase.ts";

/** The private bucket holding the chat's photos under `{user id}/{photo id}`. */
export const PHOTO_BUCKET = "assistant-photos";
/** The most photos one job reads, as `start_assistant_job` holds it. */
export const MAX_JOB_PHOTOS = 50;
/** The longest a job's instructions may be. */
export const MAX_INSTRUCTIONS = 4000;
/** The longest reading a photo keeps, as the table holds it. */
export const MAX_READING = 50_000;
/** How long a photo's signed address lets the provider fetch it. */
export const PHOTO_URL_SECONDS = 600;

export type JobStatus = "running" | "done" | "cancelled";
export type PhotoStatus =
  | "queued"
  | "read"
  | "failed"
  | "skipped"
  | "cancelled";
/** How one read of a photo ended, as `finish_assistant_job_step` records it. */
export type StepOutcome =
  | "ok"
  | "cut"
  | "model_error"
  | "time_limit"
  | "unreadable";

const JOB_STATUSES: readonly JobStatus[] = ["running", "done", "cancelled"];
const PHOTO_STATUSES: readonly PhotoStatus[] = [
  "queued",
  "read",
  "failed",
  "skipped",
  "cancelled",
];

/** Why a job did not start, or that it did. */
export type Started =
  | "started"
  | "unavailable"
  | "rate_limited"
  | "busy"
  | "bad_photos"
  | "missing_photos"
  | "not_configured";
const STARTED: readonly Started[] = [
  "started",
  "unavailable",
  "rate_limited",
  "busy",
  "bad_photos",
  "missing_photos",
];

/** A photo of a job as its owner reads it. */
export type JobPhoto = {
  readonly position: number;
  readonly photoId: string;
  readonly status: PhotoStatus;
  readonly attempts: number;
  readonly cut: boolean | null;
  readonly reading: string | null;
};

/** A job as its owner reads it. */
export type Job = {
  readonly status: JobStatus;
  readonly createdAt: string;
  readonly finishedAt: string | null;
  /** When its last read began, null before any. */
  readonly lastStepAt: string | null;
  readonly photos: readonly JobPhoto[];
};

/** A photo taken off the queue to read, with the configuration its job started on. */
export type Step = {
  readonly stepId: number;
  readonly jobId: string;
  readonly userId: UserId;
  readonly photoId: string;
  readonly position: number;
  readonly attempt: number;
  readonly plan: string;
  readonly configurationId: number;
  readonly provider: Provider;
  readonly model: string;
  readonly effort: Effort;
  readonly instructions: string;
};

/** What the queue gave: a step, or none to take now and how many messages are still queued. */
export type Next =
  | { readonly kind: "step"; readonly step: Step }
  | { readonly kind: "empty"; readonly pending: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const isUuid = (value: unknown): value is string =>
  typeof value === "string" && UUID.test(value);

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstRow(rows: unknown, name: string): Record<string, unknown> | null {
  if (!Array.isArray(rows)) {
    throw new SupabaseError(`${name} answered no rows`);
  }
  if (rows.length === 0) return null;
  const row: unknown = rows[0];
  if (!isRecord(row)) throw new SupabaseError(`${name} answered no row`);
  return row;
}

/**
 * Starts [userId]'s job [jobId] over [photoIds], in the order given, with [instructions]
 * (`public.start_assistant_job`).
 */
export async function startJob(
  userId: UserId,
  jobId: string,
  photoIds: readonly string[],
  instructions: string,
  deps: SupabaseDeps,
): Promise<Started> {
  const row = firstRow(
    await rpc("start_assistant_job", {
      user_id: userId,
      job_id: jobId,
      photo_ids: photoIds,
      instructions,
    }, deps),
    "start_assistant_job",
  );
  if (row === null) return "not_configured";
  const outcome = STARTED.find((known) => known === row.outcome);
  if (outcome === undefined) {
    throw new SupabaseError("start_assistant_job answered no outcome it names");
  }
  return outcome;
}

/** The next photo to read, its step begun (`public.next_assistant_job_step`). */
export async function nextStep(deps: SupabaseDeps): Promise<Next> {
  const r = firstRow(
    await rpc("next_assistant_job_step", {}, deps),
    "next_assistant_job_step",
  );
  if (r === null) {
    throw new SupabaseError("next_assistant_job_step answered no row");
  }
  if (r.outcome === "empty") {
    if (!isCount(r.pending)) {
      throw new SupabaseError("next_assistant_job_step answered no count");
    }
    return { kind: "empty", pending: r.pending };
  }
  const provider = PROVIDERS.find((known) => known === r.provider);
  const effort = EFFORTS.find((known) => known === r.reasoning_effort);
  if (
    r.outcome !== "step" || !isCount(r.step_id) || !isUuid(r.job_id) ||
    !isUuid(r.user_id) || !isUuid(r.photo_id) || !isCount(r.photo_position) ||
    !isCount(r.attempt) || typeof r.plan !== "string" ||
    !isCount(r.configuration_id) || provider === undefined ||
    typeof r.model !== "string" || effort === undefined ||
    typeof r.instructions !== "string"
  ) {
    throw new SupabaseError(
      "next_assistant_job_step answered a row it should not",
    );
  }
  return {
    kind: "step",
    step: {
      stepId: r.step_id,
      jobId: r.job_id,
      // A uuid the database holds as an auth user's id.
      userId: r.user_id as UserId,
      photoId: r.photo_id,
      position: r.photo_position,
      attempt: r.attempt,
      plan: r.plan,
      configurationId: r.configuration_id,
      provider,
      model: r.model,
      effort,
      instructions: r.instructions,
    },
  };
}

/** What a read used, as its provider reported it. */
export type StepUsage = {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
};

/**
 * Records how [stepId]'s read ended, which charges it, keeping [reading] on a read photo
 * (`public.finish_assistant_job_step`); answers the photo's status and the job's after it.
 */
export async function finishStep(
  stepId: number,
  outcome: StepOutcome,
  usage: StepUsage,
  latencyMs: number,
  reading: string | null,
  deps: SupabaseDeps,
): Promise<{ photo: PhotoStatus; job: JobStatus }> {
  const row = firstRow(
    await rpc("finish_assistant_job_step", {
      step_id: stepId,
      outcome,
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      reasoning_tokens: usage.reasoningTokens,
      latency_ms: Math.round(latencyMs),
      reading,
    }, deps),
    "finish_assistant_job_step",
  );
  const photo = PHOTO_STATUSES.find((known) => known === row?.photo_status);
  const job = JOB_STATUSES.find((known) => known === row?.job_status);
  if (photo === undefined || job === undefined) {
    throw new SupabaseError("finish_assistant_job_step answered no statuses");
  }
  return { photo, job };
}

/**
 * Cancels [userId]'s job [jobId] (`public.cancel_assistant_job`): its status after, or null when
 * the user has no such job.
 */
export async function cancelJob(
  userId: UserId,
  jobId: string,
  deps: SupabaseDeps,
): Promise<JobStatus | null> {
  const status = await rpc("cancel_assistant_job", {
    user_id: userId,
    job_id: jobId,
  }, deps);
  if (status === null) return null;
  const known = JOB_STATUSES.find((one) => one === status);
  if (known === undefined) {
    throw new SupabaseError("cancel_assistant_job answered no status");
  }
  return known;
}

function readPhoto(value: unknown): JobPhoto {
  if (!isRecord(value)) throw new SupabaseError("a job's photo is no object");
  const status = PHOTO_STATUSES.find((known) => known === value.status);
  if (
    !isCount(value.position) || !isUuid(value.photo_id) ||
    status === undefined || !isCount(value.attempts) ||
    (value.cut !== null && typeof value.cut !== "boolean") ||
    (value.reading !== null && typeof value.reading !== "string")
  ) {
    throw new SupabaseError("a job's photo is not of its form");
  }
  return {
    position: value.position,
    photoId: value.photo_id,
    status,
    attempts: value.attempts,
    cut: value.cut,
    reading: value.reading,
  };
}

/** [userId]'s job [jobId] with its photos, or null when the user has no such job. */
export async function readJob(
  userId: UserId,
  jobId: string,
  deps: SupabaseDeps,
): Promise<Job | null> {
  const r = firstRow(
    await rpc("assistant_job", { user_id: userId, job_id: jobId }, deps),
    "assistant_job",
  );
  if (r === null) return null;
  const status = JOB_STATUSES.find((known) => known === r.status);
  if (
    status === undefined || typeof r.created_at !== "string" ||
    (r.finished_at !== null && typeof r.finished_at !== "string") ||
    (r.last_step_at !== null && typeof r.last_step_at !== "string") ||
    !Array.isArray(r.photos)
  ) {
    throw new SupabaseError("assistant_job answered a row it should not");
  }
  return {
    status,
    createdAt: r.created_at,
    finishedAt: r.finished_at,
    lastStepAt: r.last_step_at,
    photos: r.photos.map(readPhoto),
  };
}

async function storage(
  deps: SupabaseDeps,
  path: string,
  method: string,
  body: unknown,
): Promise<Response> {
  return await deps.fetch(`${deps.url}/storage/v1/${path}`, {
    method,
    headers: {
      apikey: deps.serviceRoleKey,
      Authorization: `Bearer ${deps.serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  }).catch((cause: unknown) => {
    throw new SupabaseError("storage could not be reached", { cause });
  });
}

/**
 * An https address the provider fetches [userId]'s photo [photoId] at for `PHOTO_URL_SECONDS`, or
 * null when Storage holds no such photo.
 */
export async function photoUrl(
  userId: UserId,
  photoId: string,
  deps: SupabaseDeps,
): Promise<string | null> {
  const response = await storage(
    deps,
    `object/sign/${PHOTO_BUCKET}/${userId}/${photoId}`,
    "POST",
    { expiresIn: PHOTO_URL_SECONDS },
  );
  // Storage answers a missing object 400 or 404, by its version.
  if (response.status === 400 || response.status === 404) {
    await response.body?.cancel();
    return null;
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new SupabaseError(`storage answered ${response.status}`);
  }
  const signed: unknown = await response.json();
  if (!isRecord(signed) || typeof signed.signedURL !== "string") {
    throw new SupabaseError("storage signed no address");
  }
  return `${deps.url}/storage/v1${signed.signedURL}`;
}

/** Deletes [userId]'s photos [photoIds] from the bucket; one already gone is no failure. */
export async function deletePhotos(
  userId: UserId,
  photoIds: readonly string[],
  deps: SupabaseDeps,
): Promise<void> {
  if (photoIds.length === 0) return;
  const response = await storage(deps, `object/${PHOTO_BUCKET}`, "DELETE", {
    prefixes: photoIds.map((id) => `${userId}/${id}`),
  });
  await response.body?.cancel();
  if (!response.ok) {
    throw new SupabaseError(`storage answered ${response.status}`);
  }
}

/** Deletes [userId]'s job [jobId]'s photos from the bucket; what was read of them stays. */
export async function clearJob(
  userId: UserId,
  jobId: string,
  deps: SupabaseDeps,
): Promise<void> {
  const job = await readJob(userId, jobId, deps);
  if (job === null) return;
  await deletePhotos(userId, job.photos.map((photo) => photo.photoId), deps);
}
