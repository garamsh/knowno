import { http, HttpResponse } from "msw";

import { bearerUser, supabaseUrl } from "./handlers";
import type { FakePostgrest } from "./postgrest";

/**
 * The `publish-note` function over a [FakePostgrest]'s decks, for a session Supabase Auth knows:
 * it answers [state] to the owner of a live deck, 404 for any other, and, like the server, makes
 * the deck public with the request's description only when [state] is `public`. Set [status] to
 * make it answer that status, or [unreachable] to answer nothing.
 */
export class FakePublishNote {
  state = "public";
  status: number | undefined;
  unreachable = false;
  /** Every request answered: the caller's `Authorization` header and the body sent. */
  readonly calls: { authorization: string | null; body: unknown }[] = [];

  constructor(private readonly db: FakePostgrest) {}

  readonly handlers = [
    http.post(`${supabaseUrl}/functions/v1/publish-note`, async ({ request }) => {
      if (this.unreachable) return HttpResponse.error();
      const authorization = request.headers.get("authorization");
      const body: unknown = await request.json();
      this.calls.push({ authorization, body });
      const user = bearerUser(authorization);
      if (!user) return HttpResponse.json({ error: "unauthenticated" }, { status: 401 });
      if (this.status !== undefined)
        return HttpResponse.json({ error: "x" }, { status: this.status });
      const { deck_id: id, description } = body as { deck_id: string; description: string | null };
      const deck = this.db.rows.decks.find(
        (row) => row.id === id && row.user_id === user.id && row.deleted_at == null,
      );
      if (!deck) return HttpResponse.json({ error: "not_found" }, { status: 404 });
      if (this.state === "public") {
        deck.visibility = "public";
        deck.published_at = new Date().toISOString();
        deck.description = description ?? deck.description;
      }
      return HttpResponse.json({ state: this.state, refusal: null, findings: [] });
    }),
  ];
}
