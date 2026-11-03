type Cookie = { name: string; value: string };

let jar = new Map<string, string>();

/** Gives the next request [cookies], as a browser would send them. */
export function setRequestCookies(cookies: Cookie[]) {
  jar = new Map(cookies.map(({ name, value }) => [name, value]));
}

/** The cookies the request holds now, after whatever the code under test set or cleared. */
export function currentCookies(): Cookie[] {
  return [...jar].filter(([, value]) => value !== "").map(([name, value]) => ({ name, value }));
}

/**
 * Stands in for `next/headers`' `cookies()` with the two methods the Supabase server client
 * calls; a test replaces the module with `vi.mock("next/headers", () => import(...))`.
 */
export function cookies() {
  return Promise.resolve({
    getAll: currentCookies,
    set: (name: string, value: string) => {
      jar.set(name, value);
    },
  });
}

let requestHeaders = new Headers();

/** Gives the next request [headers], as the proxy hands them to a page. */
export function setRequestHeaders(headers: Record<string, string>) {
  requestHeaders = new Headers(headers);
}

/** Stands in for `next/headers`' `headers()`, holding what [setRequestHeaders] last gave. */
export function headers() {
  return Promise.resolve(requestHeaders);
}
