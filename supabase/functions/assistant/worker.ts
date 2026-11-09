/**
 * The photo jobs' worker (ADR 0198): one invocation of `POST /assistant/jobs/work` reads photos off
 * the queue in three lanes, each photo one model call with the plan's assistant configuration, for
 * as long as the platform's wall clock leaves room for a whole read, and then hands what is left to
 * a fresh invocation.
 */

import { type SupabaseDeps, SupabaseError } from "../_shared/auth.ts";
import type { Keys } from "../_shared/keys.ts";
import type { LogEntry } from "./handler.ts";
import {
  clearJob,
  finishStep,
  MAX_READING,
  nextStep,
  photoUrl,
  type Step,
  type StepOutcome,
  type StepUsage,
  unclearedJobs,
} from "./jobs.ts";
import {
  ADAPTERS,
  type CallUsage,
  fetchFailed,
  NO_USAGE,
  sseEvents,
  StreamError,
  withInputAtLeast,
} from "./providers.ts";

/**
 * How long one invocation takes steps for, under the 150 s wall clock of the Free plan and the
 * 400 s of paid ones (Supabase's Edge Function limits), as a message's turn is.
 */
export const WORK_LIMIT_MS = 120_000;
/** How long one photo's read may take; a step begins only while this much of the work's time is left. */
export const STEP_LIMIT_MS = 60_000;
/** How many photos one invocation reads at once, as the database lets a user's steps run. */
export const LANES = 3;
/** How long a lane waits when every queued photo is hidden, being read or waiting its turn. */
export const IDLE_MS = 5_000;

/** The instructions a photo's read is sent; the job's own instructions follow in the user turn. */
export const READING_PROMPT =
  `You read one photo of a learner's study material, so that 말랑이 can build notes and cards from it with the learner afterwards.
Write down what the page teaches, faithfully and completely, in Markdown:
- keep its headings and sections, such as a unit or a chapter, as headings;
- lists as lists, and tables as Markdown tables with their rows and columns;
- each word or term with its meaning, example or note as the page gives them;
- handwriting, highlights and marks the learner made, noted as such;
- a part you cannot read as [?].
Write only what the photo holds: do not make cards, summarise, translate or add facts.`;

export type WorkerDeps = {
  readonly supabase: SupabaseDeps;
  readonly fetch: typeof fetch;
  readonly keys: Keys;
  readonly now: () => number;
  readonly timeout: (ms: number) => AbortSignal;
  readonly wait: (ms: number) => Promise<void>;
  readonly log: (entry: LogEntry) => void;
};

/**
 * Asks the function to run the worker, as `POST /assistant/jobs/work` with the service-role key;
 * answers whether it was started. A worker already running is no reason not to: each takes its own
 * photos off the queue.
 */
export async function kick(supabase: SupabaseDeps): Promise<boolean> {
  try {
    const response = await supabase.fetch(
      `${supabase.url}/functions/v1/assistant/jobs/work`,
      {
        method: "POST",
        headers: {
          apikey: supabase.serviceRoleKey,
          Authorization: `Bearer ${supabase.serviceRoleKey}`,
        },
      },
    );
    await response.body?.cancel();
    return response.ok;
  } catch (error) {
    if (!fetchFailed(error)) throw error;
    return false;
  }
}

/** What a read of one photo came to. */
type Read = {
  readonly outcome: StepOutcome;
  readonly usage: StepUsage;
  readonly reading: string | null;
};

const counted = (call: CallUsage): StepUsage => ({
  inputTokens: call.inputTokens,
  outputTokens: call.outputTokens,
  reasoningTokens: call.reasoningTokens,
});

const NOTHING: StepUsage = counted(NO_USAGE);

/** The instructions the user gave the job, as the read's user turn carries them. */
function readingRequest(step: Step): string {
  const asked = step.instructions.trim();
  return `This is photo ${step.position} of the photos the learner sent.${
    asked === ""
      ? ""
      : `\nWhat the learner asked of the photos as a whole, for what to notice: ${asked}`
  }`;
}

/** Reads [step]'s photo with one model call of its job's configuration. */
async function read(step: Step, deps: WorkerDeps): Promise<Read> {
  let apiKey;
  try {
    apiKey = await deps.keys.get(step.provider);
  } catch (error) {
    if (!(error instanceof SupabaseError)) throw error;
    apiKey = null;
  }
  if (apiKey === null) {
    return { outcome: "model_error", usage: NOTHING, reading: null };
  }
  let url;
  try {
    url = await photoUrl(step.userId, step.photoId, deps.supabase);
  } catch (error) {
    if (!(error instanceof SupabaseError)) throw error;
    return { outcome: "model_error", usage: NOTHING, reading: null };
  }
  if (url === null) {
    return { outcome: "unreadable", usage: NOTHING, reading: null };
  }
  const adapter = ADAPTERS[step.provider];
  const started = deps.now();
  const body = JSON.stringify(adapter.body({
    configuration: {
      id: step.configurationId,
      provider: step.provider,
      model: step.model,
      promptVersionId: 0,
      prompt: READING_PROMPT,
      webSearch: false,
      maxSearches: 0,
      effort: step.effort,
    },
    system: READING_PROMPT,
    messages: adapter.history([{
      role: "user",
      text: readingRequest(step),
      photo: url,
    }]),
    tools: [],
  }));
  const broke = (reported: CallUsage): Read => ({
    outcome: deps.now() - started >= STEP_LIMIT_MS
      ? "time_limit"
      : "model_error",
    usage: counted(withInputAtLeast(reported, body)),
    reading: null,
  });
  let response;
  try {
    response = await deps.fetch(adapter.url, {
      method: "POST",
      signal: deps.timeout(STEP_LIMIT_MS),
      headers: adapter.headers(apiKey),
      body,
    });
  } catch (error) {
    if (!fetchFailed(error)) throw error;
    return broke(NO_USAGE);
  }
  if (!response.ok || response.body === null) {
    await response.body?.cancel();
    return { outcome: "model_error", usage: NOTHING, reading: null };
  }
  let text = "";
  let result;
  try {
    result = await adapter.read(sseEvents(response.body), (event) => {
      if (event.kind === "text") text += event.delta;
    });
  } catch (error) {
    if (!(error instanceof StreamError)) throw error;
    return broke(error.usage);
  }
  return {
    outcome: result.stop === "cut" ? "cut" : "ok",
    usage: counted(result.usage),
    reading: [...text].slice(0, MAX_READING).join(""),
  };
}

/** Logs the line of a call to Supabase that failed, one the queue and the sweep outlive. */
function unavailable(deps: WorkerDeps, started: number): void {
  deps.log({
    route: "work",
    user_id: null,
    plan: null,
    provider: null,
    model: null,
    model_calls: null,
    input_tokens: null,
    output_tokens: null,
    reasoning_tokens: null,
    web_search_requests: null,
    latency_ms: Math.round(deps.now() - started),
    outcome_recorded: null,
    outcome: "unavailable",
  });
}

/**
 * Deletes the photos of every job that ended and still has them, which a job ending in SQL leaves
 * and a failed deletion left before; one that fails is logged and the others go on.
 */
async function clearEnded(deps: WorkerDeps, started: number): Promise<void> {
  let ended;
  try {
    ended = await unclearedJobs(deps.supabase);
  } catch (error) {
    if (!(error instanceof SupabaseError)) throw error;
    unavailable(deps, started);
    return;
  }
  for (const job of ended) {
    try {
      await clearJob(job.userId, job.jobId, deps.supabase);
    } catch (error) {
      if (!(error instanceof SupabaseError)) throw error;
      unavailable(deps, started);
    }
  }
}

/** Reads [step]'s photo and records it, which charges it; logs one line. */
async function take(step: Step, deps: WorkerDeps): Promise<void> {
  const started = deps.now();
  const done = await read(step, deps);
  let recorded = true;
  let ended = false;
  try {
    const after = await finishStep(
      step.stepId,
      done.outcome,
      done.usage,
      deps.now() - started,
      done.outcome === "ok" || done.outcome === "cut" ? done.reading : null,
      deps.supabase,
    );
    ended = after.job !== "running";
  } catch (error) {
    if (!(error instanceof SupabaseError)) throw error;
    recorded = false;
  }
  if (ended) {
    try {
      await clearJob(step.userId, step.jobId, deps.supabase);
    } catch (error) {
      if (!(error instanceof SupabaseError)) throw error;
      unavailable(deps, started);
    }
  }
  deps.log({
    route: "work",
    user_id: step.userId,
    plan: step.plan,
    provider: step.provider,
    model: step.model,
    model_calls: done.outcome === "unreadable" ? 0 : 1,
    input_tokens: done.usage.inputTokens,
    output_tokens: done.usage.outputTokens,
    reasoning_tokens: done.usage.reasoningTokens,
    web_search_requests: 0,
    latency_ms: Math.round(deps.now() - started),
    outcome_recorded: recorded,
    outcome: done.outcome,
  });
}

/**
 * Reads photos off the queue from [started] until none is queued or the work's time leaves no room
 * for a whole read, deletes the photos of the jobs that ended, and then, with photos still queued,
 * asks for a fresh invocation.
 */
export async function work(deps: WorkerDeps, started: number): Promise<void> {
  let outOfTime = false;
  const lane = async () => {
    for (;;) {
      if (deps.now() - started > WORK_LIMIT_MS - STEP_LIMIT_MS) {
        outOfTime = true;
        return;
      }
      const next = await nextStep(deps.supabase);
      if (next.kind === "step") await take(next.step, deps);
      else if (next.pending === 0) return;
      else await deps.wait(IDLE_MS);
    }
  };
  const lanes = await Promise.allSettled(
    Array.from({ length: LANES }, lane),
  );
  for (const ended of lanes) {
    if (ended.status !== "rejected") continue;
    if (!(ended.reason instanceof SupabaseError)) throw ended.reason;
    unavailable(deps, started);
  }
  await clearEnded(deps, started);
  // When Supabase did not answer, the queue keeps every photo and the next poll of a job asks again.
  if (outOfTime && lanes.every((ended) => ended.status === "fulfilled")) {
    await kick(deps.supabase);
  }
}
