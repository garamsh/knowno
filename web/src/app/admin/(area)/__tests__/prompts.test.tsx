import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { savePrompt } from "@/features/admin/actions";
import { FakeAdmin } from "@/testing/mocks/admin";
import { otherUser, testUser } from "@/testing/mocks/handlers";
import { server } from "@/testing/mocks/server";
import { setRequestCookies } from "@/testing/next-headers";
import { render } from "@/testing/render";
import { signedInCookies } from "@/testing/session";
import { field } from "@/supabase/row";

import { AdminsContent } from "../_components/content";

vi.mock("next/headers", () => import("@/testing/next-headers"));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

async function signIn(user: typeof testUser | typeof otherUser = testUser) {
  setRequestCookies([...(await signedInCookies(user)), { name: "smartman-tz", value: "UTC" }]);
}

/** Where [action] redirected, read from the error Next's `redirect` throws, or "" when it did not. */
async function redirected(action: Promise<unknown>): Promise<string> {
  try {
    await action;
  } catch (error) {
    const digest = field(error, "digest");
    if (typeof digest === "string") return digest;
    throw error;
  }
  return "";
}

/** A form of [fields], as the browser posts it. */
function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

let admin: FakeAdmin;
beforeEach(async () => {
  admin = new FakeAdmin();
  admin.prompts.push({
    id: 2,
    text: "Prompt v8.\nKeep each fact once.",
    note: "shorter",
    by: testUser.id,
  });
  server.use(...admin.handlers);
  await signIn();
});

describe("saving a version", () => {
  it("saves the text as a new version that serves no one, records it, and returns to AI", async () => {
    expect(
      await redirected(savePrompt({ message: null }, form({ text: "New prompt.", note: " try " }))),
    ).toContain(";/ai;");
    expect(admin.prompts.at(-1)).toEqual({
      id: 3,
      text: "New prompt.",
      note: "try",
      by: testUser.id,
    });
    expect(admin.aiConfigurations.map((entry) => entry.prompt_version_id)).toEqual([1, 1, 1, 1]);
    expect(admin.audit.map((entry) => entry.action)).toEqual(["save_prompt"]);
  });

  it("refuses a blank text, one over 20,000 characters and a long note without asking the server", async () => {
    for (const fields of [
      { text: " \n ", note: "" },
      { text: "가".repeat(20_001), note: "" },
      { text: "ok", note: "n".repeat(201) },
    ]) {
      expect((await savePrompt({ message: null }, form(fields))).message).not.toBeNull();
    }
    expect(admin.calls).toEqual([]);
    // Control: 20,000 characters are saved.
    expect(
      await redirected(
        savePrompt({ message: null }, form({ text: "가".repeat(20_000), note: "" })),
      ),
    ).toContain(";/ai;");
  });

  it("is refused for a user who is not an admin, saving nothing, and done for an admin", async () => {
    await signIn(otherUser);
    expect(await savePrompt({ message: null }, form({ text: "Mine.", note: "" }))).toEqual({
      message: "관리자만 할 수 있어요.",
    });
    expect(admin.prompts).toHaveLength(2);
    await signIn();
    expect(
      await redirected(savePrompt({ message: null }, form({ text: "Mine.", note: "" }))),
    ).toContain(";/ai;");
  });
});

describe("the audit log", () => {
  it("names a saved version and links it to AI", async () => {
    await redirected(savePrompt({ message: null }, form({ text: "Third.", note: "" })));
    await render(AdminsContent, {});
    expect(
      within(screen.getByRole("list", { name: "작업 기록" }))
        .getAllByRole("listitem")
        .map((entry) => entry.firstChild?.textContent),
    ).toEqual(["프롬프트 저장 · 버전 3"]);
    expect(screen.getByRole("link", { name: "버전 3" })).toHaveAttribute("href", "/ai");
  });
});
