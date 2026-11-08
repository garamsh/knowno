import path from "node:path";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // The container runs .next/standalone/server.js (Dockerfile).
  output: "standalone",
  // next dev would write web/AGENTS.md; the repository's AGENTS.md is the one contributors read.
  agentRules: false,
  // The engine's module is read by file at src/design/markup-engine-server.ts's readEngineModule,
  // which no import names, for card text (ADR 0209) and for the 기록 page's recall (ADR 0047). Every
  // route carries it, so no route that later reads either has to be listed.
  outputFileTracingIncludes: {
    "/**": ["./src/design/engine-wasm/knowno_engine_wasm_bg.wasm"],
  },
  experimental: {
    serverActions: { bodySizeLimit: "6mb" },
    // src/styles/fonts is a link to the app's bundled fonts, and src/design/engine-wasm one to the
    // engine's WebAssembly module, both outside this project.
    turbopackAdditionalRoots: {
      fonts: { path: path.join(import.meta.dirname, "../app/assets/fonts") },
      engine: { path: path.join(import.meta.dirname, "../engine-wasm/pkg") },
    },
  },
};

export default nextConfig;
