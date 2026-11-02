// What the programs in scripts/ share: running a tool, and ending with an exit code.

/** Ends a program with an exit code; entry() is its one handler. */
export class Stop extends Error {
  constructor(readonly code: number) {
    super(`exit ${code}`);
  }
}

/** Prints the reason to stderr and ends the program. */
export function fail(message: string, code = 1): never {
  console.error(message);
  throw new Stop(code);
}

/** Runs a program's main and ends the process with its exit code. */
export async function entry(
  main: (args: string[]) => Promise<void>,
): Promise<void> {
  try {
    await main(Deno.args);
  } catch (error) {
    if (error instanceof Stop) Deno.exit(error.code);
    throw error;
  }
}

export type RunOptions = { cwd?: string; env?: Record<string, string> };

const text = new TextDecoder();

/** The tool's stdout, its stderr passing through; a failure ends the program with its code. */
export async function read(
  command: string,
  args: string[],
  options: RunOptions = {},
): Promise<string> {
  const { code, stdout } = await new Deno.Command(command, {
    args,
    ...options,
    stdout: "piped",
    stderr: "inherit",
  }).output();
  if (code !== 0) throw new Stop(code);
  return text.decode(stdout);
}

/** Runs the tool on this terminal; a failure ends the program with its code. */
export async function attached(
  command: string,
  args: string[],
  options: RunOptions = {},
): Promise<void> {
  const { code } = await new Deno.Command(command, {
    args,
    ...options,
    stdout: "inherit",
    stderr: "inherit",
  }).output();
  if (code !== 0) throw new Stop(code);
}

/** Whether the tool exits 0, printing nothing; a tool not installed does not. */
export async function succeeds(
  command: string,
  args: string[],
  options: RunOptions = {},
): Promise<boolean> {
  try {
    const { code } = await new Deno.Command(command, {
      args,
      ...options,
      stdout: "null",
      stderr: "null",
    }).output();
    return code === 0;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

/** Whether this host can start the tool, whatever it then exits with. */
export async function hasCommand(command: string): Promise<boolean> {
  try {
    await new Deno.Command(command, {
      args: ["--version"],
      stdout: "null",
      stderr: "null",
    }).output();
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

/** The tool's exit code, and its stdout and stderr in the order they arrived, as `2>&1` reads. */
export async function merged(
  command: string,
  args: string[],
  options: RunOptions = {},
): Promise<{ code: number; output: string }> {
  const child = new Deno.Command(command, {
    args,
    ...options,
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const chunks: Uint8Array[] = [];
  const collect = async (stream: ReadableStream<Uint8Array>) => {
    for await (const chunk of stream) chunks.push(chunk);
  };
  const [{ code }] = await Promise.all([
    child.status,
    collect(child.stdout),
    collect(child.stderr),
  ]);
  const joined = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const chunk of chunks) {
    joined.set(chunk, at);
    at += chunk.length;
  }
  return { code, output: text.decode(joined).trimEnd() };
}

/** The non-empty lines of a tool's output. */
export function lines(output: string): string[] {
  return output.split("\n").filter((line) => line !== "");
}

/** The command a selection is made by, as a count prints it. */
export function scopeText(pathspecs: string[]): string {
  const base = "git ls-files --cached --others --exclude-standard";
  if (pathspecs.length === 0) return base;
  return `${base} -- ${pathspecs.map((spec) => `'${spec}'`).join(" ")}`;
}

/** The files the command of scopeText selects. */
export async function scopeFiles(
  pathspecs: string[],
  cwd?: string,
): Promise<string[]> {
  const pattern = pathspecs.length === 0 ? [] : ["--", ...pathspecs];
  return lines(
    await read(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", ...pattern],
      { cwd },
    ),
  );
}
