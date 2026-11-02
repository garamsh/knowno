#!/usr/bin/env node
// Writes every brand file from the drawings in tools/brand/, the mark and the mascot's expressions
// over the one body.svg, and wordmarks.json, the outlines of 알아몰라 and knowno in Pretendard
// ExtraBold (app/assets/fonts/): the SVGs of web/public/, and the PNGs of app/assets/brand/ and
// web/public/. `make brand` runs it, then the launcher icon and
// splash generators over its output. With --check it writes nothing and fails on a file that
// differs from what it would write: an SVG by any byte, a PNG by a mean difference per channel of
// 1 in 255 or more, since librsvg's anti-aliasing differs a little between platforms.
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const sharp = createRequire(join(root, "web/package.json"))("sharp");

const ink = "#3B2118";
const inkOnDark = "#FFF1E3";
const cream = "#FCEBD5";
const cobalt = "#2547D0";
const darkGround = "#111A2E";

/** What the drawing tools/brand/[name].svg holds inside its root. */
const inner = (name) =>
  /<svg[^>]*>\s*<title>[^<]*<\/title>([\s\S]*)<\/svg>/.exec(
    readFileSync(join(root, `tools/brand/${name}.svg`), "utf8"),
  )[1];

/** The drawing [name], with body.svg drawn where it says. */
const drawing = (name) => inner(name).replaceAll('<use href="body.svg"/>', inner("body"));

const mark = drawing("mark");
const wordmarks = JSON.parse(readFileSync(join(root, "tools/brand/wordmarks.json"), "utf8"));

const svg = (width, height, body, size = { width, height }) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${size.width}" height="${size.height}"><title>knowno</title>${body}</svg>\n`;

/** The mark in a box of [scale] of a 1024 canvas, centred, over [ground]. */
const centred = (art, scale, ground = "") => {
  const inset = (1024 * (1 - scale)) / 2;
  return `${ground}<g transform="translate(${inset} ${inset}) scale(${scale})">${art}</g>`;
};

const onCircle = centred(mark, 0.88, `<circle cx="512" cy="512" r="512" fill="${cream}"/>`);

/** The mark close up on a full square of [ground], the ground showing around its head, its body running off the foot. */
const onSquare = (ground) =>
  `<rect width="1024" height="1024" fill="${ground}"/><g transform="translate(-36 70) scale(1.08)">${mark}</g>`;

/** The mark on the cream circle, in a box [size] across at ([x], [y]). */
const circled = (x, y, size) =>
  `<g transform="translate(${x} ${y}) scale(${size / 1024})">${onCircle}</g>`;

/** A wordmark [scale]d from its 1000-unit outline, its box's left and top at ([x], [y]). */
const word = ({ d, x1, y1 }, x, y, scale, fill) =>
  `<path fill="${fill}" transform="translate(${x - x1 * scale} ${y - y1 * scale}) scale(${scale})" d="${d}"/>`;

const lockupSize = { width: 981, height: 200 };
const stackedSize = { width: 600, height: 484 };

/** The mark on its circle, then 알아몰라 and knowno on one baseline. */
const lockup = (ink) =>
  svg(
    lockupSize.width,
    lockupSize.height,
    circled(0, 0, 200) +
      word(wordmarks.ko, 228, 46, 0.12, ink) +
      word(wordmarks.en, 663, 92, 0.085, ink),
  );

/** The mark on its circle over 알아몰라 over knowno. */
const stacked = (ink) =>
  svg(
    stackedSize.width,
    stackedSize.height,
    circled(155, 0, 290) +
      word(wordmarks.ko, 77, 304, 0.13, ink) +
      word(wordmarks.en, 178, 431, 0.065, ink),
  );

const canvas = (body) => svg(1024, 1024, body);
const markAlone = canvas(mark);

/** The mascot's expressions, the mark itself the thinking one. */
const expressions = {
  thinking: markAlone,
  happy: canvas(drawing("happy")),
  sad: canvas(drawing("sad")),
  sleepy: canvas(drawing("sleepy")),
};

const vectors = {
  "web/public/favicon.svg": canvas(onSquare(cobalt)),
  ...Object.fromEntries(
    Object.entries(expressions).map(([name, art]) => [`web/public/brand/knowno-${name}.svg`, art]),
  ),
  "web/public/brand/knowno-lockup-light.svg": lockup(ink),
  "web/public/brand/knowno-lockup-dark.svg": lockup(inkOnDark),
  "web/public/brand/knowno-stacked-light.svg": stacked(ink),
  "web/public/brand/knowno-stacked-dark.svg": stacked(inkOnDark),
};

/** The size an SVG of [size] is drawn at, [height] or [width] high or wide, in device pixels. */
const scaled = (size, { width, height }) => {
  const factor = width ? width / size.width : height / size.height;
  return { width: Math.round(size.width * factor), height: Math.round(size.height * factor) };
};

/** One file per device density under app/assets/brand/, as Flutter resolves them. */
const densities = (name, source, size, logical) =>
  [
    ["", 1],
    ["2.0x/", 2],
    ["3.0x/", 3],
  ].map(([folder, density]) => {
    const pixels = scaled(size, Object.fromEntries(Object.entries(logical).map(([k, v]) => [k, v * density])));
    return { path: `app/assets/brand/${folder}${name}.png`, source, ...pixels };
  });

const square = (path, source, pixels, opaque = false) => ({
  path,
  source,
  width: pixels,
  height: pixels,
  opaque,
});

const rasters = [
  ...densities("knowno-lockup-light", vectors["web/public/brand/knowno-lockup-light.svg"], lockupSize, { height: 30 }),
  ...densities("knowno-lockup-dark", vectors["web/public/brand/knowno-lockup-dark.svg"], lockupSize, { height: 30 }),
  ...densities("knowno-stacked-light", vectors["web/public/brand/knowno-stacked-light.svg"], stackedSize, { width: 200 }),
  ...densities("knowno-stacked-dark", vectors["web/public/brand/knowno-stacked-dark.svg"], stackedSize, { width: 200 }),
  ...Object.entries(expressions).flatMap(([name, art]) =>
    densities(`knowno-${name}`, art, { width: 1024, height: 1024 }, { width: 128 }),
  ),
  // The launcher icons' sources: the mark close up on cobalt, the same on the dark ground for iOS
  // 18's dark icon, and the mark alone on no ground, Android's adaptive foreground over cobalt;
  // flutter_launcher_icons insets the last by 16%, inside the 66 of 108 dp every mask keeps.
  square("app/assets/brand/icon/app-icon-light-1024.png", canvas(onSquare(cobalt)), 1024, true),
  square("app/assets/brand/icon/app-icon-dark-1024.png", canvas(onSquare(darkGround)), 1024, true),
  square("app/assets/brand/icon/app-icon-foreground-1024.png", markAlone, 1024),
  // The splash's sources: the mark alone on the light ground, the circled mark on the dark one;
  // Android 12 crops to the middle 768 of 1152.
  square("app/assets/brand/splash/splash-light.png", canvas(centred(mark, 0.8)), 640),
  square("app/assets/brand/splash/splash-dark.png", canvas(centred(onCircle, 0.8)), 640),
  square("app/assets/brand/splash/android12-light.png", canvas(centred(mark, 0.6)), 1152),
  square("app/assets/brand/splash/android12-dark.png", canvas(centred(onCircle, 0.6)), 1152),
  square("web/public/favicon-32.png", canvas(onSquare(cobalt)), 32, true),
  square("web/public/apple-touch-icon.png", canvas(onSquare(cobalt)), 180, true),
  square("web/public/icon-192.png", canvas(onSquare(cobalt)), 192, true),
  square("web/public/icon-512.png", canvas(onSquare(cobalt)), 512, true),
];

/** [source] rasterised at [width] by [height], as PNG bytes. */
async function render({ source, width, height, opaque }) {
  const sized = source.replace(/ width="[\d.]+" height="[\d.]+"/, ` width="${width}" height="${height}"`);
  const image = sharp(Buffer.from(sized));
  return (opaque ? image.removeAlpha() : image).png({ compressionLevel: 9 }).toBuffer();
}

/** The mean difference per channel, out of 255, between two PNGs of one size; Infinity when they differ in size. */
async function difference(a, b) {
  const [left, right] = await Promise.all(
    [a, b].map((png) => sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })),
  );
  if (left.info.width !== right.info.width || left.info.height !== right.info.height) return Infinity;
  let total = 0;
  for (let i = 0; i < left.data.length; i++) total += Math.abs(left.data[i] - right.data[i]);
  return total / left.data.length;
}

async function check() {
  const stale = [];
  for (const [path, text] of Object.entries(vectors)) {
    const file = join(root, path);
    if (!existsSync(file) || readFileSync(file, "utf8") !== text) stale.push(path);
  }
  for (const raster of rasters) {
    const file = join(root, raster.path);
    if (!existsSync(file) || (await difference(readFileSync(file), await render(raster))) >= 1) {
      stale.push(raster.path);
    }
  }
  if (stale.length > 0) {
    console.error(`stale brand files; run make brand and commit the result:\n${stale.join("\n")}`);
    process.exit(1);
  }
  console.log(
    `checked ${Object.keys(vectors).length} SVGs and ${rasters.length} PNGs, the table in tools/brand/generate.mjs, against the drawings in tools/brand/`,
  );
}

async function write() {
  for (const [path, text] of Object.entries(vectors)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  for (const raster of rasters) {
    mkdirSync(dirname(join(root, raster.path)), { recursive: true });
    writeFileSync(join(root, raster.path), await render(raster));
  }
  console.log(`wrote ${Object.keys(vectors).length} SVGs and ${rasters.length} PNGs from the drawings in tools/brand/`);
}

await (process.argv.includes("--check") ? check() : write());
