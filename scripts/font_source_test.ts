// tools/fonts/font_source.py against a local server standing in for raw.githubusercontent.com,
// with the cache directory in a temporary one.
import assert from "node:assert/strict";
import { run } from "./testing.ts";

const FONTS = new URL("../tools/fonts/", import.meta.url).pathname;
const BODY = new Uint8Array(new TextEncoder().encode("the font source"));

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

type Served = {
  url: string;
  requests: () => number;
  stop: () => Promise<void>;
};

/** Answers `statuses` in turn, one per request, then 200 with BODY; a status of 0 stalls. */
function serve(statuses: number[] = []): Served {
  let count = 0;
  const server = Deno.serve(
    { hostname: "127.0.0.1", port: 0, onListen: () => {} },
    () => {
      const status = statuses[count++] ?? 200;
      return status === 200
        ? new Response(BODY)
        : new Response("no", { status });
    },
  );
  return {
    url: `http://127.0.0.1:${server.addr.port}/font`,
    requests: () => count,
    stop: () => server.shutdown(),
  };
}

/** Runs font_source.fetch(url, sha256) with a pause of 0 and the given attempts. */
async function fetching(
  served: Served,
  cache: string,
  hash: string,
  attempts = 3,
) {
  const code = `import sys, font_source
data = font_source.fetch(sys.argv[1], sys.argv[2], attempts=${attempts}, pause=0)
print(data.decode())`;
  return await run(FONTS, ["python3", "-c", code, served.url, hash], {
    XDG_CACHE_HOME: cache,
    NO_PROXY: "127.0.0.1",
    no_proxy: "127.0.0.1",
  });
}

async function withServer(
  statuses: number[],
  body: (served: Served, cache: string) => Promise<void>,
) {
  const served = serve(statuses);
  const cache = await Deno.makeTempDir();
  try {
    await body(served, cache);
  } finally {
    await served.stop();
    await Deno.remove(cache, { recursive: true });
  }
}

Deno.test("the second fetch is served from the cache, with no request", async () => {
  const hash = await sha256(BODY);
  await withServer([], async (served, cache) => {
    const first = await fetching(served, cache, hash);
    assert.equal(first.code, 0, first.stderr);
    assert.equal(first.stdout.trim(), "the font source");
    assert.equal(served.requests(), 1);
    const kept = await Deno.readFile(`${cache}/knowno/fonts/${hash}`);
    assert.deepEqual(
      kept,
      BODY,
      "setup: the download was not cached by its hash",
    );

    const second = await fetching(served, cache, hash);
    assert.equal(second.code, 0, second.stderr);
    assert.equal(second.stdout.trim(), "the font source");
    assert.equal(served.requests(), 1, "the cache hit made a request");
    assert.ok(second.stderr.includes("cache hit"), second.stderr);
  });
});

Deno.test("a cached file of another hash is dropped and downloaded again", async () => {
  const hash = await sha256(BODY);
  await withServer([], async (served, cache) => {
    await Deno.mkdir(`${cache}/knowno/fonts`, { recursive: true });
    await Deno.writeTextFile(`${cache}/knowno/fonts/${hash}`, "damaged");
    const ran = await fetching(served, cache, hash);
    assert.equal(ran.code, 0, ran.stderr);
    assert.equal(ran.stdout.trim(), "the font source");
    assert.equal(served.requests(), 1);
    assert.deepEqual(
      await Deno.readFile(`${cache}/knowno/fonts/${hash}`),
      BODY,
    );
  });
});

Deno.test("a transient failure is retried, and the retries are bounded", async () => {
  const hash = await sha256(BODY);
  await withServer([503, 429], async (served, cache) => {
    const ran = await fetching(served, cache, hash, 3);
    assert.equal(ran.code, 0, ran.stderr);
    assert.equal(served.requests(), 3);
    assert.ok(ran.stderr.includes("retrying"), ran.stderr);
  });
  await withServer([503, 503, 503, 503, 503], async (served, cache) => {
    const ran = await fetching(served, cache, hash, 3);
    assert.notEqual(ran.code, 0);
    assert.equal(served.requests(), 3, "it did not stop at the attempts given");
    assert.ok(ran.stderr.includes("503"), ran.stderr);
  });
});

Deno.test("a failure that is not transient is not retried", async () => {
  const hash = await sha256(BODY);
  await withServer([404], async (served, cache) => {
    const ran = await fetching(served, cache, hash, 3);
    assert.notEqual(ran.code, 0);
    assert.equal(served.requests(), 1);
  });
});

Deno.test("a download of another hash fails and is not cached", async () => {
  await withServer([], async (served, cache) => {
    const wrong = "0".repeat(64);
    const ran = await fetching(served, cache, wrong);
    assert.notEqual(ran.code, 0);
    assert.ok(ran.stderr.includes(`not ${wrong}`), ran.stderr);
    assert.equal(served.requests(), 1);
    await assert.rejects(Deno.stat(`${cache}/knowno/fonts/${wrong}`));
  });
});
