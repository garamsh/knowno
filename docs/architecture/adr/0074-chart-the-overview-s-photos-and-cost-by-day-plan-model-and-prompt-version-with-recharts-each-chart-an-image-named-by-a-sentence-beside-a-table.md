# ADR 0074: Chart the overview's photos and cost by day, plan, model and prompt version with Recharts, each chart an image named by a sentence beside a table

> Status: accepted; its overview charts, their tables and Recharts superseded by ADR-0155
> Date: 2026-10-19

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #234**, item 1, with the PM's scope:
  - the overview's extractions and estimated model cost per day over 30 days, as a bar or line chart;
  - cost per plan and per model, stacked, once each call records its plan and model;
  - totals for today, 7 days and 30 days;
  - "a chart library pinned per `ci.md`, accessible": each chart with a text summary or a table for screen readers, colours meeting `design.md`'s contrast, and never colour alone.
- **The PM's comment on the per-call record**: the overview and the charts break usage and cost down by prompt version.
- **Before this change** ([ADR 0071](0071-give-each-user-a-plan-whose-model-and-daily-limit-an-admin-sets-in-the-database-and-make-one-model-call-per-photo.md)), the overview showed today's photos and a table of 30 UTC days, every photo costed at the Free plan's model.
- **The per-call record** of [ADR 0073](0073-keep-the-extraction-prompt-as-append-only-versions-in-the-database-served-by-an-active-and-an-admin-only-test-label-and-record-what-served-each-call.md), `private.extraction_calls`, names each counted photo's plan, model and prompt version from its deploy on. Photos counted before it have none.
- **The web's existing charts**, on 기록, are hand-drawn, each "one `img` whose name states its values" ([`web.md`](../web.md)).
- **Recharts 3.10.1**, published 2026-07-25, the `latest` tag on npm on 2026-10-19:
  - its peer range takes React 19;
  - its README asks for `react-is` "to match the version of your installed `react` package";
  - its chart props include `responsive`, which sizes by CSS, and `accessibilityLayer`, which defaults to true;
  - `npm audit --omit=dev` found no vulnerability with it and `react-is` 19.3.1 installed.
- **Alternatives considered:**
  - **Hand-drawn SVG**, as on 기록. #234 asks for a library. Stacked bars with axes on two scales are more code to keep than the 기록 bars.
  - **A chart per series instead of a stack.** It needs no fill to tell series apart, but #234 asks for stacked cost, and seven small charts for seven models read worse than one stack.
  - **Recharts' own accessibility layer** as the only text. It makes the chart a keyboard-navigable application whose tooltip speaks one point at a time. A screen reader user gets the whole picture faster from one sentence and a table, which the 기록 charts already use.

## Decision

- **The data.** `public.admin_extraction_breakdown(days)` checks the role and returns each UTC day's photos over the last `days` days, today's included, from 1 to 90, by plan, model and prompt version. A photo counted before calls were recorded comes under none of the three.
  - The migration `20261019220000_extraction_breakdown.sql` adds only this function.
  - The overview reads it for 30 days. It no longer calls `admin_extractions_by_day`, nor reads `admin_overview`'s `extractions_today`; both stay in the database.
- **The cost.** Each photo is costed at its model's cost per photo measured by the eval (`model-costs.ts`). This supersedes ADR 0071's overview estimating every photo at the Free plan's model.
  - A photo without a call record is costed at the Free plan's model, as ADR 0071 costed every photo.
  - A photo whose model was never measured has no cost: totals and tables count it apart ("비용 모르는 n장"), and the note under the totals names the model.
- **What the overview shows**, under 사진 추출:
  - today's, the last 7 days' and the last 30 days' photos and cost;
  - each day's photos as bars and cost as a dashed line;
  - each day's cost stacked by plan, and stacked by model;
  - the 30 days' photos and cost by prompt version, each version linked to its page.
  - 사용자 and 학습 are unchanged.
- **Accessibility:**
  - Each chart is one element with the role `img`, named by a sentence of its totals: the busiest day for the daily chart, and each series' cost for a stack.
  - A table of every value follows each chart: every day's photos and cost, and each plan's, model's and version's.
  - Recharts' accessibility layer is off inside that image, so a screen reader reads the sentence and the table, not the chart's parts.
- **Not colour alone.** Every mark is drawn in the ink token, which meets [`design.md`](../design.md)'s contrast on the surface in both themes, as the 기록 charts' ink does.
  - The daily chart tells photos from cost by shape: bars against a dashed line with dots.
  - A stack tells its series by fill pattern, cycling through solid, diagonal stripes, dots, horizontal lines and a cross-hatch. A legend shows each pattern beside the series' name.
- **The library.** `recharts` 3.10.1 and `react-is` 19.3.1, matching `react` 19.3.1, are pinned exactly in `web/package.json` and locked, as every web package is. Dependabot's `npm` entry for `/web` proposes their moves.
  - The charts are client components in the admin feature, so the library loads only on the admin overview.

## Consequences

- An operator sees cost by plan, model and version without the dashboard, and a change in cost traces to the plan, model or version behind it.
- Days before the prompt store show their photos under 기록 전, costed at the Free plan's model.
- The admin overview's client bundle carries Recharts and its dependencies; no other page does.
- `react-is` must move with `react`. A Dependabot proposal for one alone leaves them unmatched until the other follows.

## Signs the decision was wrong

- Operators read the tables rather than the charts, and the charts add nothing.
- More than five models or plans appear in a stack, so the patterns repeat and the legend has to settle which series is which.
- Recharts' bundle slows the admin overview noticeably, or a Recharts release drops React 19.
- The estimated cost drifts from OpenRouter's billed cost, because the eval's per-photo cost no longer matches what production pays.
