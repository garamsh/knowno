// scripts/skip.sh for a Deno program: skips a step whose tool is missing and says why, or fails
// where CI is set. Reading CI takes --allow-env=CI.
import { fail } from "./process.ts";

/** `what` reads "<what did not run>: <why>"; the caller then returns or carries on. */
export function skip(what: string): void {
  if (Deno.env.get("CI")) {
    fail(
      `did not run ${what}; CI is set, and there a missing tool fails the step instead of skipping it`,
    );
  }
  console.log(`skipped ${what}`);
}
