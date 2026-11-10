import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FakePostgrest } from "@/testing/mocks/postgrest";
import { myPlan, planRow } from "@/testing/mocks/my-plan";
import { server } from "@/testing/mocks/server";
import { setRequestCookies } from "@/testing/next-headers";
import { render } from "@/testing/render";
import { signedInCookies } from "@/testing/session";

import { Profile } from "../_components/profile";

vi.mock("next/headers", () => import("@/testing/next-headers"));

const lock = /AI 연결은 플러스부터 쓸 수 있어요/;
const buy = "플러스는 knowno 앱의 내 플랜에서 시작할 수 있어요.";
const managed = "구독은 구매한 곳에서 관리해요. 지금은 App Store예요.";

async function profile(kind: Parameters<typeof planRow>[0] | null, fields = {}) {
  server.use(...new FakePostgrest().handlers);
  if (kind !== null) server.use(myPlan(planRow(kind, fields)));
  setRequestCookies([...(await signedInCookies()), { name: "smartman-tz", value: "Asia/Seoul" }]);
  return render(Profile, {});
}

const plan = () => within(screen.getByRole("region", { name: "내 플랜" }));
const connection = () => within(screen.getByRole("region", { name: "AI 연결" }));

describe("내 플랜 on the account page", () => {
  it("opens the page with 무료, the photos used, and where 플러스 is bought, with no link or button to buy", async () => {
    await profile("free");
    const sections = screen.getAllByRole("region");
    expect(sections[0]).toHaveAccessibleName("내 플랜");
    expect(plan().getByText("무료")).toBeVisible();
    expect(plan().getByText("사진 3/10장 사용")).toBeVisible();
    expect(plan().getByText(buy)).toBeVisible();
    expect(plan().queryByText(managed)).not.toBeInTheDocument();
    expect(plan().queryByRole("link")).not.toBeInTheDocument();
    expect(plan().queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows a store plan's name, renewal date and where it is managed, and its end when it does not renew", async () => {
    await profile("plus-store");
    expect(plan().getByText("플러스")).toBeVisible();
    expect(plan().getByText("사진 7/100장 사용")).toBeVisible();
    expect(plan().getByText("다음 갱신 2026년 12월 1일")).toBeVisible();
    expect(plan().getByText(managed)).toBeVisible();
    expect(plan().queryByText(buy), "control: a paid user is not offered 플러스").toBeNull();
    document.body.innerHTML = "";
    await profile("pro-store");
    expect(plan().getByText("프로")).toBeVisible();
    expect(plan().getByText("2026년 12월 1일까지 쓸 수 있어요")).toBeVisible();
  });

  it("tells an admin and a 무제한 user nothing to buy, and shows no limit", async () => {
    for (const kind of ["admin", "unlimited"] as const) {
      document.body.innerHTML = "";
      await profile(kind);
      expect(plan().getByText("제한 없이 쓸 수 있어요")).toBeVisible();
      expect(plan().queryByText(/플러스/)).not.toBeInTheDocument();
      expect(plan().queryByText(/App Store/)).not.toBeInTheDocument();
      expect(plan().queryByText(/knowno 앱/)).not.toBeInTheDocument();
      expect(screen.queryByText(lock)).not.toBeInTheDocument();
    }
  });

  it("draws no 내 플랜 and locks nothing while the plan is unknown", async () => {
    await profile(null);
    expect(screen.queryByRole("region", { name: "내 플랜" })).not.toBeInTheDocument();
    expect(screen.queryByText(lock)).not.toBeInTheDocument();
    expect(connection().getByText("서버 주소")).toBeVisible();
  });
});

describe("AI 연결 on the account page", () => {
  it("shows MCP locked on 무료 with why, and without the server address", async () => {
    await profile("free");
    expect(connection().getByText(lock)).toBeVisible();
    expect(
      connection().getByText(/플러스는 knowno 앱의 내 플랜에서 시작할 수 있어요/),
    ).toBeVisible();
    expect(connection().queryByText("서버 주소")).not.toBeInTheDocument();
    expect(screen.queryByText(/functions\/v1\/mcp/)).not.toBeInTheDocument();
  });

  it("shows the address as before to a paid user, a 무제한 user and an admin", async () => {
    for (const kind of ["plus-store", "unlimited", "admin"] as const) {
      document.body.innerHTML = "";
      await profile(kind);
      expect(connection().getByText("서버 주소")).toBeVisible();
      expect(screen.queryByText(lock)).not.toBeInTheDocument();
    }
  });
});
