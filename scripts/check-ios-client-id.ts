// Fails when the iOS URL scheme Google Sign-In returns to differs from the iOS client ID the app is
// configured with. Info.plist cannot read a value passed by --dart-define-from-file, so it holds
// the client ID reversed (ADR 0006); this keeps the two copies equal.
import { entry, fail } from "./process.ts";

const CONFIG = "app/config/dev.json";
const PLIST = "app/ios/Runner/Info.plist";
const SUFFIX = ".apps.googleusercontent.com";

/** The URL scheme a client ID reverses to. */
export function urlScheme(clientId: string): string {
  const id = clientId.endsWith(SUFFIX)
    ? clientId.slice(0, -SUFFIX.length)
    : clientId;
  return `com.googleusercontent.apps.${id}`;
}

/** The URL schemes of Google's shape a plist holds. */
export function schemesIn(plist: string): string[] {
  return plist.match(/com\.googleusercontent\.apps\.[^<\n]*/g) ?? [];
}

async function clientId(): Promise<string> {
  let config: unknown;
  try {
    config = JSON.parse(await Deno.readTextFile(CONFIG));
  } catch (error) {
    fail(`${CONFIG} could not be read: ${error}`, 2);
  }
  const id = (config as { GOOGLE_IOS_CLIENT_ID?: unknown } | null)
    ?.GOOGLE_IOS_CLIENT_ID;
  if (typeof id !== "string" || id === "") {
    fail(`${CONFIG} has no GOOGLE_IOS_CLIENT_ID`);
  }
  return id;
}

async function main(): Promise<void> {
  const expected = urlScheme(await clientId());
  const plist = await Deno.readTextFile(PLIST);
  if (!plist.includes(`<string>${expected}</string>`)) {
    console.error(
      `${PLIST} has no URL scheme ${expected}, the reversed GOOGLE_IOS_CLIENT_ID of ${CONFIG}`,
    );
    const found = schemesIn(plist);
    fail(`found: ${found.length > 0 ? found.join("\n") : "none"}`);
  }
  console.log(
    `${PLIST} has the URL scheme of GOOGLE_IOS_CLIENT_ID in ${CONFIG}`,
  );
}

if (import.meta.main) await entry(main);
