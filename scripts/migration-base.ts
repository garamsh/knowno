// main as a change will meet it, which scripts/check-migration-order.ts and
// scripts/migration-preview.ts both read: the first parent of a merge commit, which is how CI
// checks a pull request out, or else where HEAD left origin/main.
import { lines, read, scopeFiles, succeeds } from "./process.ts";

export const MIGRATIONS = "supabase/migrations";

export type Base = { commit: string; how: string };

/** The base, or nothing when HEAD is no merge commit and origin/main is unknown. */
export async function findBase(): Promise<Base | undefined> {
  const has = (rev: string) =>
    succeeds("git", ["rev-parse", "-q", "--verify", rev]);
  if (await has("HEAD^2")) {
    return {
      commit: (await read("git", ["rev-parse", "HEAD^1"])).trim(),
      how: "the first parent of the merge commit HEAD",
    };
  }
  if (await has("origin/main")) {
    return {
      commit: (await read("git", ["merge-base", "HEAD", "origin/main"])).trim(),
      how: "where HEAD left origin/main",
    };
  }
  return undefined;
}

/** The migration file names at the base, sorted. */
export async function namesOnMain(commit: string): Promise<string[]> {
  const tree = await read("git", [
    "ls-tree",
    "--name-only",
    commit,
    `${MIGRATIONS}/`,
  ]);
  return lines(tree)
    .flatMap((path) => path.match(/^.*\/([^/]*\.sql)$/)?.[1] ?? [])
    .sort();
}

/** The migration file names in this working tree that git tracks or would track, sorted. */
export async function namesHere(): Promise<string[]> {
  const files = await scopeFiles([`${MIGRATIONS}/*.sql`]);
  return files.map((path) => path.replace(/^.*\//, "")).sort();
}
