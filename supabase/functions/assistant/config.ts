/** The function's configuration, read once from the environment. */

export type Config =
  | {
    readonly kind: "configured";
    readonly supabaseUrl: string;
    /** The anon key: the tools read and write with the caller's token, so row-level security applies. */
    readonly anonKey: string;
    /** The service-role key: the caller's user, the message count and Vault, never the tools. */
    readonly serviceRoleKey: string;
  }
  | { readonly kind: "not_configured" };

/**
 * Reads `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`, which the platform
 * sets. Every provider key is read from Vault (`_shared/keys.ts`), and the provider, model, prompt
 * and limit are the caller's plan's, read at each message (`supabase.ts`).
 */
export function readConfig(env: (name: string) => string | undefined): Config {
  const value = (name: string) => {
    const raw = env(name)?.trim();
    return raw === undefined || raw === "" ? null : raw;
  };
  const supabaseUrl = value("SUPABASE_URL");
  const anonKey = value("SUPABASE_ANON_KEY");
  const serviceRoleKey = value("SUPABASE_SERVICE_ROLE_KEY");
  if (supabaseUrl === null || anonKey === null || serviceRoleKey === null) {
    return { kind: "not_configured" };
  }
  return { kind: "configured", supabaseUrl, anonKey, serviceRoleKey };
}
