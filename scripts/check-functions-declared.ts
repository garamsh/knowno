// Fails when the functions under supabase/functions/ and the [functions.<name>] entries of
// supabase/config.toml differ. Supabase's GitHub integration deploys only the functions config.toml
// declares (server.md §Edge Function deploys), so a function with no entry merges, passes CI and is
// never deployed.
//
// A function is a directory there holding an index.ts, `_shared` apart.
import { entry, fail } from "./process.ts";

const FUNCTIONS = "supabase/functions";
const CONFIG = "supabase/config.toml";

/** The names of the `[functions.<name>]` tables a config.toml holds. */
export function declaredIn(config: string): string[] {
  return [...config.matchAll(/^\[functions\.([^\]\s]+)\]/gm)].map((m) => m[1]);
}

/** The names in `from` that `other` lacks, in `from`'s order. */
export function missingFrom(from: string[], other: string[]): string[] {
  const known = new Set(other);
  return from.filter((name) => !known.has(name));
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await Deno.stat(path)).isFile;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

async function onDisk(): Promise<string[]> {
  const names: string[] = [];
  try {
    for await (const { name, isDirectory } of Deno.readDir(FUNCTIONS)) {
      if (!isDirectory || name === "_shared") continue;
      if (await isFile(`${FUNCTIONS}/${name}/index.ts`)) names.push(name);
    }
  } catch (error) {
    // No directory holds no function, which main reports as a count of zero.
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  return names.toSorted();
}

async function main(): Promise<void> {
  const disk = await onDisk();
  const declared = declaredIn(await Deno.readTextFile(CONFIG));
  if (disk.length === 0) {
    fail(
      `found no function in ${FUNCTIONS}/: no directory there holds an index.ts`,
    );
  }
  const undeclared = missingFrom(disk, declared);
  const absent = missingFrom(declared, disk);
  for (const name of undeclared) {
    console.error(
      `${FUNCTIONS}/${name} has no [functions.${name}] entry in ${CONFIG}, so a merge never deploys it`,
    );
  }
  for (const name of absent) {
    console.error(
      `[functions.${name}] in ${CONFIG} names no directory ${FUNCTIONS}/${name} holding an index.ts`,
    );
  }
  if (undeclared.length + absent.length > 0) {
    fail("declare each function on disk, and only those (server.md)");
  }
  console.log(
    `checked ${disk.length} functions in ${FUNCTIONS}/, every directory there but _shared holding an index.ts, against the [functions.<name>] entries of ${CONFIG}: each is declared`,
  );
}

if (import.meta.main) await entry(main);
