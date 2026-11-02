// scripts/check-generated.ts on a repository holding one generated file of each set, against stubs
// of the generators; a stub's body says what that generator writes.
import assert from "node:assert/strict";
import { commit, host, program, RECORD, repository, write } from "./testing.ts";

const APP_LOCK = `name = "flutter_rust_bridge"\nversion = "2.13.0"\n`;
const WASM_LOCK = `name = "wasm-bindgen"\nversion = "0.2.129"\n`;
const APP_SCOPE =
  "git ls-files --cached --others --exclude-standard -- 'lib/*.g.dart' 'lib/*.steps.dart' 'lib/l10n/app_localizations*.dart' 'drift_schemas' 'test/drift/*/generated/*' 'lib/study/src/rust' 'rust/src/frb_generated.rs'";
const WASM_SCOPE =
  "git ls-files --cached --others --exclude-standard -- 'engine-wasm/pkg'";

const codegen = (writes = "") =>
  `if [ "$1" = --version ]; then echo "flutter_rust_bridge_codegen 2.13.0"; exit; fi\n${RECORD}\n${writes}`;
const cli =
  `if [ "$1" = --version ]; then echo "wasm-bindgen 0.2.129"; exit; fi\n${RECORD}`;

function generators(
  overrides: Record<string, string> = {},
): Record<string, string> {
  return {
    flutter_rust_bridge_codegen: codegen(),
    dart: RECORD,
    flutter: RECORD,
    cargo: RECORD,
    "wasm-bindgen": cli,
    ...overrides,
  };
}

async function fixture(): Promise<string> {
  const repo = await repository();
  await write(repo, "app/rust/Cargo.lock", APP_LOCK);
  await write(repo, "app/lib/a.g.dart", "generated\n");
  await write(repo, "app/drift_schemas/one/v1.json", "{}\n");
  await write(repo, "app/drift_schemas/two/v1.json", "{}\n");
  await write(repo, "engine-wasm/Cargo.lock", WASM_LOCK);
  await write(repo, "engine-wasm/pkg/glue.js", "generated\n");
  await commit(repo, "generated");
  return repo;
}

Deno.test("passes when the generators change nothing, counting each set beside its selection", async () => {
  const { path } = await host(generators());
  const ran = await program(await fixture(), "check-generated", [], {
    PATH: path,
  });
  assert.equal(ran.code, 0, ran.stderr);
  assert.ok(
    ran.stdout.includes(
      `checked 3 generated files in app/ against their generators, selected by: ${APP_SCOPE}\n`,
    ),
    ran.stdout,
  );
  assert.ok(
    ran.stdout.includes(
      `checked 1 generated files in engine-wasm/pkg/ against wasm-bindgen, selected by: ${WASM_SCOPE}\n`,
    ),
    ran.stdout,
  );
});

Deno.test("runs each generator, and drift's for each database", async () => {
  const { path, log } = await host(generators());
  await program(await fixture(), "check-generated", [], { PATH: path });
  assert.deepEqual((await log()).trim().split("\n").slice(0, 6), [
    "flutter_rust_bridge_codegen generate",
    "dart run build_runner build",
    "flutter gen-l10n",
    "dart run drift_dev make-migrations",
    "dart run drift_dev schema generate --data-classes --companions drift_schemas/one/ test/drift/one/generated/",
    "dart run drift_dev schema generate --data-classes --companions drift_schemas/two/ test/drift/two/generated/",
  ]);
});

Deno.test("fails on a generator that changes a file, with the diff", async () => {
  const { path } = await host(
    generators({ dart: `${RECORD}\necho regenerated >lib/a.g.dart` }),
  );
  const ran = await program(await fixture(), "check-generated", [], {
    PATH: path,
  });
  assert.equal(ran.code, 1);
  assert.ok(
    ran.stderr.startsWith(
      "generated code is stale; regenerate it and commit the result:\n",
    ),
    ran.stderr,
  );
  assert.match(ran.stderr, /^< \S+ lib\/a\.g\.dart$/m);
  assert.match(ran.stderr, /^> \S+ lib\/a\.g\.dart$/m);
  assert.ok(!ran.stdout.includes("checked 3"), ran.stdout);
});

Deno.test("fails on a generator that adds a file or removes one", async () => {
  const added = await host(generators({ flutter: `echo new >lib/b.g.dart` }));
  const adding = await program(await fixture(), "check-generated", [], {
    PATH: added.path,
  });
  assert.equal(adding.code, 1);
  assert.match(adding.stderr, /^> \S+ lib\/b\.g\.dart$/m);

  const removed = await host(generators({ flutter: `rm lib/a.g.dart` }));
  const removing = await program(await fixture(), "check-generated", [], {
    PATH: removed.path,
  });
  assert.equal(removing.code, 1);
  assert.match(removing.stderr, /^< \S+ lib\/a\.g\.dart$/m);
});

Deno.test("reads an uncommitted edit: the generator's output differs from the working tree", async () => {
  const { path } = await host(
    generators({ dart: `${RECORD}\necho generated >lib/a.g.dart` }),
  );
  const repo = await fixture();
  const clean = await program(repo, "check-generated", [], { PATH: path });
  assert.equal(clean.code, 0, clean.stderr);
  await write(repo, "app/lib/a.g.dart", "edited by hand\n");
  const edited = await program(repo, "check-generated", [], { PATH: path });
  assert.equal(edited.code, 1);
});

Deno.test("fails on stale engine-wasm/pkg/ after the app's set passed", async () => {
  const { path } = await host(
    generators({
      "wasm-bindgen": `${cli}\n[ "$1" = --target ] && echo new >pkg/glue.js`,
    }),
  );
  const ran = await program(await fixture(), "check-generated", [], {
    PATH: path,
  });
  assert.equal(ran.code, 1);
  assert.ok(
    ran.stdout.includes("checked 3 generated files in app/"),
    ran.stdout,
  );
  assert.match(ran.stderr, /^< \S+ engine-wasm\/pkg\/glue\.js$/m);
});

Deno.test("fails when no file is selected, in either set", async () => {
  const { path } = await host(generators());
  const repo = await repository();
  await write(repo, "app/rust/Cargo.lock", APP_LOCK);
  const app = await program(repo, "check-generated", [], { PATH: path });
  assert.equal(app.code, 1);
  assert.equal(app.stderr, `no generated file was selected by: ${APP_SCOPE}\n`);

  await write(repo, "app/lib/a.g.dart", "generated\n");
  await write(repo, "app/drift_schemas/one/v1.json", "{}\n");
  const wasm = await program(repo, "check-generated", [], { PATH: path });
  assert.equal(wasm.code, 1);
  assert.equal(
    wasm.stderr,
    `no generated file was selected by: ${WASM_SCOPE}\n`,
  );
});

Deno.test("fails on a codegen other than the release the lock file pins, and generates nothing", async () => {
  const { path, log } = await host(
    generators({
      flutter_rust_bridge_codegen: `echo "flutter_rust_bridge_codegen 1.0.0"`,
    }),
  );
  const ran = await program(await fixture(), "check-generated", [], {
    PATH: path,
  });
  assert.equal(ran.code, 1);
  assert.equal(
    ran.stderr,
    "flutter_rust_bridge_codegen 2.13.0 is required, as rust/Cargo.lock pins; found: flutter_rust_bridge_codegen 1.0.0\n",
  );
  assert.equal(await log(), "");
});

Deno.test("without wasm-bindgen it skips engine-wasm/pkg/ after the app's set, and fails where CI is set", async () => {
  const stubs = generators();
  delete stubs["wasm-bindgen"];
  const { path } = await host(stubs);
  const repo = await fixture();
  const local = await program(repo, "check-generated", [], { PATH: path });
  assert.equal(local.code, 0, local.stderr);
  assert.ok(
    local.stdout.endsWith(
      "skipped checking engine-wasm/pkg/: this host has no wasm-bindgen command\n",
    ),
    local.stdout,
  );
  const ci = await program(repo, "check-generated", [], {
    PATH: path,
    CI: "true",
  });
  assert.equal(ci.code, 1);
  assert.match(ci.stderr, /^did not run checking engine-wasm\/pkg\//);
});
