import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearStoreSecret, saveStoreSecret } from "@/features/admin/actions";
import { FakeAdmin } from "@/testing/mocks/admin";
import { otherUser, testUser } from "@/testing/mocks/handlers";
import { server } from "@/testing/mocks/server";
import { setRequestCookies } from "@/testing/next-headers";
import { render } from "@/testing/render";
import { signedInCookies } from "@/testing/session";

import { PlansContent } from "../_components/content";

vi.mock("next/headers", () => import("@/testing/next-headers"));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const WEBHOOK = "knowno_store_webhook_authorization";
const API_KEY = "knowno_store_api_key";
const SECRET = "Bearer rc-webhook-secret-4242";

async function signIn(user: typeof testUser | typeof otherUser = testUser) {
  setRequestCookies([...(await signedInCookies(user)), { name: "smartman-tz", value: "UTC" }]);
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

let admin: FakeAdmin;

/** 요금제 as the address [params] opens it. */
const plans = (params: Record<string, string> = {}) =>
  render(PlansContent, { searchParams: Promise.resolve(params) });

const save = (name: string, value: string) =>
  saveStoreSecret({ message: null, reauth: false }, form({ name, value }));

beforeEach(async () => {
  admin = new FakeAdmin();
  server.use(...admin.handlers);
  await signIn();
});

describe("스토어 비밀값 on 요금제", () => {
  it("shows whether each secret is set with who set it, never its value, and opens one form, its field empty, from the address", async () => {
    admin.storeSecrets.set(API_KEY, { value: SECRET, setBy: testUser.id });
    const { unmount } = await plans();
    const list = within(screen.getByRole("list", { name: "스토어 비밀값" }));
    const rows = list.getAllByRole("listitem");
    // Each row holds the name, the state and its link, so a substring is right.
    expect(rows[0]).toHaveTextContent(/시크릿 API 키설정됨.* · learner@example.com값 바꾸기/);
    expect(rows[1]).toHaveTextContent(/웹훅 Authorization 값없음값 저장/);
    expect(document.body.textContent).not.toContain(SECRET);
    expect(list.queryByRole("form")).not.toBeInTheDocument();
    expect(list.getByRole("link", { name: "값 저장" })).toHaveAttribute(
      "href",
      `/plans?secret=${WEBHOOK}`,
    );
    unmount();
    await plans({ secret: API_KEY });
    const opened = within(screen.getByRole("list", { name: "스토어 비밀값" }));
    expect(opened.getAllByRole("form")).toHaveLength(1);
    const field = opened.getByLabelText("새 값");
    expect(field).toHaveAttribute("type", "password");
    expect(field).toHaveValue("");
    expect(opened.getByRole("link", { name: "닫기" })).toHaveAttribute("href", "/plans");
    expect(opened.getByRole("button", { name: "값 삭제" })).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(SECRET);
  });

  it("saves a secret, answers a bad one with its rule, and never returns or renders the value", async () => {
    expect(await save(API_KEY, "short")).toEqual({
      message: "키는 빈칸 없이 8자에서 1,000자 사이여야 해요.",
      reauth: false,
    });
    expect(await save(WEBHOOK, "too short")).toEqual({
      message: "값은 영문, 숫자, 기호로 16자에서 1,000자 사이여야 해요.",
      reauth: false,
    });
    expect(admin.storeSecrets.size, "a bad value is not stored").toBe(0);
    const saved = await save(WEBHOOK, SECRET);
    expect(saved).toEqual({ message: "저장했어요.", reauth: false });
    expect(JSON.stringify(saved)).not.toContain(SECRET);
    expect(admin.storeSecrets.get(WEBHOOK)?.value).toBe(SECRET);
    await plans({ secret: WEBHOOK });
    const row = within(screen.getByRole("list", { name: "스토어 비밀값" })).getAllByRole(
      "listitem",
    )[1];
    expect(row).toHaveTextContent(/설정됨/);
    expect(document.body.innerHTML).not.toContain(SECRET);
    expect(document.body.innerHTML).not.toContain("4242");
  });

  it("asks an admin whose sign-in is older than 10 minutes to sign in again, and refuses a user who is not an admin", async () => {
    admin.recentSignIn = false;
    expect(await save(WEBHOOK, SECRET)).toEqual({
      message: "보안을 위해 다시 로그인한 뒤 저장해 주세요.",
      reauth: true,
    });
    expect((await clearStoreSecret(WEBHOOK)).message).toBe(
      "보안을 위해 다시 로그인한 뒤 삭제해 주세요.",
    );
    admin.recentSignIn = true;
    expect((await save(WEBHOOK, SECRET)).reauth, "control: a recent sign-in saves").toBe(false);
    await signIn(otherUser);
    expect(await save(API_KEY, "an-api-key-1234")).toEqual({
      message: "관리자만 할 수 있어요.",
      reauth: false,
    });
    expect(admin.storeSecrets.has(API_KEY)).toBe(false);
  });

  it("clears a secret, and says so when none is set", async () => {
    admin.storeSecrets.set(API_KEY, { value: "an-api-key-1234", setBy: testUser.id });
    expect(await clearStoreSecret(API_KEY)).toEqual({ changed: true, message: "삭제했어요." });
    expect(admin.storeSecrets.size).toBe(0);
    expect(await clearStoreSecret(API_KEY)).toEqual({
      changed: false,
      message: "지울 값이 없어요.",
    });
    expect((await clearStoreSecret("other")).changed).toBe(false);
  });
});
