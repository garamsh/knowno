/** A part of a pasted Markdown text, as the editor turns it into 칸, as the phone's `PastePart`. */
export type PastePart =
  | { kind: "text"; text: string }
  | { kind: "table"; columns: string[]; rows: string[][] }
  | { kind: "image"; url: string };

const delimiter = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/u;
const image = /^\s*!\[[^\]]*\]\(\s*(https:\/\/[^\s)]+)(?:\s+"[^"]*")?\s*\)\s*$/u;

/** The cells of a table row: its line without the outer pipes, split at each pipe and trimmed. */
function cellsOf(line: string): string[] {
  let row = line.trim();
  if (row.startsWith("|")) row = row.slice(1);
  if (row.endsWith("|")) row = row.slice(0, -1);
  return row.split("|").map((cell) => cell.trim());
}

/**
 * [text] as the parts the editor makes 칸 of, in order, as the phone's `splitPaste`: a table, a row
 * of cells with `|`, then a delimiter row of dashes, then rows of cells, a 표; a line that is an
 * image with an https address a 사진; and the rest, kept as written, a 글. A table of headers alone
 * stays text. This reads the shape of a paste only: the text itself is read by the engine.
 */
export function splitPaste(text: string): PastePart[] {
  const lines = text.replaceAll("\r\n", "\n").split("\n");
  const parts: PastePart[] = [];
  let rest: string[] = [];
  const flush = () => {
    const joined = rest.join("\n").trim();
    if (joined !== "") parts.push({ kind: "text", text: joined });
    rest = [];
  };
  let at = 0;
  while (at < lines.length) {
    const line = lines[at] ?? "";
    const found = image.exec(line)?.[1];
    if (found !== undefined) {
      flush();
      parts.push({ kind: "image", url: found });
      at++;
      continue;
    }
    const below = lines[at + 1];
    const isTable =
      line.includes("|") &&
      below !== undefined &&
      below.includes("-") &&
      delimiter.test(below) &&
      cellsOf(line).length === cellsOf(below).length;
    if (isTable) {
      const columns = cellsOf(line);
      const rows: string[][] = [];
      let next = at + 2;
      while (next < lines.length && (lines[next] ?? "").includes("|")) {
        const row = cellsOf(lines[next] ?? "");
        rows.push(columns.map((_, column) => row[column] ?? ""));
        next++;
      }
      // A table of headers alone has no 표 to make: it stays text.
      if (rows.length > 0) {
        flush();
        parts.push({ kind: "table", columns, rows });
        at = next;
        continue;
      }
    }
    rest.push(line);
    at++;
  }
  flush();
  return parts;
}
