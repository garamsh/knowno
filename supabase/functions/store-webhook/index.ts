/** The store-webhook Edge Function: sets a user's store grant from RevenueCat's webhook (ADR 0241). */

import { readConfig } from "./config.ts";
import { createHandler } from "./handler.ts";

Deno.serve(createHandler({
  config: readConfig((name) => Deno.env.get(name)),
  fetch,
  now: () => Date.now(),
  log: (entry) => console.log(JSON.stringify(entry)),
}));
