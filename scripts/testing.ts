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
    const shipped = /\.(sh|ts|txt)$/.test(name) && !name.endsWith("_test.ts");
    if (shipped) {
      await Deno.copyFile(`${HERE}${name}`, `${repo}/scripts/${name}`);
    }
    if (name.startsWith(".") && name !== "." && name !== "..") {
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

const HOST_TOOLS = [
  "basename",
  "cat",
  "cp",
  "deno",
  "diff",
  "dirname",
  "git",
  "grep",
  "head",
  "realpath",
  "rm",
  "sed",
  "sh",
  "sleep",
  "touch",
  "tr",
  "wc",
  "which",
];

/**
 * A directory to set as PATH: the tools a program's run needs, and a stub for each of `stubs`, whose
 * body is shell. A tool named in neither is missing, as on a host without it, and so is each of
 * `missing`, a tool the host would otherwise have. `log` is the stubs' record of their calls.
 */
export async function host(
  stubs: Record<string, string>,
  { missing = [] }: { missing?: string[] } = {},
): Promise<{ path: string; log: () => Promise<string> }> {
  const path = await Deno.makeTempDir();
  for (
    const tool of HOST_TOOLS.filter((name) =>
      !(name in stubs) && !missing.includes(name)
    )
  ) {
    const found = await run(path, ["sh", "-c", `command -v ${tool}`]);
    assert.equal(found.code, 0, `setup: no ${tool} on this host`);
    await run(path, ["ln", "-s", found.stdout.trim(), tool]);
  }
  for (const [name, body] of Object.entries(stubs)) {
    await Deno.writeTextFile(`${path}/${name}`, `#!/bin/sh\n${body}\n`);
    await Deno.chmod(`${path}/${name}`, 0o755);
  }
  await Deno.writeTextFile(`${path}/calls`, "");
  return { path, log: () => Deno.readTextFile(`${path}/calls`) };
}

/** Shell that records a stub's call in the log of the host whose PATH it runs under. */
export const RECORD = `echo "$(basename "$0") $*" >>"$(dirname "$0")/calls"`;
