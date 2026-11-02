// scripts/check-ios-client-id.ts: the client ID in app/config/dev.json against app/ios/Runner/Info.plist.
import assert from "node:assert/strict";
import { schemesIn, urlScheme } from "./check-ios-client-id.ts";
import { program, repository, write } from "./testing.ts";

const CONFIG = "app/config/dev.json";
const PLIST = "app/ios/Runner/Info.plist";
const id = (name: string) => `${name}.apps.googleusercontent.com`;
const scheme = (name: string) => `com.googleusercontent.apps.${name}`;

async function fixture(config: string, plist: string): Promise<string> {
  const repo = await repository();
  await write(repo, CONFIG, config);
  await write(repo, PLIST, plist);
  return repo;
}

Deno.test("passes when the plist holds the reversed client ID, and fails beside another", async () => {
  const config = JSON.stringify({ GOOGLE_IOS_CLIENT_ID: id("1-abc") });
  const same = await fixture(config, `<string>${scheme("1-abc")}</string>\n`);
  const passed = await program(same, "check-ios-client-id");
  assert.equal(passed.code, 0, passed.stderr);
  assert.equal(
    passed.stdout,
    `${PLIST} has the URL scheme of GOOGLE_IOS_CLIENT_ID in ${CONFIG}\n`,
  );

  const other = await fixture(config, `<string>${scheme("2-old")}</string>\n`);
  const failed = await program(other, "check-ios-client-id");
  assert.equal(failed.code, 1);
  assert.equal(
    failed.stderr,
    `${PLIST} has no URL scheme ${
      scheme("1-abc")
    }, the reversed GOOGLE_IOS_CLIENT_ID of ${CONFIG}\nfound: ${
      scheme("2-old")
    }\n`,
  );
});

Deno.test("reports none where the plist holds no scheme of Google's shape", async () => {
  const repo = await fixture(
    JSON.stringify({ GOOGLE_IOS_CLIENT_ID: id("1-abc") }),
    "<string>other</string>\n",
  );
  const ran = await program(repo, "check-ios-client-id");
  assert.equal(ran.code, 1);
  assert.ok(ran.stderr.endsWith("found: none\n"), ran.stderr);
});

Deno.test("fails when the configuration has no client ID", async () => {
  const repo = await fixture("{}", "<string>other</string>\n");
  const ran = await program(repo, "check-ios-client-id");
  assert.equal(ran.code, 1);
  assert.equal(ran.stderr, `${CONFIG} has no GOOGLE_IOS_CLIENT_ID\n`);
});

Deno.test("exits 2 on a configuration that is not JSON", async () => {
  const repo = await fixture("not json", "<string>other</string>\n");
  const ran = await program(repo, "check-ios-client-id");
  assert.equal(ran.code, 2);
});

Deno.test("urlScheme strips Google's suffix, and only that", () => {
  assert.equal(urlScheme(id("1-abc")), scheme("1-abc"));
  assert.equal(urlScheme("no-suffix"), scheme("no-suffix"));
});

Deno.test("schemesIn reads each scheme up to its tag", () => {
  assert.deepEqual(
    schemesIn(
      `<string>${scheme("a")}</string>\n<string>${scheme("b")}</string>\n`,
    ),
    [scheme("a"), scheme("b")],
  );
});
