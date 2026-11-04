// Fails when committed generated code in app/ or engine-wasm/pkg/, or the Google Sans font
// tools/fonts/google_sans.py writes, differs from what its generators write from the current
// sources. Each selected file is hashed, every generator is rerun with the
// command its documentation gives, and the set is hashed again; a changed, added or removed file
// is stale output. Hashing the working tree rather than diffing the index keeps the check true on
// an uncommitted edit as well as on a clean checkout.
import { pinnedVersion } from "./cargo-lock.ts";
import {
  attached,
  entry,
  fail,
  hasCommand,
  lines,
  merged,
  read,
  reported,
  scopeFiles,
  scopeText,
  Stop,
} from "./process.ts";
import { skip } from "./skip.ts";
import { generate } from "./wasm-bindgen.ts";

const APP = "app";
const APP_SCOPE = [
  "lib/*.g.dart",
  "lib/*.steps.dart",
  "lib/l10n/app_localizations*.dart",
  "drift_schemas",
  "test/drift/*/generated/*",
  "lib/study/src/rust",
  "rust/src/frb_generated.rs",
];
const WASM_SCOPE = ["engine-wasm/pkg"];
const FONT_SCOPE = ["app/assets/fonts/GoogleSans-*"];

async function isFile(path: string): Promise<boolean> {
  try {
    return (await Deno.stat(path)).isFile;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

/** "<hash> <file>" for each selected file that exists, sorted by file. */
async function snapshot(pathspecs: string[], cwd: string): Promise<string[]> {
  const inside = (file: string) => cwd === "." ? file : `${cwd}/${file}`;
  const selected = (await scopeFiles(pathspecs, cwd)).toSorted();
  const present: string[] = [];
  for (const file of selected) {
    if (await isFile(inside(file))) present.push(file);
  }
  if (present.length === 0) return [];
  const hashes = lines(
    await read("git", ["hash-object", ...present], { cwd }),
  );
  return present.map((file, at) => `${hashes[at]} ${file}`);
}

/** The first snapshot of a set, which holds a file or fails naming the selection. */
async function before(pathspecs: string[], cwd: string): Promise<string[]> {
  const taken = await snapshot(pathspecs, cwd);
  if (taken.length === 0) {
    fail(`no generated file was selected by: ${scopeText(pathspecs)}`);
  }
  return taken;
}

/** Fails, with diff's reading of the two snapshots, when they differ. */
async function failIfStale(old: string[], fresh: string[]): Promise<void> {
  if (old.join("\n") === fresh.join("\n")) return;
  console.error(
    "generated code is stale; regenerate it and commit the result:",
  );
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${dir}/before`, `${old.join("\n")}\n`);
    await Deno.writeTextFile(`${dir}/after`, `${fresh.join("\n")}\n`);
    const { output } = await merged("diff", [`${dir}/before`, `${dir}/after`]);
    console.error(output);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
  throw new Stop(1);
}

/** The codegen must be the release of the flutter_rust_bridge crate in rust/Cargo.lock. */
async function requirePinnedCodegen(): Promise<void> {
  const lock = await Deno.readTextFile(`${APP}/rust/Cargo.lock`);
  const version = pinnedVersion(lock, "flutter_rust_bridge");
  const found = await reported("flutter_rust_bridge_codegen", ["--version"]);
  if (found !== `flutter_rust_bridge_codegen ${version}`) {
    fail(
      `flutter_rust_bridge_codegen ${version} is required, as rust/Cargo.lock pins; found: ${found}`,
    );
  }
}

/** The databases under app/drift_schemas/, one directory each, by name. */
async function databases(): Promise<string[]> {
  const names: string[] = [];
  for await (const { name } of Deno.readDir(`${APP}/drift_schemas`)) {
    if (!name.startsWith(".")) names.push(name);
  }
  return names.toSorted();
}

async function checkApp(): Promise<void> {
  const old = await before(APP_SCOPE, APP);
  await requirePinnedCodegen();
  const inApp = { cwd: APP };
  await attached("flutter_rust_bridge_codegen", ["generate"], inApp);
  await attached("dart", ["run", "build_runner", "build"], inApp);
  await attached("flutter", ["gen-l10n"], inApp);
  // Exits non-zero when the dump for the current schema version differs from the schema.
  await attached("dart", ["run", "drift_dev", "make-migrations"], inApp);
  for (const database of await databases()) {
    await attached("dart", [
      "run",
      "drift_dev",
      "schema",
      "generate",
      "--data-classes",
      "--companions",
      `drift_schemas/${database}/`,
      `test/drift/${database}/generated/`,
    ], inApp);
  }
  const fresh = await snapshot(APP_SCOPE, APP);
  await failIfStale(old, fresh);
  console.log(
    `checked ${fresh.length} generated files in app/ against their generators, selected by: ${
      scopeText(APP_SCOPE)
    }`,
  );
}

/** The engine as WebAssembly for the web app (ADR 0018). */
async function checkWasm(): Promise<void> {
  if (!(await hasCommand("wasm-bindgen"))) {
    skip("checking engine-wasm/pkg/: this host has no wasm-bindgen command");
    return;
  }
  const old = await before(WASM_SCOPE, ".");
  await generate();
  const fresh = await snapshot(WASM_SCOPE, ".");
  await failIfStale(old, fresh);
  console.log(
    `checked ${fresh.length} generated files in engine-wasm/pkg/ against wasm-bindgen, selected by: ${
      scopeText(WASM_SCOPE)
    }`,
  );
}

/** Google Sans Medium, cut from Google's file by fontTools at the release tools/fonts/uv.lock pins. */
async function checkFonts(): Promise<void> {
  if (!(await hasCommand("uv"))) {
    skip("checking app/assets/fonts/GoogleSans-*: this host has no uv command");
    return;
  }
  const old = await before(FONT_SCOPE, ".");
  await attached("uv", [
    "run",
    "--project",
    "tools/fonts",
    "--locked",
    "python",
    "tools/fonts/google_sans.py",
  ]);
  const fresh = await snapshot(FONT_SCOPE, ".");
  await failIfStale(old, fresh);
  console.log(
    `checked ${fresh.length} generated files in app/assets/fonts/ against tools/fonts/google_sans.py, selected by: ${
      scopeText(FONT_SCOPE)
    }`,
  );
}

async function main(): Promise<void> {
  await checkApp();
  await checkWasm();
  await checkFonts();
}

if (import.meta.main) await entry(main);
