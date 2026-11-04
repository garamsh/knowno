/** The mcp Edge Function: knowno's remote MCP server for Claude and ChatGPT (ADR 0126). */

import { cardFormSkills } from "../_shared/card_forms.ts";
import { readConfig } from "./config.ts";
import { createHandler } from "./handler.ts";

Deno.serve(createHandler({
  config: readConfig((name) => Deno.env.get(name)),
  fetch,
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
