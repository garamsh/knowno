// The providers' keys read from Vault: the cache, the OpenRouter transition and the failure.
import assert from "node:assert/strict";
import { KEY_CACHE_MS, vaultKeys } from "./keys.ts";

const URL_BASE = "https://project.supabase.test";

function store(vault: Record<string, string | null>, secret: string | null = null) {
  const asked: string[] = [];
  let clock = 0;
  const keys = vaultKeys({
    url: URL_BASE,
    serviceRoleKey: "service-role-key",
    now: () => clock,
    openRouterSecret: secret,
    fetch: (_input, init) => {
      const { provider } = JSON.parse(String(init?.body));
      asked.push(provider);
      return Promise.resolve(Response.json(vault[provider] ?? null));
    },
  });
  return { keys, asked, tick: (ms: number) => (clock += ms) };
}

Deno.test("a key is read from Vault once a minute, and again at once after it is replaced", async () => {
  const vault: Record<string, string | null> = { openai: "sk-first-0001" };
  const s = store(vault);
  assert.equal(await s.keys.get("openai"), "sk-first-0001");
  vault.openai = "sk-second-002";
  s.tick(KEY_CACHE_MS - 1);
  assert.equal(await s.keys.get("openai"), "sk-first-0001", "kept within the minute");
  assert.deepEqual(s.asked, ["openai"]);
  s.tick(1);
  assert.equal(await s.keys.get("openai"), "sk-second-002", "read again after it");
  vault.openai = "sk-third-0003";
  s.keys.forget("openai");
  assert.equal(await s.keys.get("openai"), "sk-third-0003", "read again once forgotten");
});

Deno.test("OpenRouter alone falls back to its transition secret, and only while Vault holds none", async () => {
  const none = store({}, "sk-or-secret-01");
  assert.equal(await none.keys.get("openrouter"), "sk-or-secret-01");
  assert.equal(await none.keys.get("openai"), null, "no other provider has a secret");
  assert.equal(await none.keys.get("anthropic"), null);
  const vault = store({ openrouter: "sk-or-vault-001" }, "sk-or-secret-01");
  assert.equal(await vault.keys.get("openrouter"), "sk-or-vault-001", "Vault's key wins");
  const neither = store({});
  assert.equal(await neither.keys.get("openrouter"), null, "control: without the secret, none");
});

Deno.test("a failed read names the status and never a key", async () => {
  const keys = vaultKeys({
    url: URL_BASE,
    serviceRoleKey: "service-role-key",
    now: () => 0,
    openRouterSecret: "sk-or-secret-01",
    fetch: () => Promise.resolve(Response.json({ hint: "sk-or-secret-01" }, { status: 500 })),
  });
  await assert.rejects(keys.get("openrouter"), (error: Error) => {
    assert.equal(error.message, "provider_key answered 500");
    return true;
  });
});
