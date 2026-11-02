import { Search } from "lucide-react";
import { notFound } from "next/navigation";

import { parseDeckId } from "@/features/decks";

import {
  AdminFailureMessage,
  AdminList,
  adminTimeZone,
  AuditLog,
  extractionPageSize,
  OutcomesView,
  readExtractionCalls,
  readExtractionOutcomes,
  summarizeOutcomes,
  DeckView,
  GrantAdminForm,
  OverviewView,
  parseUserId,
  PlansView,
  PromptForm,
  PromptTrial,
  PromptVersions,
  PromptView,
  PublicDecks,
  readAdmins,
  readAuditLog,
  readDeck,
  readExtractionBreakdown,
  readOverview,
  readPlanVersions,
  readPromptVersion,
  readPromptVersions,
  readPublicDecks,
  readReportedDecks,
  readUser,
  searchUsersThrough,
  ReportedDecks,
  UserSearch,
  UserView,
  summarizeUsage,
} from "@/features/admin";

/** The text of a search parameter, or "" when it is absent or repeated. */
function searchText(value: string | string[] | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/** The last page of the user search an address names, 0 when it names none or no whole number. */
function pageIndex(value: string | string[] | undefined): number {
  return typeof value === "string" && /^\d{1,3}$/.test(value) ? Number(value) : 0;
}

export async function OverviewContent() {
  const [read, plans, breakdown] = await Promise.all([
    readOverview(),
    readPlanVersions(),
    readExtractionBreakdown(),
  ]);
  if ("failure" in read) return <AdminFailureMessage failure={read.failure} />;
  if ("failure" in plans) return <AdminFailureMessage failure={plans.failure} />;
  if ("failure" in breakdown) return <AdminFailureMessage failure={breakdown.failure} />;
  // A photo counted before calls were recorded is costed at the model of Free's current version.
  const free =
    plans.data.find((version) => version.plan === "free" && version.current)?.model ?? null;
  const today = new Date().toISOString().slice(0, 10);
  return <OverviewView overview={read.data} usage={summarizeUsage(breakdown.data, today, free)} />;
}

export async function ExtractionsContent({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const before = versionId((await searchParams).before);
  const [outcomes, calls, timeZone] = await Promise.all([
    readExtractionOutcomes(),
    readExtractionCalls(before),
    adminTimeZone(),
  ]);
  if ("failure" in outcomes) return <AdminFailureMessage failure={outcomes.failure} />;
  if ("failure" in calls) return <AdminFailureMessage failure={calls.failure} />;
  const today = new Date().toISOString().slice(0, 10);
  return (
    <OutcomesView
      summary={summarizeOutcomes(outcomes.data, today)}
      calls={calls.data}
      before={before}
      more={calls.data.length === extractionPageSize}
      timeZone={timeZone}
    />
  );
}

export async function PlansContent() {
  const [read, timeZone] = await Promise.all([readPlanVersions(), adminTimeZone()]);
  if ("failure" in read) return <AdminFailureMessage failure={read.failure} />;
  return <PlansView versions={read.data} timeZone={timeZone} />;
}

export async function ReportsContent() {
  const [read, timeZone] = await Promise.all([readReportedDecks(), adminTimeZone()]);
  if ("failure" in read) return <AdminFailureMessage failure={read.failure} />;
  return <ReportedDecks decks={read.data} timeZone={timeZone} />;
}

export async function PublicDecksContent({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const search = searchText((await searchParams).q);
  const [read, timeZone] = await Promise.all([readPublicDecks({ search }), adminTimeZone()]);
  return (
    <>
      <form role="search" action="/admin/decks" className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted"
          strokeWidth={2}
        />
        <input
          type="search"
          name="q"
          aria-label="노트 이름 검색"
          placeholder="노트 이름 검색"
          defaultValue={search}
          className="h-search w-full rounded-field border border-outline bg-surface pr-4 pl-12 text-body placeholder:text-muted focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-ink"
        />
      </form>
      {"failure" in read ? (
        <AdminFailureMessage failure={read.failure} />
      ) : (
        <PublicDecks
          decks={read.data}
          timeZone={timeZone}
          empty={
            search
              ? "찾는 노트가 없어요. 다른 단어로 검색해 보세요."
              : "공개된 노트가 없어요. 사용자가 노트를 공개하면 여기에 보여요."
          }
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

export async function UsersContent({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
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

export async function AdminsContent() {
  const [read, timeZone] = await Promise.all([readAdmins(), adminTimeZone()]);
  return (
    <>
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
  if ("failure" in read) return <AdminFailureMessage failure={read.failure} />;
  return <AuditLog entries={read.data} timeZone={timeZone} />;
}

/** A version's or an extraction's id in an address: digits only, as the server numbers them. */
function versionId(value: string | string[] | undefined): number | null {
  return typeof value === "string" && /^[1-9]\d{0,15}$/.test(value) ? Number(value) : null;
}

export async function PromptsContent({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [read, timeZone, from] = await Promise.all([
    readPromptVersions(),
    adminTimeZone(),
    searchParams.then((params) => versionId(params.from)),
  ]);
  if ("failure" in read) return <AdminFailureMessage failure={read.failure} />;
  const active = read.data.find((version) => version.labels.includes("active"));
  const test = read.data.find((version) => version.labels.includes("test"));
  // The form starts from the version the address names, or else the active one.
  const basis = from ?? active?.id ?? null;
  const start = basis === null ? null : await readPromptVersion(basis);
  if (start !== null && "failure" in start) return <AdminFailureMessage failure={start.failure} />;
  const served = test ?? active;
  return (
    <>
      {served !== undefined && <PromptTrial served={{ id: served.id, test: served === test }} />}
      <PromptForm
        key={basis}
        initialText={start?.data?.text ?? ""}
        basis={start?.data ? `버전 ${String(start.data.id)}` : "빈 프롬프트"}
      />
      <PromptVersions versions={read.data} timeZone={timeZone} />
    </>
  );
}

export async function PromptContent({ params }: { params: Promise<{ id: string }> }) {
  const id = versionId((await params).id);
  if (id === null) notFound();
  const [read, timeZone] = await Promise.all([readPromptVersion(id), adminTimeZone()]);
  if ("failure" in read) return <AdminFailureMessage failure={read.failure} />;
  if (read.data === null) notFound();
  return <PromptView version={read.data} timeZone={timeZone} />;
}
