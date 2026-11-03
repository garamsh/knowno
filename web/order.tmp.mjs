// Prints which of two utilities comes later in the CSS Tailwind generates from globals.css.
import fs from "node:fs";
import path from "node:path";
import { compile } from "@tailwindcss/node";

const web = process.argv[2];
const candidates = process.argv.slice(3);
const css = fs.readFileSync(path.join(web, "src/styles/globals.css"), "utf8");
const compiler = await compile(css, { base: path.join(web, "src/styles"), onDependency() {} });
const out = compiler.build(candidates);
for (const c of candidates) console.log(c, out.indexOf(`.${c.replace(/[:[\]()/.]/g, (m) => "\\" + m)} {`));
