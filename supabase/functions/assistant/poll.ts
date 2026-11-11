/**
 * `GET /assistant/jobs/{id}` and `POST /assistant/jobs/{id}/cancel`: a photo job's poll and cancel
 * (ADR 0198).
 */

import { SupabaseError } from "../_shared/auth.ts";
import { type Answer, type Caller, refusal } from "./answer.ts";
import { cancelJob, clearJob, type Job, readJob } from "./jobs.ts";
import { kick } from "./worker.ts";

/**
 * How long a running job may go without a read begun before its poll asks for the worker again:
 * past the 150 s a photo's message is hidden while it is read.
 */
export const STALE_MS = 180_000;

/** A job as its poll answers it: each photo's status, never its reading. */
function jobBody(id: string, job: Job): Record<string, unknown> {
  const count = (status: string) =>
    job.photos.filter((photo) => photo.status === status).length;
  return {
    id,
    status: job.status,
    photos: job.photos.map((photo) => ({
      position: photo.position,
      photo_id: photo.photoId,
      status: photo.status,
    })),
    read: count("read"),
    queued: count("queued"),
    failed: count("failed"),
    skipped: count("skipped"),
    cancelled: count("cancelled"),
    created_at: job.createdAt,
    finished_at: job.finishedAt,
  };
}

/**
 * A photo job's poll, which asks for the worker again when a running job has begun no read for
 * `STALE_MS`, or its cancel, which deletes its photos.
 */
export async function jobRequest(
  route: "job" | "cancel",
  jobId: string,
  caller: Caller,
): Promise<Answer> {
  const { userId, service, entry, deps } = caller;
  try {
    if (route === "cancel") {
      const status = await cancelJob(userId, jobId, service);
      if (status === null) return refusal(404, "not_found", entry);
      if (status === "cancelled") await clearJob(userId, jobId, service);
      return {
        response: Response.json({ id: jobId, status }),
        entry: { ...entry, outcome: "cancelled" },
      };
    }
    const job = await readJob(userId, jobId, service);
    if (job === null) return refusal(404, "not_found", entry);
    const last = Date.parse(job.lastStepAt ?? job.createdAt);
    if (job.status === "running" && deps.now() - last > STALE_MS) {
      await kick(service);
    }
    return {
      response: Response.json(jobBody(jobId, job)),
      entry: { ...entry, outcome: "polled" },
    };
  } catch (error) {
    if (error instanceof SupabaseError) {
      return refusal(503, "unavailable", entry);
    }
    throw error;
  }
}
