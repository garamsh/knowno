// Runs every e2e spec in web/e2e/ against the built web app and a local stack of its own, or says why
// it did not. The stack follows ADR 0014's pattern for the database tests: its own project id and
// reserved ports, stopped with its data however the run ends. It runs Postgres, Auth, PostgREST,
// Storage and the API gateway; the app is built with the stack's URL and publishable key, which a build
// freezes, and served as the image serves it, by its standalone server. Arguments go to `playwright
// test` as given, which then selects what runs, so no spec is required to run a test.
import {
  attached,
  entry,
  fail,
  hasCommand,
  merged,
  read,
  scopeFiles,
  scopeText,
  Stop,
  succeeds,
} from "./process.ts";
import { skip } from "./skip.ts";
import { dockerReady, Stack, WITH_MAIL } from "./stack.ts";

const SCOPE = ["web/e2e/*.spec.ts"];
const SERVER_ATTEMPTS = 5;
const HEALTH_TRIES = 60;

/** Playwright's count of passed tests, and whether it names any skipped. */
export function playwrightSummary(
  output: string,
): { passed: number; skipped: boolean } {
  const counts = [...output.matchAll(/^ *(\d*) passed.*$/gm)];
  return {
    passed: Number(counts.at(-1)?.[1] || 0),
    skipped: /^ *[0-9]+ skipped/m.test(output),
  };
}

/**
 * The specs with a passed test. A passed test's line reads
 * "✓ <n> [<project>] › e2e/<file>.spec.ts:<line>:<col> › <title>".
 */
export function specsThatPassed(output: string): Set<string> {
  const found = output.matchAll(
    /^ *✓ *[0-9]* \[[^\]]*\] › (e2e\/[^:]*\.spec\.ts):.*$/gm,
  );
  return new Set([...found].map(([, spec]) => spec));
}

/** A server started in the background, its stdout and stderr in one log file. */
class Server {
  #exited = false;
  readonly done: Promise<void>;
  constructor(readonly child: Deno.ChildProcess, log: Deno.FsFile) {
    const pump = (stream: ReadableStream<Uint8Array>) =>
      stream.pipeTo(
        new WritableStream({
          write: (chunk) => log.write(chunk).then(() => {}),
        }),
      );
    this.done = Promise.all([
      child.status,
      pump(child.stdout),
      pump(child.stderr),
    ])
      .then(() => {
        this.#exited = true;
      });
  }
  get running(): boolean {
    return !this.#exited;
  }
  async stop(): Promise<void> {
    if (this.running) this.child.kill("SIGTERM");
    await this.done.catch(() => {});
  }
}

/** Starts the app's standalone server and returns it once it answers, or once it has exited. */
async function serve(
  port: number,
  logPath: string,
  url: string,
): Promise<Server> {
  const log = await Deno.open(logPath, {
    write: true,
    truncate: true,
    create: true,
  });
  const child = new Deno.Command("node", {
    args: ["web/.next/standalone/server.js"],
    // 0.0.0.0, as the image listens, and not 127.0.0.1: Next.js 16.4.1 names a request by the
    // address the server was given and compares a proxy's rewrite with it after turning 127.0.0.1
    // (and `localhost`'s ::1) into `localhost`, so on 127.0.0.1 the admin host's rewrite is taken
    // for another origin's and fetched again. A server given `localhost` listens on one of its two
    // addresses, which its own fetch after a Server Action's redirect may not reach
    // (`server/app-render/action-handler.js`).
    // The service's origin is the one the specs reach it at; its admin host is admin.localhost.
    env: {
      PORT: `${port}`,
      HOSTNAME: "0.0.0.0",
      NODE_ENV: "production",
      KNOWNO_SERVICE_ORIGIN: url,
    },
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const server = new Server(child, log);
  server.done.finally(() => log.close());
  const answers = () =>
    succeeds("curl", [
      "--silent",
      "--fail",
      "--output",
      "/dev/null",
      `${url}/api/health`,
    ]);
  for (let tries = 0; !(await answers()); tries++) {
    if (!server.running) return server;
    if (tries >= HEALTH_TRIES) {
      console.error(await Deno.readTextFile(logPath));
      fail(
        `the web app built for the stack did not answer ${url}/api/health within 60 s`,
      );
    }
    await new Promise((done) => setTimeout(done, 1000));
  }
  return server;
}

async function main(args: string[]): Promise<void> {
  const specs = (await scopeFiles(SCOPE)).map((file) =>
    file.replace(/^web\//, "")
  );
  if (specs.length === 0) {
    fail(`no e2e spec was selected by: ${scopeText(SCOPE)}`);
  }
  if (!(await dockerReady("the web e2e specs in web/e2e/"))) return;
  if (!(await hasCommand("node"))) {
    skip("the web e2e specs in web/e2e/: this host has no node command");
    return;
  }
  const stack = new Stack("the web e2e stack");
  const dbPort = await stack.reserve(54400, 54499);
  const apiPort = await stack.reserve(54500, 54599);
  // Mailpit's port is the stack's own as well, so stacks run together do not meet on config.toml's.
  const mailPort = await stack.reserve(54700, 54799);
  stack.env.SUPABASE_PROJECT_ID = `knowno_web_${dbPort}`;
  stack.env.SUPABASE_DB_PORT = `${dbPort}`;
  stack.env.SUPABASE_API_PORT = `${apiPort}`;
  stack.env.SUPABASE_LOCAL_SMTP_PORT = `${mailPort}`;
  let server: Server | undefined;
  const serverLog = await Deno.makeTempFile();
  stack.onStop(async () => {
    await server?.stop();
    await Deno.remove(serverLog).catch(() => {});
  });
  await stack.run(async () => {
    await stack.start(WITH_MAIL);
    const { url, key } = await stack.endpoint();
    const built = {
      NEXT_PUBLIC_SUPABASE_URL: url,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key,
      NEXT_TELEMETRY_DISABLED: "1",
    };
    await read("npx", ["next", "build"], { cwd: "web", env: built });
    // The image copies the static files beside the standalone server; so does this run.
    await attached("rm", ["-rf", "web/.next/standalone/.next/static"]);
    await attached("cp", [
      "-R",
      "web/.next/static",
      "web/.next/standalone/.next/static",
    ]);
    await attached("rm", ["-rf", "web/.next/standalone/public"]);
    await attached("cp", ["-R", "web/public", "web/.next/standalone/public"]);
    // The server's port is reserved once the build is done, just before the server listens on it.
    // The reservation sees only a listener, and a port can be held without one, as the local port
    // of an outgoing connection, which Linux takes from 32768-60999 (#158). The server then exits
    // with EADDRINUSE, and the next free port is reserved and tried, five times at most.
    let base = "";
    for (let attempt = 1; attempt <= SERVER_ATTEMPTS; attempt++) {
      const webPort = await stack.reserve(54600, 54699);
      base = `http://localhost:${webPort}`;
      server = await serve(webPort, serverLog, base);
      if (server.running) {
        console.log(`the web app answers on port ${webPort}`);
        break;
      }
      const log = await Deno.readTextFile(serverLog);
      server = undefined;
      if (!log.includes("EADDRINUSE") || attempt === SERVER_ATTEMPTS) {
        console.error(log);
        fail(
          `the web app built for the stack exited before answering on port ${webPort}, attempt ${attempt}`,
        );
      }
      console.log(
        `port ${webPort} was taken after it was reserved; trying the next free port`,
      );
    }
    await read("npx", ["playwright", "install", "chromium"], { cwd: "web" });
    const { code, output } = await merged("npx", [
      "playwright",
      "test",
      ...args,
    ], {
      cwd: "web",
      env: {
        E2E_BASE_URL: base,
        E2E_SUPABASE_URL: url,
        E2E_SUPABASE_KEY: key,
        // The mail catcher's API, which the sign-in code is read from.
        E2E_MAIL_URL: `http://127.0.0.1:${mailPort}`,
        // admin-host.spec.ts makes its admin in the stack's database, as the PM makes the first.
        E2E_DB_CONTAINER: `supabase_db_${stack.projectId}`,
      },
    });
    console.log(output);
    if (code !== 0) {
      console.log("the web app's log:");
      console.log(await Deno.readTextFile(serverLog));
      throw new Stop(1);
    }
    const { passed, skipped } = playwrightSummary(output);
    if (passed === 0 || skipped) {
      fail(
        `the web e2e specs skipped or ran no test against the stack ${stack.projectId}`,
      );
    }
    const ran = specsThatPassed(output);
    const missed = args.length > 0
      ? []
      : specs.filter((spec) => !ran.has(spec)).toSorted();
    if (missed.length > 0) {
      fail(
        `these e2e specs ran no test against the stack ${stack.projectId}:\n${
          missed.join("\n")
        }`,
      );
    }
    const selection = args.length > 0
      ? `${scopeText(SCOPE)}, narrowed by: playwright test ${args.join(" ")}`
      : scopeText(SCOPE);
    console.log(
      `ran ${passed} web e2e tests in ${ran.size} specs against the web app built for the stack ${stack.projectId}, selected by: ${selection}`,
    );
  });
}

if (import.meta.main) await entry(main);
