/** The triage-reports Edge Function: judges a reported note once by a model (ADR 0244). */

import { readConfig } from "./config.ts";
import { createHandler } from "./handler.ts";

Deno.serve(createHandler({
  config: readConfig((name) => Deno.env.get(name)),
  fetch,
  now: () => Date.now(),
  log: (entry) => console.log(JSON.stringify(entry)),
}));
