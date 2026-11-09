// A throwaway local stack for the stack tests and the migration preview (ADR 0014): it reserves its
// ports and is stopped, with its data, however the run ends.
import {
  captured,
  fail,
  hasCommand,
  merged,
  read,
  Stop,
  succeeds,
} from "./process.ts";
import { skip } from "./skip.ts";

/** Whether Docker answers; where it does not, the step `what` is skipped (skip.ts). */
export async function dockerReady(what: string): Promise<boolean> {
  if (!(await hasCommand("docker"))) {
    skip(`${what}: they need Docker, and this host has no docker command`);
    return false;
  }
  if (!(await succeeds("docker", ["info"]))) {
    skip(
      `${what}: they need Docker, and docker info reached no daemon on this host`,
    );
    return false;
  }
  return true;
}

/** Whether something on the host listens on the port. */
async function listening(port: number): Promise<boolean> {
  try {
    (await Deno.connect({ hostname: "127.0.0.1", port })).close();
    return true;
  } catch (error) {
    // Only a refused connection says nothing listens; a missing grant is no answer.
    if (error instanceof Deno.errors.ConnectionRefused) return false;
    throw error;
  }
}

const STOP_ATTEMPTS = 10;
const STOP_PAUSE_MS = 2000;

export class Stack {
  /** What every tool run against the stack is given: its project id and ports. */
  readonly env: Record<string, string> = {};
  readonly reservations = `${Deno.env.get("TMPDIR") || "/tmp"}/knowno-test-db`;
  #reserved: number[] = [];
  #cleanups: (() => Promise<void>)[] = [];
  #stopping = false;

  /** `name` is how messages name the stack. */
  constructor(readonly name: string) {}

  get projectId(): string {
    return this.env.SUPABASE_PROJECT_ID;
  }

  /**
   * The first port from `from` to `to` this run reserves. A port is this run's once mkdir creates
   * its directory, which is atomic between concurrent runs, and nothing on the host listens on it.
   * On failure every port the run holds is released.
   */
  async reserve(from: number, to: number): Promise<number> {
    await Deno.mkdir(this.reservations, { recursive: true });
    for (let port = from; port <= to; port++) {
      const dir = `${this.reservations}/${port}`;
      try {
        await Deno.mkdir(dir);
      } catch (error) {
        if (error instanceof Deno.errors.AlreadyExists) continue;
        throw error;
      }
      if (await listening(port)) {
        await Deno.remove(dir);
        continue;
      }
      this.#reserved.push(port);
      return port;
    }
    console.error(
      `found no free port in ${from}-${to} for ${this.name}; reservations are under ${this.reservations}`,
    );
    await this.release();
    throw new Stop(1);
  }

  async release(): Promise<void> {
    for (const port of this.#reserved) {
      await Deno.remove(`${this.reservations}/${port}`).catch(() => {});
    }
  }

  /** Runs before the stack stops, as the scripts' EXIT traps did. */
  onStop(cleanup: () => Promise<void>): void {
    this.#cleanups.push(cleanup);
  }

  /** Starts the stack, whose output, which carries the local keys, is not printed. */
  async start(excluded: string, workdir?: string): Promise<void> {
    const at = workdir === undefined ? [] : ["--workdir", workdir];
    await read("supabase", ["start", ...at, "--exclude", excluded], {
      env: this.env,
    });
  }

  /**
   * Stops the stack and ends the program with `status`. Stop prunes containers, volumes and
   * networks, and Docker refuses a prune while another stack's stop is pruning, so a failed stop is
   * retried. A stack left behind fails the run.
   */
  async stop(status: number): Promise<never> {
    if (this.#stopping) return await new Promise<never>(() => {});
    this.#stopping = true;
    for (const cleanup of this.#cleanups) await cleanup().catch(() => {});
    let output = "";
    for (let attempt = 1; attempt <= STOP_ATTEMPTS; attempt++) {
      const stopped = await merged("supabase", ["stop", "--no-backup"], {
        env: this.env,
      });
      if (stopped.code === 0) {
        await this.release();
        Deno.exit(status);
      }
      output = stopped.output;
      if (attempt < STOP_ATTEMPTS) {
        await new Promise((done) => setTimeout(done, STOP_PAUSE_MS));
      }
    }
    console.error(output);
    console.error(
      `could not stop ${this.name} ${this.projectId} after ${STOP_ATTEMPTS} attempts; remove it with: supabase stop --no-backup --project-id ${this.projectId}`,
    );
    await this.release();
    Deno.exit(status === 0 ? 1 : status);
  }

  /** Runs `body` against the stack, then stops it however the run ends: 130 on INT, 143 on TERM. */
  async run(body: () => Promise<void>): Promise<never> {
    Deno.addSignalListener("SIGINT", () => void this.stop(130));
    Deno.addSignalListener("SIGTERM", () => void this.stop(143));
    let status = 0;
    try {
      await body();
    } catch (error) {
      if (error instanceof Stop) status = error.code;
      else {
        console.error(error);
        status = 1;
      }
    }
    return await this.stop(status);
  }

  /** The API's URL and publishable key, from `supabase status`, which carries keys and is not printed. */
  async endpoint(): Promise<{ url: string; key: string }> {
    const { stdout } = await captured(
      "supabase",
      ["status", "--output", "env"],
      {
        env: this.env,
      },
    );
    const found = endpointOf(stdout);
    if (found === undefined) {
      fail(
        `supabase status gave no API_URL or PUBLISHABLE_KEY for the stack ${this.projectId}`,
      );
    }
    return found;
  }
}

/** The API_URL and PUBLISHABLE_KEY lines of `supabase status --output env`. */
export function endpointOf(
  status: string,
): { url: string; key: string } | undefined {
  const url = status.match(/^API_URL="(.*)"$/m)?.[1];
  const key = status.match(/^PUBLISHABLE_KEY="(.*)"$/m)?.[1];
  if (!url || !key) return undefined;
  return { url, key };
}

/** The services a stack of Postgres alone leaves out. */
export const DATABASE_ONLY =
  "gotrue,realtime,storage-api,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor";
/** The services a stack of Postgres, Auth, PostgREST and the API gateway leaves out. */
export const WITH_API =
  "realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor";
/**
 * The services the web's stack leaves out: the API's, Storage, which it stores media in, and the
 * mail catcher, Mailpit, which receives the sign-in code the e2e reads.
 */
export const WITH_MAIL =
  "realtime,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor";
