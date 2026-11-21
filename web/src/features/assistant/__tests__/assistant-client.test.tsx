import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UnrecognizedActionError } from "next/dist/client/components/unrecognized-action-error";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { httpAssistantClient } from "../assistant-client";
import { commitProposal } from "../commit-proposal";
import { AssistantChat } from "../components/assistant-chat";
import { fakeClient, proposal } from "./fake-client";

vi.mock("../commit-proposal", () => ({ commitProposal: vi.fn() }));

const staleMessage = "새 버전이 나왔어요. 페이지를 새로고침한 뒤 다시 추가해 주세요.";

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("the chat's commit through the Server Action", () => {
  it("tells the user to reload where the deployment no longer has the action, and says so for any other throw", async () => {
    vi.mocked(commitProposal).mockRejectedValueOnce(new UnrecognizedActionError("not found"));
    expect(await httpAssistantClient.commit(proposal, {})).toEqual({
      kind: "failed",
      message: staleMessage,
    });
    vi.mocked(commitProposal).mockRejectedValueOnce(new Error("network"));
    expect(await httpAssistantClient.commit(proposal, {})).toEqual({
      kind: "failed",
      message: "카드를 추가하지 못했어요. 잠시 후 다시 시도해 주세요.",
    });
  });

  it("leaves the add button usable with the message shown after a stale action, and adds once it answers", async () => {
    vi.mocked(commitProposal)
      .mockRejectedValueOnce(new UnrecognizedActionError("not found"))
      .mockResolvedValueOnce({
        kind: "added",
        deck: { id: "d1", name: "영단어" },
        count: 3,
        skipped: 0,
        refused: 0,
      });
    const { client } = fakeClient([[{ type: "proposal", proposal }]]);
    render(
      <AssistantChat allowance={null} client={{ ...client, commit: httpAssistantClient.commit }} />,
    );
    await userEvent.type(
      screen.getByRole("textbox", { name: "말랑이에게 보낼 메시지" }),
      "카드 만들어 줘",
    );
    await userEvent.click(screen.getByRole("button", { name: "보내기" }));
    await userEvent.click(await screen.findByRole("button", { name: "3장 추가" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(staleMessage);
    const add = screen.getByRole("button", { name: "3장 추가" });
    expect(add).toBeEnabled();
    await userEvent.click(add);
    expect(await screen.findByRole("link", { name: /영단어/ })).toBeInTheDocument();
  });
});
