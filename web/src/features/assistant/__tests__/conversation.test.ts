import { describe, expect, it } from "vitest";

import {
  type AssistantTurn,
  type Conversation,
  parseConversation,
  readyProposal,
  requestTurns,
  shown,
  type Turn,
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

const reply = (edit: Partial<AssistantTurn> = {}): AssistantTurn => ({
  role: "assistant",
  id: "a1",
  text: "",
  citations: [],
  proposals: [],
  choice: null,
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
    const turns: Turn[] = Array.from({ length: 45 }, (_, index) => ({
      role: "user",
      id: String(index),
      text: String(index),
    }));
    const asked = reply({
      text: "어떤 형식?",
      proposals: [shown(proposal)],
      choice: { prompt: "형식은?", options: ["단어", "표"] },
      ending: "ok",
    });
    const sent = requestTurns([...turns, asked, { role: "user", id: "u", text: "단어" }]);
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
        { role: "user", id: "u1", text: "영단어 카드 만들어 줘" },
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
