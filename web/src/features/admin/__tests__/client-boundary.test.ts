// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * A Server Component can render what a `"use client"` module exports but not call it: on the
 * server each export is a reference that throws when called, which neither tsc, Vitest nor
 * `next build` checks (#473). Every module of the admin area without the directive renders on
 * the server, so each name it imports from a client module must be a component.
 */

const src = path.join(import.meta.dirname, "../../..");
const roots = ["features/admin", "app/admin"].map((dir) => path.join(src, dir));

/** A module's named value imports from a relative or `@/` path; `import type` is erased. */
const namedImports = /^\s*import\s+(?!type\b)\{([^}]*)\}\s*from\s+["']([^"']+)["']/gm;

function read(file: string): string {
  return readFileSync(file, "utf8");
}

function modules(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) return name === "__tests__" ? [] : modules(file);
    return /\.tsx?$/.test(name) ? [file] : [];
  });
}

function resolve(spec: string, from: string): string | null {
  const base = spec.startsWith("@/")
    ? path.join(src, spec.slice(2))
    : spec.startsWith(".")
      ? path.join(path.dirname(from), spec)
      : null;
  if (base === null) return null;
  return (
    [".ts", ".tsx", "/index.ts", "/index.tsx"]
      .map((end) => base + end)
      .find((file) => statSync(file, { throwIfNoEntry: false })?.isFile()) ?? null
  );
}

const isClient = (file: string) => /^\s*["']use client["']/.test(read(file));

/** Each name a server module of the area imports from a client module, as "module: name". */
function clientImports(): string[] {
  const servers = roots.flatMap((root) => modules(root)).filter((file) => !isClient(file));
  return servers.flatMap((file) =>
    [...read(file).matchAll(namedImports)].flatMap(([, names = "", spec = ""]) => {
      const target = resolve(spec, file);
      if (target === null || !isClient(target)) return [];
      return names
        .split(",")
        .map((name) => name.trim())
        .filter((name) => name !== "" && !/^type\s/.test(name))
        .map((name) => `${path.relative(src, file)}: ${name.split(/\s+as\s+/)[0] ?? name}`);
    }),
  );
}

describe("a server module of the admin area", () => {
  it("imports only components from a client module, which it cannot call", () => {
    const imported = clientImports();
    // Control: the trial is a client module 사진 AI renders, so the scan
    // reaches client modules and reads what is imported from them.
    expect(imported).toContain("features/admin/components/ai-view.tsx: PromptTrial");

    expect(imported.filter((entry) => !/: [A-Z]/.test(entry))).toEqual([]);
  });
});
