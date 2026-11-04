import { notFound } from "next/navigation";

import { SearchField } from "@/design/search-field";
import { Section } from "@/design/section";
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
  listUsers,
  parsePlanFilter,
  parseStatusFilter,
  parseUserId,
  type PlanId,
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
  summarizeOutcomes,
  summarizeWeeks,
  TodoView,
  UserFilters,
  type UserListAddress,
  userPageSizes,
  UserTable,
  UserView,
  usersHref,
  ViewSwitch,
  weekUsageDays,
} from "@/features/admin";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** The text of a search parameter, or "" when it is absent or repeated. */
function searchText(value: string | string[] | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/** The page of the users' list an address names, from 1; the first when it names none or no whole number. */
function pageNumber(value: string | string[] | undefined): number {
  return typeof value === "string" && /^[1-9]\d{0,4}$/.test(value) ? Number(value) : 1;
}

/** The users' list's address as [params] name it, each part its default where it names none it knows. */
function userListAddress(params: Record<string, string | string[] | undefined>): UserListAddress {
  const size = userPageSizes.find((known) => String(known) === params.size) ?? userPageSizes[0];
  const user = typeof params.user === "string" ? parseUserId(params.user) : null;
  return {
    query: searchText(params.q),
    plan: parsePlanFilter(params.plan),
    status: parseStatusFilter(params.status),
    page: pageNumber(params.page),
    size,
    user,
  };
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
  const [read, reports, timeZone] = await Promise.all([
    readNotes(shown.view, search),
    readOpenReports(),
    adminTimeZone(),
  ]);
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
          timeZone={timeZone}
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
  const address = userListAddress(await searchParams);
  const filter = { query: address.query, plan: address.plan, status: address.status };
  const [list, selected, timeZone] = await Promise.all([
    listUsers(filter, address.page - 1, address.size),
    address.user === null ? null : readUser(address.user),
    adminTimeZone(),
  ]);
  const user = selected !== null && !("failure" in selected) ? selected.data : null;
  const close = { ...address, user: null };
  return (
    <>
      <UserFilters address={address} />
      <div
        className={
          user === null
            ? "flex flex-col"
            : "grid items-start gap-section-gap lg:grid-cols-[minmax(0,1fr)_--spacing(90)] lg:gap-4"
        }
      >
        {/* Below 1024 px the user shown takes the list's place, as a page of its own would. */}
        <div className={user === null ? "contents" : "max-lg:hidden"}>
          {"failure" in list ? (
            <AdminFailureMessage failure={list.failure} />
          ) : (
            <UserTable page={list.data} address={address} timeZone={timeZone} />
          )}
        </div>
        {selected !== null && "failure" in selected && (
          <AdminFailureMessage failure={selected.failure} />
        )}
        {user !== null && (
          <aside aria-label={user.email} className="min-w-0 lg:sticky lg:top-8">
            <UserView user={user} timeZone={timeZone} panel={{ close: usersHref(close) }} />
          </aside>
        )}
      </div>
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

/** The users on each plan now, each read as the total of the users' list filtered by it. */
async function readPlanMembers(): Promise<Record<PlanId, number | null>> {
  const plans = ["free", "pro", "max", "special"] as const;
  const counts = await Promise.all(
    plans.map((plan) => listUsers({ query: "", plan, status: null }, 0, 1)),
  );
  const members: Record<PlanId, number | null> = {
    free: null,
    pro: null,
    max: null,
    special: null,
  };
  plans.forEach((plan, index) => {
    const read = counts[index];
    members[plan] = read === undefined || "failure" in read ? null : read.data.total;
  });
  return members;
}

export async function PlansContent() {
  const [read, configurations, members, timeZone] = await Promise.all([
    readPlanVersions(),
    readAiConfigurations(),
    readPlanMembers(),
    adminTimeZone(),
  ]);
  if ("failure" in read) return <AdminFailureMessage failure={read.failure} />;
  if ("failure" in configurations) {
    return <AdminFailureMessage failure={configurations.failure} />;
  }
  return (
    <PlansView
      versions={read.data}
      configurations={configurations.data}
      members={members}
      timeZone={timeZone}
    />
  );
}

export async function AiSettingsContent() {
  const [keys, configurations, labels, timeZone] = await Promise.all([
    readProviderKeys(),
    readAiConfigurations(),
    readPromptLabels(),
    adminTimeZone(),
  ]);
  const failed = (failure: AdminFailure) => <AdminFailureMessage failure={failure} />;
  if ("failure" in keys) return failed(keys.failure);
  if ("failure" in configurations) return failed(configurations.failure);
  if ("failure" in labels) return failed(labels.failure);
  // An admin's trial is served the test prompt while one is set (ADR 0073).
  const test = labels.data.find((label) => label.label === "test");
  const served = test ?? labels.data.find((label) => label.label === "active");
  return (
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
  );
}

/** 관리자: the form to grant the role, the admins, and the latest 100 admin writes. */
export async function AdminsContent() {
  const [admins, audit, timeZone] = await Promise.all([
    readAdmins(),
    readAuditLog(),
    adminTimeZone(),
  ]);
  return (
    <>
      <GrantAdminForm />
      {"failure" in admins ? (
        <AdminFailureMessage failure={admins.failure} />
      ) : (
        <AdminList admins={admins.data} timeZone={timeZone} />
      )}
      <Section label="작업 기록" note="최근 100건">
        {"failure" in audit ? (
          <AdminFailureMessage failure={audit.failure} />
        ) : (
          <AuditLog entries={audit.data} timeZone={timeZone} />
        )}
      </Section>
    </>
  );
}
