import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { supabaseUnreachable, supabaseUrl, testAccessToken } from "@/testing/mocks/handlers";
import { server } from "@/testing/mocks/server";
import { setRequestCookies } from "@/testing/next-headers";
import { signedInCookies } from "@/testing/session";

import { cancelPhotoJob } from "../cancel-job";
import { forwardJobPoll } from "../forward-job";
import { forwardMessage } from "../forward-message";
import { commitProposal } from "../commit-proposal";

vi.mock("next/headers", () => import("@/testing/next-headers"));
const revalidated = vi.hoisted(() => [] as string[]);
vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => {
    revalidated.push(path);
  },
}));

/** What the function received: each request's path, token and body. */
let received: { path: string; authorization: string | null; body: unknown }[];

function functionAnswers(path: string, answer: () => Response) {
  server.use(
    http.post(`${supabaseUrl}/functions/v1/assistant${path}`, async ({ request }) => {
      received.push({
        path,
        authorization: request.headers.get("Authorization"),
        body: await request.json(),
      });
      return answer();
    }),
  );
}

const message = { messages: [{ role: "user", text: "영단어 카드 만들어 줘" }] };

const send = () =>
  forwardMessage(
    new Request("http://localhost:3000/api/assistant", {
      method: "POST",
      body: JSON.stringify(message),
    }),
  );

beforeEach(async () => {
  received = [];
  revalidated.length = 0;
  setRequestCookies(await signedInCookies());
});

describe("a message on its way to the function", () => {
  it("reaches the function as the signed-in user and streams its events back as they came", async () => {
    const events = 'event: text\ndata: {"delta":"네"}\n\n';
    functionAnswers(
      "",
      () => new HttpResponse(events, { headers: { "Content-Type": "text/event-stream" } }),
    );
    const response = await send();
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    expect(await response.text()).toBe(events);
    expect(received).toEqual([
      { path: "", authorization: `Bearer ${testAccessToken}`, body: message },
    ]);
  });

  it("passes on the function's refusals, a spent budget's tokens with it", async () => {
    functionAnswers("", () =>
      HttpResponse.json(
        { error: "rate_limited", token_budget: 200000, tokens_used: 200100 },
        { status: 429 },
      ),
    );
    const response = await send();
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({
      error: "rate_limited",
      token_budget: 200000,
      tokens_used: 200100,
    });
  });

  it("refuses a visitor who is not signed in without calling the function", async () => {
    functionAnswers("", () => new HttpResponse("", { status: 200 }));
    setRequestCookies([]);
    const response = await send();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthenticated" });
    expect(received).toEqual([]);
    // Control: signed in, it calls.
    setRequestCookies(await signedInCookies());
    await send();
    expect(received).toHaveLength(1);
  });

  it("answers unavailable when Supabase cannot be reached", async () => {
    server.use(supabaseUnreachable);
    const response = await send();
    expect(response.status).toBe(503);
  });
});

describe("adding a proposal", () => {
  const proposal = {
    id: "p1",
    kind: "cards",
    deck: { id: null, name: "영단어" },
    groups: [
      {
        id: "g1",
        title: "1단원",
        format: "text",
        cards: [
          { id: "c1", card: { front: "apple", back: "사과" } },
          { id: "c2", card: { front: "pear", back: "배" } },
        ],
      },
    ],
  };

  it("commits the cards checked as the user and answers the note and the cards written", async () => {
    functionAnswers("/commit", () =>
      HttpResponse.json({
        deck: { id: "d1", name: "영단어" },
        added: [{ index: 0, id: "x", front: "apple" }],
        skipped: [],
        refused: [],
        files_not_released: [],
      }),
    );
    expect(await commitProposal(proposal, { g1: ["c1"] })).toEqual({
      kind: "added",
      deck: { id: "d1", name: "영단어" },
      count: 1,
    });
    expect(received).toEqual([
      {
        path: "/commit",
        authorization: `Bearer ${testAccessToken}`,
        body: { proposal, checked: { g1: ["c1"] } },
      },
    ]);
    expect(revalidated).toEqual(["/"]);
  });

  it("counts the cards a commit of changes updated", async () => {
    functionAnswers("/commit", () =>
      HttpResponse.json({
        deck: { id: "d1", name: "영단어" },
        updated: [{ index: 0 }, { index: 1 }],
        refused: [],
        files_not_released: [],
      }),
    );
    const changes = { ...proposal, kind: "changes", deck: { id: "d1", name: "영단어" } };
    expect(await commitProposal(changes, { g1: ["c1", "c2"] })).toMatchObject({ count: 2 });
  });

  it("says a refused commit cannot be added, and sends nothing that is not a proposal", async () => {
    functionAnswers("/commit", () =>
      HttpResponse.json({ error: "refused", message: "not your note" }, { status: 422 }),
    );
    expect(await commitProposal(proposal, { g1: ["c1"] })).toEqual({
      kind: "failed",
      message: "카드를 추가하지 못했어요. 말랑이에게 다시 만들어 달라고 해 주세요.",
    });
    expect(received).toHaveLength(1);
    expect(await commitProposal({ id: "p1" }, { g1: ["c1"] })).toMatchObject({ kind: "failed" });
    expect(await commitProposal(proposal, { g1: "c1" })).toMatchObject({ kind: "failed" });
    expect(received).toHaveLength(1);
    expect(revalidated).toEqual([]);
  });
});

const jobId = "0190a7c2-3b4d-7e5f-8a9b-0c1d2e3f4a5b";

/** What the function received on a job's path: its method, path and token. */
let asked: { method: string; path: string; authorization: string | null }[];

function jobAnswers(path: string, method: "get" | "post", answer: () => Response) {
  server.use(
    http[method](`${supabaseUrl}/functions/v1/assistant${path}`, ({ request }) => {
      asked.push({
        method: request.method,
        path,
        authorization: request.headers.get("Authorization"),
      });
      return answer();
    }),
  );
}

describe("a photo job's poll on its way to the function", () => {
  beforeEach(() => {
    asked = [];
  });

  it("asks as the signed-in user and answers the function's status and body", async () => {
    const poll = {
      id: jobId,
      status: "running",
      photos: [{ position: 0, photo_id: "p", status: "queued" }],
    };
    jobAnswers(`/jobs/${jobId}`, "get", () => HttpResponse.json(poll));
    const response = await forwardJobPoll(jobId);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(poll);
    expect(asked).toEqual([
      { method: "GET", path: `/jobs/${jobId}`, authorization: `Bearer ${testAccessToken}` },
    ]);
    // Control: a job that is not the user's is the function's 404, passed on.
    jobAnswers(`/jobs/${jobId}`, "get", () =>
      HttpResponse.json({ error: "not_found" }, { status: 404 }),
    );
    expect((await forwardJobPoll(jobId)).status).toBe(404);
  });

  it("refuses a visitor who is not signed in, and an id that is no uuid, without calling the function", async () => {
    jobAnswers(`/jobs/${jobId}`, "get", () => HttpResponse.json({}));
    setRequestCookies([]);
    expect((await forwardJobPoll(jobId)).status).toBe(401);
    setRequestCookies(await signedInCookies());
    expect((await forwardJobPoll("../commit")).status).toBe(404);
    expect(asked).toEqual([]);
  });

  it("says unavailable when the function cannot be reached", async () => {
    server.use(
      http.get(`${supabaseUrl}/functions/v1/assistant/jobs/${jobId}`, () => HttpResponse.error()),
    );
    expect((await forwardJobPoll(jobId)).status).toBe(503);
  });
});

describe("cancelling a photo job", () => {
  beforeEach(() => {
    asked = [];
  });

  it("cancels as the signed-in user, and says whether the function did", async () => {
    jobAnswers(`/jobs/${jobId}/cancel`, "post", () =>
      HttpResponse.json({ id: jobId, status: "cancelled" }),
    );
    expect(await cancelPhotoJob(jobId)).toBe(true);
    expect(asked).toEqual([
      { method: "POST", path: `/jobs/${jobId}/cancel`, authorization: `Bearer ${testAccessToken}` },
    ]);
    jobAnswers(`/jobs/${jobId}/cancel`, "post", () =>
      HttpResponse.json({ error: "not_found" }, { status: 404 }),
    );
    expect(await cancelPhotoJob(jobId)).toBe(false);
  });

  it("calls nothing for a visitor not signed in or an id that crossed the network as none", async () => {
    jobAnswers(`/jobs/${jobId}/cancel`, "post", () => HttpResponse.json({}));
    // Control: where an id of dots would lead, the function answers, so only the check refuses it.
    jobAnswers("/commit/cancel", "post", () =>
      HttpResponse.json({ id: jobId, status: "cancelled" }),
    );
    expect(await cancelPhotoJob("../commit")).toBe(false);
    expect(await cancelPhotoJob(7)).toBe(false);
    setRequestCookies([]);
    expect(await cancelPhotoJob(jobId)).toBe(false);
    expect(asked).toEqual([]);
  });
});
