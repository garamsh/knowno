import { cleanup, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { supabaseUnreachable } from "@/testing/mocks/handlers";
import { FakePostgrest } from "@/testing/mocks/postgrest";
import { server } from "@/testing/mocks/server";
import { setRequestCookies } from "@/testing/next-headers";
import { render } from "@/testing/render";
import { signedInCookies } from "@/testing/session";

import { Decks } from "../_components/decks";

vi.mock("next/headers", () => import("@/testing/next-headers"));

describe("the 노트 page", () => {
  beforeEach(async () => {
    setRequestCookies(await signedInCookies());
    server.use(...new FakePostgrest().handlers);
  });

  it("keeps its heading above a failed read, with 다시 시도", async () => {
    // Control: the read succeeds under the same heading, counting the decks.
    await render(Decks, {});
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("내 노트 0");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    cleanup();

    server.use(supabaseUnreachable);
    await render(Decks, {});

    const heading = screen.getByRole("heading", { level: 1, name: "내 노트" });
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("서버에 연결할 수 없어요.");
    expect(heading.compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
  });
});
