import { notFound } from "next/navigation";

import { SearchField } from "@/design/search-field";
import { parseDeckId } from "@/features/decks";

import {
  AdminFailureMessage,
  type AdminFailure,
  AdminList,
  adminTimeZone,
  AiSettingsView,
  AiView,
  AuditLog,
  DeckView,
  extractionPageSize,
  GrantAdminForm,
  NoteList,
  type NoteView,
  outcomeDays,
  parseUserId,
  PlansView,
  PromptForm,
  PromptView,
  readAdmins,
  readAuditLog,
  readDeck,
  readExtractionBreakdown,
  readExtractionOutcomes,
  readAiConfigurations,
  readNotes,
  readOpenReports,
  readPlanVersions,
  readProviderKeys,
  readPromptLabels,
  readPromptVersion,
  readPromptVersions,
  readUser,
  readVersionCalls,
  readWeekActivity,
  searchUsersThrough,
  summarizeOutcomes,
  summarizeWeeks,
  TodoView,
  UserSearch,
  UserView,
  ViewSwitch,
  weekUsageDays,
} from "@/features/admin";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** The text of a search parameter, or "" when it is absent or repeated. */
function searchText(value: string | string[] | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/** The last page of the user search an address names, 0 when it names none or no whole number. */
function pageIndex(value: string | string[] | undefined): number {
  return typeof value === "string" && /^\d{1,3}$/.test(value) ? Number(value) : 0;
}

/** A version's or an extraction's id in an address: digits only, as the server numbers them. */
function versionId(value: string | string[] | undefined): number | null {
  return typeof value === "string" && /^[1-9]\d{0,15}$/.test(value) ? Number(value) : null;
}

/** Today's UTC day, the day the extraction reads count by. */
function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function TodoContent() {
  const [reports, failures, labels, week, breakdown, configurations] = await Promise.all([
    readOpenReports(),
    readExtractionOutcomes(7),
    readPromptLabels(),
    readWeekActivity(),
    readExtractionBreakdown(weekUsageDays),
    readAiConfigurations(),
  ]);
  if ("failure" in reports) return <AdminFailureMessage failure={reports.failure} />;
  if ("failure" in failures) return <AdminFailureMessage failure={failures.failure} />;
  if ("failure" in labels) return <AdminFailureMessage failure={labels.failure} />;
  if ("failure" in week) return <AdminFailureMessage failure={week.failure} />;
  if ("failure" in breakdown) return <AdminFailureMessage failure={breakdown.failure} />;
  if ("failure" in configurations) {
    return <AdminFailureMessage failure={configurations.failure} />;
  }
  // A photo counted before calls were recorded is costed at the model serving Free now.
  const free =
    configurations.data.find((c) => c.plan === "free" && c.label === "active")?.model ?? null;
  const today = utcToday();
  return (
    <TodoView
      reports={reports.data}
      failures={summarizeOutcomes(failures.data, today, 7).total}
      test={labels.data.find((label) => label.label === "test") ?? null}
      week={week.data}
      usage={summarizeWeeks(breakdown.data, today, free)}
    />
  );
}

const noteViews: readonly { view: NoteView; label: string; empty: string }[] = [
  {
    view: "reported",
    label: "신고된 노트",
    empty: "처리할 신고가 없어요. 새 신고가 들어오면 여기에 보여요.",
  },
  {
    view: "public",
    label: "모든 공개 노트",
    empty: "공개된 노트가 없어요. 사용자가 노트를 공개하면 여기에 보여요.",
  },
  { view: "hidden", label: "숨긴 노트", empty: "숨긴 노트가 없어요." },
];

/** The 노트 section's address for [view] and [search]; the reported view is the section's own. */
function notesHref(view: NoteView, search: string): string {
  const params = new URLSearchParams();
  if (view !== "reported") params.set("view", view);
  if (search !== "") params.set("q", search);
  const query = params.toString();
  return query === "" ? "/decks" : `/decks?${query}`;
}

export async function NotesContent({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const search = searchText(params.q);
  const shown = noteViews.find(({ view }) => view === params.view) ?? noteViews[0];
  if (shown === undefined) return null;
  const [read, reports] = await Promise.all([readNotes(shown.view, search), readOpenReports()]);
  return (
    <>
      <ViewSwitch
        label="노트 보기"
        views={noteViews.map(({ view, label }) => ({
          href: notesHref(view, search),
          label:
            view === "reported" && !("failure" in reports)
              ? `${label} ${String(reports.data.notes)}`
              : label,
          current: view === shown.view,
        }))}
      />
      <form role="search" action="/decks">
        {shown.view !== "reported" && <input type="hidden" name="view" value={shown.view} />}
        <SearchField label="노트 이름이나 만든 사람 이메일로 검색" name="q" defaultValue={search} />
      </form>
      {"failure" in read ? (
        <AdminFailureMessage failure={read.failure} />
      ) : (
        <NoteList
          notes={read.data}
          empty={search === "" ? shown.empty : "찾는 노트가 없어요. 다른 단어로 검색해 보세요."}
        />
      )}
    </>
  );
}

export async function DeckContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const deckId = parseDeckId(id);
  if (deckId === null) notFound();
  const [read, timeZone] = await Promise.all([readDeck(deckId), adminTimeZone()]);
  if ("failure" in read) return <AdminFailureMessage failure={read.failure} />;
  if (read.data === null) notFound();
  return <DeckView deck={read.data} timeZone={timeZone} />;
}

export async function UsersContent({ searchParams }: { searchParams: SearchParams }) {
  const { q, page } = await searchParams;
  const query = searchText(q);
  const shown = pageIndex(page);
  const timeZone = await adminTimeZone();
  // An address with a query opens on the pages it names, read on the server, so a search the
  // admin left for a user's page comes back as it was.
  const read = query === "" ? null : await searchUsersThrough(query, shown);
  return (
    <>
      <UserSearch
        initialQuery={query}
        initialPage={read === null || "failure" in read ? null : read.data}
        initialPageIndex={shown}
        timeZone={timeZone}
      />
      {read !== null && "failure" in read && <AdminFailureMessage failure={read.failure} />}
    </>
  );
}

export async function UserContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = parseUserId(id);
  if (userId === null) notFound();
  const [read, timeZone] = await Promise.all([readUser(userId), adminTimeZone()]);
  if ("failure" in read) return <AdminFailureMessage failure={read.failure} />;
  if (read.data === null) notFound();
  return <UserView user={read.data} timeZone={timeZone} />;
}

export async function AiContent() {
  const [versions, outcomes] = await Promise.all([
    readPromptVersions(),
    readExtractionOutcomes(outcomeDays),
  ]);
  if ("failure" in versions) return <AdminFailureMessage failure={versions.failure} />;
  if ("failure" in outcomes) return <AdminFailureMessage failure={outcomes.failure} />;
  const today = utcToday();
  const byVersion = (span: number) =>
    new Map(
      summarizeOutcomes(outcomes.data, today, span).versions.map(({ version, counts }) => [
        version,
        counts,
      ]),
    );
  return <AiView versions={versions.data} week={byVersion(7)} month={byVersion(outcomeDays)} />;
}

export async function NewPromptContent({ searchParams }: { searchParams: SearchParams }) {
  const [read, from] = await Promise.all([
    readPromptVersions(),
    searchParams.then((params) => versionId(params.from)),
  ]);
  if ("failure" in read) return <AdminFailureMessage failure={read.failure} />;
  const active = read.data.find((version) => version.labels.includes("active"));
  // The form starts from the version the address names, or else the active one.
  const basis = from ?? active?.id ?? null;
  const start = basis === null ? null : await readPromptVersion(basis);
  if (start !== null && "failure" in start) return <AdminFailureMessage failure={start.failure} />;
  return (
    <PromptForm
      key={basis}
      initialText={start?.data?.text ?? ""}
      basis={start?.data ? `버전 ${String(start.data.id)}` : "빈 프롬프트"}
    />
  );
}

export async function PromptContent({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  const id = versionId((await params).id);
  if (id === null) notFound();
  const before = versionId((await searchParams).before);
  const [read, outcomes, calls, timeZone] = await Promise.all([
    readPromptVersion(id),
    readExtractionOutcomes(outcomeDays),
    readVersionCalls(id, before),
    adminTimeZone(),
  ]);
  if ("failure" in read) return <AdminFailureMessage failure={read.failure} />;
  if (read.data === null) notFound();
  if ("failure" in outcomes) return <AdminFailureMessage failure={outcomes.failure} />;
  if ("failure" in calls) return <AdminFailureMessage failure={calls.failure} />;
  return (
    <PromptView
      version={read.data}
      results={summarizeOutcomes(
        outcomes.data.filter((row) => row.promptVersion === id),
        utcToday(),
      )}
      calls={calls.data}
      before={before}
      more={calls.data.length === extractionPageSize}
      timeZone={timeZone}
    />
  );
}

/** 설정's three pages, each an address of its own. */
function SettingsSwitch({ current }: { current: "plans" | "ai" | "admins" | "audit" }) {
  return (
    <ViewSwitch
      label="설정 보기"
      views={[
        { href: "/settings", label: "요금제", current: current === "plans" },
        { href: "/settings/ai", label: "AI 제공자", current: current === "ai" },
        { href: "/settings/admins", label: "관리자", current: current === "admins" },
        { href: "/settings/audit", label: "작업 기록", current: current === "audit" },
      ]}
    />
  );
}

export async function PlansContent() {
  const [read, timeZone] = await Promise.all([readPlanVersions(), adminTimeZone()]);
  return (
    <>
      <SettingsSwitch current="plans" />
      {"failure" in read ? (
        <AdminFailureMessage failure={read.failure} />
      ) : (
        <PlansView versions={read.data} timeZone={timeZone} />
      )}
    </>
  );
}

export async function AiSettingsContent() {
  const [keys, configurations, labels, timeZone] = await Promise.all([
    readProviderKeys(),
    readAiConfigurations(),
    readPromptLabels(),
    adminTimeZone(),
  ]);
  const failed = (failure: AdminFailure) => (
    <>
      <SettingsSwitch current="ai" />
      <AdminFailureMessage failure={failure} />
    </>
  );
  if ("failure" in keys) return failed(keys.failure);
  if ("failure" in configurations) return failed(configurations.failure);
  if ("failure" in labels) return failed(labels.failure);
  // An admin's trial is served the test prompt while one is set (ADR 0073).
  const test = labels.data.find((label) => label.label === "test");
  const served = test ?? labels.data.find((label) => label.label === "active");
  return (
    <>
      <SettingsSwitch current="ai" />
      <AiSettingsView
        keys={keys.data}
        configurations={configurations.data}
        prompt={
          served === undefined
            ? "사용 중인 버전"
            : `${test === undefined ? "사용 중" : "테스트"} 버전 ${String(served.versionId)}`
        }
        timeZone={timeZone}
      />
    </>
  );
}

export async function AdminsContent() {
  const [read, timeZone] = await Promise.all([readAdmins(), adminTimeZone()]);
  return (
    <>
      <SettingsSwitch current="admins" />
      <GrantAdminForm />
      {"failure" in read ? (
        <AdminFailureMessage failure={read.failure} />
      ) : (
        <AdminList admins={read.data} timeZone={timeZone} />
      )}
    </>
  );
}

export async function AuditContent() {
  const [read, timeZone] = await Promise.all([readAuditLog(), adminTimeZone()]);
  return (
    <>
      <SettingsSwitch current="audit" />
      {"failure" in read ? (
        <AdminFailureMessage failure={read.failure} />
      ) : (
        <AuditLog entries={read.data} timeZone={timeZone} />
      )}
    </>
  );
}
