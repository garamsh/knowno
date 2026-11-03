import { http, HttpResponse } from "msw";

import { bearerUser, otherUser, supabaseUrl, testUser } from "./handlers";

type Row = Record<string, unknown>;

/** A deck as the admin functions see it, its cards' sides as plain text. */
export type FakeDeck = {
  id: string;
  name: string;
  ownerId: string;
  visibility: "public" | "private";
  hidden: boolean;
  deleted: boolean;
  description: string | null;
  copies: number;
  publishedAt: string | null;
  cards: { id: string; front: string | unknown[]; back: string | unknown[] }[];
  reports: { reason: string; at: string }[];
};

/** A user as the admin functions see it. */
export type FakeUser = {
  id: string;
  email: string;
  createdAt: string;
  lastAnswerAt: string | null;
  decks: number;
  cards: number;
  extractionsToday: number;
};

const text = (value: string | unknown[]) =>
  typeof value === "string" ? [{ type: "text", payload: { text: value } }] : value;

/**
 * The server's admin functions (ADR 0070), in memory: each answers for a signed-in admin and
 * refuses anyone else with `42501`, as `private.require_admin` does, and every write is recorded
 * in [audit] as the server records it. [testUser] is the one admin until a test says otherwise;
 * [otherUser] is not one.
 */
/** One plan version, as `private.plan_versions` holds it. */
type FakePlanVersion = {
  id: number;
  plan: string;
  quota: string;
  /** Null for 스페셜's quota, none. */
  amount: number | null;
  starts_at: string;
  applies_to_all: boolean;
  created_by: string | null;
};

/** A version of [plan] from [startsAt], for existing users at their renewal. */
function version(
  id: number,
  plan: string,
  quota: string,
  amount: number | null,
  startsAt: string,
): FakePlanVersion {
  return {
    id,
    plan,
    quota,
    amount,
    starts_at: startsAt,
    applies_to_all: false,
    created_by: null,
  };
}

export class FakeAdmin {
  readonly admins = new Map<string, { grantedAt: string; grantedBy: string | null }>([
    [testUser.id, { grantedAt: "2026-10-19T00:00:00Z", grantedBy: null }],
  ]);
  readonly users: FakeUser[] = [
    {
      id: testUser.id,
      email: testUser.email,
      createdAt: "2026-10-01T00:00:00Z",
      lastAnswerAt: null,
      decks: 0,
      cards: 0,
      extractionsToday: 0,
    },
    {
      id: otherUser.id,
      email: otherUser.email,
      createdAt: "2026-10-15T00:00:00Z",
      lastAnswerAt: "2026-10-18T09:30:00Z",
      decks: 2,
      cards: 3,
      extractionsToday: 4,
    },
  ];
  readonly decks: FakeDeck[] = [];
  readonly audit: Row[] = [];
  /** What `admin_week_activity` answers: the last 7 study days and the 7 before. */
  weekActivity: Row = { new_users_this: 1, new_users_last: 0, studied_this: 7, studied_last: 14 };
  /** The rows `admin_extraction_breakdown` answers: each UTC day's photos by plan, model and version. */
  breakdown: Row[] = [];
  /**
   * The recorded calls, newest first, as the server orders them, each with the version that served
   * it; `admin_version_calls` pages through one version's.
   */
  extractionCalls: Row[] = [];
  /** The rows `admin_extraction_failures` answers: each UTC day's counts by prompt version. */
  extractionFailures: Row[] = [];
  /**
   * The plan versions, oldest first: each plan's settings before versions, and the owner's terms
   * after them, as the migration makes them of the seed. A plan's current version is its latest
   * started; this substitute knows no renewal, which the database tests cover.
   */
  readonly planVersions: FakePlanVersion[] = [
    version(1, "free", "daily", 30, "2026-10-19T00:00:00Z"),
    version(2, "pro", "daily", 30, "2026-10-19T00:00:00Z"),
    version(3, "max", "daily", 30, "2026-10-19T00:00:00Z"),
    version(4, "free", "monthly", 10, "2026-10-26T00:00:00Z"),
    { ...version(5, "pro", "daily", 100, "2026-10-26T00:00:00Z"), applies_to_all: true },
    { ...version(6, "max", "unlimited", 1000, "2026-10-26T00:00:00Z"), applies_to_all: true },
    version(7, "special", "none", null, "2026-11-03T00:00:00Z"),
  ];
  /**
   * The saved AI configurations (ADR 0162), each plan's active one first as the migration seeds
   * them, and any draft an admin saved through extract-cards, labelled `test`.
   */
  readonly aiConfigurations: {
    id: number;
    plan: string;
    label: "active" | "test";
    provider: string;
    model: string;
    created_by: string | null;
  }[] = ["free", "pro", "max", "special"].map((plan, index) => ({
    id: index + 1,
    plan,
    label: "active",
    provider: "openrouter",
    model: "anthropic/claude-haiku-5.5",
    created_by: null,
  }));
  /** The providers whose key Vault holds, with its last four characters; never the key. */
  readonly providerKeys = new Map<string, { lastFour: string; setBy: string }>();
  /** Whether the admin's session is from a sign-in within the last 10 minutes. */
  recentSignIn = true;
  /** The saved prompt versions, oldest first; the seed, prompt v8, is version 1. */
  readonly prompts: { id: number; text: string; note: string; by: string | null }[] = [
    { id: 1, text: "Prompt v8.\nKeep each fact.", note: "prompt v8", by: null },
  ];
  /** The version each label names; no `test` while none is set. */
  readonly promptLabels = new Map<"active" | "test", number>([["active", 1]]);
  /** When each label was last set. */
  readonly promptLabelsSetAt = new Map<"active" | "test", string>([
    ["active", "2026-10-19T04:00:00Z"],
  ]);
  /** Each suspended user's suspension. */
  readonly suspensions = new Map<string, { reason: string; by: string }>();
  /** Each deck removed from sharing, and why. */
  readonly removals = new Map<string, string>();
  /** Each user's grant of a plan other than Free. */
  readonly userPlans = new Map<
    string,
    { plan: string; endsAt: string | null; grantedBy: string | null }
  >();
  /** The functions called, as `<name> <args as JSON>`. */
  readonly calls: string[] = [];

  /** Adds [deck] to the server. */
  seedDeck(deck: Partial<FakeDeck> & Pick<FakeDeck, "id" | "name">) {
    this.decks.push({
      ownerId: otherUser.id,
      visibility: "public",
      hidden: false,
      deleted: false,
      description: null,
      copies: 0,
      publishedAt: "2026-10-17T00:00:00Z",
      cards: [],
      reports: [],
      ...deck,
    });
  }

  private owner(deck: FakeDeck): Row {
    const user = this.users.find((candidate) => candidate.id === deck.ownerId);
    return { owner_id: deck.ownerId, owner_email: user?.email ?? "", owner_name: null };
  }

  private promptRow(prompt: FakeAdmin["prompts"][number]): Row {
    return {
      id: prompt.id,
      note: prompt.note,
      length: prompt.text.length,
      created_by_email: this.users.find((user) => user.id === prompt.by)?.email ?? null,
      created_at: "2026-10-19T04:00:00Z",
      labels: (["active", "test"] as const).filter(
        (label) => this.promptLabels.get(label) === prompt.id,
      ),
    };
  }

  private reasons(deck: FakeDeck): string[] {
    return [...new Set(deck.reports.map((report) => report.reason))].sort();
  }

  private record(admin: string, action: string, kind: string, target: string, detail: Row) {
    this.audit.unshift({
      id: this.audit.length + 1,
      created_at: "2026-10-19T03:00:00Z",
      admin_email: this.users.find((user) => user.id === admin)?.email ?? "",
      action,
      target_kind: kind,
      target_id: target,
      detail,
    });
  }

  /** [plan]'s version a user subscribing at [at] takes: the latest started by then. */
  private currentVersion(plan: string, at = Date.now()): FakePlanVersion | undefined {
    return this.planVersions
      .filter((entry) => entry.plan === plan && Date.parse(entry.starts_at) <= at)
      .sort((a, b) => Date.parse(b.starts_at) - Date.parse(a.starts_at) || b.id - a.id)[0];
  }

  /** What each function answers for [admin], given its arguments. */
  private answer(name: string, args: Row, admin: string): unknown {
    const deckOf = (id: unknown) => this.decks.find((deck) => deck.id === id);
    switch (name) {
      case "admin_week_activity":
        return [this.weekActivity];
      case "admin_extraction_breakdown":
        return this.breakdown;
      case "admin_version_calls": {
        const before = typeof args.before === "number" ? args.before : null;
        const size = Math.min(Math.max(Number(args.page_size ?? 50), 1), 500);
        return this.extractionCalls
          .filter((call) => call.prompt_version_id === args.version_id)
          .filter((call) => before === null || Number(call.usage_id) < before)
          .slice(0, size)
          .map(({ prompt_version_id: _version, ...call }) => call);
      }
      case "admin_extraction_failures":
        return this.extractionFailures;
      case "admin_note_list": {
        const view = args.view;
        if (view !== "reported" && view !== "public" && view !== "hidden") {
          throw new Error(`admin_note_list knows no view ${String(view)}`);
        }
        const search = typeof args.search === "string" ? args.search.toLowerCase() : "";
        const first = (deck: FakeDeck) => deck.reports.map((report) => report.at).sort()[0] ?? null;
        return this.decks
          .filter((deck) => deck.visibility === "public" && !deck.deleted)
          .filter((deck) =>
            view === "reported"
              ? !deck.hidden && deck.reports.length > 0
              : view === "hidden"
                ? deck.hidden
                : true,
          )
          .filter(
            (deck) =>
              deck.name.toLowerCase().includes(search) ||
              String(this.owner(deck).owner_email).toLowerCase().includes(search),
          )
          .toSorted((a, b) =>
            view === "reported"
              ? (first(a) ?? "").localeCompare(first(b) ?? "")
              : view === "hidden"
                ? b.reports.length - a.reports.length
                : (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""),
          )
          .map((deck) => ({
            deck_id: deck.id,
            name: deck.name,
            ...this.owner(deck),
            hidden: deck.hidden,
            cards: deck.cards.length,
            copy_count: deck.copies,
            reports: deck.reports.length,
            reasons: this.reasons(deck),
            first_reported_at: first(deck),
            published_at: deck.publishedAt,
          }));
      }
      case "admin_public_decks": {
        const search = typeof args.search === "string" ? args.search.toLowerCase() : "";
        return this.decks
          .filter((deck) => deck.visibility === "public" && !deck.deleted)
          .filter((deck) => (typeof args.owner === "string" ? deck.ownerId === args.owner : true))
          .filter((deck) => deck.name.toLowerCase().includes(search))
          .map((deck) => ({
            deck_id: deck.id,
            name: deck.name,
            ...this.owner(deck),
            hidden: deck.hidden,
            cards: deck.cards.length,
            copy_count: deck.copies,
            reports: deck.reports.length,
            published_at: deck.publishedAt,
          }));
      }
      case "admin_user": {
        const user = this.users.find((candidate) => candidate.id === args.user_id);
        if (!user) return [];
        return [
          {
            id: user.id,
            email: user.email,
            created_at: user.createdAt,
            last_answer_at: user.lastAnswerAt,
            decks: user.decks,
            cards: user.cards,
            extractions_today: user.extractionsToday,
            admin: this.admins.has(user.id),
          },
        ];
      }
      case "admin_admins":
        return [...this.admins].map(([id, grant]) => ({
          user_id: id,
          email: this.users.find((user) => user.id === id)?.email ?? "",
          granted_at: grant.grantedAt,
          granted_by_email: this.users.find((user) => user.id === grant.grantedBy)?.email ?? null,
        }));
      case "admin_audit_log":
        return this.audit;
      case "admin_search_users": {
        const query = typeof args.query === "string" ? args.query.trim().toLowerCase() : "";
        if (query === "") return [];
        const matches = this.users
          .filter((user) => user.email.toLowerCase().includes(query))
          .toSorted(
            (a, b) =>
              Number(!a.email.toLowerCase().startsWith(query)) -
                Number(!b.email.toLowerCase().startsWith(query)) || a.email.localeCompare(b.email),
          );
        const offset = Number(args.page_offset ?? 0);
        return matches.slice(offset, offset + Number(args.page_size ?? 20)).map((user) => ({
          user_id: user.id,
          email: user.email,
          created_at: user.createdAt,
          suspended: this.suspensions.has(user.id),
          total: matches.length,
        }));
      }
      case "admin_user_suspension": {
        const suspension = this.suspensions.get(String(args.user_id));
        if (!suspension) return [];
        return [
          {
            reason: suspension.reason,
            suspended_at: "2026-10-19T03:00:00Z",
            suspended_by_email: this.users.find((user) => user.id === suspension.by)?.email ?? null,
          },
        ];
      }
      case "admin_suspend_user": {
        const id = String(args.user_id);
        const user = this.users.find((candidate) => candidate.id === id);
        if (!user) return "no_user";
        if (id === admin) return "self";
        if (this.suspensions.has(id)) return "already";
        const reason = String(args.reason).trim();
        this.suspensions.set(id, { reason, by: admin });
        this.record(admin, "suspend_user", "user", id, { email: user.email, reason });
        return "suspended";
      }
      case "admin_unsuspend_user": {
        const id = String(args.user_id);
        if (!this.suspensions.delete(id)) return false;
        this.record(admin, "unsuspend_user", "user", id, {
          email: this.users.find((user) => user.id === id)?.email ?? "",
        });
        return true;
      }
      case "admin_user_decks":
        return this.decks
          .filter((deck) => deck.ownerId === args.user_id && !deck.deleted)
          .map((deck) => ({
            deck_id: deck.id,
            name: deck.name,
            visibility: deck.visibility,
            hidden: deck.hidden,
            removed: this.removals.has(deck.id),
            cards: deck.cards.length,
            created_at: "2026-10-17T00:00:00Z",
          }));
      case "admin_user_deck": {
        const deck = deckOf(args.deck_id);
        if (!deck) return [];
        const removal = this.removals.get(deck.id);
        return [
          {
            id: deck.id,
            name: deck.name,
            description: deck.description,
            ...this.owner(deck),
            visibility: deck.visibility,
            hidden: deck.hidden,
            deleted: deck.deleted,
            copy_count: deck.copies,
            reports: deck.reports.length,
            reasons: this.reasons(deck),
            removal_reason: removal ?? null,
            removed_at: removal === undefined ? null : "2026-10-19T03:00:00Z",
          },
        ];
      }
      case "admin_user_deck_cards": {
        const deck = deckOf(args.deck_id);
        if (!deck) return [];
        return deck.cards.map((card) => ({
          card_id: card.id,
          front: text(card.front),
          back: text(card.back),
        }));
      }
      case "admin_remove_deck": {
        const deck = deckOf(args.deck_id);
        if (!deck || this.removals.has(deck.id)) return false;
        const reason = String(args.reason).trim();
        this.removals.set(deck.id, reason);
        deck.visibility = "private";
        this.record(admin, "remove_deck", "deck", deck.id, { name: deck.name, reason });
        return true;
      }
      case "admin_prompt_labels":
        return (["active", "test"] as const).flatMap((label) => {
          const version = this.promptLabels.get(label);
          return version === undefined
            ? []
            : [{ label, version_id: version, set_at: this.promptLabelsSetAt.get(label) }];
        });
      case "admin_prompt_versions":
        return this.prompts.toReversed().map((prompt) => this.promptRow(prompt));
      case "admin_prompt_version": {
        const prompt = this.prompts.find((candidate) => candidate.id === args.version_id);
        if (!prompt) return [];
        const active = this.prompts.find((p) => p.id === this.promptLabels.get("active"));
        return [
          {
            ...this.promptRow(prompt),
            text: prompt.text,
            active_id: active?.id ?? null,
            active_text: active?.text ?? null,
          },
        ];
      }
      case "admin_save_prompt": {
        const text = String(args.text);
        const id = (this.prompts.at(-1)?.id ?? 0) + 1;
        const note = String(args.note).trim();
        this.prompts.push({ id, text, note, by: admin });
        this.record(admin, "save_prompt", "prompt", String(id), { note, length: text.length });
        return id;
      }
      case "admin_set_prompt_label": {
        const label = args.label === "test" ? "test" : "active";
        const id = Number(args.version_id);
        const previous = this.promptLabels.get(label) ?? null;
        if (previous === id) return false;
        this.promptLabels.set(label, id);
        this.promptLabelsSetAt.set(label, new Date().toISOString());
        const cleared = label === "active" && this.promptLabels.get("test") === id;
        if (cleared) this.promptLabels.delete("test");
        this.record(
          admin,
          label === "active" ? "activate_prompt" : "test_prompt",
          "prompt",
          String(id),
          {
            previous,
            test_cleared: cleared,
          },
        );
        return true;
      }
      case "admin_clear_test_prompt": {
        const test = this.promptLabels.get("test");
        if (test === undefined) return false;
        this.promptLabels.delete("test");
        this.record(admin, "clear_test_prompt", "prompt", String(test), {});
        return true;
      }
      case "admin_ai_session":
        return this.recentSignIn;
      case "admin_provider_keys":
        return ["openrouter", "openai", "anthropic"].map((provider) => {
          const key = this.providerKeys.get(provider);
          return {
            provider,
            last_four: key?.lastFour ?? null,
            set_at: key ? "2026-11-03T01:00:00Z" : null,
            set_by_email: this.users.find((user) => user.id === key?.setBy)?.email ?? null,
            in_use: this.aiConfigurations.some(
              (entry) => entry.label === "active" && entry.provider === provider,
            ),
          };
        });
      case "admin_ai_configurations":
        return this.aiConfigurations.map((entry) => ({
          plan: entry.plan,
          label: entry.label,
          configuration_id: entry.id,
          provider: entry.provider,
          model: entry.model,
          created_at: "2026-11-03T01:00:00Z",
          created_by_email: this.users.find((user) => user.id === entry.created_by)?.email ?? null,
          set_at: "2026-11-03T01:00:00Z",
        }));
      case "admin_activate_ai_configuration": {
        const draft = this.aiConfigurations.find(
          (entry) => entry.plan === args.plan && entry.label === "test",
        );
        if (draft === undefined) return "no_test";
        if (draft.provider !== "openrouter" && !this.providerKeys.has(draft.provider)) {
          return "no_key";
        }
        const before = this.aiConfigurations.findIndex(
          (entry) => entry.plan === args.plan && entry.label === "active",
        );
        if (before >= 0) this.aiConfigurations.splice(before, 1);
        draft.label = "active";
        this.record(admin, "activate_ai_configuration", "plan", draft.plan, {
          configuration_id: draft.id,
          provider: draft.provider,
          model: draft.model,
        });
        return "activated";
      }
      case "admin_clear_ai_test": {
        const draft = this.aiConfigurations.findIndex(
          (entry) => entry.plan === args.plan && entry.label === "test",
        );
        if (draft < 0) return false;
        this.aiConfigurations.splice(draft, 1);
        this.record(admin, "clear_ai_test", "plan", String(args.plan), {});
        return true;
      }
      case "admin_remove_provider_key": {
        const provider = String(args.provider);
        if (!this.recentSignIn) return "reauth";
        if (
          this.aiConfigurations.some(
            (entry) => entry.label === "active" && entry.provider === provider,
          )
        ) {
          return "in_use";
        }
        if (!this.providerKeys.delete(provider)) return "none";
        this.record(admin, "remove_provider_key", "provider", provider, {});
        return "removed";
      }
      case "admin_plan_versions": {
        const rank = (plan: string) => ["free", "pro", "max", "special"].indexOf(plan);
        return [...this.planVersions]
          .sort(
            (a, b) =>
              rank(a.plan) - rank(b.plan) ||
              Date.parse(b.starts_at) - Date.parse(a.starts_at) ||
              b.id - a.id,
          )
          .map((entry) => ({
            ...entry,
            current: entry.id === this.currentVersion(entry.plan)?.id,
            created_at: entry.starts_at,
            created_by_email:
              this.users.find((user) => user.id === entry.created_by)?.email ?? null,
          }));
      }
      case "admin_create_plan_version": {
        const starts =
          typeof args.starts_at === "string" ? args.starts_at : new Date().toISOString();
        if (Date.parse(starts) < Date.now() - 1000) return "past_start";
        const plan = String(args.plan);
        const previous = this.currentVersion(plan, Date.parse(starts));
        if (previous && previous.quota === args.quota && previous.amount === args.amount) {
          return "unchanged";
        }
        const quotas = ["monthly", "daily", "unlimited"];
        if (
          args.applies_to_all === true &&
          this.planVersions.some(
            (entry) =>
              entry.plan === plan &&
              (quotas.indexOf(entry.quota) > quotas.indexOf(String(args.quota)) ||
                (entry.amount !== null && entry.amount > Number(args.amount))),
          )
        ) {
          return "not_in_favour";
        }
        const added: FakePlanVersion = {
          ...version(
            Math.max(...this.planVersions.map((entry) => entry.id)) + 1,
            plan,
            String(args.quota),
            Number(args.amount),
            starts,
          ),
          applies_to_all: args.applies_to_all === true,
          created_by: admin,
        };
        this.planVersions.push(added);
        this.record(admin, "create_plan_version", "plan", plan, {
          version_id: added.id,
          quota: added.quota,
          amount: added.amount,
          starts_at: added.starts_at,
          applies_to_all: added.applies_to_all,
          quota_before: previous?.quota ?? null,
          amount_before: previous?.amount ?? null,
        });
        return "created";
      }
      case "admin_user_plan": {
        const user = this.users.find((candidate) => candidate.id === args.user_id);
        if (!user) return [];
        const grant = this.userPlans.get(user.id);
        // An admin is on 스페셜 whatever it was granted (ADR 0177).
        const active = this.admins.has(user.id)
          ? "special"
          : grant && (grant.endsAt === null || Date.parse(grant.endsAt) > Date.now())
            ? grant.plan
            : "free";
        const terms = this.currentVersion(active);
        const serving = this.aiConfigurations.find(
          (entry) => entry.plan === terms?.plan && entry.label === "active",
        );
        return [
          {
            plan: terms?.plan ?? null,
            version_id: terms?.id ?? null,
            quota: terms?.quota ?? null,
            amount: terms?.amount ?? null,
            provider: serving?.provider ?? null,
            model: serving?.model ?? null,
            used: terms ? user.extractionsToday : null,
            granted_plan: grant?.plan ?? null,
            ends_at: grant?.endsAt ?? null,
            granted_at: grant ? "2026-10-19T03:00:00Z" : null,
            granted_by_email: this.users.find((u) => u.id === grant?.grantedBy)?.email ?? null,
          },
        ];
      }
      case "admin_grant_plan": {
        const id = String(args.user_id);
        if (!this.users.some((user) => user.id === id)) return "no_user";
        const endsAt = typeof args.ends_at === "string" ? args.ends_at : null;
        if (
          (args.plan !== "pro" && args.plan !== "max" && args.plan !== "special") ||
          (args.plan === "pro" && endsAt !== null) ||
          (endsAt !== null && Date.parse(endsAt) <= Date.now())
        ) {
          return "bad_plan";
        }
        this.userPlans.set(id, { plan: args.plan, endsAt, grantedBy: admin });
        this.record(admin, "grant_plan", "user", id, {
          email: this.users.find((user) => user.id === id)?.email ?? "",
          plan: args.plan,
          ends_at: endsAt,
        });
        return "granted";
      }
      case "admin_revoke_plan": {
        const id = String(args.user_id);
        const grant = this.userPlans.get(id);
        if (!grant) return false;
        this.userPlans.delete(id);
        this.record(admin, "revoke_plan", "user", id, {
          email: this.users.find((user) => user.id === id)?.email ?? "",
          plan: grant.plan,
        });
        return true;
      }
      case "admin_set_deck_hidden": {
        const deck = deckOf(args.deck_id);
        if (!deck || deck.hidden === args.hidden) return false;
        deck.hidden = args.hidden === true;
        this.record(admin, deck.hidden ? "hide_deck" : "unhide_deck", "deck", deck.id, {
          name: deck.name,
        });
        return true;
      }
      case "admin_unpublish_deck": {
        const deck = deckOf(args.deck_id);
        if (deck?.visibility !== "public") return false;
        deck.visibility = "private";
        this.record(admin, "unpublish_deck", "deck", deck.id, { name: deck.name });
        return true;
      }
      case "admin_dismiss_reports": {
        const deck = deckOf(args.deck_id);
        const dismissed = deck?.reports.length ?? 0;
        if (deck && dismissed > 0) {
          deck.reports = [];
          this.record(admin, "dismiss_reports", "deck", deck.id, { reports: dismissed });
        }
        return dismissed;
      }
      case "admin_grant_admin": {
        const email = typeof args.email === "string" ? args.email.trim().toLowerCase() : "";
        const user = this.users.find((candidate) => candidate.email === email);
        if (!user) return "no_user";
        if (this.admins.has(user.id)) return "already";
        this.admins.set(user.id, { grantedAt: "2026-10-19T03:00:00Z", grantedBy: admin });
        this.record(admin, "grant_admin", "user", user.id, { email });
        return "granted";
      }
      case "admin_revoke_admin": {
        const id = args.user_id;
        if (id === admin) return "self";
        if (typeof id !== "string" || !this.admins.delete(id)) return "not_admin";
        this.record(admin, "revoke_admin", "user", id, {
          email: this.users.find((user) => user.id === id)?.email ?? "",
        });
        return "revoked";
      }
      default:
        throw new Error(`the fake admin functions do not know ${name}`);
    }
  }

  readonly handlers = [
    http.post(`${supabaseUrl}/rest/v1/rpc/:name`, async ({ request, params }) => {
      const name = String(params.name);
      if (name !== "is_admin" && !name.startsWith("admin_")) return undefined;
      const user = bearerUser(request.headers.get("authorization"));
      const body = await request.text();
      const args = (body ? JSON.parse(body) : {}) as Row;
      this.calls.push(`${name} ${JSON.stringify(args)}`);
      if (name === "is_admin") {
        if (!user) {
          return HttpResponse.json(
            { code: "42501", message: "permission denied" },
            { status: 401 },
          );
        }
        return HttpResponse.json(this.admins.has(user.id));
      }
      if (!user || !this.admins.has(user.id)) {
        return HttpResponse.json(
          { code: "42501", message: "only an admin may call this" },
          { status: 403 },
        );
      }
      return new HttpResponse(JSON.stringify(this.answer(name, args, user.id)), {
        headers: { "content-type": "application/json" },
      });
    }),
  ];
}
