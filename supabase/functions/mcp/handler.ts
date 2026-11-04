/**
 * The MCP server over Streamable HTTP: the protected resource metadata, the bearer check with its
 * 401 challenge, and JSON-RPC requests answered as JSON, with no session, at the protocol
 * versions that open with `initialize` (ADR 0126).
 */

import { SupabaseError, type UserId } from "../_shared/auth.ts";
import { authorize } from "./authorize.ts";
import type { Config } from "./config.ts";
import {
  cardFormIndex,
  type CardForms,
  FORMS,
  formUri,
  GUIDE_URI,
  type Skills,
} from "../_shared/card_forms.ts";
import { callTool, type ToolDeps, TOOLS } from "../_shared/tools.ts";

/** The protocol versions served, newest first; `initialize` answers the newest it is not offered. */
export const PROTOCOL_VERSIONS = [
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
] as const;

const METADATA_SUFFIX = "/oauth-protected-resource";

/** How a request ended. */
export type Outcome =
  | "answered"
  | "tool_refused"
  | "metadata"
  | "notification"
  | "unauthenticated"
  | "forbidden_origin"
  | "method_not_allowed"
  | "not_found"
  | "bad_request"
  | "not_configured"
  | "unavailable";

/** The one line logged per request: never the token, a key, or a card's content. */
export type LogEntry = {
  readonly user_id: UserId | null;
  readonly method: string | null;
  readonly tool: string | null;
  readonly outcome: Outcome;
};

export type HandlerDeps = ToolDeps & {
  readonly config: Config;
  readonly fetch: typeof fetch;
  readonly log: (entry: LogEntry) => void;
  readonly skills: CardForms;
};

const INSTRUCTIONS =
  "knowno is a flashcard app. These tools read, add, change and delete the signed-in user's decks and cards. Find a deck's id with list_decks, read a deck with list_cards, find cards with search_cards, make a deck with create_deck and add cards with add_cards, choosing each card's form: text, senses, cloze, table or a photo. The resource knowno://guide/card-forms indexes the forms and links each one's guide; read a form's guide before making cards of it. To change a card, read it and send its blocks back changed with update_cards; prefer that to deleting a card and adding a new one, which loses its study history. Rename a deck with update_deck. Before delete_cards or delete_deck, confirm with the user what will be deleted: a deleted card or deck leaves every device. Changes reach the user's phone and the web at their next sync.";

type Exchange = {
  response: Response;
  entry: Omit<LogEntry, "outcome"> & { outcome: Outcome };
};

const empty = { user_id: null, method: null, tool: null };

/** The card-form resources as `resources/list` names them: the index, then each form's guide. */
const RESOURCES = [
  {
    uri: GUIDE_URI,
    name: "card-forms",
    title: "Choosing a card's form",
    description:
      "Each form a card can take, when it fits, and where its guide is. Read it before add_cards.",
    mimeType: "text/markdown",
  },
  ...FORMS.map((form) => ({
    uri: formUri(form),
    name: `card-form-${form}`,
    title: `Making a ${form} card`,
    description:
      `The ${form} form's rules, a good and a bad example, and its edge cases.`,
    mimeType: "text/markdown",
  })),
];

/** The index resource's text, each form linked to its guide's uri (ADR 0197). */
const guideIndex = (skills: Skills) =>
  cardFormIndex(
    skills,
    (form) => ` Guide: ${formUri(form)}`,
    "Read a form's guide, at its uri above, before making cards of that form.",
  );

function rpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

export function createHandler(
  deps: HandlerDeps,
): (request: Request) => Promise<Response> {
  return async (request) => {
    let exchange: Exchange;
    try {
      exchange = await handle(request, deps);
    } catch (error) {
      deps.log({ ...empty, outcome: "unavailable" });
      throw error;
    }
    deps.log(exchange.entry);
    return exchange.response;
  };
}

async function handle(request: Request, deps: HandlerDeps): Promise<Exchange> {
  const path = new URL(request.url).pathname.replace(/\/$/, "");
  const config = deps.config;
  if (config.kind === "not_configured") {
    return {
      response: Response.json(
        rpcError(null, -32603, "The server is not configured"),
        {
          status: 503,
        },
      ),
      entry: { ...empty, outcome: "not_configured" },
    };
  }
  const resource = config.resourceUrl;
  if (path === `/mcp${METADATA_SUFFIX}`) {
    if (request.method !== "GET") {
      return {
        response: new Response(null, {
          status: 405,
          headers: { Allow: "GET" },
        }),
        entry: { ...empty, outcome: "method_not_allowed" },
      };
    }
    return {
      response: Response.json({
        resource,
        // Auth's issuer, which RFC 8414 requires this to equal, stays on the project's host.
        authorization_servers: [`${config.projectOrigin}/auth/v1`],
        bearer_methods_supported: ["header"],
        resource_name: "knowno",
      }),
      entry: { ...empty, outcome: "metadata" },
    };
  }
  if (path !== "/mcp") {
    return {
      response: Response.json({ error: "not_found" }, { status: 404 }),
      entry: { ...empty, outcome: "not_found" },
    };
  }
  // No browser is a client: a request carrying an Origin is refused against DNS rebinding.
  if (request.headers.has("Origin")) {
    return {
      response: Response.json(rpcError(null, -32600, "Origin not allowed"), {
        status: 403,
      }),
      entry: { ...empty, outcome: "forbidden_origin" },
    };
  }
  if (request.method !== "POST") {
    return {
      response: new Response(null, { status: 405, headers: { Allow: "POST" } }),
      entry: { ...empty, outcome: "method_not_allowed" },
    };
  }
  let caller;
  try {
    caller = await authorize(request.headers.get("Authorization"), {
      url: config.supabaseUrl,
      anonKey: config.anonKey,
      fetch: deps.fetch,
    });
  } catch (error) {
    if (error instanceof SupabaseError) return unavailable(null, null, null);
    throw error;
  }
  if (caller === null) {
    const metadata = `${resource}${METADATA_SUFFIX}`;
    const challenge = request.headers.has("Authorization")
      ? `Bearer error="invalid_token", error_description="The access token is missing its connection, expired or was revoked; sign in again", resource_metadata="${metadata}"`
      : `Bearer resource_metadata="${metadata}"`;
    return {
      response: Response.json({ error: "unauthenticated" }, {
        status: 401,
        headers: { "WWW-Authenticate": challenge },
      }),
      entry: { ...empty, outcome: "unauthenticated" },
    };
  }
  let message: unknown;
  try {
    message = await request.json();
  } catch {
    return badRequest(
      caller.userId,
      rpcError(null, -32700, "The body is not JSON"),
    );
  }
  if (
    typeof message !== "object" || message === null || Array.isArray(message)
  ) {
    return badRequest(
      caller.userId,
      rpcError(
        null,
        -32600,
        "The body must be one JSON-RPC message; batches are not supported",
      ),
    );
  }
  const body = message as Record<string, unknown>;
  // A notification, or a response to a request this server never sends, needs no answer.
  if (!("id" in body) || !("method" in body)) {
    return {
      response: new Response(null, { status: 202 }),
      entry: {
        user_id: caller.userId,
        method: typeof body.method === "string" ? body.method : null,
        tool: null,
        outcome: "notification",
      },
    };
  }
  const { id, method } = body;
  if (
    (typeof id !== "string" && typeof id !== "number") ||
    typeof method !== "string"
  ) {
    return badRequest(
      caller.userId,
      rpcError(null, -32600, "Invalid JSON-RPC request"),
    );
  }
  const version = request.headers.get("MCP-Protocol-Version");
  if (
    method !== "initialize" && version !== null &&
    !(PROTOCOL_VERSIONS as readonly string[]).includes(version)
  ) {
    return badRequest(
      caller.userId,
      rpcError(
        id,
        -32600,
        `Unsupported protocol version ${version}; this server speaks ${
          PROTOCOL_VERSIONS.join(", ")
        } after initialize`,
      ),
      method,
    );
  }
  const params = typeof body.params === "object" && body.params !== null
    ? body.params as Record<string, unknown>
    : {};
  const store = {
    url: config.supabaseUrl,
    anonKey: config.anonKey,
    token: caller.token,
    userId: caller.userId,
    fetch: deps.fetch,
  };
  const answer = (
    result: unknown,
    outcome: Outcome = "answered",
    tool: string | null = null,
  ) => ({
    response: Response.json({ jsonrpc: "2.0", id, result }),
    entry: { user_id: caller.userId, method, tool, outcome },
  });
  switch (method) {
    case "initialize": {
      const offered = params.protocolVersion;
      const protocolVersion =
        (PROTOCOL_VERSIONS as readonly unknown[]).includes(offered)
          ? offered
          : PROTOCOL_VERSIONS[0];
      return answer({
        protocolVersion,
        capabilities: {
          tools: { listChanged: false },
          resources: { listChanged: false },
        },
        serverInfo: { name: "knowno", title: "knowno", version: "1" },
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return answer({});
    case "tools/list":
      return answer({ tools: TOOLS });
    case "resources/list":
      return answer({ resources: RESOURCES });
    case "resources/read": {
      // The index is null here and a form's guide is its form.
      const form = params.uri === GUIDE_URI
        ? null
        : FORMS.find((known) => formUri(known) === params.uri);
      if (form === undefined) {
        return {
          response: Response.json(
            rpcError(id, -32002, `No resource at that uri; read ${GUIDE_URI}`),
          ),
          entry: {
            user_id: caller.userId,
            method,
            tool: null,
            outcome: "not_found",
          },
        };
      }
      let skills;
      try {
        skills = await deps.skills.read(store);
      } catch (error) {
        if (!(error instanceof SupabaseError)) throw error;
        return {
          response: Response.json(
            rpcError(
              id,
              -32603,
              "knowno's server did not answer; read the resource again in a moment",
            ),
          ),
          entry: {
            user_id: caller.userId,
            method,
            tool: null,
            outcome: "unavailable",
          },
        };
      }
      return answer({
        contents: [{
          uri: params.uri,
          mimeType: "text/markdown",
          text: form === null ? guideIndex(skills) : skills[form].text,
        }],
      });
    }
    case "tools/call": {
      const name = typeof params.name === "string" ? params.name : "";
      let result;
      try {
        result = await callTool(name, params.arguments, store, deps);
      } catch (error) {
        if (error instanceof SupabaseError) {
          return answer(
            {
              content: [{
                type: "text",
                text:
                  "knowno's server did not answer. Nothing was changed by this call unless list_cards shows it; try again in a moment.",
              }],
              isError: true,
            },
            "unavailable",
            name,
          );
        }
        throw error;
      }
      return result.kind === "refused"
        ? answer(
          { content: [{ type: "text", text: result.message }], isError: true },
          "tool_refused",
          name,
        )
        : answer(
          {
            content: [{ type: "text", text: JSON.stringify(result.value) }],
            structuredContent: result.value,
          },
          "answered",
          name,
        );
    }
    default:
      return {
        response: Response.json(
          rpcError(id, -32601, `Method not found: ${method}`),
        ),
        entry: {
          user_id: caller.userId,
          method,
          tool: null,
          outcome: "not_found",
        },
      };
  }
}

function badRequest(
  userId: UserId,
  body: unknown,
  method: string | null = null,
): Exchange {
  return {
    response: Response.json(body, { status: 400 }),
    entry: { user_id: userId, method, tool: null, outcome: "bad_request" },
  };
}

function unavailable(
  userId: UserId | null,
  method: string | null,
  tool: string | null,
): Exchange {
  return {
    response: Response.json(
      rpcError(null, -32603, "Supabase Auth could not be reached"),
      {
        status: 503,
      },
    ),
    entry: { user_id: userId, method, tool, outcome: "unavailable" },
  };
}
