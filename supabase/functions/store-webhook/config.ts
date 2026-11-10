/** The function's configuration, read once from the environment. */

export type Config =
  | {
    readonly kind: "configured";
    readonly supabaseUrl: string;
    readonly serviceRoleKey: string;
  }
  | { readonly kind: "not_configured" };

/** Reads `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, which the platform sets. */
export function readConfig(env: (name: string) => string | undefined): Config {
  const value = (name: string) => {
    const raw = env(name)?.trim();
    return raw === undefined || raw === "" ? null : raw;
  };
  const supabaseUrl = value("SUPABASE_URL");
  const serviceRoleKey = value("SUPABASE_SERVICE_ROLE_KEY");
  return supabaseUrl === null || serviceRoleKey === null
    ? { kind: "not_configured" }
    : { kind: "configured", supabaseUrl, serviceRoleKey };
}
