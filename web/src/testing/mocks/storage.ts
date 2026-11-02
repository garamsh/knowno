import { http, HttpResponse } from "msw";

import { bearerUser, supabaseUrl } from "./handlers";
import type { FakePostgrest } from "./postgrest";

/** One stored object: its bytes and the type it was uploaded with. */
type StoredObject = { bytes: Uint8Array; contentType: string };

/** What a test can make Storage refuse: an upload, a removal or a signing. */
type Operation = "upload" | "remove" | "sign";

const objects = `${supabaseUrl}/storage/v1/object`;

/**
 * Supabase Storage's `media` bucket, in memory, under the policies of
 * `supabase/migrations/20261026140000_media.sql`: a user writes `{owner}/{media id}` only in its
 * own folder and only once [db] holds the `media` row it names, never over a stored object, and
 * reads and deletes its own folder alone. It logs each request in [db]'s `requests`, as
 * `<method> storage <operation>`, so a test reads one order across both.
 */
export class FakeStorage {
  /** The bucket's objects, by name. */
  readonly objects = new Map<string, StoredObject>();
  private failing = new Set<Operation>();

  constructor(private readonly db: FakePostgrest) {}

  /** Stores [name] as an earlier upload left it. */
  seed(name: string, bytes = new Uint8Array([0xff, 0xd8, 0xff])) {
    this.objects.set(name, { bytes, contentType: "image/jpeg" });
  }

  /** Fails every [operation] with HTTP 500 until the returned function is called. */
  fail(operation: Operation): () => void {
    this.failing.add(operation);
    return () => {
      this.failing.delete(operation);
    };
  }

  private refusal(operation: Operation): Response | null {
    return this.failing.has(operation)
      ? HttpResponse.json(
          { statusCode: "500", error: "failing", message: "failing" },
          { status: 500 },
        )
      : null;
  }

  readonly handlers = [
    http.post(`${objects}/sign/media`, async ({ request }) => {
      this.db.requests.push("POST storage sign");
      const refused = this.refusal("sign");
      if (refused) return refused;
      const user = bearerUser(request.headers.get("authorization"));
      if (!user) return HttpResponse.json({ statusCode: "403" }, { status: 400 });
      const { paths } = (await request.json()) as { paths: string[] };
      return HttpResponse.json(
        paths.map((path) =>
          path.startsWith(`${user.id}/`) && this.objects.has(path)
            ? { path, signedURL: `/object/sign/media/${path}?token=signed`, error: null }
            : {
                path,
                signedURL: null,
                error: "Either the object does not exist or you do not have access to it",
              },
        ),
      );
    }),
    http.post(`${objects}/media/:owner/:id`, async ({ request, params }) => {
      this.db.requests.push("POST storage upload");
      const refused = this.refusal("upload");
      if (refused) return refused;
      const user = bearerUser(request.headers.get("authorization"));
      const { owner, id } = params as { owner: string; id: string };
      const named = this.db.rows.media.some((row) => row.user_id === owner && row.id === id);
      if (!user || user.id !== owner || !named) {
        return HttpResponse.json(
          {
            statusCode: "403",
            error: "Unauthorized",
            message: "new row violates row-level security policy",
          },
          { status: 400 },
        );
      }
      const name = `${owner}/${id}`;
      if (this.objects.has(name)) {
        return HttpResponse.json(
          { statusCode: "409", error: "Duplicate", message: "The resource already exists" },
          { status: 400 },
        );
      }
      this.objects.set(name, {
        bytes: new Uint8Array(await request.arrayBuffer()),
        contentType: request.headers.get("content-type") ?? "",
      });
      return HttpResponse.json({ Key: `media/${name}`, Id: id });
    }),
    http.delete(`${objects}/media`, async ({ request }) => {
      this.db.requests.push("DELETE storage remove");
      const refused = this.refusal("remove");
      if (refused) return refused;
      const user = bearerUser(request.headers.get("authorization"));
      if (!user) return HttpResponse.json({ statusCode: "403" }, { status: 400 });
      const { prefixes } = (await request.json()) as { prefixes: string[] };
      const removed = prefixes.filter(
        (name) => name.startsWith(`${user.id}/`) && this.objects.delete(name),
      );
      return HttpResponse.json(removed.map((name) => ({ name })));
    }),
  ];
}
