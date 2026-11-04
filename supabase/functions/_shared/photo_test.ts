// The photo fetch's guards with the network and the address lookup replaced: no test leaves the
// process, and each refusal stands beside the accepted case its mechanism alone tells apart.
import assert from "node:assert/strict";
import {
  fetchPhoto,
  imageSizeOf,
  imageTypeOf,
  isPublicAddress,
  MAX_PHOTO_BYTES,
  type PhotoDeps,
} from "./photo.ts";

/** The first bytes of a PNG of [width] by [height]. */
function png(width: number, height: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([...new TextEncoder().encode("IHDR")], 12);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
}

/** A JPEG of [width] by [height], with an Exif block of [orientation] when given. */
function jpeg(
  width: number,
  height: number,
  orientation?: number,
  order: "II" | "MM" = "II",
): Uint8Array<ArrayBuffer> {
  const out = [0xff, 0xd8];
  if (orientation !== undefined) {
    const little = order === "II";
    const u16 = (value: number) => little ? [value, 0] : [0, value];
    const u32 = (value: number) => little ? [value, 0, 0, 0] : [0, 0, 0, value];
    const tiff = [
      ...new TextEncoder().encode(order),
      ...u16(42),
      ...u32(8),
      ...u16(1),
      ...(little ? [0x12, 0x01] : [0x01, 0x12]),
      ...u16(3),
      ...u32(1),
      ...u16(orientation),
      0,
      0,
    ];
    const exif = [...new TextEncoder().encode("Exif\0\0"), ...tiff];
    out.push(0xff, 0xe1, 0, exif.length + 2, ...exif);
  }
  out.push(
    0xff,
    0xc0,
    0,
    11,
    8,
    height >> 8,
    height & 255,
    width >> 8,
    width & 255,
    1,
    1,
    0x11,
    0,
    0xff,
    0xda,
    0,
    0,
  );
  return new Uint8Array(out);
}

function riffWebp(form: string, body: number[]): Uint8Array<ArrayBuffer> {
  const text = new TextEncoder();
  return new Uint8Array([
    ...text.encode("RIFF"),
    0,
    0,
    0,
    0,
    ...text.encode("WEBP"),
    ...text.encode(form),
    0,
    0,
    0,
    0,
    ...body,
    ...new Array(16).fill(0),
  ]);
}

const PUBLIC_V4 = "93.184.216.34";
const PUBLIC_V6 = "2606:2800:220:1:248:1893:25c8:1946";

type Reply = () => Response;

/** A network of [replies] by URL and a lookup of [hosts], recording what was requested. */
function network(
  replies: Record<string, Reply>,
  hosts: Record<string, string[]> = {},
  timeout: (ms: number) => AbortSignal = () => new AbortController().signal,
) {
  const requested: { url: string; init?: RequestInit }[] = [];
  const deps: PhotoDeps = {
    fetch: (input, init) => {
      const url = String(input);
      requested.push({ url, init });
      const reply = replies[url];
      return reply
        ? Promise.resolve(reply())
        : Promise.reject(new TypeError(`no route to ${url}`));
    },
    resolve: (host) => Promise.resolve(hosts[host] ?? [PUBLIC_V4]),
    timeout,
  };
  return { deps, requested };
}

const image =
  (bytes: Uint8Array<ArrayBuffer>, type = "image/png"): Reply => () =>
    new Response(bytes, { headers: { "Content-Type": type } });
const redirect = (to: string, status = 302): Reply => () =>
  new Response(null, { status, headers: { Location: to } });

const OK = "https://cdn.example/a.png";

for (
  const [address, isPublic] of [
    [PUBLIC_V4, true],
    ["8.8.8.8", true],
    ["172.32.0.1", true],
    ["192.169.0.1", true],
    ["100.128.0.1", true],
    ["0.0.0.0", false],
    ["10.1.2.3", false],
    ["100.64.0.1", false],
    ["127.0.0.1", false],
    ["169.254.169.254", false],
    ["172.16.0.1", false],
    ["172.31.255.255", false],
    ["192.168.1.1", false],
    ["198.18.0.1", false],
    ["224.0.0.1", false],
    ["255.255.255.255", false],
    [PUBLIC_V6, true],
    ["2a00:1450:4001:81d::200e", true],
    ["::1", false],
    ["::", false],
    ["fe80::1", false],
    ["fc00::1", false],
    ["fd12:3456::1", false],
    ["ff02::1", false],
    ["::ffff:127.0.0.1", false],
    ["::ffff:7f00:1", false],
    ["::ffff:8.8.8.8", false],
    ["64:ff9b::7f00:1", false],
    ["2002:7f00:1::", false],
    ["2001:db8::1", false],
    ["2001:0:4136:e378::1", false],
    ["not an address", false],
  ] as const
) {
  Deno.test(`${address} is ${isPublic ? "public" : "refused"}`, () => {
    assert.equal(isPublicAddress(address), isPublic);
  });
}

Deno.test("a public https image is fetched with no credential, its type and size from its bytes", async () => {
  const { deps, requested } = network({
    [OK]: image(png(640, 480), "image/png; charset=binary"),
  });
  const photo = await fetchPhoto(OK, deps);
  assert.ok(typeof photo !== "string", String(photo));
  assert.equal(photo.mimeType, "image/png");
  assert.deepEqual([photo.width, photo.height], [640, 480]);
  const headers = new Headers(requested[0]!.init?.headers);
  assert.equal(headers.has("Authorization"), false);
  assert.equal(headers.has("apikey"), false);
  assert.equal(requested[0]!.init?.redirect, "manual");
});

for (
  const [name, address] of [
    ["http", "http://cdn.example/a.png"],
    ["a credential in the url", "https://user:pw@cdn.example/a.png"],
    ["a loopback literal", "https://127.0.0.1/a.png"],
    ["a decimal loopback", "https://2130706433/a.png"],
    ["a hex loopback", "https://0x7f.0.0.1/a.png"],
    ["the metadata address", "https://169.254.169.254/latest/meta-data/"],
    ["an IPv6 loopback", "https://[::1]/a.png"],
    ["an IPv6-mapped loopback", "https://[::ffff:127.0.0.1]/a.png"],
    ["text that is no url", "not a url"],
  ] as const
) {
  Deno.test(`${name} is refused before any request`, async () => {
    const { deps, requested } = network({});
    const refused = await fetchPhoto(address, deps);
    assert.equal(typeof refused, "string");
    assert.match(refused as string, /public https address/);
    assert.deepEqual(requested, []);
  });
}

Deno.test("a public address literal is requested, as a private one is not", async () => {
  const url = `https://${PUBLIC_V4}/a.png`;
  const { deps, requested } = network({ [url]: image(png(1, 1)) });
  assert.notEqual(typeof await fetchPhoto(url, deps), "string");
  assert.equal(requested.length, 1);
});

Deno.test("a host with any private address is refused before a request, and one of public addresses alone is served", async () => {
  const hosts = {
    "rebind.example": [PUBLIC_V4, "10.0.0.1"],
    "mapped.example": ["::ffff:10.0.0.1"],
    "good.example": [PUBLIC_V4, PUBLIC_V6],
  };
  const { deps, requested } = network({
    "https://good.example/a.png": image(png(1, 1)),
  }, hosts);
  for (const host of ["rebind.example", "mapped.example"]) {
    const refused = await fetchPhoto(`https://${host}/a.png`, deps);
    assert.match(refused as string, /public https address/);
  }
  assert.deepEqual(requested, []);
  const served = await fetchPhoto("https://good.example/a.png", deps);
  assert.notEqual(typeof served, "string");
});

Deno.test("a host with no address is refused and says to check the url", async () => {
  const { deps, requested } = network({}, { "none.example": [] });
  const refused = await fetchPhoto("https://none.example/a.png", deps);
  assert.match(refused as string, /no address/);
  assert.deepEqual(requested, []);
});

Deno.test("a redirect to a private address is refused at that hop, as one to a public host is followed", async () => {
  const hosts = { "inner.example": ["192.168.0.5"] };
  const { deps, requested } = network({
    "https://a.example/x": redirect("https://b.example/y"),
    "https://b.example/y": redirect("/z", 301),
    "https://b.example/z": image(png(2, 3)),
    "https://a.example/bad": redirect("https://inner.example/secret"),
    "https://a.example/plain": redirect("http://b.example/z"),
    "https://a.example/mapped": redirect("https://[::ffff:a00:1]/"),
  }, hosts);
  const followed = await fetchPhoto("https://a.example/x", deps);
  assert.ok(typeof followed !== "string");
  assert.equal(followed.height, 3);
  requested.length = 0;
  for (const path of ["bad", "plain", "mapped"]) {
    const refused = await fetchPhoto(`https://a.example/${path}`, deps);
    assert.match(refused as string, /public https address/, path);
  }
  assert.deepEqual(requested.map(({ url }) => url), [
    "https://a.example/bad",
    "https://a.example/plain",
    "https://a.example/mapped",
  ]);
});

Deno.test("three redirects are followed and a fourth is refused", async () => {
  const chain = (hops: number) =>
    Object.fromEntries(
      Array.from({ length: hops }, (_, hop) => [
        `https://r.example/${hop}`,
        redirect(`https://r.example/${hop + 1}`),
      ]).concat([[`https://r.example/${hops}`, image(png(1, 1))]]),
    );
  const three = network(chain(3));
  assert.notEqual(
    typeof await fetchPhoto("https://r.example/0", three.deps),
    "string",
  );
  const four = network(chain(4));
  const refused = await fetchPhoto("https://r.example/0", four.deps);
  assert.match(refused as string, /redirected more than 3 times/);
  assert.equal(four.requested.length, 4);
});

Deno.test("a file over the cap is refused by its header without reading it, and by its stream when the header lies", async () => {
  const over = new Uint8Array(MAX_PHOTO_BYTES + 1);
  over.set(png(1, 1));
  const declared = network({
    [OK]: () =>
      new Response(new ReadableStream(), {
        headers: {
          "Content-Type": "image/png",
          "Content-Length": String(MAX_PHOTO_BYTES + 1),
        },
      }),
  });
  assert.match(await fetchPhoto(OK, declared.deps) as string, /larger than/);
  const streamed = network({ [OK]: image(over) });
  assert.match(await fetchPhoto(OK, streamed.deps) as string, /larger than/);
  const exact = network({ [OK]: image(over.slice(0, MAX_PHOTO_BYTES)) });
  assert.notEqual(typeof await fetchPhoto(OK, exact.deps), "string");
});

Deno.test("the header and the bytes must both name the same image type", async () => {
  const cases: [Reply, RegExp][] = [
    [image(png(1, 1), "text/html"), /not a page/],
    [image(png(1, 1), "image/svg+xml"), /not a page/],
    [image(png(1, 1), "image/jpeg"), /bytes are not/],
    [image(new TextEncoder().encode("<svg/>")), /bytes are not/],
  ];
  for (const [reply, reason] of cases) {
    const { deps } = network({ [OK]: reply });
    assert.match(await fetchPhoto(OK, deps) as string, reason);
  }
  const { deps } = network({ [OK]: image(jpeg(5, 4), "IMAGE/JPEG") });
  const photo = await fetchPhoto(OK, deps);
  assert.ok(typeof photo !== "string");
  assert.equal(photo.mimeType, "image/jpeg");
});

Deno.test("a file that states no size is refused, as one that does is served", async () => {
  const empty = new Uint8Array(33);
  empty.set(png(0, 0));
  const { deps } = network({ [OK]: image(empty) });
  assert.match(await fetchPhoto(OK, deps) as string, /states no size/);
});

Deno.test("a failing address is refused with what it answered, and a dropped connection with what to do", async () => {
  const missing = network({ [OK]: () => new Response(null, { status: 404 }) });
  assert.match(await fetchPhoto(OK, missing.deps) as string, /answered 404/);
  const dropped = network({});
  assert.match(
    await fetchPhoto(OK, dropped.deps) as string,
    /could not be fetched/,
  );
});

Deno.test("a host that never answers is refused at the deadline, and the deadline covers the whole fetch", async () => {
  const asked: number[] = [];
  const controller = new AbortController();
  const deps: PhotoDeps = {
    fetch: (_, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("x")));
        controller.abort();
      }),
    resolve: () => Promise.resolve([PUBLIC_V4]),
    timeout: (ms) => {
      asked.push(ms);
      return controller.signal;
    },
  };
  assert.match(await fetchPhoto(OK, deps) as string, /within 10 seconds/);
  assert.deepEqual(asked, [10_000]);
});

Deno.test("types are read from the opening bytes", () => {
  assert.equal(imageTypeOf(png(1, 1)), "image/png");
  assert.equal(imageTypeOf(jpeg(1, 1)), "image/jpeg");
  assert.equal(imageTypeOf(riffWebp("VP8 ", [])), "image/webp");
  const wave = riffWebp("VP8 ", []);
  wave.set(new TextEncoder().encode("WAVE"), 8);
  assert.equal(imageTypeOf(wave), null);
});

Deno.test("a JPEG's size is read as drawn, a quarter turn of Exif swapping it", () => {
  assert.deepEqual(imageSizeOf(jpeg(640, 480), "image/jpeg"), {
    width: 640,
    height: 480,
  });
  for (const order of ["II", "MM"] as const) {
    assert.deepEqual(imageSizeOf(jpeg(640, 480, 6, order), "image/jpeg"), {
      width: 480,
      height: 640,
    });
    assert.deepEqual(imageSizeOf(jpeg(640, 480, 3, order), "image/jpeg"), {
      width: 640,
      height: 480,
    });
  }
});

Deno.test("a WebP's size is read from each of its three forms", () => {
  const vp8 = riffWebp("VP8 ", [
    0,
    0,
    0,
    0x9d,
    0x01,
    0x2a,
    0x80,
    0x02,
    0xe0,
    0x01,
  ]);
  assert.deepEqual(imageSizeOf(vp8, "image/webp"), { width: 640, height: 480 });
  // 640 - 1 and 480 - 1 in 14 bits each.
  const bits = 639 + 479 * 16384;
  const lossless = riffWebp("VP8L", [
    0x2f,
    bits & 255,
    (bits >> 8) & 255,
    (bits >> 16) & 255,
    (bits >> 24) & 255,
  ]);
  assert.deepEqual(imageSizeOf(lossless, "image/webp"), {
    width: 640,
    height: 480,
  });
  const extended = riffWebp("VP8X", [0, 0, 0, 0, 0x7f, 0x02, 0, 0xdf, 0x01, 0]);
  assert.deepEqual(imageSizeOf(extended, "image/webp"), {
    width: 640,
    height: 480,
  });
});
