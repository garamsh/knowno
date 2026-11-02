// Stubs of Docker and the Supabase CLI for the tests of the programs that run a stack. Each records
// its call and the stack's environment, and reads its behaviour from the environment a test sets.
import { RECORD } from "./testing.ts";

const ENV =
  `echo "env $SUPABASE_PROJECT_ID $SUPABASE_DB_PORT \${SUPABASE_API_PORT:-}" >>"$(dirname "$0")/calls"`;

export const SUPABASE = `${RECORD}
case "$1 \${2:-}" in
"start "*) ${ENV}; [ -z "\${START_PAUSE:-}" ] || sleep "$START_PAUSE" ;;
"status "*) [ -n "\${NO_ENDPOINT:-}" ] || { echo 'API_URL="http://127.0.0.1:54500"'; echo 'PUBLISHABLE_KEY="local-key"'; } ;;
"test db") printf '%s\\n' "\${PGTAP:-Files=2, Tests=7,  1 wallclock secs}"; exit "\${PGTAP_EXIT:-0}" ;;
"stop "*)
  count="$(dirname "$0")/stops"; echo x >>"$count"
  [ "$(wc -l <"$count")" -gt "\${STOP_FAILS:-0}" ] || { echo "prune refused"; exit 1; } ;;
esac`;

export const DOCKER = `${RECORD}
case "$1" in
info) exit "\${DOCKER_INFO:-0}" ;;
exec) cat >>"$(dirname "$0")/calls" ;;
esac`;

/** The reservations a stack's ports leave under the temporary directory once the run is over. */
export async function reservationsLeft(tmp: string): Promise<string[]> {
  try {
    return (await Array.fromAsync(Deno.readDir(`${tmp}/knowno-test-db`))).map((
      { name },
    ) => name);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return [];
    throw error;
  }
}
