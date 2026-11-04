# ADR 0155: Organise the admin area in five sections by the job to do, and show only what an operator acts on

> Status: accepted; its five-section menu above each page superseded by ADR-0178; its 설정 pages for 요금제, 관리자 and 작업 기록 superseded by ADR-0181
> Date: 2026-11-03

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #589**, the owner's request of 2026-11-03: "어드민 페이지좀 제대로… 사용이 복잡하지 않도록", "불필요한 내용도 빼고 직관적으로". The PM's mockup of five sections was approved.
- **The area before this change** had nine menu items, one for each table behind it: 개요, 신고, 공개 노트, 사용자, 요금제, 프롬프트, 추출 결과, 관리자 and 작업 기록 ([ADR 0070](0070-run-the-service-from-a-web-admin-area-whose-role-and-audit-log-live-in-the-database-and-whose-every-read-and-write-is-checked-there.md), [ADR 0073](0073-keep-the-extraction-prompt-as-append-only-versions-in-the-database-served-by-an-active-and-an-admin-only-test-label-and-record-what-served-each-call.md), [ADR 0130](0130-retry-a-failed-photo-once-within-one-usage-and-record-each-extraction-s-outcome.md)).
  - Handling one report meant moving through 신고, 공개 노트 and 사용자.
  - The overview drew four Recharts charts and three tables of cost ([ADR 0074](0074-chart-the-overview-s-photos-and-cost-by-day-plan-model-and-prompt-version-with-recharts-each-chart-an-image-named-by-a-sentence-beside-a-table.md)).
- **#589's constraints:**
  - No admin capability is lost.
  - Old addresses redirect.
  - Anything the new pages need is a new admin-only read in the database, checked as every admin read is.
  - Nothing is read with a service-role key.
- **Alternatives considered:**
  - Keeping the nine pages and adding a dashboard above them. Rejected: the jobs would still be split by table.
  - Clearing a note's reports when it is hidden, so that 숨기기 empties the queue. Rejected: it changes an existing write, which #589 leaves alone (only new reads). The open-report rule below gets the same result.

## Decision

- **Five sections**, by the job to do: 처리할 일 (`/admin`), 노트 (`/admin/decks`), 사용자 (`/admin/users`), 사진 AI (`/admin/ai`) and 설정 (`/admin/settings`).
- **처리할 일:**
  - Three cards, each with one action:
    - the open reports, with the oldest one's age;
    - the photo-reading failure rate over 7 UTC days, in `dont-know-text` over 5%;
    - the prompt under test, with its version and how many days it has been under test.
  - Then "이번 주": the last 7 days against the 7 before it.
    - New users, and the daily average of users who studied, are counted by study days in the admin's zone.
    - Photos read and their estimated cost are counted by UTC days.
  - A later queue, such as public-deck screening, takes a card of its own here.
- **An open report is a reported note that others can still see:** public, not hidden and not deleted.
  - Hiding a note (숨기기) or clearing its reports (문제없음) each takes it off the queue.
  - A note the trigger hid at three reports is under 숨긴 노트, with its report count.
  - The menu item 처리할 일 carries the count.
- **노트:**
  - One list in three views, 신고된 노트 n, 모든 공개 노트 and 숨긴 노트.
  - One search covers the note's name and its owner's email.
  - Each row has three actions, fixed in place:
    - 카드 보기;
    - 문제없음, which is disabled while the note has no report;
    - 숨기기, or 숨김 해제 on a hidden note.
  - Under ⋯ are 만든 사람 보기 and 공유에서 영구 삭제, which keeps its red final step. 비공개로 전환 stays on the note's page.
- **사용자:** the search, and one page per user:
  - the account's facts;
  - the plan, with its next renewal, the 1st at 00:00 Asia/Seoul, and 요금제 바꾸기, which opens the grant form and 무료로 되돌리기;
  - every note, each with its reports;
  - 이용 정지 or 정지 해제.
- **사진 AI:**
  - Three cards:
    - the active prompt, with its 7-day failure rate and 새 버전 쓰기;
    - the test prompt, with its 30-day rate and 모두에게 적용;
    - 사진 한 장으로 시험.
  - Then each saved version's 30-day results.
  - Each version opens `/admin/ai/[id]`, which holds the actions that serve it, its daily failure chart, its diff against the active version, its recorded calls a page at a time, and its text. The form for a new version is `/admin/ai/new`.
- **설정:** 요금제 (each plan's model is chosen here), 관리자 and 작업 기록, each an address of its own under one switch.
- **Removed:**
  - the overview's charts and its tables by day, plan, model and prompt version;
  - the outcome-by-kind count list and the 기록 없음 count;
  - `recharts` and `react-is`, which nothing else imports.
- **Four new admin reads**, in migration `20261102160718_admin_jobs.sql`, each checking the role:
  - `admin_note_list(view, search)`;
  - `admin_week_activity(time_zone)`;
  - `admin_prompt_labels()`;
  - `admin_version_calls(version_id, before, page_size)`.
  - `admin_overview`, `admin_reported_decks` and `admin_extraction_calls` lose their web caller and stay in the database.
- **The old addresses redirect behind the admin gate**, so a user who is not an admin still gets the not-found page:
  - `/admin/reports` goes to `/admin/decks`;
  - `/admin/plans`, `/admin/admins` and `/admin/audit` go to their 설정 pages;
  - `/admin/extractions` and `/admin/prompts` go to `/admin/ai`, and `/admin/prompts?from=` to `/admin/ai/new?from=`;
  - `/admin/prompts/[id]` goes to `/admin/ai/[id]`.
- **The look is the app's** ([ADR 0147](0147-draw-both-clients-in-cobalt-with-solid-surfaces-on-hard-edges-jua-for-what-we-write-and-pretendard-for-what-a-user-wrote.md)):
  - Cards and switches are solid surfaces on their edge.
  - The current section is in `accent` on the brand tint.
  - The buttons in a card or a row are outlined, a tap target high, in the `label` type, so a page keeps its one primary.

This supersedes ADR 0070's section menu, ADR 0073's 프롬프트 page as a section of its own, and ADR 0074's overview charts, their tables and Recharts.

## Consequences

- One click from 처리할 일 reaches each queue, and a note's report is handled from its row.
- The area makes four more reads, all small. The menu's count is read on every admin page, beside the role check.
- The cost by plan and by model is no longer drawn anywhere. A question about it is answered from the database until a page needs it again.
- The recent calls are per version. No page lists every version's calls together.

## Signs the decision was wrong

- Operators open 숨긴 노트 to find notes the trigger hid that still need a decision. That would mean the open-report rule should count them, and a write should clear reports on hide.
- An operator asks for the cost by plan or by model, or for the calls of every version together, more than once.
- The menu's count makes the area slow to open.
