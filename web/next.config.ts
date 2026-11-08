import path from "node:path";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // The container runs .next/standalone/server.js (Dockerfile).
  output: "standalone",
  // next dev would write web/AGENTS.md; the repository's AGENTS.md is the one contributors read.
  agentRules: false,
  // The 기록 page runs the engine on the server from its WebAssembly file (ADR 0047), read at
  // src/features/study/engine-server.ts's wasmPath, which no import names.
  outputFileTracingIncludes: {
    "/record": ["./src/features/study/engine-wasm/knowno_engine_wasm_bg.wasm"],
    // The routes that read a card's text on the server, or save a card, read the module at
    // src/design/markup-engine-server.ts's markupWasmPath, which no import names (ADR 0209).
    ...Object.fromEntries(
      ["/decks", "/decks/[id]", "/study", "/admin/decks/[id]"].map((route) => [
        route,
        ["./src/design/engine-wasm/knowno_engine_wasm_bg.wasm"],
      ]),
    ),
  },
  experimental: {
    serverActions: { bodySizeLimit: "6mb" },
    // src/styles/fonts is a link to the app's bundled fonts, and src/features/study/engine-wasm and
    // src/design/engine-wasm each one to the engine's WebAssembly module, all outside this project.
    turbopackAdditionalRoots: {
      fonts: { path: path.join(import.meta.dirname, "../app/assets/fonts") },
      engine: { path: path.join(import.meta.dirname, "../engine-wasm/pkg") },
    },
  },
};

export default nextConfig;
