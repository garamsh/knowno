// Fails when an inline link of a Markdown file points at a file or directory that does not exist,
// relative to the file holding the link. Absolute URLs (any scheme, or //host), bare fragments and
// links from the repository root (/path) are not checked, nor is a fragment's heading: only the
// path before `#` or `?` must exist. Code spans and fenced code are not links. A file that is not
// there is not read, as the repository's other checks read their set. The count is printed with the
// scope, since a check that read no file reads like one that found nothing.
import { entry, fail, scopeFiles, scopeText, Stop } from "./process.ts";

export type Link = { line: number; target: string };

const LINK =
  /\]\((<[^>\n]*>|(?:[^\s()]|\([^\s()]*\))*)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const SCHEME = /^(?:[A-Za-z][A-Za-z0-9+.-]*:|\/)/;

/** The inline link targets of a Markdown text, outside fenced code and code spans. */
export function linksIn(markdown: string): Link[] {
  const links: Link[] = [];
  let fence = "";
  markdown.split("\n").forEach((text, index) => {
    const opening = FENCE.exec(text);
    if (fence !== "") {
      if (
        opening && opening[1][0] === fence[0] &&
        opening[1].length >= fence.length
      ) {
        fence = "";
      }
      return;
    }
    if (opening) {
      fence = opening[1];
      return;
    }
    const prose = text.replace(/(`+).*?\1(?!`)/g, "");
    for (const match of prose.matchAll(LINK)) {
      const raw = match[1];
      const target = raw.startsWith("<") ? raw.slice(1, -1) : raw;
      links.push({ line: index + 1, target });
    }
  });
  return links;
}

/** The path a link names on disk, nothing for a link this check does not follow. */
export function pathOf(target: string): string | undefined {
  if (target === "" || target.startsWith("#") || SCHEME.test(target)) {
    return undefined;
  }
  const path = target.split(/[#?]/)[0];
  if (path === "") return undefined;
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

async function main(): Promise<void> {
  const scope = ["*.md"];
  let files = 0;
  let links = 0;
  let clean = true;
  for (const file of await scopeFiles(scope)) {
    if (!(await exists(file))) continue;
    files++;
    const directory = file.includes("/")
      ? file.slice(0, file.lastIndexOf("/"))
      : ".";
    for (const { line, target } of linksIn(await Deno.readTextFile(file))) {
      const path = pathOf(target);
      if (path === undefined) continue;
      links++;
      if (await exists(`${directory}/${path}`)) continue;
      console.log(`${file}:${line}: ${target} does not exist`);
      clean = false;
    }
  }
  console.log(
    `checked ${links} relative links in ${files} Markdown files, selected by: ${
      scopeText(scope)
    }`,
  );
  if (files === 0) fail("no file was read");
  if (!clean) throw new Stop(1);
}

if (import.meta.main) await entry(main);
