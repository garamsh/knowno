import { lfOf } from "./line-breaks";

/** One line of a diff: kept in both texts, or only in the version before or after. */
export type DiffLine = { kind: "same" | "removed" | "added"; text: string };

/**
 * The lines of [after] against [before], in order: each line both keep once, by the longest
 * common subsequence of lines, and each other line as removed or added, removals first. A CRLF
 * and an LF end a line alike, so a version stored with CRLF diffs as it reads.
 */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = lfOf(before).split("\n");
  const b = lfOf(after).split("\n");
  // common[i][j]: the longest common subsequence of a from i and b from j.
  const common = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      const row = common[i];
      const below = common[i + 1];
      if (row === undefined || below === undefined) continue;
      row[j] = a[i] === b[j] ? (below[j + 1] ?? 0) + 1 : Math.max(below[j] ?? 0, row[j + 1] ?? 0);
    }
  }
  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    const left = a[i];
    const right = b[j];
    if (left !== undefined && left === right) {
      lines.push({ kind: "same", text: left });
      i++;
      j++;
    } else if (
      left !== undefined &&
      (right === undefined || (common[i + 1]?.[j] ?? 0) >= (common[i]?.[j + 1] ?? 0))
    ) {
      lines.push({ kind: "removed", text: left });
      i++;
    } else if (right !== undefined) {
      lines.push({ kind: "added", text: right });
      j++;
    }
  }
  return lines;
}
