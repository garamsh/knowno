/** The delete-account Edge Function: deletes the caller's account and, by cascade, every row it owns. */

import { readConfig } from "./config.ts";
import { createHandler } from "./handler.ts";

Deno.serve(createHandler({
  config: readConfig((name) => Deno.env.get(name)),
  fetch,
  now: () => Date.now(),
  log: (entry) => console.log(JSON.stringify(entry)),
}));
