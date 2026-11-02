// Fails when a Supabase secret key or service-role key is in a file this repository tracks or would
// track. A secret key starts with sb_secret_; a legacy service-role key is a JWT whose payload has
// "role": "service_role". Publishable and anon keys are public by design and pass. Every file is
// read, not a chosen directory, so the count is printed with the scope, and a match prints only its
// file, never the key: no message or error here carries a file's content.
import { entry, fail, scopeFiles, scopeText, Stop } from "./process.ts";

const SECRET_KEY = /sb_secret_[A-Za-z0-9_-]{8,}/;
const JWT = /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;

/** The `role` of a JWT's payload; nothing for a payload that does not decode. */
export function jwtRole(token: string): unknown {
  const payload = token.split(".")[1].replaceAll("-", "+").replaceAll("_", "/");
  const padded = payload + "=".repeat((4 - payload.length % 4) % 4);
  try {
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    const claims = JSON.parse(new TextDecoder().decode(bytes));
    return claims?.role;
  } catch {
    return undefined;
  }
}

/** A file with a NUL byte is binary and holds no key, as grep -I reads it. */
export function isBinary(bytes: Uint8Array): boolean {
  return bytes.includes(0);
}

export type Finding = "secret key" | "service-role key";

/** What a text file's content holds, read as bytes so that no encoding hides a key. */
export function findings(content: string): Finding[] {
  const found: Finding[] = [];
  if (SECRET_KEY.test(content)) found.push("secret key");
  const roles = (content.match(JWT) ?? []).map(jwtRole);
  if (roles.includes("service_role")) found.push("service-role key");
  return found;
}

const LATIN1 = new TextDecoder("latin1");

const MESSAGE: Record<Finding, string> = {
  "secret key": "holds a Supabase secret key (sb_secret_...)",
  "service-role key":
    "holds a Supabase service-role key (a JWT with role service_role)",
};

async function isFile(path: string): Promise<boolean> {
  try {
    return (await Deno.stat(path)).isFile;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

async function main(): Promise<void> {
  let count = 0;
  let clean = true;
  for (const file of await scopeFiles([])) {
    if (!(await isFile(file))) continue;
    count++;
    const bytes = await Deno.readFile(file);
    if (isBinary(bytes)) continue;
    for (const finding of findings(LATIN1.decode(bytes))) {
      console.log(`${file}: ${MESSAGE[finding]}`);
      clean = false;
    }
  }
  console.log(
    `checked ${count} files for Supabase secret and service-role keys, selected by: ${
      scopeText([])
    }`,
  );
  if (count === 0) fail("no file was read");
  if (!clean) throw new Stop(1);
}

if (import.meta.main) await entry(main);
