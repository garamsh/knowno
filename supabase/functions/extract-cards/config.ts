/** The function's configuration, read once from the environment. */

export type Config =
  | {
    readonly kind: "configured";
    readonly supabaseUrl: string;
    readonly serviceRoleKey: string;
  }
  | { readonly kind: "not_configured" };

/**
 * Reads `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, which the platform sets. Every provider key
 * is read from Vault (`keys.ts`), and the provider, model and limit are the caller's plan's, read at
 * each call (`supabase.ts`).
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
  return { kind: "configured", supabaseUrl, serviceRoleKey };
}
