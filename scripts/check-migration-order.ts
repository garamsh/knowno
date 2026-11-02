// Fails when a migration this branch adds does not sort after every migration on main. Supabase's
// GitHub integration still runs such a migration on merge, out of order, and only warns
// (server.md), so production would apply it after the later ones it should have preceded.
//
// A migration is new when the base (migration-base.ts) has no file of its name; its version is the
// 14 digits its name starts with.
import {
  findBase,
  MIGRATIONS,
  namesHere,
  namesOnMain,
} from "./migration-base.ts";
import { entry, fail, Stop } from "./process.ts";

type Versions = { versions: string[]; refused?: string };

/** The names' versions up to the first name of another shape, which `refused` holds. */
export function versionsOf(names: string[]): Versions {
  const versions: string[] = [];
  for (const name of names) {
    const version = name.match(/^(\d{14})_.*\.sql$/)?.[1];
    if (version === undefined) return { versions, refused: name };
    versions.push(version);
  }
  return { versions };
}

/** The versions that do not sort after `latest`: what the check refuses. */
export function notAfter(versions: string[], latest: string): string[] {
  return versions.filter((version) => version <= latest);
}

const shapeRefusal = (name: string) =>
  `${name} is not named <14-digit UTC time>_<name>.sql`;

async function main(): Promise<void> {
  const base = await findBase();
  if (base === undefined) {
    fail(
      `found no base to compare ${MIGRATIONS}/ with: HEAD is no merge commit and origin/main is unknown`,
    );
  }
  const onMain = await namesOnMain(base.commit);
  const known = new Set(onMain);
  const added = (await namesHere()).filter((name) => !known.has(name));

  const fresh = versionsOf(added);
  if (fresh.refused !== undefined) fail(shapeRefusal(fresh.refused));
  // A name of another shape already on main is reported and ends the reading of main's versions.
  const merged = versionsOf(onMain);
  if (merged.refused !== undefined) console.error(shapeRefusal(merged.refused));
  const latest = merged.versions.toSorted().at(-1) ?? "";

  const early = notAfter(fresh.versions, latest);
  if (early.length > 0) {
    console.error(
      `these new migrations do not sort after ${latest}, the latest on main at ${base.commit} (${base.how}):`,
    );
    for (const version of early) console.error(version);
    console.error("name each after the latest on main (server.md)");
    throw new Stop(1);
  }
  console.log(
    `checked ${added.length} new migrations in ${MIGRATIONS}/, every file there that main lacks, against ${latest}, the latest of ${onMain.length} on main at ${base.commit} (${base.how}): each sorts after it`,
  );
}

if (import.meta.main) await entry(main);
