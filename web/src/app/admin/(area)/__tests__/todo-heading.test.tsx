import { cleanup, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import AdminsPage from "../settings/admins/page";
import AiPage from "../ai/page";
import AiSettingsPage from "../settings/ai/page";
import AuditPage from "../settings/audit/page";
import DecksPage from "../decks/page";
import Page from "../page";
import PlansPage from "../settings/page";
import UsersPage from "../users/page";

// The sections' content reads the server; only each page's own heading is under test here.
vi.mock("../_components/content", () => ({
  TodoContent: () => null,
  UsersContent: () => null,
  NotesContent: () => null,
  AiContent: () => null,
  PlansContent: () => null,
  AiSettingsContent: () => null,
  AdminsContent: () => null,
  AuditContent: () => null,
}));

const props = { params: Promise.resolve({}), searchParams: Promise.resolve({}) };

/** The level-one heading [page] draws. */
function headingOf(page: ReactElement): string | null {
  cleanup();
  render(page);
  return screen.getByRole("heading", { level: 1 }).textContent;
}

describe("the admin area's pages", () => {
  it("are headed 처리할 일 on the first, the name the section menu gives it", () => {
    render(<Page />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveAccessibleName("처리할 일");
  });

  it("are each headed by the name of the menu's section it sits under", () => {
    expect(headingOf(<UsersPage {...props} />)).toBe("사용자");
    expect(headingOf(<DecksPage {...props} />)).toBe("노트");
    expect(headingOf(<AiPage />)).toBe("AI");
    expect(headingOf(<AiSettingsPage />)).toBe("AI");
    expect(headingOf(<PlansPage />)).toBe("요금제");
    expect(headingOf(<AdminsPage />)).toBe("관리자");
    expect(headingOf(<AuditPage />)).toBe("관리자");
  });
});
