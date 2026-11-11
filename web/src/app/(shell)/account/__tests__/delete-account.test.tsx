import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { FakePostgrest } from "@/testing/mocks/postgrest";
import { myPlan, planRow } from "@/testing/mocks/my-plan";
import { server } from "@/testing/mocks/server";
import { setRequestCookies } from "@/testing/next-headers";
import { render } from "@/testing/render";
import { signedInCookies } from "@/testing/session";

import { Profile } from "../_components/profile";

vi.mock("next/headers", () => import("@/testing/next-headers"));

const storeNote = "스토어 구독은 계정을 삭제해도 해지되지 않고";

async function profile(kind: Parameters<typeof planRow>[0] | null) {
  server.use(...new FakePostgrest().handlers);
  if (kind !== null) server.use(myPlan(planRow(kind)));
  setRequestCookies(await signedInCookies());
  await render(Profile, {});
}

async function openDialog() {
  await userEvent.click(screen.getByRole("button", { name: "계정 삭제" }));
  return screen.getByRole("dialog", { name: "계정을 삭제할까요?" });
}

describe("계정 삭제 on the account page", () => {
  it("is the last row of 계정, under 로그아웃", async () => {
    await profile("free");

    const rows = within(screen.getByRole("region", { name: "계정" })).getAllByRole("button");
    expect(rows.map((row) => row.textContent)).toEqual(["로그아웃", "계정 삭제"]);
  });

  it("warns that a store subscription is not cancelled while the plan's source is the store", async () => {
    await profile("plus-store");

    expect(within(await openDialog()).getByText(new RegExp(storeNote))).toBeVisible();
  });

  // Controls: an unknown plan, no source and another source leave it unchanged, still deletable.
  it.each([null, "free", "admin", "unlimited"] as const)(
    "leaves it unchanged, and deletable, for a plan of %s",
    async (kind) => {
      await profile(kind);

      const dialog = await openDialog();
      expect(within(dialog).queryByText(new RegExp(storeNote))).not.toBeInTheDocument();
      expect(within(dialog).getByRole("button", { name: "삭제" })).toBeEnabled();
    },
  );
});
