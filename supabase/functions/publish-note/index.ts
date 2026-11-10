/** The publish-note Edge Function: screens a note before it is public (ADR 0238, ADR 0239). */

import { vaultKeys } from "../_shared/keys.ts";
import { readConfig } from "./config.ts";
import { createHandler } from "./handler.ts";

const config = readConfig((name) => Deno.env.get(name));

Deno.serve(createHandler({
  config,
  fetch,
  keys: vaultKeys({
    url: config.kind === "configured" ? config.supabaseUrl : "",
    serviceRoleKey: config.kind === "configured" ? config.serviceRoleKey : "",
    fetch,
    now: Date.now,
  }),
  log: (entry) => console.log(JSON.stringify(entry)),
}));
