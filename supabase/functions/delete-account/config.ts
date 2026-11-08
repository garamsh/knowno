/** The function's configuration, read once from the environment. */

/** What signs the client secret Apple's token endpoints take (ADR 0210). */
export type AppleConfig = {
  readonly teamId: string;
  readonly keyId: string;
  readonly clientId: string;
  /** The Sign in with Apple key, the text of its `.p8` file. */
  readonly privateKey: string;
};

export type Config =
  | {
    readonly kind: "configured";
    readonly supabaseUrl: string;
    readonly serviceRoleKey: string;
    /** Null while any of the four Apple secrets is missing: no revocation is attempted. */
    readonly apple: AppleConfig | null;
  }
  | { readonly kind: "not_configured" };

/**
 * Reads `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, which the platform sets, and
 * `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_CLIENT_ID` and `APPLE_PRIVATE_KEY`, which the owner sets
 * as function secrets.
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
  const teamId = value("APPLE_TEAM_ID");
  const keyId = value("APPLE_KEY_ID");
  const clientId = value("APPLE_CLIENT_ID");
  const privateKey = value("APPLE_PRIVATE_KEY");
  return {
    kind: "configured",
    supabaseUrl,
    serviceRoleKey,
    apple: teamId === null || keyId === null || clientId === null ||
        privateKey === null
      ? null
      : { teamId, keyId, clientId, privateKey },
  };
}
