// The admin area's AI settings through the handler: a key or a draft saved only after its check
// call parsed, with Supabase and the providers replaced by a fake fetch.
import assert from "node:assert/strict";
import { readConfig } from "./config.ts";
import { createHandler, type SettingsLogEntry } from "./handler.ts";
import { vaultKeys } from "./keys.ts";
import { ANTHROPIC_URL, OPENAI_URL, OPENROUTER_URL } from "./providers.ts";
import { CHECK_IMAGE } from "./settings.ts";

const SUPABASE_URL = "https://project.supabase.test";
const ADMIN_ID = "00000000-0000-4000-8000-0000000000ad";
const SIGNED_IN = "Bearer admin-token";
const NEW_KEY = "sk-new-provider-key-9876";
const VAULT_KEY = "sk-ant-vault-key-5555";

type Answer = { status: number; body: unknown };

type Fake = {
  session: "recent" | "stale" | "not_admin";
  vault: Record<string, string>;
  provider: Answer;
  calls: { url: string; init: RequestInit | undefined }[];
};

const parsed: Answer = {
  status: 200,
  body: {
    choices: [{ finish_reason: "stop", message: { content: '{"cards":[]}' } }],
    usage: { prompt_tokens: 3, completion_tokens: 2 },
  },
};

function fakeFetch(fake: Fake): typeof fetch {
  return (input, init) => {
    const url = String(input);
    fake.calls.push({ url, init });
    const reply = (body: unknown, status = 200) =>
      Promise.resolve(Response.json(body, { status }));
    if (url === `${SUPABASE_URL}/auth/v1/user`) {
      return new Headers(init?.headers).get("Authorization") === SIGNED_IN
        ? reply({ id: ADMIN_ID })
        : reply({}, 401);
    }
    if (url === `${SUPABASE_URL}/rest/v1/rpc/admin_ai_session`) {
      return fake.session === "not_admin"
        ? reply({ code: "42501" }, 403)
        : reply(fake.session === "recent");
    }
    if (url === `${SUPABASE_URL}/rest/v1/rpc/provider_key`) {
      const { provider } = JSON.parse(String(init?.body));
      return reply(fake.vault[provider] ?? null);
    }
    if (url === `${SUPABASE_URL}/rest/v1/rpc/save_provider_key`) {
      return reply("saved");
    }
    if (url === `${SUPABASE_URL}/rest/v1/rpc/save_ai_configuration`) {
      const { prompt_version_id } = JSON.parse(String(init?.body));
      // The database holds no version 404.
      return reply(prompt_version_id === 404 ? null : 7);
    }
    if (url === OPENAI_URL || url === ANTHROPIC_URL || url === OPENROUTER_URL) {
      return reply(fake.provider.body, fake.provider.status);
    }
    throw new Error(`unexpected request to ${url}`);
  };
}

async function post(
  route: "key" | "configuration",
  body: unknown,
  options: Partial<Omit<Fake, "calls">> = {},
) {
  const fake: Fake = {
    session: options.session ?? "recent",
    vault: options.vault ?? {},
    provider: options.provider ?? parsed,
    calls: [],
  };
  const env: Record<string, string> = {
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  };
  const send = fakeFetch(fake);
  const logs: unknown[] = [];
  const settingsLogs: SettingsLogEntry[] = [];
  const handler = createHandler({
    config: readConfig((name) => env[name]),
    fetch: send,
    log: (entry) => {
      if ("settings" in entry) settingsLogs.push(entry);
      else logs.push(entry);
    },
    now: () => 0,
    modelTimeoutMs: 1000,
    newToken: () => {
      throw new Error("no cursor here");
    },
    keys: vaultKeys({
      url: SUPABASE_URL,
      serviceRoleKey: "service-role-key",
      fetch: send,
      now: () => 0,
    }),
  });
  const printed: string[] = [];
  const saved = { ...console };
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    console[level] = (...args: unknown[]) =>
      printed.push(args.map(String).join(" "));
  }
  let response: Response;
  try {
    response = await handler(
      new Request(`https://functions.test/extract-cards/settings/${route}`, {
        method: "POST",
        headers: {
          Authorization: SIGNED_IN,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }),
    );
  } finally {
    Object.assign(console, saved);
  }
  const text = await response.text();
  const at = (url: string) => fake.calls.filter((call) => call.url === url);
  return {
    status: response.status,
    text,
    body: JSON.parse(text),
    settingsLogs,
    logs,
    printed,
    fake,
    modelCalls: [OPENAI_URL, ANTHROPIC_URL, OPENROUTER_URL].flatMap(at),
    saves: [
      ...at(`${SUPABASE_URL}/rest/v1/rpc/save_provider_key`),
      ...at(`${SUPABASE_URL}/rest/v1/rpc/save_ai_configuration`),
    ].map((call) => JSON.parse(String(call.init?.body))),
  };
}

const keyBody = { provider: "openai", key: NEW_KEY, model: "gpt-model" };

Deno.test("a provider's key is stored only after one call with it, its model, an image and the strict schema parsed", async () => {
  const r = await post("key", keyBody);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { saved: true });
  assert.equal(r.modelCalls.length, 1);
  const call = r.modelCalls[0];
  assert.equal(
    new Headers(call.init?.headers).get("Authorization"),
    `Bearer ${NEW_KEY}`,
  );
  const sent = JSON.parse(String(call.init?.body));
  assert.equal(sent.model, "gpt-model");
  assert.equal(sent.response_format.json_schema.strict, true);
  assert.ok(
    JSON.stringify(sent.messages).includes(CHECK_IMAGE.base64),
    "the check image",
  );
  assert.ok(sent.messages[0].content.includes("cards"), "the output contract");
  assert.deepEqual(r.saves, [{
    admin_id: ADMIN_ID,
    provider: "openai",
    key: NEW_KEY,
  }]);
});

Deno.test("a key whose check call fails is not stored, and the answer names why", async () => {
  const cases: [Answer, string][] = [
    [
      { status: 401, body: { error: { message: "Incorrect API key" } } },
      "key_refused",
    ],
    [
      { status: 404, body: { error: { message: "The model does not exist" } } },
      "model_not_found",
    ],
    [
      {
        status: 400,
        body: { error: { message: "This model does not support image input" } },
      },
      "no_image_input",
    ],
    [{
      status: 200,
      body: {
        choices: [{
          finish_reason: "stop",
          message: { content: "here are your cards" },
        }],
      },
    }, "bad_output"],
    [{ status: 500, body: {} }, "call_failed"],
  ];
  for (const [answer, code] of cases) {
    const r = await post("key", keyBody, { provider: answer });
    assert.equal(r.status, 422, code);
    assert.deepEqual(r.body, { error: code });
    assert.equal(r.modelCalls.length, 1, code);
    assert.equal(r.saves.length, 0, `${code}: nothing is stored`);
  }
  const control = await post("key", keyBody);
  assert.equal(
    control.saves.length,
    1,
    "control: a call that parses stores the key",
  );
});

Deno.test("saving a key needs an admin who signed in within 10 minutes, and calls no provider before", async () => {
  const stale = await post("key", keyBody, { session: "stale" });
  assert.equal(stale.status, 403);
  assert.deepEqual(stale.body, { error: "reauth" });
  assert.equal(stale.modelCalls.length + stale.saves.length, 0);
  const user = await post("key", keyBody, { session: "not_admin" });
  assert.equal(user.status, 403);
  assert.deepEqual(user.body, { error: "forbidden" });
  assert.equal(user.modelCalls.length + user.saves.length, 0);
  const session = user.fake.calls.find((call) =>
    call.url.endsWith("/rpc/admin_ai_session")
  );
  assert.equal(
    new Headers(session?.init?.headers).get("Authorization"),
    SIGNED_IN,
    "asked as the caller, not the service role",
  );
  const control = await post("key", keyBody, { session: "recent" });
  assert.equal(control.status, 200, "control: a recent sign-in saves");
});

Deno.test("a key appears in no log line, printed line, answer or error", async () => {
  for (
    const answer of [parsed, {
      status: 401,
      body: { error: { message: `bad key ${NEW_KEY}` } },
    }]
  ) {
    const r = await post("key", keyBody, { provider: answer });
    assert.ok(!r.text.includes(NEW_KEY), "not in the answer");
    assert.ok(
      !JSON.stringify(r.settingsLogs).includes(NEW_KEY),
      "not in the log line",
    );
    assert.ok(
      !r.printed.join("\n").includes(NEW_KEY),
      "nothing else printed holds it",
    );
    assert.equal(r.settingsLogs.length, 1);
    assert.deepEqual(Object.keys(r.settingsLogs[0]).sort(), [
      "outcome",
      "settings",
    ]);
  }
  const sent = (await post("key", keyBody)).fake.calls.map((call) =>
    String(call.init?.body)
  );
  assert.ok(
    sent.some((body) => body.includes(NEW_KEY)),
    "control: the key was in the requests",
  );
});

Deno.test("a plan's provider and model are saved as its draft only after a call with the key in use parsed", async () => {
  const body = {
    plan: "pro",
    provider: "anthropic",
    model: "claude-haiku-5-5",
  };
  const anthropicReply: Answer = {
    status: 200,
    body: {
      content: [{ type: "text", text: '{"cards":[]}' }],
      stop_reason: "end_turn",
      usage: { input_tokens: 3, output_tokens: 2 },
    },
  };
  const r = await post("configuration", body, {
    vault: { anthropic: VAULT_KEY },
    provider: anthropicReply,
    session: "stale",
  });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { saved: true, configuration_id: 7 });
  assert.equal(
    new Headers(r.modelCalls[0].init?.headers).get("x-api-key"),
    VAULT_KEY,
  );
  assert.deepEqual(r.saves, [{ admin_id: ADMIN_ID, ...body }]);
  assert.ok(!r.text.includes(VAULT_KEY));

  const failing = await post("configuration", body, {
    vault: { anthropic: VAULT_KEY },
    provider: {
      status: 404,
      body: { type: "error", error: { message: "model: not found" } },
    },
  });
  assert.deepEqual(failing.body, { error: "model_not_found" });
  assert.equal(failing.saves.length, 0, "a draft that fails is not saved");

  const keyless = await post("configuration", body, {});
  assert.equal(keyless.status, 409);
  assert.deepEqual(keyless.body, { error: "no_key" });
  assert.equal(keyless.modelCalls.length + keyless.saves.length, 0);

  const malformed = await post("configuration", {
    ...body,
    model: "anthropic/claude",
  }, {
    vault: { anthropic: VAULT_KEY },
  });
  assert.equal(malformed.status, 400, "a model id of another provider's form");
  assert.equal(malformed.modelCalls.length, 0);

  const special = await post("configuration", { ...body, plan: "special" }, {
    vault: { anthropic: VAULT_KEY },
    provider: anthropicReply,
  });
  assert.equal(special.status, 200, "special's draft is saved as any plan's");
  assert.deepEqual(special.saves, [{
    admin_id: ADMIN_ID,
    ...body,
    plan: "special",
  }]);
  const unknown = await post("configuration", { ...body, plan: "gold" }, {
    vault: { anthropic: VAULT_KEY },
    provider: anthropicReply,
  });
  assert.equal(unknown.status, 400, "a plan that does not exist");
  assert.equal(unknown.modelCalls.length + unknown.saves.length, 0);
});

Deno.test("a draft is saved with the prompt version it names, and one the database lacks is refused", async () => {
  const body = {
    plan: "free",
    provider: "anthropic",
    model: "claude-haiku-5-5",
    prompt_version_id: 9,
  };
  const reply: Answer = {
    status: 200,
    body: {
      content: [{ type: "text", text: '{"cards":[]}' }],
      stop_reason: "end_turn",
      usage: { input_tokens: 3, output_tokens: 2 },
    },
  };
  const options = { vault: { anthropic: VAULT_KEY }, provider: reply };
  const named = await post("configuration", body, options);
  assert.equal(named.status, 200);
  assert.deepEqual(named.saves, [{ admin_id: ADMIN_ID, ...body }]);

  const missing = await post("configuration", {
    ...body,
    prompt_version_id: 404,
  }, options);
  assert.equal(missing.status, 400, "a version the database does not hold");
  assert.deepEqual(missing.body, { error: "bad_request" });

  for (const malformed of [0, 1.5, "9", null]) {
    const r = await post("configuration", {
      ...body,
      prompt_version_id: malformed,
    }, options);
    assert.equal(
      r.status,
      400,
      `prompt_version_id ${JSON.stringify(malformed)}`,
    );
    assert.equal(r.modelCalls.length + r.saves.length, 0);
  }
});
