// scripts/wasm-bindgen.ts against stubs of cargo, wasm-bindgen and node.
import assert from "node:assert/strict";
import { pinnedVersion } from "./cargo-lock.ts";
import { passedTotal } from "./wasm-bindgen.ts";
import { host, program, RECORD, repository, write } from "./testing.ts";

const LOCK = `[[package]]\nname = "wasm-bindgen"\nversion = "0.2.129"\n`;
const CLI =
  `if [ "$1" = --version ]; then echo "wasm-bindgen 0.2.129"; exit; fi\n${RECORD}`;
const NODE = "exit 0";
const FLAGS =
  `${RECORD}\necho "RUSTFLAGS=$RUSTFLAGS" >>"$(dirname "$0")/calls"`;
const passing = (counts: number[]) =>
  counts.map((n) => `echo "test result: ok. ${n} passed; 0 failed"`).join("\n");

async function fixture(): Promise<string> {
  const repo = await repository();
  await write(repo, "engine-wasm/Cargo.lock", LOCK);
  return repo;
}

Deno.test("test sums every cargo test binary's count", async () => {
  const { path } = await host({
    "wasm-bindgen": CLI,
    node: NODE,
    cargo: passing([2, 4, 0]),
  });
  const ran = await program(await fixture(), "wasm-bindgen", ["test"], {
    PATH: path,
  });
  assert.equal(ran.code, 0, ran.stderr);
  assert.ok(
    ran.stdout.endsWith(
      "ran 6 tests as WebAssembly in node, the tests cargo test selects by default in engine-wasm/: engine-wasm/tests/*.rs, unit and doc tests\n",
    ),
    ran.stdout,
  );
});

Deno.test("test fails when cargo test ran no test, and prints a failing run's output", async () => {
  const none = await host({
    "wasm-bindgen": CLI,
    node: NODE,
    cargo: passing([0]),
  });
  const empty = await program(await fixture(), "wasm-bindgen", ["test"], {
    PATH: none.path,
  });
  assert.equal(empty.code, 1);
  assert.equal(empty.stderr, "cargo test ran no test in engine-wasm/\n");

  const broken = await host({
    "wasm-bindgen": CLI,
    node: NODE,
    cargo: `echo "panicked at the probe"\nexit 101`,
  });
  const failed = await program(await fixture(), "wasm-bindgen", ["test"], {
    PATH: broken.path,
  });
  assert.equal(failed.code, 1);
  assert.ok(failed.stdout.includes("panicked at the probe"), failed.stdout);
  assert.ok(!failed.stderr.includes("ran no test"), failed.stderr);
});

Deno.test("test without node skips, and fails where CI is set", async () => {
  const { path } = await host({ "wasm-bindgen": CLI, cargo: passing([1]) });
  const repo = await fixture();
  const local = await program(repo, "wasm-bindgen", ["test"], { PATH: path });
  assert.equal(local.code, 0, local.stderr);
  assert.equal(
    local.stdout,
    "skipped the WebAssembly tests in engine-wasm/: this host has no node command, which wasm-bindgen-test-runner runs them in\n",
  );
  const ci = await program(repo, "wasm-bindgen", ["test"], {
    PATH: path,
    CI: "true",
  });
  assert.equal(ci.code, 1);
  assert.match(
    ci.stderr,
    /^did not run the WebAssembly tests in engine-wasm\//,
  );
});

Deno.test("without the CLI it skips, and fails where CI is set", async () => {
  const { path } = await host({ node: NODE, cargo: passing([1]) });
  const repo = await fixture();
  const local = await program(repo, "wasm-bindgen", ["generate"], {
    PATH: path,
  });
  assert.equal(local.code, 0, local.stderr);
  assert.equal(
    local.stdout,
    "skipped wasm-bindgen generate in engine-wasm/: this host has no wasm-bindgen command\n",
  );
  const ci = await program(repo, "wasm-bindgen", ["generate"], {
    PATH: path,
    CI: "true",
  });
  assert.equal(ci.code, 1);
  assert.match(
    ci.stderr,
    /^did not run wasm-bindgen generate in engine-wasm\//,
  );
});

Deno.test("test without the CLI skips and runs nothing", async () => {
  const { path, log } = await host({ node: NODE, cargo: RECORD });
  const ran = await program(await fixture(), "wasm-bindgen", ["test"], {
    PATH: path,
  });
  assert.equal(ran.code, 0, ran.stderr);
  assert.equal(
    ran.stdout,
    "skipped wasm-bindgen test in engine-wasm/: this host has no wasm-bindgen command\n",
  );
  assert.equal(await log(), "");
});

Deno.test("fails on a CLI other than the release the lock file pins, and runs nothing", async () => {
  const { path, log } = await host({
    "wasm-bindgen": `echo "wasm-bindgen 0.2.1"`,
    cargo: RECORD,
  });
  const ran = await program(await fixture(), "wasm-bindgen", ["generate"], {
    PATH: path,
  });
  assert.equal(ran.code, 1);
  assert.equal(
    ran.stderr,
    "wasm-bindgen 0.2.129 is required, as engine-wasm/Cargo.lock pins; found: wasm-bindgen 0.2.1\n",
  );
  assert.equal(await log(), "");
});

Deno.test("generate builds with the paths mapped, then writes pkg/ for the web", async () => {
  const { path, log } = await host({ "wasm-bindgen": CLI, cargo: FLAGS });
  const repo = await fixture();
  const ran = await program(repo, "wasm-bindgen", ["generate"], {
    PATH: path,
    CARGO_HOME: "/cargo-home",
  });
  assert.equal(ran.code, 0, ran.stderr);
  assert.equal(
    ran.stdout,
    "generated engine-wasm/pkg/ with wasm-bindgen 0.2.129, --target web\n",
  );
  const calls = (await log()).split("\n");
  assert.equal(
    calls[0],
    "cargo build --locked --release --target-dir target/generate",
  );
  assert.match(
    calls[1],
    /^RUSTFLAGS=--remap-path-prefix=\/cargo-home=\/cargo --remap-path-prefix=\S+=\/knowno$/,
  );
  assert.equal(
    calls[2],
    "wasm-bindgen --target web --out-dir pkg target/generate/wasm32-unknown-unknown/release/knowno_engine_wasm.wasm",
  );
});

Deno.test("generate falls back to the home directory's cargo", async () => {
  const { path, log } = await host({ "wasm-bindgen": CLI, cargo: FLAGS });
  await program(await fixture(), "wasm-bindgen", ["generate"], {
    PATH: path,
    HOME: "/home/x",
  });
  assert.match(await log(), /--remap-path-prefix=\/home\/x\/\.cargo=\/cargo/);
});

Deno.test("refuses an unknown task with exit 2", async () => {
  const { path } = await host({ "wasm-bindgen": CLI });
  const ran = await program(await fixture(), "wasm-bindgen", ["nothing"], {
    PATH: path,
  });
  assert.equal(ran.code, 2);
  assert.equal(
    ran.stderr,
    "usage: scripts/run.sh wasm-bindgen generate|test\n",
  );
});

Deno.test("passedTotal reads only a passing summary", () => {
  assert.equal(
    passedTotal(
      "test result: ok. 2 passed; 0 failed\ntest result: FAILED. 9 passed\n",
    ),
    2,
  );
});

Deno.test("pinnedVersion reads the version of the crate it names, not one sharing its prefix", () => {
  const lock =
    `name = "wasm-bindgen-macro"\nversion = "1.0.0"\n\nname = "wasm-bindgen"\nversion = "0.2.129"\n`;
  assert.equal(pinnedVersion(lock, "wasm-bindgen"), "0.2.129");
  assert.equal(pinnedVersion(lock, "absent"), "");
  assert.equal(pinnedVersion(`version = "9.9.9"\n`, "absent"), "");
});
