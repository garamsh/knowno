/** The extract-cards Edge Function: turns one photo of a vocabulary page into candidate cards. */

import { readConfig } from "./config.ts";
import { newCursorToken } from "./continuation.ts";
import { createHandler } from "./handler.ts";
import { type Keys, vaultKeys } from "./keys.ts";
import { MODEL_TIMEOUT_MS } from "./model.ts";

const config = readConfig((name) => Deno.env.get(name));
const now = () => performance.now();
// Without the platform's variables there is no Vault to read; every request answers not configured.
const keys: Keys = config.kind === "configured"
  ? vaultKeys({
    url: config.supabaseUrl,
    serviceRoleKey: config.serviceRoleKey,
    fetch,
    now,
  })
  : { get: () => Promise.resolve(null), forget: () => {} };

Deno.serve(createHandler({
  config,
  fetch,
  log: (entry) => console.log(JSON.stringify(entry)),
  now,
  modelTimeoutMs: MODEL_TIMEOUT_MS,
  newToken: newCursorToken,
  keys,
}));
