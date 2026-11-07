/**
 * The photo job tools (ADR 0198): start a job over the photos the user attached, read a job's
 * progress and what was read, and cancel it. A started job is shown to the user, whose client polls
 * it; the photos are read by the worker, not in the message.
 */

import type { SupabaseDeps, UserId } from "../_shared/auth.ts";
import { type IdSource, uuidV7 } from "../_shared/cards.ts";
import {
  cancelJob,
  clearJob,
  type Job,
  MAX_INSTRUCTIONS,
  readJob,
  startJob,
} from "./jobs.ts";
import type { Ran } from "./tools.ts";

/** The most characters of readings one `read_photo_job` answers; at least one photo's is answered. */
export const READ_PAGE = 60_000;

/** What the photo tools need for one message: who, the photos it attached, and how to reach work. */
export type PhotoContext = {
  readonly userId: UserId;
  /** The photos of the latest user turn that attached any, in order; empty when none did. */
  readonly attached: readonly string[];
  readonly supabase: SupabaseDeps;
  readonly ids: IdSource;
  /** Asks for the worker; answers whether it started. */
  readonly kick: () => Promise<boolean>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const refuse = (message: string): Ran => ({
  content: message,
  isError: true,
  shown: null,
});

const NO_JOB =
  "There is no photo job of the user's with that id: use the job_id start_photo_job answered, as the conversation names it.";

function jobIdOf(args: Record<string, unknown>): string | null {
  const id = typeof args.job_id === "string" ? args.job_id.toLowerCase() : "";
  return UUID.test(id) ? id : null;
}

/** A job's counts by photo status. */
function counts(job: Job): Record<string, number> {
  const count = (status: string) =>
    job.photos.filter((photo) => photo.status === status).length;
  return {
    photos: job.photos.length,
    read: count("read"),
    queued: count("queued"),
    failed: count("failed"),
    skipped: count("skipped"),
    cancelled: count("cancelled"),
  };
}

/** Starts a job over the attached photos with the user's [instructions]. */
export async function startPhotoJob(
  args: Record<string, unknown>,
  context: PhotoContext,
): Promise<Ran> {
  const instructions = args.instructions ?? "";
  if (
    typeof instructions !== "string" ||
    [...instructions].length > MAX_INSTRUCTIONS
  ) {
    return refuse(
      `instructions is the user's requests for the photos, at most ${MAX_INSTRUCTIONS} characters.`,
    );
  }
  if (context.attached.length === 0) {
    return refuse(
      "No photos are attached to this conversation's messages: ask the user to attach the photos first.",
    );
  }
  const jobId = uuidV7(context.ids);
  const started = await startJob(
    context.userId,
    jobId,
    context.attached,
    instructions.trim(),
    context.supabase,
  );
  switch (started) {
    case "started":
      break;
    case "busy":
      return refuse(
        "Another photo job of the user's is still running: wait for it, or cancel it with cancel_photo_job if the user asks, before starting one.",
      );
    case "rate_limited":
      return refuse(
        "The user's tokens for today are spent, so no photo can be read until tomorrow. Tell the user.",
      );
    case "bad_photos":
    case "missing_photos":
      return refuse(
        "Some attached photos were not uploaded, or are attached twice: ask the user to attach them again.",
      );
    case "unavailable":
    case "not_configured":
      return refuse(
        "Photos cannot be read right now. Tell the user to try again later.",
      );
  }
  // A worker that does not start now is asked again by the client's next poll of the job.
  await context.kick();
  return {
    content: {
      job_id: jobId,
      photos: context.attached.length,
      status: "running",
      shown_to_user:
        "The photos are being read in the background; the user sees the progress. Tell the user, and when they come back after it is done, call read_photo_job and build what they asked from what was read.",
    },
    isError: false,
    shown: {
      kind: "job",
      job: { id: jobId, photos: context.attached.length },
    },
  };
}

/** A job's progress and what was read of its photos from position [from], a page at a time. */
export async function readPhotoJob(
  args: Record<string, unknown>,
  context: PhotoContext,
): Promise<Ran> {
  const jobId = jobIdOf(args);
  if (jobId === null) return refuse(NO_JOB);
  const from = args.from ?? 1;
  if (typeof from !== "number" || !Number.isSafeInteger(from) || from < 1) {
    return refuse("from is the position of the first photo to read, from 1.");
  }
  const job = await readJob(context.userId, jobId, context.supabase);
  if (job === null) return refuse(NO_JOB);
  const readings: { photo: number; cut: boolean; text: string }[] = [];
  let size = 0;
  let next: number | null = null;
  for (const photo of job.photos) {
    if (photo.position < from || photo.reading === null) continue;
    const length = [...photo.reading].length;
    if (readings.length > 0 && size + length > READ_PAGE) {
      next = photo.position;
      break;
    }
    readings.push({
      photo: photo.position,
      cut: photo.cut === true,
      text: photo.reading,
    });
    size += length;
  }
  return {
    content: {
      job_id: jobId,
      status: job.status,
      ...counts(job),
      readings,
      next_from: next,
      note: job.status === "running"
        ? "Some photos are still being read: tell the user, and read the job again once it is done."
        : "A photo cut true was read only in part. Failed or skipped photos were not read; skipped ones ran out of today's tokens.",
    },
    isError: false,
    shown: null,
  };
}

/**
 * Cancels a running job: its photos not yet read are not read, and the job's photos are deleted.
 * What was read stays.
 */
export async function cancelPhotoJob(
  args: Record<string, unknown>,
  context: PhotoContext,
): Promise<Ran> {
  const jobId = jobIdOf(args);
  if (jobId === null) return refuse(NO_JOB);
  const status = await cancelJob(context.userId, jobId, context.supabase);
  if (status === null) return refuse(NO_JOB);
  if (status === "cancelled") {
    await clearJob(context.userId, jobId, context.supabase);
  }
  return { content: { job_id: jobId, status }, isError: false, shown: null };
}
