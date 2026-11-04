import { notFound } from "next/navigation";

import { SearchField } from "@/design/search-field";
import { Section } from "@/design/section";
import { parseDeckId } from "@/features/decks";

import {
  AdminFailureMessage,
  type AdminFailure,
  AdminList,
  adminTimeZone,
  AiView,
  AuditLog,
  DeckView,
  GrantAdminForm,
  NoteList,
  type NoteView,
  listUsers,
  parsePlanFilter,
  parsePlanId,
  parseProvider,
  parseStatusFilter,
  parseUserId,
  type PlanId,
  PlansView,
  readAdmins,
  readAuditLog,
  readConfigurationResults,
  readDeck,
  readExtractionBreakdown,
  readExtractionOutcomes,
  readAiConfigurations,
  readNotes,
  readOpenReports,
  readPlanVersions,
  readProviderKeys,
  readPromptVersion,
  readPromptVersions,
  readUser,
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

/** A prompt version's id in an address: digits only, as the server numbers them. */
function versionId(value: string | string[] | undefined): number | null {
  return typeof value === "string" && /^[1-9]\d{0,15}$/.test(value) ? Number(value) : null;
}

/** Today's UTC day, the day the extraction reads count by. */
function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function TodoContent() {
  const [reports, failures, week, breakdown, configurations] = await Promise.all([
    readOpenReports(),
    readExtractionOutcomes(7),
    readWeekActivity(),
    readExtractionBreakdown(weekUsageDays),
    readAiConfigurations(),
  ]);
  if ("failure" in reports) return <AdminFailureMessage failure={reports.failure} />;
  if ("failure" in failures) return <AdminFailureMessage failure={failures.failure} />;
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
      drafts={configurations.data.filter((c) => c.label === "test").map((c) => c.plan)}
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

/**
 * The page of the users' list [named] asks for, or the last page, with the address naming it,
 * where the one asked for is past the end: a page past the end holds no row to carry the total.
 */
async function readUserPage(named: UserListAddress) {
  const filter = { query: named.query, plan: named.plan, status: named.status };
  const list = await listUsers(filter, named.page - 1, named.size);
  if (named.page === 1 || "failure" in list || list.data.users.length > 0) {
    return { list, address: named };
  }
  const total = await listUsers(filter, 0, 1);
  if ("failure" in total || total.data.total === 0) return { list: total, address: named };
  const page = Math.ceil(total.data.total / named.size);
  return { list: await listUsers(filter, page - 1, named.size), address: { ...named, page } };
}

export async function UsersContent({ searchParams }: { searchParams: SearchParams }) {
  const named = userListAddress(await searchParams);
  const [{ list, address }, selected, timeZone] = await Promise.all([
    readUserPage(named),
    named.user === null ? null : readUser(named.user),
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
          // Pinned beside a long list, it scrolls on its own, so its foot is never out of reach.
          <aside
            aria-label={user.email}
            className="min-w-0 lg:sticky lg:top-8 lg:-mx-1 lg:max-h-[calc(100dvh_-_--spacing(16))] lg:overflow-y-auto lg:px-1 lg:pb-2"
          >
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

/**
 * AI: each plan's configuration, the panel of the plan the address names, or else of the first plan
 * with a draft, or else Free's, the keys, the prompt versions and the results; with `write` in the
 * address, the new version's form, from the version it names or else the plan's active one.
 */
export async function AiContent({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const [configurations, versions, week, month, keys, timeZone] = await Promise.all([
    readAiConfigurations(),
    readPromptVersions(),
    readConfigurationResults(7),
    readConfigurationResults(30),
    readProviderKeys(),
    adminTimeZone(),
  ]);
  const failed = (failure: AdminFailure) => <AdminFailureMessage failure={failure} />;
  if ("failure" in configurations) return failed(configurations.failure);
  if ("failure" in versions) return failed(versions.failure);
  if ("failure" in week) return failed(week.failure);
  if ("failure" in month) return failed(month.failure);
  if ("failure" in keys) return failed(keys.failure);
  // The server lists the configurations in the plans' order, so the first draft is the first plan's.
  const plan =
    parsePlanId(params.plan) ?? configurations.data.find((c) => c.label === "test")?.plan ?? "free";
  const active = configurations.data.find((c) => c.plan === plan && c.label === "active");
  const draft = configurations.data.find((c) => c.plan === plan && c.label === "test");
  const compared =
    active !== undefined && draft !== undefined && active.promptVersionId !== draft.promptVersionId;
  // The form starts from the version the address names, or else the plan's active one.
  const basis =
    typeof params.write === "string" ? (versionId(params.write) ?? active?.promptVersionId) : null;
  const [before, after, start] = await Promise.all([
    compared ? readPromptVersion(active.promptVersionId) : null,
    compared ? readPromptVersion(draft.promptVersionId) : null,
    basis == null ? null : readPromptVersion(basis),
  ]);
  for (const read of [before, after, start]) {
    if (read !== null && "failure" in read) return failed(read.failure);
  }
  const text = (read: typeof before) => (read === null || "failure" in read ? null : read.data);
  const [from, to, written] = [text(before), text(after), text(start)];
  return (
    <AiView
      configurations={configurations.data}
      versions={versions.data}
      week={week.data}
      month={month.data}
      keys={keys.data}
      plan={plan}
      diff={from !== null && to !== null ? { before: from.text, after: to.text } : null}
      editing={parseProvider(params.key)}
      write={
        typeof params.write === "string"
          ? {
              text: written?.text ?? "",
              basis: written === null ? "빈 프롬프트" : `버전 ${String(written.id)}`,
            }
          : null
      }
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
