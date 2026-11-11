import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { render } from "@/testing/render";

import { CallbackError } from "../components/callback-error";
import { DeletedNotice } from "../components/deleted-notice";

describe("the login page's callback error", () => {
  it("says sign-in was cancelled for error=cancelled", async () => {
    await render(CallbackError, { searchParams: Promise.resolve({ error: "cancelled" }) });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "로그인이 취소되었어요. 다시 시도해 주세요.",
    );
  });

  it("says sign-in failed for error=failed", async () => {
    await render(CallbackError, { searchParams: Promise.resolve({ error: "failed" }) });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "로그인하지 못했어요. 잠시 후 다시 시도해 주세요.",
    );
  });

  it("says the account is suspended for error=suspended", async () => {
    await render(CallbackError, { searchParams: Promise.resolve({ error: "suspended" }) });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "이 계정은 이용이 정지됐어요. 문의는 sauce@garam.sh로 보내 주세요.",
    );
  });

  it("shows nothing for no error or an unknown one", async () => {
    for (const error of [undefined, "other", ["failed", "cancelled"]]) {
      await render(CallbackError, { searchParams: Promise.resolve({ error }) });
    }

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("the login page's deleted notice", () => {
  it("says the account was deleted for deleted=1, and nothing for anything else", async () => {
    await render(DeletedNotice, { searchParams: Promise.resolve({ deleted: "1" }) });
    expect(screen.getByRole("status")).toHaveTextContent("계정을 삭제했어요.");
    document.body.innerHTML = "";

    for (const deleted of [undefined, "0", ["1", "1"]]) {
      await render(DeletedNotice, { searchParams: Promise.resolve({ deleted }) });
    }
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
