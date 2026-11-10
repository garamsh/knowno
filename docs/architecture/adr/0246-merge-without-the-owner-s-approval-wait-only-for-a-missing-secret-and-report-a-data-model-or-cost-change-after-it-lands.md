# ADR 0246: Merge without the owner's approval, wait only for a missing secret, and report a data, model or cost change after it lands

> Status: accepted
> Date: 2026-11-11

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #917**, the owner's decision of 2026-11-11 in the PM session: "앞으로 main 머지는 나의 허락 안받아도 돼." From now on no merge into `main` waits on the owner's approval.
- **The rule before it** was in [`server.md`](../server.md) §Location and migrations and §Edge Function deploys, each under "Gate": a migration that changes or deletes existing data, and a function change that needs a secret, changes a model or a call's cost, or starts spending, merged only after the owner approved. [ADR 0111](0111-preview-each-pull-request-s-migrations-on-synthetic-data-in-ci-and-keep-deploying-them-on-merge.md) set the migration half, and later ADRs applied or restated it.
- **Merging deploys.** Supabase's GitHub integration applies a migration and deploys a function when its pull request merges ([`server.md`](../server.md)), so what the Gate held back was the deploy, and what it protected were production data, a model's choice and cost, and a secret the deploy reads.

## Decision

- **No merge into `main` waits on the owner's approval.** The PM merges after review.
- **A secret the deploy needs still comes first.** A merge whose deploy needs a secret, or a new value of one, that the production project lacks waits until the secret is set, by the owner or the PM. This is a precondition of the deploy, not an approval: the deploy would otherwise run without it.
- **The owner is told after.** A merge that changes or deletes production data, or changes which model is called or a call's cost, is reported to the owner in the PM's report once it has landed. It is not asked before.
- **Supersedes** the owner's approval before merge in:
  - ADR 0111's "guard before merge" for a data-changing migration;
  - ADR 0034 §9's owner-marked steps pushed only after the owner approves;
  - ADR 0053's "the owner approves the pull request before it merges" and its covering the enabling of `pg_cron`;
  - ADR 0076's and ADR 0080's owner approval of a cost change, and ADR 0080's owner wait for a migration that changes what users are served;
  - ADR 0097's "a change of model changes cost, which is the owner's";
  - ADR 0245's merge only after the owner approves its migration.
- **The dated approvals stay as history:** ADR 0069's, 0072's, 0137's, 0182's and 0241's records that the owner approved a given change on a date are not rules and are not superseded.

## Alternatives considered

- **Keep the approval for a data-changing migration and drop it for functions.** The owner's words cover every merge into `main`, and a split would leave the Gate in two places with one reason.
- **Drop the secret precondition with the approval.** A merge deployed before its secret is set runs without it, which no approval made safe either; the wait is about the deploy, so it stays.
- **Report before the merge instead of after.** That is asking again under another name.

## Consequences

- **The PM's review is the only gate before a merge**, so a migration that changes data or a function that changes a call's cost must be correct as merged, with the preview and the eval as the evidence they already are.
- **The owner learns of a data, model or cost change from the PM's report**, after production runs it, and acts on it then.
- **Workers still make no change to the remote project.**

## Signs the decision was wrong

- A production migration that changed or deleted data wrongly is found in the owner's report and not in the review.
- A model or cost change reaches production and the owner's first sight of it is the bill.
- A merge deploys a function before its secret is set, and a request fails for the missing value.
