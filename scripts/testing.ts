// What the tests in scripts/ share: a git repository in a temporary directory holding these
// programs, each run through scripts/run.sh, so a test meets the grant the program ships with.
import assert from "node:assert/strict";

const HERE = new URL(".", import.meta.url).pathname;

export type Ran = { code: number; stdout: string; stderr: string };

const decoded = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

/** Runs a command, CI unset unless `env` sets it, as a contributor's shell would. */
export async function run(
  cwd: string,
  command: string[],
  env: Record<string, string> = {},
): Promise<Ran> {
  const assigned = Object.entries(env).map(([key, value]) => `${key}=${value}`);
  const { code, stdout, stderr } = await new Deno.Command("env", {
    args: ["-u", "CI", ...assigned, ...command],
    cwd,
  }).output();
  return { code, stdout: decoded(stdout), stderr: decoded(stderr) };
}

/** Runs git in the repository and returns its stdout; a failure fails the test's setup. */
export async function git(repo: string, ...args: string[]): Promise<string> {
  const ran = await run(repo, [
    "git",
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@t",
    ...args,
  ]);
  assert.equal(ran.code, 0, `setup: git ${args.join(" ")}: ${ran.stderr}`);
  return ran.stdout.trim();
}

/** A repository on main with no commit, holding the programs in scripts/, tests apart. */
export async function repository(): Promise<string> {
  const repo = await Deno.makeTempDir();
  await git(repo, "init", "-q", "-b", "main");
  await Deno.mkdir(`${repo}/scripts`);
  for await (const { name } of Deno.readDir(HERE)) {
    const shipped = /\.(sh|ts)$/.test(name) && !name.endsWith("_test.ts");
    if (shipped) {
      await Deno.copyFile(`${HERE}${name}`, `${repo}/scripts/${name}`);
    }
  }
  return repo;
}

/** Writes a file of the repository, making its directory. */
export async function write(
  repo: string,
  path: string,
  content: string | Uint8Array,
): Promise<void> {
  const file = `${repo}/${path}`;
  await Deno.mkdir(file.slice(0, file.lastIndexOf("/")), { recursive: true });
  if (typeof content === "string") await Deno.writeTextFile(file, content);
  else await Deno.writeFile(file, content);
}

/** Adds everything and commits it. */
export async function commit(repo: string, message: string): Promise<void> {
  await git(repo, "add", "-A");
  await git(repo, "commit", "-q", "-m", message);
}

/** Runs a program as make does. */
export function program(
  repo: string,
  name: string,
  args: string[] = [],
  env: Record<string, string> = {},
): Promise<Ran> {
  return run(repo, ["sh", "scripts/run.sh", name, ...args], env);
}

/** The lines of a program's output, stdout and stderr together. */
export function outputLines({ stdout, stderr }: Ran): string[] {
  return `${stdout}\n${stderr}`.split("\n");
}
