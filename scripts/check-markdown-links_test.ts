// scripts/check-markdown-links.ts on repositories built in a temporary directory: each refusal is
// read beside the same link pointing at a file that exists.
import assert from "node:assert/strict";
import { linksIn, pathOf } from "./check-markdown-links.ts";
import { commit, program, repository, write } from "./testing.ts";

const SCOPE = "git ls-files --cached --others --exclude-standard -- '*.md'";

async function fixture(files: Record<string, string>): Promise<string> {
  const repo = await repository();
  for (const [path, content] of Object.entries(files)) {
    await write(repo, path, content);
  }
  await commit(repo, "main");
  return repo;
}

Deno.test("a link to a missing file fails with file:line and target, and passes once the file exists", async () => {
  const text = "# A\n\nSee [the ADR](adr/0228-x.md).\n";
  const broken = await fixture({ "docs/a.md": text });
  const failed = await program(broken, "check-markdown-links");
  assert.equal(failed.code, 1);
  assert.equal(
    failed.stdout,
    `docs/a.md:3: adr/0228-x.md does not exist\nchecked 1 relative links in 1 Markdown files, selected by: ${SCOPE}\n`,
  );

  const intact = await fixture({
    "docs/a.md": text,
    "docs/adr/0228-x.md": "# X\n",
  });
  const passed = await program(intact, "check-markdown-links");
  assert.equal(passed.code, 0, passed.stdout);
  assert.equal(
    passed.stdout,
    `checked 1 relative links in 2 Markdown files, selected by: ${SCOPE}\n`,
  );
});

Deno.test("a link resolves from the linking file's directory, not the root", async () => {
  const repo = await fixture({
    "docs/a.md": "[b](../b.md) [c](c.md)\n",
    "b.md": "# B\n",
  });
  const ran = await program(repo, "check-markdown-links");
  assert.equal(ran.code, 1);
  assert.ok(ran.stdout.startsWith("docs/a.md:1: c.md does not exist\n"));
  assert.ok(!ran.stdout.includes("../b.md"), ran.stdout);
});

Deno.test("a fragment on an existing file passes whatever its heading, and one on a missing file fails", async () => {
  const repo = await fixture({
    "a.md": "[x](b.md#no-such-heading) [y](#here) [z](b.md?plain=1)\n",
    "b.md": "# B\n",
  });
  const passed = await program(repo, "check-markdown-links");
  assert.equal(passed.code, 0, passed.stdout);

  const missing = await fixture({ "a.md": "[x](gone.md#top)\n" });
  const failed = await program(missing, "check-markdown-links");
  assert.equal(failed.code, 1);
  assert.ok(failed.stdout.startsWith("a.md:1: gone.md#top does not exist\n"));
});

Deno.test("a link that is an absolute URL is ignored, beside a relative one that fails", async () => {
  const urls = await fixture({
    "a.md":
      "[w](https://example.com/x.md) [h](http://e.com/y) [m](mailto:a@b.c) [r](/rooted.md)\n",
  });
  const passed = await program(urls, "check-markdown-links");
  assert.equal(passed.code, 0, passed.stdout);
  assert.equal(
    passed.stdout,
    `checked 0 relative links in 1 Markdown files, selected by: ${SCOPE}\n`,
  );

  const relative = await fixture({ "a.md": "[w](example.com/x.md)\n" });
  assert.equal((await program(relative, "check-markdown-links")).code, 1);
});

Deno.test("images, titles, angle brackets and encoded names are followed", async () => {
  const repo = await fixture({
    "a.md":
      '![i](img/p.png) [t](b.md "title") [<](<c d.md>) [e](c%20d.md) [p](e(1).md)\n',
    "b.md": "# B\n",
    "c d.md": "# C\n",
    "e(1).md": "# E\n",
  });
  const ran = await program(repo, "check-markdown-links");
  assert.equal(ran.code, 1);
  assert.equal(
    ran.stdout,
    `a.md:1: img/p.png does not exist\nchecked 5 relative links in 4 Markdown files, selected by: ${SCOPE}\n`,
  );
});

Deno.test("a link in a code span or fenced code is not a link", () => {
  const found = linksIn(
    [
      "a `[x](gone.md)` b [real](here.md)",
      "```md",
      "[y](gone.md)",
      "```",
      "~~~",
      "[z](gone.md)",
      "~~~",
      "[after](later.md)",
    ].join("\n"),
  );
  assert.deepEqual(found, [
    { line: 1, target: "here.md" },
    { line: 8, target: "later.md" },
  ]);
});

Deno.test("pathOf drops the fragment and query, and skips what is not a relative path", () => {
  assert.equal(pathOf("a/b.md#c"), "a/b.md");
  assert.equal(pathOf("a%20b.md"), "a b.md");
  assert.equal(pathOf("#c"), undefined);
  assert.equal(pathOf("https://x.y"), undefined);
  assert.equal(pathOf("/x.md"), undefined);
});

Deno.test("fails when the repository tracks no Markdown file", async () => {
  const repo = await fixture({ "a.txt": "x\n" });
  const ran = await program(repo, "check-markdown-links");
  assert.equal(ran.code, 1);
  assert.equal(ran.stderr, "no file was read\n");
});
