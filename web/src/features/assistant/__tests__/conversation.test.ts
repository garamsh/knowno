import { describe, expect, it } from "vitest";

import {
  type AssistantTurn,
  type Conversation,
  ended,
  enteredFrom,
  lastMessage,
  parseConversation,
  readyProposal,
  requestTurns,
  runningJob,
  shown,
  storeConversation,
  type Turn,
  type UserTurn,
  withEvent,
} from "../conversation";
import type { Proposal } from "../protocol";

const firstGroup: Proposal["groups"][number] = {
  id: "g1",
  title: "1단원",
  format: "senses",
  cards: [
    { id: "c1", card: { front: "apple", back: "사과" } },
    { id: "c2", card: { front: "pear", back: "배" } },
  ],
};

const proposal: Proposal = {
  id: "p1",
  kind: "cards",
  deck: { id: null, name: "영단어" },
  groups: [
    firstGroup,
    {
      id: "g2",
      title: "2단원",
      format: "senses",
      cards: [{ id: "c3", card: { front: "plum", back: "자두" } }],
    },
  ],
};

const said = (id: string, text: string, edit: Partial<UserTurn> = {}): UserTurn => ({
  role: "user",
  id,
  text,
  photos: [],
  auto: false,
  ...edit,
});

const reply = (edit: Partial<AssistantTurn> = {}): AssistantTurn => ({
  role: "assistant",
  id: "a1",
  text: "",
  citations: [],
  proposals: [],
  choice: null,
  job: null,
  interim: null,
  ending: null,
  ...edit,
});

describe("a reply as its events arrive", () => {
  it("adds text, each source once, and a proposal with every card checked", () => {
    let turn = reply();
    turn = withEvent(turn, { type: "text", delta: "만들" });
    turn = withEvent(turn, { type: "text", delta: "었어요" });
    turn = withEvent(turn, { type: "citation", url: "https://a.test", title: "A" });
    turn = withEvent(turn, { type: "citation", url: "https://a.test", title: "A" });
    turn = withEvent(turn, { type: "proposal", proposal });
    expect(turn.text).toBe("만들었어요");
    expect(turn.citations).toEqual([{ url: "https://a.test", title: "A" }]);
    expect(turn.proposals[0]?.checked).toEqual({ g1: ["c1", "c2"], g2: ["c3"] });
  });

  it("keeps the checks of the groups a remade proposal kept, and checks the remade group whole", () => {
    let turn = withEvent(reply(), { type: "proposal", proposal });
    const [first] = turn.proposals;
    if (!first) throw new Error("no proposal shown");
    turn = { ...turn, proposals: [{ ...first, checked: { g1: ["c1"], g2: [] } }] };
    const remade: Proposal = {
      ...proposal,
      groups: [
        firstGroup,
        { id: "g2", title: "2단원", format: "cloze", cards: [{ id: "c4", card: { blocks: [] } }] },
      ],
    };
    turn = withEvent(turn, { type: "proposal", proposal: remade });
    expect(turn.proposals).toHaveLength(1);
    expect(turn.proposals[0]?.checked).toEqual({ g1: ["c1"], g2: ["c4"] });
  });
});

describe("the turns a message sends", () => {
  it("sends the last 40, each reply with the proposals and question it showed", () => {
    const turns: Turn[] = Array.from({ length: 45 }, (_, index) =>
      said(String(index), String(index)),
    );
    const asked = reply({
      text: "어떤 형식?",
      proposals: [shown(proposal)],
      choice: { prompt: "형식은?", options: ["단어", "표"] },
      ending: "ok",
    });
    const sent = requestTurns([...turns, asked, said("u", "단어")]);
    expect(sent).toHaveLength(40);
    expect(sent.at(-2)).toEqual({
      role: "assistant",
      text: "어떤 형식?",
      proposals: [proposal],
      choice: { prompt: "형식은?", options: ["단어", "표"] },
    });
    expect(sent.at(-1)).toEqual({ role: "user", text: "단어" });
    expect(sent[0]).toEqual({ role: "user", text: "7" });
    // Control: a plain reply carries neither key.
    expect(requestTurns([reply({ text: "네" })])).toEqual([{ role: "assistant", text: "네" }]);
  });
});

describe("the conversation kept in the browser", () => {
  it("reads back what it stored, a reply cut off mid-stream ended as stopped", () => {
    const conversation: Conversation = {
      turns: [
        said("u1", "영단어 카드 만들어 줘"),
        reply({ text: "네", proposals: [shown(proposal)], ending: "ok" }),
        reply({ id: "a2", text: "그리고" }),
      ],
      draft: "다음엔",
    };
    const read = parseConversation(JSON.stringify({ version: 1, ...conversation }));
    expect(read.turns.slice(0, 2)).toEqual(conversation.turns.slice(0, 2));
    expect(read.turns[2]).toEqual(reply({ id: "a2", text: "그리고", ending: "stopped" }));
    expect(read.draft).toBe("다음엔");
  });

  it("starts empty from nothing, from text that is not JSON, and from another version", () => {
    for (const text of [null, "{", JSON.stringify({ version: 2, turns: [], draft: "" })])
      expect(parseConversation(text)).toEqual({ turns: [], draft: "" });
  });

  it("has a proposal ready once its reply ended and until it is added", () => {
    const open = shown(proposal);
    const at = (turn: AssistantTurn): Conversation => ({ turns: [turn], draft: "" });
    expect(readyProposal(at(reply({ proposals: [open], ending: "ok" })))).toEqual(open);
    expect(readyProposal(at(reply({ proposals: [open] })))).toBeNull();
    const added = { ...open, added: { deck: { id: "d1", name: "영단어" }, count: 3 } };
    expect(readyProposal(at(reply({ proposals: [added], ending: "ok" })))).toBeNull();
  });
});

describe("photos, the photo job and the note a chat opens from", () => {
  const job = { id: "j1", photos: 3, finished: 1, state: "running" } as const;

  it("sends a user turn's photos and a reply's job, and no context line", () => {
    const sent = requestTurns([
      { role: "context", id: "x", deckId: "d1", name: "영단어" },
      said("u1", "읽어 줘", { photos: ["p1", "p2"] }),
      reply({ text: "읽는 중이에요", job, ending: "ok" }),
      said("u2", "다 읽었어요", { auto: true }),
    ]);
    expect(sent).toEqual([
      { role: "user", text: "읽어 줘", photos: ["p1", "p2"] },
      { role: "assistant", text: "읽는 중이에요", job: { id: "j1", photos: 3 } },
      { role: "user", text: "다 읽었어요" },
    ]);
  });

  it("shows a job event as a running job with nothing finished", () => {
    expect(withEvent(reply(), { type: "job", id: "j1", photos: 3 }).job).toEqual({
      id: "j1",
      photos: 3,
      finished: 0,
      state: "running",
    });
  });

  it("finds the reply whose job still reads, and the last message past a context line", () => {
    const turns: Turn[] = [
      reply({ id: "old", job: { ...job, state: "done" } }),
      reply({ id: "now", job }),
      { role: "context", id: "x", deckId: "d1", name: "영단어" },
    ];
    expect(runningJob(turns)?.id).toBe("now");
    expect(lastMessage(turns)?.id).toBe("now");
    // Control: a job done or cancelled is none that reads.
    expect(runningJob([reply({ job: { ...job, state: "cancelled" } })])).toBeUndefined();
  });

  it("names a note once, unless the last line already does, and reads the line back", () => {
    const note = { id: "d1", name: "영단어" };
    const first = enteredFrom({ turns: [said("u1", "안녕")], draft: "" }, note, "c1");
    expect(first.turns.at(-1)).toEqual({ role: "context", id: "c1", deckId: "d1", name: "영단어" });
    expect(enteredFrom(first, note, "c2")).toBe(first);
    // Control: another note, or the same one after a message, is named again.
    expect(enteredFrom(first, { id: "d2", name: "표" }, "c3").turns).toHaveLength(3);
    const after = { ...first, turns: [...first.turns, said("u2", "더")] };
    expect(enteredFrom(after, note, "c4").turns).toHaveLength(4);
    const read = parseConversation(JSON.stringify({ version: 1, ...first }));
    expect(read.turns.at(-1)).toEqual(first.turns.at(-1));
  });

  it("reads back a user turn's photos and a reply's job, and drops a job that is not one", () => {
    const conversation: Conversation = {
      turns: [said("u1", "", { photos: ["p1"] }), reply({ job, ending: "ok" })],
      draft: "",
    };
    const read = parseConversation(JSON.stringify({ version: 1, ...conversation }));
    expect(read.turns).toEqual(conversation.turns);
    const broken = JSON.parse(JSON.stringify({ version: 1, ...conversation })) as {
      turns: { job?: unknown }[];
    };
    broken.turns[1] = { ...broken.turns[1], job: { id: "j1", state: "lost" } };
    expect((parseConversation(JSON.stringify(broken)).turns[1] as AssistantTurn).job).toBeNull();
  });
});

describe("a reply's passing status line", () => {
  const text = (turn: AssistantTurn, delta: string) => withEvent(turn, { type: "text", delta });
  const interim = (turn: AssistantTurn) => withEvent(turn, { type: "interim" });

  it("takes the text before the mark as one folded line, each new one replacing the last", () => {
    let turn = text(reply(), "카드를\n찾아볼게요  ");
    expect(turn.text).toBe("카드를\n찾아볼게요  ");
    turn = interim(turn);
    expect(turn).toMatchObject({ text: "", interim: "카드를 찾아볼게요" });
    turn = text(text(turn, "\n\n"), "하나 더 볼게요");
    // The call's text streams in as the reply until its mark arrives (ADR 0224), the line gone.
    expect(turn).toMatchObject({ text: "하나 더 볼게요", interim: null });
    turn = interim(turn);
    expect(turn).toMatchObject({ text: "", interim: "하나 더 볼게요" });
  });

  it("goes when the reply's text begins, dropping the separator the function sent before it", () => {
    let turn = interim(text(reply(), "찾아볼게요"));
    turn = text(turn, "\n\n");
    // Whitespace alone is not the reply: the line stays.
    expect(turn).toMatchObject({ text: "", interim: "찾아볼게요" });
    turn = text(turn, "답이에요");
    expect(turn).toMatchObject({ text: "답이에요", interim: null });
  });

  it("is kept by a mark with no text before it, and goes with every ending", () => {
    const line = interim(text(reply(), "잠깐만요"));
    expect(interim(line).interim).toBe("잠깐만요");
    expect(ended(line, "ok").interim).toBeNull();
    expect(ended(line, "stopped")).toMatchObject({ interim: null, ending: "stopped" });
    expect(withEvent(line, { type: "error", error: "cut" }).interim).toBeNull();
    // A turn that ended keeps its first ending.
    expect(ended(reply({ ending: "cut" }), "ok").ending).toBe("cut");
  });

  it("a turn of one call has none, and what is stored and sent holds the reply alone", () => {
    expect(text(reply(), "답이에요")).toMatchObject({ text: "답이에요", interim: null });

    const midStream = interim(text(reply(), "찾아볼게요"));
    const turns: Turn[] = [said("u1", "안녕"), text(midStream, "답이에요")];
    expect(requestTurns(turns)[1]).toEqual({ role: "assistant", text: "답이에요" });

    const withLine: Turn[] = [said("u1", "안녕"), midStream];
    expect(storeConversation({ turns: withLine, draft: "" })).toBe(true);
    const kept = window.localStorage.getItem("knowno.assistant") ?? "";
    expect(kept).not.toContain("찾아볼게요");
    window.localStorage.clear();
  });
});
