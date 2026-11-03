// The providers' keys read from Vault: the cache, a provider without one and the failure.
import assert from "node:assert/strict";
import { KEY_CACHE_MS, vaultKeys } from "./keys.ts";

const URL_BASE = "https://project.supabase.test";

function store(vault: Record<string, string | null>) {
  const asked: string[] = [];
  let clock = 0;
  const keys = vaultKeys({
    url: URL_BASE,
    serviceRoleKey: "service-role-key",
    now: () => clock,
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
  assert.equal(
    await s.keys.get("openai"),
    "sk-first-0001",
    "kept within the minute",
  );
  assert.deepEqual(s.asked, ["openai"]);
  s.tick(1);
  assert.equal(
    await s.keys.get("openai"),
    "sk-second-002",
    "read again after it",
  );
  vault.openai = "sk-third-0003";
  s.keys.forget("openai");
  assert.equal(
    await s.keys.get("openai"),
    "sk-third-0003",
    "read again once forgotten",
  );
});

Deno.test("a provider without a key in Vault has none, OpenRouter as every other", async () => {
  const none = store({});
  for (const provider of ["openrouter", "openai", "anthropic"] as const) {
    assert.equal(await none.keys.get(provider), null, provider);
  }
  const held = store({
    openrouter: "sk-or-vault-001",
    openai: "sk-oa-vault-001",
    anthropic: "sk-an-vault-001",
  });
  assert.equal(
    await held.keys.get("openrouter"),
    "sk-or-vault-001",
    "control: OpenRouter's key once Vault holds it",
  );
  assert.equal(await held.keys.get("openai"), "sk-oa-vault-001");
  assert.equal(await held.keys.get("anthropic"), "sk-an-vault-001");
});

Deno.test("a failed read names the status and never a key", async () => {
  const keys = vaultKeys({
    url: URL_BASE,
    serviceRoleKey: "service-role-key",
    now: () => 0,
    fetch: () =>
      Promise.resolve(
        Response.json({ hint: "sk-or-vault-001" }, { status: 500 }),
      ),
  });
  await assert.rejects(keys.get("openrouter"), (error: Error) => {
    assert.equal(error.message, "provider_key answered 500");
    return true;
  });
});
