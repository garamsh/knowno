# ADR 0180: Skip Vercel's build when none of the web build's inputs changed since the branch's last deployment

> Status: accepted
> Date: 2026-11-04

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #685.** Vercel built the web on every push to every branch and on every merge to `main`, including pushes that changed only `app/`, `supabase/` or `docs/`. The project had no Ignored Build Step. The PM measured 107 deployments in 24 hours on 2026-11-04 through the Vercel API: 29 production and 78 preview. That was over the Hobby plan's 100 a day, and previews then failed on the limit. 266 deployments were held under the 30-day retention.
- **[ADR 0030](0030-read-only-what-each-web-page-shows-and-size-the-web-from-the-app-tokens.md)** declared the region in `web/vercel.json`, "which holds nothing else". Its reason: a container never reads the file, so a key that changed behaviour would make Vercel and the container differ.
- **What Vercel documents** (each page read 2026-11-04):
  - [Project settings §Ignored Build Step](https://vercel.com/docs/project-configuration/project-settings#ignored-build-step), updated 2026-09-21: the command runs in the Root Directory, here `web`. Exit 0 aborts the build and marks the deployment `CANCELED`. Such a cancelled build still counts toward the deployment quotas and the concurrent build slots.
  - The [Ignored Build Step guide](https://vercel.com/kb/guide/how-do-i-use-the-ignored-build-step-field-on-vercel), updated 2026-10-16: an exit of 1 or more builds. Vercel clones the last 10 commits.
  - [`vercel.json` §ignoreCommand](https://vercel.com/docs/project-configuration/vercel-json#ignorecommand), updated 2026-08-14: the key overrides the project setting.
  - [System environment variables](https://vercel.com/docs/environment-variables/system-environment-variables), updated 2026-07-15: `VERCEL_GIT_PREVIOUS_SHA` is the commit of the branch's last successful deployment. It is empty on the branch's first deployment, and set only where an Ignored Build Step is.
- **What the build reads outside `web/`:**
  - `web/src/styles/fonts` links to `app/assets/fonts/`, which `next.config.ts` names in `turbopackAdditionalRoots`.
  - `web/src/features/study/engine-wasm` links to `engine-wasm/pkg/`, which `next.config.ts` names in `turbopackAdditionalRoots` and traces with `outputFileTracingIncludes`.
  - Tailwind's source detection skips the files git ignores, so the root `.gitignore` can change which files under `web/` it scans.
  - Nothing else: no import or CSS source leaves `web/`, and the repository root has no package manifest, lockfile or TypeScript configuration.
- **Alternatives considered:**
  - **Compare with `HEAD^`**, as Vercel's example does. A push of several commits would then be judged by its last commit alone, and a web change in an earlier one skipped. Rejected.
  - **A Deno program under `scripts/`**, as [ADR 0146](0146-write-repository-tooling-with-logic-as-deno-programs-and-keep-shell-under-30-lines-for-running-commands-in-order.md) asks of tooling with logic. Vercel's build host has no `deno`. Fetching one through `npx` on every deployment would add a download, a pin the repository records no checksum for, and a version apart from CI's. The decision is one `git diff`, whose exit codes are already Vercel's contract, so there is no logic to put in a program. Rejected.
  - **Vercel's skipping of unaffected projects in a monorepo.** Vercel documents that skip as not counting toward the limits. It needs npm, yarn, pnpm or Bun workspaces declared at the repository root ([Monorepos](https://vercel.com/docs/monorepos), updated 2026-08-11), and this repository has none. Its dependency graph would not see the two links either. Not taken.
  - **`git.deploymentEnabled` by branch name.** It turns off deployments whatever the push changed, so a branch that changes the web gets no preview. Not taken; whether to stop the cancelled builds counting is left to the owner.

## Decision

- **Vercel builds the web only when one of its inputs changed since the branch's last successful deployment.** `web/vercel.json`'s `ignoreCommand` is `git diff --quiet "$VERCEL_GIT_PREVIOUS_SHA" HEAD --` over these inputs, named from the Root Directory: `.`, `../app/assets/fonts`, `../engine-wasm/pkg` and `../.gitignore`.
- **Anything git cannot compare builds.** An empty previous commit (a branch's first deployment) and one outside Vercel's clone make `git diff` fail with 128, and Vercel builds on any exit above 0.
- **`web/vercel.json` holds `regions` and `ignoreCommand`, and nothing else.** This supersedes ADR 0030's "which holds nothing else" for `ignoreCommand` only. ADR 0030's reason stands: `ignoreCommand` decides whether Vercel builds and changes nothing the app does, so Vercel and the container still run the same app.
- **The input list is held to the build.** A test fails while a link under `web/` or an entry of `turbopackAdditionalRoots` points outside `web/` anywhere the command does not name.

## Consequences

- A push or merge that changes nothing the web build reads ends in a cancelled deployment, not a build. That saves the build's minutes but not the deployment count: Vercel counts a cancelled build toward the daily quota. A cancelled deployment is kept for 30 days on Hobby ([Deployment retention](https://vercel.com/docs/deployment-retention), updated 2026-09-16), and that page does not say how much storage one holds.
- The changes a cancelled build skipped are compared again at the next push, because `VERCEL_GIT_PREVIOUS_SHA` stays at the last successful deployment.
- A branch's first push always builds, even when it changes only `app/`. So does a push whose last deployment is more than 10 commits back.
- A change made only in Vercel's settings, such as an environment variable, reaches no commit. It is deployed by a redeploy from the dashboard with "Use project's Ignore Build Step" unchecked.
- A new place outside `web/` that the build reads has to be added to the command, and the test above says so for links and Turbopack roots.

## Signs the decision was wrong

- A deployment serves output older than its commit: a change the build reads, outside the four inputs, was skipped. That would mean the inputs were not complete, for example a new kind of read the test does not check, such as an `import` climbing out of `web/` or a Tailwind `@source`.
- Most deployments still build despite the skip, because most branches are pushed once and a first deployment always builds. The saving would then come only from merges to `main`.
- The cancelled deployments still exhaust the daily quota or storage. In that case the count, not the build, was the problem, and the skip of unaffected projects or `git.deploymentEnabled` should have been chosen instead.
- Vercel stops exposing `VERCEL_GIT_PREVIOUS_SHA`, or starts running the command elsewhere than the Root Directory, and every build runs or none does.
