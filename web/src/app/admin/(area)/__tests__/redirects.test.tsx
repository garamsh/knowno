import { describe, expect, it } from "vitest";

import { redirectTarget } from "@/testing/redirect";

import AuditPage from "../audit/page";
import ExtractionsPage from "../extractions/page";
import PromptPage from "../prompts/[id]/page";
import PromptsPage from "../prompts/page";
import ReportsPage from "../reports/page";
import SettingsAdminsPage from "../settings/admins/page";
import SettingsAuditPage from "../settings/audit/page";
import SettingsPage from "../settings/page";

/** [page]'s redirect, the call wrapped so a synchronous throw reaches the helper as a rejection. */
const target = (page: () => unknown) => redirectTarget(Promise.resolve().then(page));

describe("an address the admin area had before its sections", () => {
  it("redirects to its new place", async () => {
    expect(await target(ReportsPage)).toBe("/decks");
    expect(await target(AuditPage)).toBe("/admins");
    expect(await target(SettingsPage)).toBe("/plans");
    expect(await target(SettingsAdminsPage)).toBe("/admins");
    expect(await target(SettingsAuditPage)).toBe("/admins");
    expect(await target(ExtractionsPage)).toBe("/ai");
    expect(await target(PromptPage)).toBe("/ai");
  });

  it("opens AI's form from the version the prompts page's form started from, and AI without one", async () => {
    const prompts = (searchParams: Record<string, string>) =>
      target(() =>
        PromptsPage({ params: Promise.resolve({}), searchParams: Promise.resolve(searchParams) }),
      );
    expect(await prompts({ from: "3" })).toBe("/ai?write=3");
    expect(await prompts({})).toBe("/ai");
  });
});
