import "server-only";

import { readFileSync } from "node:fs";
import path from "node:path";

import { installMarkupModule, setServerMarkupLoad } from "./markup-engine";

/**
 * The engine module's bytes, read from the file beside the glue. No import names it, so
 * `next.config.ts` traces it into every route with `outputFileTracingIncludes`, whatever route
 * later reads card text or the engine.
 */
export function readEngineModule(): Uint8Array<ArrayBuffer> {
  return new Uint8Array(
    readFileSync(path.join(process.cwd(), "src/design/engine-wasm/knowno_engine_wasm_bg.wasm")),
  );
}

// Importing this file on the server is what lets a card's text be read there: the first read
// instantiates the module from its bytes, once per server process.
setServerMarkupLoad(() => {
  installMarkupModule(readEngineModule());
});
