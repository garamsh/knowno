# ADR 0181: List every user in admin as a paged table filtered by plan and status, with the one chosen beside it, and give 요금제 and 관리자 a page each

> Status: accepted
> Date: 2026-11-04

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #651**, the PM's decisions on the owner-approved mockup of issue #648 (the Artifact `BkwXdRvfhpcLcg8ze7VUHE`): 사용자 opens on the full list as a table, with a page-size select of 20, 50 or 100 above it and a pager showing only "1–20 / N" and the page numbers; it is searched and filtered by plan and status; a row opens the user's detail in a side panel, and below 1024 px the list is cards (the mockup's "목록: 줄 대신 카드") and the detail a page. On the phone the mockup's pager is "1 / 65" with the arrows. 노트 is a table per view; 요금제 shows each plan's limits with its AI configuration linked to AI, not edited there; 관리자 holds the admins and the latest 100 audit entries.
- **Before this change** ([ADR 0072](0072-suspend-a-user-through-supabase-auth-s-ban-and-restrictive-write-policies-remove-a-public-deck-from-sharing-for-good-and-read-any-deck-in-the-admin-area.md), [ADR 0155](0155-organise-the-admin-area-in-five-sections-by-the-job-to-do-and-show-only-what-an-operator-acts-on.md), [ADR 0178](0178-serve-the-admin-area-at-admin-knowno-app-from-the-same-web-app-routed-by-host-in-its-own-shell-and-session.md)):
  - 사용자 showed nothing until the admin typed, and `admin_search_users` found no one for a blank search; "더 보기" added 20 at a time; a user opened on a page of its own;
  - 요금제, 관리자 and 작업 기록 were three of 설정's four pages under a switch, at `/settings`, `/settings/admins` and `/settings/audit`.
- **No price exists.** Billing has not started (issue #599), so no table or store product holds a price; the mockup's 가격 column has no source. The PM decided on 2026-11-04 to leave it out until #599.
- **Alternatives considered:**
  - **Paging the list in the browser over one read of every user.** The list grows with the service, and the filters by plan need each user's entitlement, which only the database resolves. Rejected for a server function that pages.
  - **Keeping `admin_search_users` beside the new read.** Nothing calls it once the list reads through `admin_users`. Rejected: it is dropped in the same migration, its revert in the header.
  - **The side panel as a parallel route.** `stack-nextjs.md` §10's intercepted route keeps a modal shareable, but the panel is not a modal: it sits beside the list, and below 1024 px takes the list's place. One page reading the chosen user from the address's `user` does both with no second route. Taken.
  - **Two drawings of the list, a table from 1024 px and rows below.** Two copies of the same data drift, and every test would read each user twice. Rejected for one table whose rows become cards below 1024 px.
  - **Moving 작업 기록 to a page of its own under 관리자.** The decision puts both on one page. Rejected.

## Decision

- **사용자** (`/users`) lists every user who is not anonymous as a table, newest sign-up first: the email, the sign-up, the last study, notes, cards, the plan and the state (관리자, 정지됨). Above it, the email search, applied 250 ms after the last keystroke, a plan filter, a status filter (이용 중, 정지됨) and a page-size select (20, 50 or 100) each replace the address on the first page; the pager under it shows "first–last / total" and the pages around the current one from 1024 px, and below it "page / pages" with the arrows alone. A page past the last shows the last. The address holds `q`, `plan`, `status`, `size` and `page`, each left out at its default, and a part the list does not know reads as its default.
- A row opens its user beside the list through the address's `user`, with quiet icon links to close it and to the user's own page (`/users/[id]`), which stays; below 1024 px the user takes the list's place. 요금제 바꾸기 and 무료로 되돌리기 are rows ending the plan's group, and 이용 정지 or 정지 해제 sits last in its own section, each asking in the shared sheet; 요금제 바꾸기's sheet has the one primary, 지정, so the panel itself holds no raised button.
- The list reads through `admin_users(query, plan, status, page_size, page_offset)`, which checks the role and pages in the database. 요금제 counts each plan's users by the same read.
- **노트** draws each view as a table: the note with its chips and reasons, its owner, cards, copies, first report, its count of reports and its actions.
- **요금제** (`/plans`) is a page of its own: a table of the four plans with the terms a user subscribing now takes, the active AI configuration linked to AI, and the users on it, and nothing else open: a plan's "한도 바꾸기" opens its versions and its form for a new version in the shared sheet, whose one primary is 만들기. It shows no price until billing exists.
- **관리자** (`/admins`) is a page of its own: the grant form, the admins, and the latest 100 admin writes.
- 설정's switch goes. `/settings` redirects to `/plans`, and `/settings/admins`, `/settings/audit` and `/audit` to `/admins`; AI 제공자 stays at `/settings/ai` under AI until issue #650 draws AI as one section.
- The tables are one frame, `design/frames.md` §Table, drawn by `admin-table.tsx`: from 1024 px a table, below it a card per row, each value named.

## Consequences

- An admin sees the users at once and narrows them, instead of guessing an email.
- The list costs one entitlement resolution per matching user per page; `server.md` names when an index or a stored plan is added.
- A link into `/settings`, `/settings/admins` or `/settings/audit` keeps working through the redirects.
- The users' page reads the chosen user beside the list on each row's press, a server read as the user's own page was.

## Signs the decision was wrong

- `admin_users` among the ten statements of highest total time while the admin area is the only caller: the plan must be stored, not resolved per row.
- Operators opening `/users/[id]` from the panel more often than they use the panel: the panel holds too little, or the wrong things.
- A price on 요금제 asked for before billing exists: the decision to leave it out until #599 is revisited.
