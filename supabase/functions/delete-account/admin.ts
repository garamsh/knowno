/**
 * Deleting a user's media and chat photos through Supabase Storage, and the user through Supabase
 * Auth's admin API.
 */

import {
  type SupabaseDeps,
  SupabaseError,
  type UserId,
} from "../_shared/auth.ts";

/**
 * Deletes the user for good, which deletes every row referencing it through `on delete cascade`.
 * Throws [SupabaseError] when Supabase Auth cannot be reached or does not delete the user.
 */
export async function deleteUser(
  userId: UserId,
  deps: SupabaseDeps,
): Promise<void> {
  const response = await deps.fetch(
    `${deps.url}/auth/v1/admin/users/${userId}`,
    {
      method: "DELETE",
      headers: {
        apikey: deps.serviceRoleKey,
        Authorization: `Bearer ${deps.serviceRoleKey}`,
      },
    },
  ).catch((cause: unknown) => {
    throw new SupabaseError("auth admin could not be reached", { cause });
  });
  await response.body?.cancel();
  if (!response.ok) {
    throw new SupabaseError(`auth admin answered ${response.status}`);
  }
}

/**
 * The private buckets holding a user's files in a folder named by its id: its media (ADR 0107) and
 * the photos it sent 말랑이 (ADR 0198).
 */
const BUCKETS = ["media", "assistant-photos"] as const;
type Bucket = (typeof BUCKETS)[number];
/** How many objects one listing returns, and so one delete removes. */
const MEDIA_PAGE = 1000;

/**
 * Deletes every object in the user's folder of each bucket, a page at a time, through the Storage
 * API: the database refuses a direct delete, which would leave the bytes behind. Throws
 * [SupabaseError] when Storage cannot be reached, refuses, or deletes none of a listed page.
 */
export async function deleteMedia(
  userId: UserId,
  deps: SupabaseDeps,
): Promise<void> {
  for (const bucket of BUCKETS) {
    for (;;) {
      const names = await listMedia(bucket, userId, deps);
      if (names.length === 0) break;
      const deleted = await storage(deps, `object/${bucket}`, "DELETE", {
        prefixes: names.map((name) => `${userId}/${name}`),
      });
      if (!Array.isArray(deleted) || deleted.length === 0) {
        throw new SupabaseError("storage deleted none of the listed media");
      }
    }
  }
}

/** The names, relative to the user's folder of [bucket], of up to [MEDIA_PAGE] of its objects. */
async function listMedia(
  bucket: Bucket,
  userId: UserId,
  deps: SupabaseDeps,
): Promise<string[]> {
  const listed = await storage(deps, `object/list/${bucket}`, "POST", {
    prefix: userId,
    limit: MEDIA_PAGE,
    offset: 0,
  });
  if (!Array.isArray(listed)) {
    throw new SupabaseError("storage listed media in an unexpected shape");
  }
  return listed.map((entry: unknown) => {
    if (
      typeof entry !== "object" || entry === null || !("name" in entry) ||
      typeof entry.name !== "string" || entry.name === ""
    ) {
      throw new SupabaseError("storage listed a media object without a name");
    }
    return entry.name;
  });
}

async function storage(
  deps: SupabaseDeps,
  path: string,
  method: string,
  body: unknown,
): Promise<unknown> {
  const response = await deps.fetch(`${deps.url}/storage/v1/${path}`, {
    method,
    headers: {
      apikey: deps.serviceRoleKey,
      Authorization: `Bearer ${deps.serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  }).catch((cause: unknown) => {
    throw new SupabaseError("storage could not be reached", { cause });
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new SupabaseError(`storage answered ${response.status}`);
  }
  return await response.json();
}
