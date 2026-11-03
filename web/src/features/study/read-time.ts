import "server-only";

import { connection } from "next/server";

/**
 * The server's time at this request, read at request time as Next documents under
 * `cacheComponents`: after `connection()`, inside a Suspense boundary.
 */
export async function readRequestTime(): Promise<number> {
  await connection();
  return Date.now();
}
