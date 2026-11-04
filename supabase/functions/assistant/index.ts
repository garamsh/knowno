/** The assistant Edge Function: 말랑이, which builds notes and cards with the user in conversation. */

import { cardFormSkills } from "../_shared/card_forms.ts";
import { type Keys, vaultKeys } from "../_shared/keys.ts";
import { readConfig } from "./config.ts";
import { createHandler } from "./handler.ts";

const config = readConfig((name) => Deno.env.get(name));
// Without the platform's variables there is no Vault to read; every request answers not configured.
const keys: Keys = config.kind === "configured"
  ? vaultKeys({
    url: config.supabaseUrl,
    serviceRoleKey: config.serviceRoleKey,
    fetch,
    now: () => performance.now(),
  })
  : { get: () => Promise.resolve(null), forget: () => {} };

Deno.serve(createHandler({
  config,
  fetch,
  keys,
  log: (entry) => console.log(JSON.stringify(entry)),
  now: () => Date.now(),
  random: (bytes) => crypto.getRandomValues(new Uint8Array(bytes)),
  resolve: async (host, signal) => {
    const found = await Promise.allSettled(
      (["A", "AAAA"] as const).map((type) =>
        Deno.resolveDns(host, type, { signal })
      ),
    );
    return found.flatMap((lookup) =>
      lookup.status === "fulfilled" ? lookup.value : []
    );
  },
  timeout: (ms) => AbortSignal.timeout(ms),
  skills: cardFormSkills(() => Date.now()),
}));
