/** The app's configuration, parsed once from the environment at module load. */
export type Env = {
  supabaseUrl: string;
  supabasePublishableKey: string;
};

/** Thrown when a variable is missing or malformed; names the variable, never its value. */
export class EnvError extends Error {
  override name = "EnvError";
}

/**
 * Parses the variables the app reads. The key must be a publishable key: a secret or
 * service-role key never belongs in a `NEXT_PUBLIC_` variable, which reaches the browser.
 */
export function parseEnv(source: {
  NEXT_PUBLIC_SUPABASE_URL: string | undefined;
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: string | undefined;
}): Env {
  const url = source.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!/^https?:$/.test(protocolOf(url))) {
    throw new EnvError("NEXT_PUBLIC_SUPABASE_URL is not an http(s) URL");
  }
  const key = source.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!key?.startsWith("sb_publishable_")) {
    throw new EnvError("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not a Supabase publishable key");
  }
  return { supabaseUrl: url, supabasePublishableKey: key };
}

/** The protocol of [value] as a URL, or "" when it is none; `URL.canParse` is missing in Safari 16. */
function protocolOf(value: string): string {
  try {
    return new URL(value).protocol;
  } catch {
    return "";
  }
}

/**
 * The deployment's two hosts (ADR 0178): the service's, `https://knowno.app`, and its admin
 * host's, `https://admin.knowno.app`. Each `host` is its origin's name and port, as a Host header
 * names it.
 */
export type Hosts = {
  service: { origin: string; host: string };
  admin: { origin: string; host: string };
};

/**
 * Parses `KNOWNO_SERVICE_ORIGIN`, the service's origin and nothing more: `https://knowno.app`, or
 * `http://localhost:3000` on a machine. The admin host is the same origin with `admin.` before
 * its name.
 */
export function parseHosts(source: { KNOWNO_SERVICE_ORIGIN: string | undefined }): Hosts {
  const value = source.KNOWNO_SERVICE_ORIGIN ?? "";
  if (!/^https?:$/.test(protocolOf(value)) || new URL(value).origin !== value) {
    throw new EnvError("KNOWNO_SERVICE_ORIGIN is not an http(s) origin");
  }
  const service = new URL(value);
  const admin = new URL(value);
  admin.hostname = `admin.${service.hostname}`;
  return {
    service: { origin: service.origin, host: service.host },
    admin: { origin: admin.origin, host: admin.host },
  };
}

let parsedHosts: Hosts | undefined;

/**
 * The deployment's hosts, parsed on the server at the proxy's first request and kept. The variable
 * has no `NEXT_PUBLIC_` prefix, so the server reads it as it runs rather than from the build, and
 * no browser bundle carries it. A missing or malformed value fails every request the proxy runs on.
 */
export function hosts(): Hosts {
  parsedHosts ??= parseHosts({ KNOWNO_SERVICE_ORIGIN: process.env.KNOWNO_SERVICE_ORIGIN });
  return parsedHosts;
}

// Each variable is named in full so `next build` inlines it into the client bundle.
export const env = parseEnv({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
});
