/**
 * The assistant's requests (ADR 0190, ADR 0195, ADR 0198), routed to the module of each: a message
 * (`message.ts`), a commit (`commit.ts`), an admin's draft configuration (`settings.ts`), a photo
 * job's poll and cancel (`poll.ts`) and the photo jobs' worker (`worker.ts`).
 */

import { authenticate, SupabaseError } from "../_shared/auth.ts";
import {
  type Answer,
  blank,
  type Call,
  type Caller,
  type Entry,
  type HandlerDeps,
  type LogEntry,
  refusal,
} from "./answer.ts";
import { commitRequest } from "./commit.ts";
import { messageRequest } from "./message.ts";
import { jobRequest } from "./poll.ts";
import { settingsRequest } from "./settings.ts";
import { workRequest } from "./worker.ts";

type Route = NonNullable<LogEntry["route"]>;

const ID = "([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})";

/** Each route's method and path, tried in order against the path without its trailing slash. */
const ROUTES: readonly {
  readonly route: Route;
  readonly method: "GET" | "POST";
  readonly path: RegExp;
}[] = [
  { route: "commit", method: "POST", path: /\/assistant\/commit$/ },
  {
    route: "settings",
    method: "POST",
    path: /\/assistant\/settings\/configuration$/,
  },
  { route: "work", method: "POST", path: /\/assistant\/jobs\/work$/ },
  {
    route: "job",
    method: "GET",
    path: new RegExp(`/assistant/jobs/${ID}$`, "i"),
  },
  {
    route: "cancel",
    method: "POST",
    path: new RegExp(`/assistant/jobs/${ID}/cancel$`, "i"),
  },
  { route: "message", method: "POST", path: /\/assistant$/ },
];

export function createHandler(
  deps: HandlerDeps,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const started = deps.now();
    const log = (entry: Entry) =>
      deps.log({ ...entry, latency_ms: Math.round(deps.now() - started) });
    let answered;
    try {
      answered = await handle(request, deps, started, log);
    } catch (error) {
      log(blank);
      throw error;
    }
    if (answered.entry !== null) log(answered.entry);
    return answered.response;
  };
}

/** Answers [request]; a stream logs its own line when it ends, so its entry here is null. */
async function handle(
  request: Request,
  deps: HandlerDeps,
  started: number,
  log: (entry: Entry) => void,
): Promise<Answer> {
  const path = new URL(request.url).pathname.replace(/\/$/, "");
  let matched: { route: Route; method: string; jobId: string } | null = null;
  for (const { route, method, path: pattern } of ROUTES) {
    const found = path.match(pattern);
    if (found !== null) {
      matched = { route, method, jobId: found[1]?.toLowerCase() ?? "" };
      break;
    }
  }
  if (matched === null) return refusal(404, "not_found", blank);
  const { route, method, jobId } = matched;
  if (request.method !== method) {
    return {
      response: new Response(null, { status: 405, headers: { Allow: method } }),
      entry: { ...blank, route, outcome: "method_not_allowed" },
    };
  }
  const entry: Entry = { ...blank, route };
  const config = deps.config;
  if (config.kind === "not_configured") {
    return refusal(503, "not_configured", entry);
  }
  const call: Call = {
    request,
    deps,
    config,
    service: {
      url: config.supabaseUrl,
      serviceRoleKey: config.serviceRoleKey,
      fetch: deps.fetch,
    },
    started,
    log,
    entry,
  };
  if (route === "work") return workRequest(call);
  if (route === "settings") return await settingsRequest(call);
  const caller = await authenticated(call);
  if ("response" in caller) return caller;
  switch (route) {
    case "job":
    case "cancel":
      return await jobRequest(route, jobId, caller);
    case "commit":
      return await commitRequest(caller);
    case "message":
      return await messageRequest(caller);
  }
}

/** The caller whose bearer token Supabase Auth accepts, or the refusal of a request that has none. */
async function authenticated(call: Call): Promise<Caller | Answer> {
  const authorization = call.request.headers.get("Authorization");
  const token = authorization?.match(/^Bearer (\S+)$/)?.[1];
  if (token === undefined) {
    return refusal(401, "unauthenticated", call.entry);
  }
  let userId;
  try {
    userId = await authenticate(authorization, call.service);
  } catch (error) {
    if (error instanceof SupabaseError) {
      return refusal(503, "unavailable", call.entry);
    }
    throw error;
  }
  if (userId === null) return refusal(401, "unauthenticated", call.entry);
  return { ...call, userId, token, entry: { ...call.entry, user_id: userId } };
}
