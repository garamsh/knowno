/** The providers' keys, read from Vault through `public.provider_key` and kept briefly in memory. */

import { type SupabaseDeps, SupabaseError } from "./auth.ts";

/** How long a key read from Vault is reused before it is read again. */
export const KEY_CACHE_MS = 60_000;

/** The providers Vault may hold a key for, as `public.provider_key` names them. */
export const PROVIDERS = ["openrouter", "openai", "anthropic"] as const;
export type Provider = (typeof PROVIDERS)[number];

/** A provider's key, or null when none can serve it; and forgetting one that was just replaced. */
export type Keys = {
  readonly get: (provider: Provider) => Promise<string | null>;
  readonly forget: (provider: Provider) => void;
};

/**
 * The keys of Vault, each kept for `KEY_CACHE_MS` by [now]'s clock. A key appears in no log, error
 * or answer: a failure to read one names only the status.
 */
export function vaultKeys(
  deps: SupabaseDeps & { readonly now: () => number },
): Keys {
  const kept = new Map<Provider, { key: string | null; until: number }>();
  const read = async (provider: Provider): Promise<string | null> => {
    const response = await deps.fetch(`${deps.url}/rest/v1/rpc/provider_key`, {
      method: "POST",
      headers: {
        apikey: deps.serviceRoleKey,
        Authorization: `Bearer ${deps.serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ provider }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new SupabaseError(`provider_key answered ${response.status}`);
    }
    const key: unknown = await response.json();
    if (key !== null && typeof key !== "string") {
      throw new SupabaseError("provider_key answered no key");
    }
    return key;
  };
  return {
    get: async (provider) => {
      const hit = kept.get(provider);
      const stored = hit !== undefined && hit.until > deps.now()
        ? hit.key
        : await read(provider);
      if (hit === undefined || hit.until <= deps.now()) {
        kept.set(provider, { key: stored, until: deps.now() + KEY_CACHE_MS });
      }
      return stored;
    },
    forget: (provider) => {
      kept.delete(provider);
    },
  };
}
