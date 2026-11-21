import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { testRouter } from "@/testing/router";

import { httpAssistantClient } from "../assistant-client";
import { cancelPhotoJob } from "../cancel-job";
import { commitProposal } from "../commit-proposal";
import { AssistantChat } from "../components/assistant-chat";
import { fakeClient, proposal } from "./fake-client";

vi.mock("../commit-proposal", () => ({ commitProposal: vi.fn() }));
vi.mock("../cancel-job", () => ({ cancelPhotoJob: vi.fn() }));

// Next.js builds its unrecognized-action error in an internal module, so a stand-in is told apart
// through the public check the client uses.
const { UnrecognizedActionError } = vi.hoisted(() => ({
  UnrecognizedActionError: class extends Error {},
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => testRouter,
  unstable_isUnrecognizedActionError: (error: unknown) => error instanceof UnrecognizedActionError,
}));

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

describe("the chat's photo job cancel through the Server Action", () => {
  const staleCancel = "새 버전이 나왔어요. 페이지를 새로고침한 뒤 다시 시도해 주세요.";

  it("says whether the function cancelled, and tells the user where the call threw", async () => {
    vi.mocked(cancelPhotoJob).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect(await httpAssistantClient.cancelJob("j1")).toEqual({ kind: "cancelled" });
    expect(await httpAssistantClient.cancelJob("j1")).toEqual({ kind: "kept" });
    vi.mocked(cancelPhotoJob).mockRejectedValueOnce(new UnrecognizedActionError("not found"));
    expect(await httpAssistantClient.cancelJob("j1")).toEqual({
      kind: "failed",
      message: staleCancel,
    });
    vi.mocked(cancelPhotoJob).mockRejectedValueOnce(new Error("network"));
    expect(await httpAssistantClient.cancelJob("j1")).toEqual({
      kind: "failed",
      message: "사진 읽기를 취소하지 못했어요. 잠시 후 다시 시도해 주세요.",
    });
  });

  it("leaves the job running and the cancel usable with the message shown after a stale action, and cancels once it answers", async () => {
    vi.mocked(cancelPhotoJob)
      .mockRejectedValueOnce(new UnrecognizedActionError("not found"))
      .mockResolvedValueOnce(true);
    const { client } = fakeClient([[{ type: "job", id: "j1", photos: 3 }]]);
    render(
      <AssistantChat
        allowance={null}
        client={{ ...client, cancelJob: httpAssistantClient.cancelJob }}
      />,
    );
    await userEvent.type(
      screen.getByRole("textbox", { name: "말랑이에게 보낼 메시지" }),
      "사진 읽어 줘",
    );
    await userEvent.click(screen.getByRole("button", { name: "보내기" }));
    await userEvent.click(await screen.findByRole("button", { name: "읽기 취소" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(staleCancel);
    await userEvent.click(screen.getByRole("button", { name: "읽기 취소" }));
    expect(await screen.findByText("사진 읽기를 취소했어요")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
