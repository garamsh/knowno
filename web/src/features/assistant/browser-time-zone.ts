/** The zone [options] name, null where it is absent or empty: a browser may name none. */
function zoneOf(options: { timeZone?: string }): string | null {
  return options.timeZone === undefined || options.timeZone === "" ? null : options.timeZone;
}

/**
 * The browser's IANA time zone, `Intl.DateTimeFormat().resolvedOptions().timeZone`, which the
 * assistant counts the user's study day in; null where the browser names none. It is read in the
 * browser: the server's own zone is never the user's.
 */
export function browserTimeZone(): string | null {
  try {
    return zoneOf(Intl.DateTimeFormat().resolvedOptions());
  } catch {
    return null;
  }
}
