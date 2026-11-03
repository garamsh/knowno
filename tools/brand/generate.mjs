#!/usr/bin/env node
// Writes every brand file from the drawings in tools/brand/, the mark and the mascot's expressions
// over the one body.svg, and wordmarks.json, the outlines of 알아몰라 and knowno in Pretendard
// ExtraBold (app/assets/fonts/): the SVGs of web/public/, the PNGs of app/assets/brand/ and
// web/public/, and the parts each client's Mascot moves, as Dart for the app and SVG markup for the
// web, and the study coach's hand, coach-hand.svg, as the paths each client draws in its theme's
// colours. A lockup holds one name: 알아몰라 on the web and for a Korean phone, knowno for any other.
// `make brand` runs it, then the launcher icon and splash generators over its output. With --check it writes nothing and fails on a file that
// differs from what it would write: an SVG or a source file by any byte, a PNG by a mean difference
// per channel of 1 in 255 or more, since librsvg's anti-aliasing differs a little between platforms.
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const sharp = createRequire(join(root, "web/package.json"))("sharp");

const ink = "#3B2118";
const cobalt = "#2547D0";
const darkGround = "#111A2E";
const darkCard = "#232F4E";
const darkAccent = "#8AB4FF";
const white = "#FFFFFF";

/** What the drawing tools/brand/[name].svg holds inside its root. */
const inner = (name) =>
  /<svg[^>]*>\s*<title>[^<]*<\/title>([\s\S]*)<\/svg>/.exec(
    readFileSync(join(root, `tools/brand/${name}.svg`), "utf8"),
  )[1];

/** The drawing [name], with body.svg drawn where it says. */
const drawing = (name) => inner(name).replaceAll('<use href="body.svg"/>', inner("body"));

const mark = drawing("mark");
const wordmarks = JSON.parse(readFileSync(join(root, "tools/brand/wordmarks.json"), "utf8"));

/** An SVG [width] by [height] drawing [body], named [title] to a screen reader: the word a lockup shows. */
const svg = (width, height, body, title = "knowno") =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><title>${title}</title>${body}</svg>\n`;

/** The mark in a box of [scale] of a 1024 canvas, centred, over [ground]. */
const centred = (art, scale, ground = "") => {
  const inset = (1024 * (1 - scale)) / 2;
  return `${ground}<g transform="translate(${inset} ${inset}) scale(${scale})">${art}</g>`;
};

/** The mark on a circle of [fill]. */
const onCircle = (fill) =>
  centred(mark, 0.88, `<circle cx="512" cy="512" r="512" fill="${fill}"/>`);

/** The mark close up on a full square of [ground], the ground showing around its head, its body running off the foot. */
const onSquare = (ground) =>
  `<rect width="1024" height="1024" fill="${ground}"/><g transform="translate(-36 70) scale(1.08)">${mark}</g>`;

/** The mark on a circle of [fill], in a box [size] across at ([x], [y]). */
const circled = (x, y, size, fill) =>
  `<g transform="translate(${x} ${y}) scale(${size / 1024})">${onCircle(fill)}</g>`;

/** A wordmark [scale]d from its 1000-unit outline, its box's left and top at ([x], [y]). */
const word = ({ d, x1, y1 }, x, y, scale, fill) =>
  `<path fill="${fill}" transform="translate(${places(x - x1 * scale)} ${places(y - y1 * scale)}) scale(${scale})" d="${d}"/>`;

/** [n] to three decimals, so a layout's arithmetic does not leave 77.99999999999999 in a file. */
function places(n) {
  return Math.round(n * 1000) / 1000;
}

/** How wide a lockup's word is drawn, whichever the name. */
const wordWidth = 446;

/** The scale at which [outline] is [wordWidth] across. */
const wordScale = ({ x1, x2 }) => wordWidth / (x2 - x1);

/** How high [outline] stands at [scale]. */
const wordHeight = ({ y1, y2 }, scale) => (y2 - y1) * scale;

/** The stacked lockup's circle across and the gap under it, then the horizontal lockup's circle and the gap beside it. */
const circleSize = 290;
const gap = 14;
const lockupCircle = 200;
const lockupGap = 28;

/** The languages the phone draws a lockup in; the web, in Korean alone, draws 알아몰라. */
const languages = ["ko", "en"];

/** The canvas of the stacked lockup in [lang]: as wide as its word, as high as the circle, the gap and the word. */
const stackedSize = (lang) => ({
  width: wordWidth,
  height: Math.ceil(circleSize + gap + wordHeight(wordmarks[lang], wordScale(wordmarks[lang]))),
});

/** The canvas of the horizontal lockup: the circle, its gap and the Korean word, as high as the circle. */
const lockupSize = { width: lockupCircle + lockupGap + wordWidth, height: lockupCircle };

/** The mark on its circle, then 알아몰라 beside it, centred on the circle. */
const lockup = (circle, words) => {
  const scale = wordScale(wordmarks.ko);
  return svg(
    lockupSize.width,
    lockupSize.height,
    circled(0, 0, lockupCircle, circle) +
      word(
        wordmarks.ko,
        lockupCircle + lockupGap,
        (lockupCircle - wordHeight(wordmarks.ko, scale)) / 2,
        scale,
        words,
      ),
    wordmarks.ko.text,
  );
};

/** The mark on its circle over the word of [lang], centred under it. */
const stacked = (lang, circle, words) => {
  const { width, height } = stackedSize(lang);
  const scale = wordScale(wordmarks[lang]);
  return svg(
    width,
    height,
    circled((width - circleSize) / 2, 0, circleSize, circle) +
      word(wordmarks[lang], 0, circleSize + gap, scale, words),
    wordmarks[lang].text,
  );
};

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
  "web/public/brand/knowno-lockup-light.svg": lockup(white, cobalt),
  "web/public/brand/knowno-lockup-dark.svg": lockup(darkCard, darkAccent),
  "web/public/brand/knowno-stacked-light.svg": stacked("ko", white, cobalt),
  "web/public/brand/knowno-stacked-dark.svg": stacked("ko", darkCard, darkAccent),
};

/** The elements of an SVG fragment as a tree of { tag, attrs, children }; the drawings hold nothing else. */
const parse = (markup) => {
  const root = { children: [] };
  const open = [root];
  for (const [, close, tag, attrs, alone] of markup.matchAll(/<(\/?)(\w+)([^>]*?)(\/?)>/g)) {
    if (close) {
      open.pop();
      continue;
    }
    const node = {
      tag,
      attrs: Object.fromEntries([...attrs.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, k, v]) => [k, v])),
      children: [],
    };
    open.at(-1).children.push(node);
    if (!alone) open.push(node);
  }
  return root.children;
};

/** A number of the drawing to a tenth, as SVG and Dart both write it. */
const number = (n) => String(Math.round(n * 10) / 10);

/**
 * [nodes] with each eye's closed lid after it: an arc in ink, 20 wide, from 0.72 of the white's
 * radius either side of its centre, dipping a half radius below it. The eye keeps its white's
 * centre as the point it closes about.
 */
const withLids = (nodes) =>
  nodes.flatMap((node) => {
    if (node.attrs.class !== "eye") return [{ ...node, children: withLids(node.children) }];
    const { cx, cy, r } = Object.fromEntries(
      Object.entries(node.children.find(({ tag }) => tag === "circle").attrs).map(([k, v]) => [k, Number(v)]),
    );
    const d = `M${number(cx - 0.72 * r)} ${cy}Q${cx} ${number(cy + 0.5 * r)} ${number(cx + 0.72 * r)} ${cy}`;
    return [
      { ...node, attrs: { ...node.attrs, "transform-origin": `${cx} ${cy}` } },
      {
        tag: "path",
        attrs: {
          class: "lid",
          fill: "none",
          stroke: ink,
          "stroke-width": "20",
          "stroke-linecap": "round",
          opacity: "0",
          d,
        },
        children: [],
      },
    ];
  });

/** Each expression's drawing, its moving parts named by class: eye, pupil, lid, arms and zz. */
const parts = Object.fromEntries(
  ["thinking", "happy", "sad", "sleepy"].map((name) => [
    name,
    withLids(parse(drawing(name === "thinking" ? "mark" : name))),
  ]),
);

const markup = (nodes) =>
  nodes
    .map(({ tag, attrs, children }) => {
      const open = `<${tag}${Object.entries(attrs)
        .map(([k, v]) => ` ${k}="${v}"`)
        .join("")}`;
      return children.length ? `${open}>${markup(children)}</${tag}>` : `${open}/>`;
    })
    .join("");

/** The web's parts: each drawing inside the group that breathes, as markup for an inline SVG. */
const webParts = `// Written by tools/brand/generate.mjs from the drawings in tools/brand/; run make brand after changing one.

${Object.entries(parts)
  .map(([name, nodes]) => `const ${name} =\n  '<g class="breath">${markup(nodes)}</g>';\n`)
  .join("\n")}
/** Each expression's drawing on a 1024 square, inside the group that breathes, its moving parts named by class. */
export const mascotDrawings = { ${Object.keys(parts).join(", ")} };
`;

/** The shapes of [nodes], back to front, each with the style, transform and moving part it takes from its groups. */
function* shapes(nodes, context = { style: {}, transform: "", move: null, eye: null }) {
  for (const node of nodes) {
    const style = { ...context.style };
    for (const key of ["fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin"]) {
      if (key in node.attrs) style[key] = node.attrs[key];
    }
    const inner = {
      style,
      transform: [context.transform, node.attrs.transform].filter(Boolean).join(" "),
      move: node.attrs.class ?? context.move,
      eye: node.attrs["transform-origin"] ?? context.eye,
    };
    if (node.tag === "g") yield* shapes(node.children, inner);
    else yield { ...inner, node };
  }
}

const dartColour = (hex) => `Color(0xFF${hex.slice(1).toUpperCase()})`;

/** A call of [name] with [args], on one line where it fits in 80 columns at [indent], as dart format writes it. */
const dartCall = (indent, name, args) => {
  const pad = " ".repeat(indent);
  const line = `${pad}${name}(${args.join(", ")}),`;
  if (line.length <= 80) return line;
  return [`${pad}${name}(`, ...args.map((arg) => `${pad}  ${arg},`), `${pad}),`].join("\n");
};

/** One shape as the app's `_Shape`. */
const dartShape = ({ node: { tag, attrs }, style, transform, move, eye }) => {
  const args =
    tag === "path"
      ? [`d: '${attrs.d}'`]
      : [
          `oval: (${[attrs.cx, attrs.cy, attrs.rx ?? attrs.r, attrs.ry ?? attrs.r]
            .map((n) => number(Number(n)))
            .join(", ")})`,
        ];
  const fill = style.fill ?? "#000000";
  if (fill !== "none") args.push(`fill: ${dartColour(fill)}`);
  if (style.stroke && style.stroke !== "none") {
    args.push(`stroke: ${dartColour(style.stroke)}`, `width: ${style["stroke-width"] ?? 1}`);
    if (style["stroke-linecap"]) args.push(`cap: StrokeCap.${style["stroke-linecap"]}`);
    if (style["stroke-linejoin"]) args.push(`join: StrokeJoin.${style["stroke-linejoin"]}`);
  }
  if (transform) args.push(`transform: '${transform}'`);
  if (move) args.push(`move: _Move.${move}`);
  if (eye) args.push(`eye: Offset(${eye.split(" ").join(", ")})`);
  return dartCall(4, "_Shape", args);
};

/** The app's parts: each drawing's shapes, which its Mascot paints and moves. */
const dartParts = `// Written by tools/brand/generate.mjs from the drawings in tools/brand/; run
// make brand after changing one.
part of 'mascot.dart';

/// Each expression's shapes, back to front, on a 1024 square.
const _drawings = {
${Object.entries(parts)
  .map(
    ([name, nodes]) => `  MascotExpression.${name}: [\n${[...shapes(nodes)].map(dartShape).join("\n")}\n  ],`,
  )
  .join("\n")}
};
`;

/**
 * The touch coach's pointing hand, coach-hand.svg, by the class of each part: its outline, filled
 * in the surface and drawn in ink; its edge, the outline offset by its translate and filled in the
 * edge colour; its creases in ink; and its tip, where it presses.
 */
const hand = Object.fromEntries(parse(inner("coach-hand")).map(({ attrs }) => [attrs.class, attrs]));
const handBox = Number(
  /viewBox="0 0 (\d+)/.exec(readFileSync(join(root, "tools/brand/coach-hand.svg"), "utf8"))[1],
);
const handEdge = /translate\(([\d.]+) ([\d.]+)\)/.exec(hand.edge.transform).slice(1).map(Number);

/** SVG path data of absolute M, L and Q commands and Z as a Dart cascade on a `Path`, a call a line. */
const dartPath = (d) =>
  [...d.matchAll(/([MLQ])([^MLQZ]*)|Z/g)]
    .map(([whole, command, numbers]) => {
      if (whole === "Z") return "    ..close()";
      const name = { M: "moveTo", L: "lineTo", Q: "quadraticBezierTo" }[command];
      return `    ..${name}(${numbers.trim().split(/[\s,]+/).join(", ")})`;
    })
    .join("\n");

const dartHand = `// Written by tools/brand/generate.mjs from tools/brand/coach-hand.svg; run
// make brand after changing it.
import 'dart:ui';

/// The study coach's pointing hand on a ${handBox} square: its outline, its
/// creases, both in lines [line] wide, the edge under it [edge] off, and the
/// [tip] it presses with.
abstract final class CoachHandDrawing {
  static const box = ${handBox}.0;
  static const line = ${hand.outline["stroke-width"]}.0;
  static const edge = Offset(${handEdge.join(", ")});
  static const tip = Offset(${hand.tip.cx}, ${hand.tip.cy});

  static Path outline() => Path()
${dartPath(hand.outline.d)};

  static Path creases() => Path()
${dartPath(hand.creases.d)};
}
`;

const webHand = `// Written by tools/brand/generate.mjs from tools/brand/coach-hand.svg; run make brand after changing it.

/**
 * The study coach's pointing hand on a ${handBox} square: its outline, its creases, both in lines
 * \`line\` wide, the edge under it \`edge\` off, and the \`tip\` it presses with.
 */
export const coachHand = {
  box: ${handBox},
  line: ${hand.outline["stroke-width"]},
  edge: { x: ${handEdge[0]}, y: ${handEdge[1]} },
  tip: { x: ${hand.tip.cx}, y: ${hand.tip.cy} },
  outline:
    "${hand.outline.d}",
  creases: "${hand.creases.d}",
};
`;

/** The source files each client's Mascot draws its parts from, and the coach's hand. */
const sources = {
  "app/lib/design/mascot_drawings.dart": dartParts,
  "web/src/design/mascot-drawings.ts": webParts,
  "app/lib/study/src/coach_hand_drawing.dart": dartHand,
  "web/src/features/study/components/coach-hand-drawing.ts": webHand,
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
  // The phone's stacked lockup in each language and on each ground.
  ...languages.flatMap((lang) =>
    [
      ["light", white, cobalt],
      ["dark", darkCard, darkAccent],
    ].flatMap(([ground, circle, words]) =>
      densities(`knowno-stacked-${lang}-${ground}`, stacked(lang, circle, words), stackedSize(lang), { width: 150 }),
    ),
  ),
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
  square("app/assets/brand/splash/splash-dark.png", canvas(centred(onCircle(darkCard), 0.8)), 640),
  square("app/assets/brand/splash/android12-light.png", canvas(centred(mark, 0.6)), 1152),
  square("app/assets/brand/splash/android12-dark.png", canvas(centred(onCircle(darkCard), 0.6)), 1152),
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
  for (const [path, text] of Object.entries({ ...vectors, ...sources })) {
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
    `checked ${Object.keys(vectors).length} SVGs, ${rasters.length} PNGs and ${Object.keys(sources).length} source files, the tables in tools/brand/generate.mjs, against the drawings in tools/brand/`,
  );
}

async function write() {
  for (const [path, text] of Object.entries({ ...vectors, ...sources })) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  for (const raster of rasters) {
    mkdirSync(dirname(join(root, raster.path)), { recursive: true });
    writeFileSync(join(root, raster.path), await render(raster));
  }
  console.log(
    `wrote ${Object.keys(vectors).length} SVGs, ${rasters.length} PNGs and ${Object.keys(sources).length} source files from the drawings in tools/brand/`,
  );
}

await (process.argv.includes("--check") ? check() : write());
