// Generates engine-wasm/pkg/ or runs engine-wasm/'s tests as WebAssembly, as
// scripts/check-generated.ts and make test ask. Both need the wasm-bindgen CLI at the release
// engine-wasm/Cargo.lock pins; the tests also need node. Where either is missing it skips the step
// and says why, or fails where CI is set (skip.ts).
import { pinnedVersion } from "./cargo-lock.ts";
import {
  attached,
  entry,
  fail,
  hasCommand,
  merged,
  reported,
  Stop,
} from "./process.ts";
import { skip } from "./skip.ts";

const CRATE = "engine-wasm";
const ROOT = decodeURIComponent(new URL("..", import.meta.url).pathname)
  .replace(/\/$/, "");

/** The release the lock file pins, or nothing where the CLI is missing, which skip() has reported. */
async function pinnedCli(
  task: string | undefined,
): Promise<string | undefined> {
  if (!(await hasCommand("wasm-bindgen"))) {
    skip(
      `wasm-bindgen ${
        task ?? ""
      } in engine-wasm/: this host has no wasm-bindgen command`,
    );
    return undefined;
  }
  const lock = await Deno.readTextFile(`${CRATE}/Cargo.lock`);
  const version = pinnedVersion(lock, "wasm-bindgen");
  const found = await reported("wasm-bindgen", ["--version"]);
  if (found !== `wasm-bindgen ${version}`) {
    fail(
      `wasm-bindgen ${version} is required, as engine-wasm/Cargo.lock pins; found: ${found}`,
    );
  }
  return version;
}

/** Absolute paths reach the module in panic locations; mapping them makes it the same on every host. */
function reproducibleFlags(root: string, cargoHome: string): string {
  return `--remap-path-prefix=${cargoHome}=/cargo --remap-path-prefix=${root}=/knowno`;
}

/** Writes engine-wasm/pkg/. */
export async function generate(): Promise<void> {
  const version = await pinnedCli("generate");
  if (version === undefined) return;
  const cargoHome = Deno.env.get("CARGO_HOME") ||
    `${Deno.env.get("HOME")}/.cargo`;
  await attached(
    "cargo",
    ["build", "--locked", "--release", "--target-dir", "target/generate"],
    {
      cwd: CRATE,
      env: { RUSTFLAGS: reproducibleFlags(ROOT, cargoHome) },
    },
  );
  await attached("wasm-bindgen", [
    "--target",
    "web",
    "--out-dir",
    "pkg",
    "target/generate/wasm32-unknown-unknown/release/knowno_engine_wasm.wasm",
  ], { cwd: CRATE });
  console.log(
    `generated engine-wasm/pkg/ with wasm-bindgen ${version}, --target web`,
  );
}

/** The sum of the counts on cargo test's "test result: ok." lines. */
export function passedTotal(output: string): number {
  return [...output.matchAll(/^test result: ok\. (\d+) passed/gm)]
    .reduce((sum, [, count]) => sum + Number(count), 0);
}

async function test(): Promise<void> {
  if (await pinnedCli("test") === undefined) return;
  if (!(await hasCommand("node"))) {
    skip(
      "the WebAssembly tests in engine-wasm/: this host has no node command, which wasm-bindgen-test-runner runs them in",
    );
    return;
  }
  const { code, output } = await merged(
    "cargo",
    ["test", "--locked", "--", "--nocapture"],
    { cwd: CRATE },
  );
  console.log(output);
  if (code !== 0) throw new Stop(1);
  const passed = passedTotal(output);
  if (passed === 0) fail("cargo test ran no test in engine-wasm/");
  console.log(
    `ran ${passed} tests as WebAssembly in node, the tests cargo test selects by default in engine-wasm/: engine-wasm/tests/*.rs, unit and doc tests`,
  );
}

async function main([task]: string[]): Promise<void> {
  if (task === "generate") return await generate();
  if (task === "test") return await test();
  if (await pinnedCli(task) === undefined) return;
  fail("usage: scripts/run.sh wasm-bindgen generate|test", 2);
}

if (import.meta.main) await entry(main);
