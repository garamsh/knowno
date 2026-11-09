import { execFileSync } from "node:child_process";

/** The stack's database container, which scripts/test-web.ts names; none outside the stack. */
export const database = process.env.E2E_DB_CONTAINER;

/** Runs [sql] in the stack's database as its superuser, which no client write is. */
export function runSql(sql: string) {
  if (!database) throw new Error("skipped without local stack");
  execFileSync(
    "docker",
    ["exec", database, "psql", "-U", "supabase_admin", "-d", "postgres"].concat([
      "-X",
      "-q",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      sql,
    ]),
  );
}
