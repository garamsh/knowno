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
  /**
   * The notes `admin_screening_queue` lists while [state] is `held`: each names a deck of [decks],
   * the hold behind it, the content [hash] the server holds now (a test sets another to stand for
   * an edit by the owner), and the findings `admin_screening_findings` answers.
   */
  readonly holds: {
    deckId: string;
    hold: string | null;
    hash: string;
    unscreened?: boolean;
    findings: Row[];
    state: "held" | "public" | "refused";
  }[] = [];
  /** The banned words, as `private.screening_terms` keeps the live ones. */
  readonly terms: { id: number; term: string; created_at: string }[] = [];
  private nextTerm = 1;
  /** What `admin_week_activity` answers: the last 7 study days and the 7 before. */
  weekActivity: Row = { new_users_this: 1, new_users_last: 0, studied_this: 7, studied_last: 14 };
  /** The rows `admin_extraction_breakdown` answers: each UTC day's photos by plan, model and version. */
  breakdown: Row[] = [];
  /**
   * The rows `admin_configuration_results` answers for each number of days: each provider, model
   * and prompt version's counts.
   */
  readonly configurationResults = new Map<number, Row[]>();
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
   * The saved AI configurations (ADR 0162), each a provider, model and prompt version: each plan's
   * active one first as the migration seeds them, on the seed prompt, and any draft an admin saved
   * through extract-cards, labelled `test`.
   */
  readonly aiConfigurations: {
    id: number;
    plan: string;
    label: "active" | "test";
    provider: string;
    model: string;
    prompt_version_id: number;
    created_by: string | null;
  }[] = ["free", "pro", "max", "special"].map((plan, index) => ({
    id: index + 1,
    plan,
    label: "active",
    provider: "openrouter",
    model: "anthropic/claude-haiku-5.5",
    prompt_version_id: 1,
    created_by: null,
  }));
  /** The providers whose key Vault holds, with its last four characters; never the key. */
  readonly providerKeys = new Map<string, { lastFour: string; setBy: string }>();
  /** The RevenueCat secrets Vault holds, by name, with who set each; the value is Vault's alone. */
  readonly storeSecrets = new Map<string, { value: string; setBy: string }>();
  /** Whether the admin's session is from a sign-in within the last 10 minutes. */
  recentSignIn = true;
  /** The saved prompt versions, oldest first; the seed, prompt v8, is version 1. */
  readonly prompts: { id: number; text: string; note: string; by: string | null }[] = [
    { id: 1, text: "Prompt v8.\nKeep each fact.", note: "prompt v8", by: null },
  ];
  /**
   * The saved assistant configurations (ADR 0190): each plan's active one as the migration seeds
   * it, on the photo's provider and model with the first assistant prompt, web search off for Free
   * alone, 3 searches a message and no reasoning; and any draft an admin saved through the
   * assistant, labelled `test`.
   */
  readonly assistantConfigurations: (FakeAdmin["aiConfigurations"][number] & {
    web_search: boolean;
    max_searches: number;
    reasoning_effort: string;
  })[] = ["free", "pro", "max", "special"].map((plan, index) => ({
    id: index + 1,
    plan,
    label: "active",
    provider: "openrouter",
    model: "anthropic/claude-haiku-5.5",
    prompt_version_id: 1,
    created_by: null,
    web_search: plan !== "free",
    max_searches: 3,
    reasoning_effort: "none",
  }));
  /** The saved assistant prompts, oldest first. */
  readonly assistantPrompts: { id: number; text: string; note: string; by: string | null }[] = [
    { id: 1, text: "You are 말랑이.\nAnswer briefly.", note: "first", by: null },
  ];
  /** The saved card-form skill versions, oldest first; each form's first is its seed. */
  readonly cardFormSkills: {
    id: number;
    form: string;
    summary: string;
    text: string;
    note: string;
    by: string | null;
  }[] = ["text", "senses", "cloze", "table", "image", "mixed"].map((form, index) => ({
    id: index + 1,
    form,
    summary: `${form} summary`,
    text: `# ${form}\nUse it for ${form}.\nRule one.`,
    note: "seed (#751)",
    by: null,
  }));
  /**
   * The version each card form's 'active', 'test' and 'markup' labels name; the seeds are active.
   */
  readonly cardFormSkillLabels = new Map<string, number>(
    this.cardFormSkills.map((skill) => [`${skill.form} active`, skill.id]),
  );
  /**
   * The card markup switch, off, and who set it and when once an admin has; `everSet` stays true
   * when `by` names an account that is gone, as the server's `ever_set` does.
   */
  cardMarkup: { enabled: boolean; everSet: boolean; by: string | null; at: string } = {
    enabled: false,
    everSet: false,
    by: null,
    at: "2026-11-09T01:00:00Z",
  };
  /** Each plan's daily assistant token budget, as the owner approved them; null for none. */
  readonly assistantTokenBudgets = new Map<string, number | null>([
    ["free", 200_000],
    ["pro", 2_000_000],
    ["max", 6_000_000],
    ["special", null],
  ]);
  /** Who set each plan's budget, and when, once an admin has; the seed's set_by is null. */
  readonly assistantBudgetSetters = new Map<string, { by: string; at: string }>();
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
  /** The report triage's verdicts on decks of [decks], by deck id, as `private.triage_verdicts` keeps them. */
  readonly triageVerdicts = new Map<
    string,
    {
      category: string;
      confidence: number;
      passage: string | null;
      field: string | null;
      tier: string;
      model: string;
      cost_usd: number;
      judged_at: string;
    }
  >();
  /** What the triage did, as `private.triage_actions` keeps it. */
  readonly triageActions: {
    id: number;
    deckId: string;
    action: "hide" | "dismiss";
    category: string;
    confidence: number;
    model: string;
    reason: string;
    createdAt: string;
    sampled: boolean;
    recheckedAt: string | null;
    recheckAgreed: boolean | null;
    undoneAt: string | null;
  }[] = [];
  /** The owners' appeals of AI actions, as `private.triage_appeals` keeps them. */
  readonly triageAppeals: {
    actionId: number;
    deckId: string;
    appealedAt: string;
    resolved: boolean;
  }[] = [];
  /** `private.triage_settings`' one row as `admin_triage_settings` answers it: judge-only until an admin changes it. */
  readonly triageSettings: Row = {
    mode: "judge_only",
    act_threshold: 0.9,
    daily_cap_usd: 0.5,
    batch_notes: 10,
    daily_notes: 100,
    sample_percent: 10,
    undo_window_hours: 168,
    undo_threshold: 0.2,
    undo_min_actions: 5,
    paused_at: null,
    paused_reason: null,
    spent_today_usd: 0,
    judged_today: 0,
    actions_in_window: 0,
    undo_rate: null,
    reporter_daily_cap: 20,
  };
  /** Failed tries of a claimed note, by deck id: the server answers null for a note not claimed. */
  readonly triageFailures = new Map<string, number>();
  /** What `admin_triage_agreement` answers. */
  readonly triageAgreement: { category: string; compared: number; agreed: number }[] = [];
  /** The triage's labelled configurations, as `admin_triage_configurations` answers them. */
  readonly triageConfigurations: Row[] = [];
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

  private promptRow(
    prompt: FakeAdmin["prompts"][number],
    configurations: { label: string; prompt_version_id: number }[] = this.aiConfigurations,
  ): Row {
    return {
      id: prompt.id,
      note: prompt.note,
      length: prompt.text.length,
      created_by_email: this.users.find((user) => user.id === prompt.by)?.email ?? null,
      created_at: "2026-10-19T04:00:00Z",
      // The labels of the configurations sending it, as the server names them.
      labels: (["active", "test"] as const).filter((label) =>
        configurations.some(
          (entry) => entry.label === label && entry.prompt_version_id === prompt.id,
        ),
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

  /** The plan [id] is on now: 스페셜 for an admin whatever it was granted (ADR 0177), a grant not ended, or Free. */
  private planOf(id: string): string {
    const grant = this.userPlans.get(id);
    if (this.admins.has(id)) return "special";
    return grant && (grant.endsAt === null || Date.parse(grant.endsAt) > Date.now())
      ? grant.plan
      : "free";
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
      case "admin_extraction_failures":
        return this.extractionFailures;
      case "admin_configuration_results":
        return this.configurationResults.get(Number(args.days ?? 30)) ?? [];
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
      case "admin_users": {
        // Every user that matches, newest sign-up first, as the server pages them (ADR 0181).
        const query = typeof args.query === "string" ? args.query.trim().toLowerCase() : "";
        const matches = this.users
          .filter((user) => query === "" || user.email.toLowerCase().includes(query))
          .filter((user) => args.plan == null || this.planOf(user.id) === args.plan)
          .filter(
            (user) =>
              args.status == null ||
              (args.status === "suspended") === this.suspensions.has(user.id),
          )
          .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
        const offset = Number(args.page_offset ?? 0);
        const size = Math.min(Math.max(Number(args.page_size ?? 20), 1), 100);
        return matches.slice(offset, offset + size).map((user) => ({
          user_id: user.id,
          email: user.email,
          created_at: user.createdAt,
          last_answer_at: user.lastAnswerAt,
          decks: user.decks,
          cards: user.cards,
          user_plan: this.planOf(user.id),
          admin: this.admins.has(user.id),
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
      case "admin_prompt_versions":
        return this.prompts.toReversed().map((prompt) => this.promptRow(prompt));
      case "admin_prompt_version": {
        const prompt = this.prompts.find((candidate) => candidate.id === args.version_id);
        if (!prompt) return [];
        return [{ ...this.promptRow(prompt), text: prompt.text }];
      }
      case "admin_save_prompt": {
        const text = String(args.text);
        const id = (this.prompts.at(-1)?.id ?? 0) + 1;
        const note = String(args.note).trim();
        this.prompts.push({ id, text, note, by: admin });
        this.record(admin, "save_prompt", "prompt", String(id), { note, length: text.length });
        return id;
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
      case "admin_ai_configurations": {
        // In the plans' order, each plan's active configuration before its draft, as the server orders them.
        const rank = (plan: string) => ["free", "pro", "max", "special"].indexOf(plan);
        const ordered = this.aiConfigurations.toSorted(
          (a, b) => rank(a.plan) - rank(b.plan) || a.label.localeCompare(b.label),
        );
        return ordered.map((entry) => ({
          plan: entry.plan,
          label: entry.label,
          configuration_id: entry.id,
          provider: entry.provider,
          model: entry.model,
          prompt_version_id: entry.prompt_version_id,
          created_at: "2026-11-03T01:00:00Z",
          created_by_email: this.users.find((user) => user.id === entry.created_by)?.email ?? null,
          set_at: "2026-11-03T01:00:00Z",
        }));
      }
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
          prompt_version_id: draft.prompt_version_id,
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
      case "admin_assistant_configurations": {
        const rank = (plan: string) => ["free", "pro", "max", "special"].indexOf(plan);
        return this.assistantConfigurations
          .toSorted((a, b) => rank(a.plan) - rank(b.plan) || a.label.localeCompare(b.label))
          .map((entry) => ({
            plan: entry.plan,
            label: entry.label,
            configuration_id: entry.id,
            provider: entry.provider,
            model: entry.model,
            prompt_version_id: entry.prompt_version_id,
            web_search: entry.web_search,
            max_searches: entry.max_searches,
            reasoning_effort: entry.reasoning_effort,
            created_at: "2026-11-04T01:00:00Z",
            created_by_email:
              this.users.find((user) => user.id === entry.created_by)?.email ?? null,
            set_at: "2026-11-04T01:00:00Z",
          }));
      }
      case "admin_assistant_prompts":
        return this.assistantPrompts.toReversed().map((prompt) => ({
          ...this.promptRow(prompt, this.assistantConfigurations),
          text: prompt.text,
        }));
      case "admin_save_assistant_prompt": {
        const text = String(args.text);
        const id = (this.assistantPrompts.at(-1)?.id ?? 0) + 1;
        const note = String(args.note).trim();
        this.assistantPrompts.push({ id, text, note, by: admin });
        this.record(admin, "save_assistant_prompt", "assistant_prompt", String(id), {
          note,
          length: text.length,
        });
        return id;
      }
      case "admin_activate_assistant_configuration": {
        const draft = this.assistantConfigurations.find(
          (entry) => entry.plan === args.plan && entry.label === "test",
        );
        if (draft === undefined) return "no_test";
        if (draft.provider !== "openrouter" && !this.providerKeys.has(draft.provider)) {
          return "no_key";
        }
        const before = this.assistantConfigurations.findIndex(
          (entry) => entry.plan === args.plan && entry.label === "active",
        );
        const replaced = this.assistantConfigurations[before]?.id ?? null;
        if (before >= 0) this.assistantConfigurations.splice(before, 1);
        draft.label = "active";
        this.record(admin, "activate_assistant_configuration", "plan", draft.plan, {
          configuration_id: draft.id,
          configuration_before: replaced,
        });
        return "activated";
      }
      case "admin_clear_assistant_test": {
        const draft = this.assistantConfigurations.findIndex(
          (entry) => entry.plan === args.plan && entry.label === "test",
        );
        if (draft < 0) return false;
        const cleared = this.assistantConfigurations[draft]?.id;
        this.assistantConfigurations.splice(draft, 1);
        this.record(admin, "clear_assistant_test", "plan", String(args.plan), {
          configuration_id: cleared,
        });
        return true;
      }
      case "admin_card_form_skills":
        return this.cardFormSkills.toReversed().map((skill) => ({
          id: skill.id,
          form: skill.form,
          summary: skill.summary,
          text: skill.text,
          note: skill.note,
          created_by_email: this.users.find((user) => user.id === skill.by)?.email ?? null,
          created_at: "2026-11-05T01:00:00Z",
          labels: (["active", "test", "markup"] as const).filter(
            (label) => this.cardFormSkillLabels.get(`${skill.form} ${label}`) === skill.id,
          ),
        }));
      case "admin_save_card_form_skill": {
        const form = String(args.form);
        const id = (this.cardFormSkills.at(-1)?.id ?? 0) + 1;
        const note = String(args.note).trim();
        const text = String(args.text);
        this.cardFormSkills.push({
          id,
          form,
          summary: String(args.summary).trim(),
          text,
          note,
          by: admin,
        });
        this.cardFormSkillLabels.set(`${form} test`, id);
        this.record(admin, "save_card_form_skill", "card_form", form, {
          version_id: id,
          note,
          length: text.length,
        });
        return id;
      }
      case "admin_activate_card_form_skill": {
        const form = String(args.form);
        const tested = this.cardFormSkillLabels.get(`${form} test`);
        if (tested === undefined) return "no_test";
        this.cardFormSkillLabels.set(`${form} active`, tested);
        this.cardFormSkillLabels.delete(`${form} test`);
        this.record(admin, "activate_card_form_skill", "card_form", form, { version_id: tested });
        return "activated";
      }
      case "admin_clear_card_form_skill_test": {
        const form = String(args.form);
        const cleared = this.cardFormSkillLabels.get(`${form} test`);
        if (cleared === undefined) return false;
        this.cardFormSkillLabels.delete(`${form} test`);
        this.record(admin, "clear_card_form_skill_test", "card_form", form, {
          version_id: cleared,
        });
        return true;
      }
      case "admin_card_markup":
        return [
          {
            enabled: this.cardMarkup.enabled,
            ever_set: this.cardMarkup.everSet,
            set_by_email: this.users.find((user) => user.id === this.cardMarkup.by)?.email ?? null,
            set_at: this.cardMarkup.at,
          },
        ];
      case "admin_set_card_markup": {
        const enabled = args.enabled;
        if (typeof enabled !== "boolean") return "bad_value";
        if (this.cardMarkup.enabled === enabled) return "unchanged";
        const before = this.cardMarkup.enabled;
        this.cardMarkup = { enabled, everSet: true, by: admin, at: "2026-11-09T11:00:00Z" };
        this.record(admin, "set_card_markup", "switch", "card_markup", {
          enabled,
          enabled_before: before,
        });
        return "set";
      }
      case "admin_assistant_token_budgets":
        return [...this.assistantTokenBudgets].map(([plan, daily]) => ({
          plan,
          daily_tokens: daily,
          set_by_email:
            this.users.find((user) => user.id === this.assistantBudgetSetters.get(plan)?.by)
              ?.email ?? null,
          set_at: this.assistantBudgetSetters.get(plan)?.at ?? "2026-11-05T01:00:00Z",
        }));
      case "admin_set_assistant_token_budget": {
        const plan = String(args.plan);
        const tokens = args.daily_tokens as number | null;
        if (!this.assistantTokenBudgets.has(plan)) return "bad_plan";
        if (tokens !== null && (tokens < 0 || tokens > 1_000_000_000)) return "bad_budget";
        const before = this.assistantTokenBudgets.get(plan) ?? null;
        if (before === tokens) return "unchanged";
        this.assistantTokenBudgets.set(plan, tokens);
        this.assistantBudgetSetters.set(plan, { by: admin, at: "2026-11-05T11:00:00Z" });
        this.record(admin, "set_assistant_token_budget", "plan", plan, {
          daily_tokens: tokens,
          daily_tokens_before: before,
        });
        return "set";
      }
      case "admin_store_secrets":
        return ["knowno_store_api_key", "knowno_store_webhook_authorization"]
          .toSorted()
          .map((name) => {
            const secret = this.storeSecrets.get(name);
            return {
              name,
              is_set: secret !== undefined,
              set_at: secret ? "2026-11-10T01:00:00Z" : null,
              set_by_email: this.users.find((user) => user.id === secret?.setBy)?.email ?? null,
            };
          });
      case "admin_set_store_secret": {
        const name = String(args.name);
        const value = String(args.value);
        if (!this.recentSignIn) return "reauth";
        if (!["knowno_store_api_key", "knowno_store_webhook_authorization"].includes(name)) {
          return "bad_name";
        }
        const valid =
          name === "knowno_store_api_key"
            ? /^\S{8,1000}$/.test(value)
            : /^[ -~]{16,1000}$/.test(value);
        if (!valid) return "bad_secret";
        this.storeSecrets.set(name, { value, setBy: admin });
        this.record(admin, "set_store_secret", "store_secret", name, {});
        return "saved";
      }
      case "admin_clear_store_secret": {
        const name = String(args.name);
        if (!this.recentSignIn) return "reauth";
        if (!this.storeSecrets.delete(name)) return "none";
        this.record(admin, "clear_store_secret", "store_secret", name, {});
        return "cleared";
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
        const terms = this.currentVersion(this.planOf(user.id));
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
      case "admin_screening_queue":
        return this.holds
          .filter((hold) => hold.state === "held")
          .flatMap((hold) => {
            const deck = deckOf(hold.deckId);
            if (!deck) return [];
            return [
              {
                deck_id: deck.id,
                name: deck.name,
                owner_id: deck.ownerId,
                owner_email: this.users.find((user) => user.id === deck.ownerId)?.email ?? "",
                hold: hold.hold,
                content_hash: hold.hash,
                reports: deck.reports.length,
                updated_at: "2026-10-19T02:00:00Z",
              },
            ];
          });
      case "admin_screening_findings": {
        const hold = this.holds.find((entry) => entry.deckId === args.deck_id);
        if (!hold || hold.hash !== args.content_hash) {
          return { changed: true, unscreened: true, findings: [] };
        }
        return { changed: false, unscreened: hold.unscreened ?? false, findings: hold.findings };
      }
      case "admin_allow_deck":
      case "admin_keep_deck_hidden": {
        const hold = this.holds.find((entry) => entry.deckId === args.deck_id);
        const deck = deckOf(args.deck_id);
        if (!hold || !deck || hold.state !== "held") return "not_held";
        if (hold.hash !== args.content_hash) return "changed";
        const allowed = name === "admin_allow_deck";
        hold.state = allowed ? "public" : "refused";
        deck.visibility = allowed ? "public" : "private";
        deck.hidden = false;
        this.record(
          admin,
          allowed ? "allow_deck" : "keep_deck_hidden",
          "deck",
          deck.id,
          allowed ? { name: deck.name } : { name: deck.name, reason: args.reason },
        );
        return allowed ? "allowed" : "kept";
      }
      case "admin_screening_terms":
        return this.terms;
      case "admin_add_screening_term": {
        const term = typeof args.term === "string" ? args.term.trim().normalize("NFKC") : "";
        if (term === "" || Array.from(term).length > 100)
          throw new Error("a term has 1 to 100 characters");
        const known = this.terms.find((entry) => entry.term === term);
        if (known) return known.id;
        const added = { id: this.nextTerm++, term, created_at: "2026-10-19T03:30:00Z" };
        this.terms.push(added);
        this.record(admin, "add_screening_term", "screening_term", String(added.id), {});
        return added.id;
      }
      case "admin_remove_screening_term": {
        const at = this.terms.findIndex((entry) => entry.id === args.id);
        if (at === -1) return false;
        this.terms.splice(at, 1);
        this.record(admin, "remove_screening_term", "screening_term", String(args.id), {});
        return true;
      }
      case "admin_triage_queue":
        return this.decks
          .filter(
            (deck) => !deck.deleted && deck.visibility === "public" && deck.reports.length >= 2,
          )
          .map((deck) => {
            const verdict = this.triageVerdicts.get(deck.id);
            const standing = this.triageActions.findLast(
              (action) => action.deckId === deck.id && action.undoneAt === null,
            );
            return {
              deck_id: deck.id,
              name: deck.name,
              owner_id: deck.ownerId,
              hidden: deck.hidden,
              publication: deck.hidden ? "held" : "public",
              reporters: deck.reports.length,
              reasons: this.reasons(deck),
              last_reported_at: deck.reports
                .map((report) => report.at)
                .sort()
                .at(-1),
              category: verdict?.category ?? null,
              confidence: verdict?.confidence ?? null,
              passage: verdict?.passage ?? null,
              field: verdict?.field ?? null,
              tier: verdict?.tier ?? null,
              model: verdict?.model ?? null,
              cost_usd: verdict?.cost_usd ?? null,
              judged_at: verdict?.judged_at ?? null,
              action_id: standing?.id ?? null,
              appealed: this.triageAppeals.some(
                (appeal) => appeal.deckId === deck.id && !appeal.resolved,
              ),
              failures: this.triageFailures.get(deck.id) ?? null,
            };
          })
          .sort((a, b) => {
            const severe = (row: { reasons: string[] }) => (row.reasons.includes("sexual") ? 0 : 1);
            return (
              severe(a) - severe(b) ||
              String(b.last_reported_at).localeCompare(String(a.last_reported_at))
            );
          });
      case "admin_triage_actions":
      case "admin_triage_sample":
        return this.triageActions
          .filter(
            (action) =>
              name === "admin_triage_actions" || (action.sampled && action.recheckedAt === null),
          )
          .toReversed()
          .map((action) => ({
            action_id: action.id,
            deck_id: action.deckId,
            name: this.decks.find((deck) => deck.id === action.deckId)?.name ?? "",
            action: action.action,
            category: action.category,
            confidence: action.confidence,
            model: action.model,
            reason: action.reason,
            created_at: action.createdAt,
            sampled: action.sampled,
            rechecked_at: action.recheckedAt,
            recheck_agreed: action.recheckAgreed,
            undone_at: action.undoneAt,
          }));
      case "admin_undo_triage_action": {
        const action = this.triageActions.find((entry) => entry.id === args.action_id);
        if (!action) return "not_found";
        if (action.undoneAt !== null) return "already";
        const deck = this.decks.find((entry) => entry.id === action.deckId);
        if (action.action === "hide") {
          if (!deck?.hidden) return "superseded";
          deck.hidden = false;
        }
        action.undoneAt = "2026-11-11T03:00:00Z";
        this.record(admin, "undo_triage_action", "deck", action.deckId, { action_id: action.id });
        return "undone";
      }
      case "admin_recheck_triage_action": {
        const action = this.triageActions.find((entry) => entry.id === args.action_id);
        if (!action) return "not_found";
        if (!action.sampled) return "not_sampled";
        if (action.recheckedAt !== null) return "already";
        action.recheckedAt = "2026-11-11T03:00:00Z";
        action.recheckAgreed = args.agreed === true;
        this.record(admin, "recheck_triage_action", "deck", action.deckId, {
          action_id: action.id,
          agreed: args.agreed,
        });
        return "rechecked";
      }
      case "admin_triage_settings":
        return [this.triageSettings];
      case "admin_set_triage_settings": {
        const changed: Row = {};
        for (const [key, value] of Object.entries(args)) {
          if (value === null || value === undefined) continue;
          this.triageSettings[key] = value;
          changed[key] = value;
        }
        this.record(admin, "set_triage_settings", "triage", "settings", changed);
        return true;
      }
      case "admin_resume_triage":
        if (this.triageSettings.paused_at === null) return false;
        this.triageSettings.paused_at = null;
        this.triageSettings.paused_reason = null;
        this.record(admin, "resume_triage", "triage", "settings", {});
        return true;
      case "admin_triage_agreement":
        return this.triageAgreement;
      case "admin_triage_appeals":
        return this.triageAppeals
          .filter((appeal) => !appeal.resolved)
          .map((appeal) => {
            const action = this.triageActions.find((entry) => entry.id === appeal.actionId);
            const deck = this.decks.find((entry) => entry.id === appeal.deckId);
            const verdict = this.triageVerdicts.get(appeal.deckId);
            return {
              deck_id: appeal.deckId,
              name: deck?.name ?? "",
              owner_id: deck?.ownerId ?? "",
              appealed_at: appeal.appealedAt,
              action_id: appeal.actionId,
              category: action?.category ?? "",
              confidence: action?.confidence ?? 0,
              passage: verdict?.passage ?? null,
              field: verdict?.field ?? null,
            };
          });
      case "admin_resolve_triage_appeal": {
        const appeal = this.triageAppeals.find(
          (entry) => entry.deckId === args.deck_id && !entry.resolved,
        );
        if (!appeal) return "not_found";
        appeal.resolved = true;
        let outcome = "upheld";
        if (args.restore === true) {
          const action = this.triageActions.find((entry) => entry.id === appeal.actionId);
          const deck = this.decks.find((entry) => entry.id === appeal.deckId);
          if (action && action.undoneAt === null && deck?.hidden) {
            deck.hidden = false;
            action.undoneAt = "2026-11-11T03:00:00Z";
            outcome = "restored";
          } else {
            outcome = action?.undoneAt === null ? "not_restored" : "restored";
          }
        }
        this.record(admin, "resolve_triage_appeal", "deck", appeal.deckId, { outcome });
        return outcome;
      }
      case "admin_triage_configurations":
        return this.triageConfigurations;
      case "admin_activate_triage_configuration": {
        const chosen = this.triageConfigurations.find((entry) => entry.label === "test");
        if (!chosen) return "no_test";
        const active = this.triageConfigurations.findIndex((entry) => entry.label === "active");
        if (active >= 0) this.triageConfigurations.splice(active, 1);
        chosen.label = "active";
        this.record(
          admin,
          "activate_triage_configuration",
          "triage_configuration",
          String(chosen.configuration_id),
          {},
        );
        return "activated";
      }
      case "admin_clear_triage_test": {
        const draft = this.triageConfigurations.findIndex((entry) => entry.label === "test");
        if (draft < 0) return false;
        this.triageConfigurations.splice(draft, 1);
        this.record(admin, "clear_triage_test", "triage_configuration", "", {});
        return true;
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
