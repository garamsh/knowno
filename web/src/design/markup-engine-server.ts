import "server-only";

import { readFileSync } from "node:fs";
import path from "node:path";

import { installMarkupModule, setServerMarkupLoad } from "./markup-engine";

/**
 * The module's file, from the project's root, where every server runs. next.config.ts traces it
 * into the standalone output and into every function that reads a card's text, since no import
 * names it.
 */
export const markupWasmPath = "src/design/engine-wasm/knowno_engine_wasm_bg.wasm";

// Importing this file on the server is what lets a card's text be read there: the first read
// instantiates the module from its bytes, once per server process.
setServerMarkupLoad(() => {
  installMarkupModule(readFileSync(path.join(process.cwd(), markupWasmPath)));
});
