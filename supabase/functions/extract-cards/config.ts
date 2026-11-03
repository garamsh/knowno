/** The function's configuration, read once from the environment. */

export type Config =
  | {
    readonly kind: "configured";
    readonly supabaseUrl: string;
    readonly serviceRoleKey: string;
    /**
     * `OPENROUTER_API_KEY`, the transition's only provider secret: it serves OpenRouter while Vault
     * holds no OpenRouter key, and a follow-up removes it (ADR 0162). Null when it is not set.
     */
    readonly openRouterSecret: string | null;
  }
  | { readonly kind: "not_configured" };

/**
 * Reads `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, which the platform sets, and the
 * transition's `OPENROUTER_API_KEY`. Every other provider key is read from Vault (`keys.ts`), and
 * the provider, model and limit are the caller's plan's, read at each call (`supabase.ts`).
 */
export function readConfig(env: (name: string) => string | undefined): Config {
  const value = (name: string) => {
    const raw = env(name)?.trim();
    return raw === undefined || raw === "" ? null : raw;
  };
  const supabaseUrl = value("SUPABASE_URL");
  const serviceRoleKey = value("SUPABASE_SERVICE_ROLE_KEY");
  if (supabaseUrl === null || serviceRoleKey === null) {
    return { kind: "not_configured" };
  }
  return {
    kind: "configured",
    supabaseUrl,
    serviceRoleKey,
    openRouterSecret: value("OPENROUTER_API_KEY"),
  };
}
