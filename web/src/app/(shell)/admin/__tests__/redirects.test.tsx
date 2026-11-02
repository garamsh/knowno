import { describe, expect, it } from "vitest";

import { redirectTarget } from "@/testing/redirect";

import AdminsPage from "../admins/page";
import AuditPage from "../audit/page";
import ExtractionsPage from "../extractions/page";
import PlansPage from "../plans/page";
import PromptPage from "../prompts/[id]/page";
import PromptsPage from "../prompts/page";
import ReportsPage from "../reports/page";

/** [page]'s redirect, the call wrapped so a synchronous throw reaches the helper as a rejection. */
const target = (page: () => unknown) => redirectTarget(Promise.resolve().then(page));

describe("an address the admin area had before its five sections", () => {
  it("redirects to its new place", async () => {
    expect(await target(ReportsPage)).toBe("/admin/decks");
    expect(await target(PlansPage)).toBe("/admin/settings");
    expect(await target(AdminsPage)).toBe("/admin/settings/admins");
    expect(await target(AuditPage)).toBe("/admin/settings/audit");
    expect(await target(ExtractionsPage)).toBe("/admin/ai");
    expect(
      await target(() =>
        PromptPage({ params: Promise.resolve({ id: "7" }), searchParams: Promise.resolve({}) }),
      ),
    ).toBe("/admin/ai/7");
  });

  it("keeps the version the prompts page's form started from, and goes to 사진 AI without one", async () => {
    const prompts = (searchParams: Record<string, string>) =>
      target(() =>
        PromptsPage({ params: Promise.resolve({}), searchParams: Promise.resolve(searchParams) }),
      );
    expect(await prompts({ from: "3" })).toBe("/admin/ai/new?from=3");
    expect(await prompts({})).toBe("/admin/ai");
  });
});
