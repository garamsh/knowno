import { assertEquals } from "jsr:@std/assert@1";
import { type Claim, screen } from "./rules.ts";

const text = (value: string) => [{
  type: "text",
  v: 1,
  id: "b1",
  payload: { text: value },
}];

function claim(front: string, over: Partial<Claim> = {}): Claim {
  return {
    name: "영어 단어",
    description: null,
    cards: [{ hash: "h1", front: text(front), back: text("답") }],
    terms: [],
    ...over,
  };
}

const categories = (c: Claim) => screen(c).findings.map((f) => f.category);

Deno.test("a plain note is clean", () => {
  assertEquals(screen(claim("apple 사과")), { outcome: "clean", findings: [] });
});

Deno.test("a resident number with its check digit is severe; one without is not", () => {
  assertEquals(screen(claim("번호 880101-1234568")).outcome, "severe");
  assertEquals(screen(claim("번호 8801011234568")).outcome, "severe");
  assertEquals(categories(claim("번호 880101-1234563")), []);
});

Deno.test("a phone number is refused with any separator", () => {
  for (
    const n of [
      "010-1234-5678",
      "010 1234 5678",
      "01012345678",
      "010.1234.5678",
      "02-123-4567",
      "+82 10 1234 5678",
      "０１０-１２３４-５６７８",
    ]
  ) {
    assertEquals(categories(claim(`call ${n}`)), ["phone"], n);
  }
});

Deno.test("an account number is severe only beside a bank", () => {
  assertEquals(screen(claim("국민 123456-04-123456")).outcome, "severe");
  assertEquals(screen(claim("123456-04-123456")).outcome, "clean");
});

Deno.test("links, kakao ids and contact prompts are refused", () => {
  assertEquals(categories(claim("https://example.com/x")), ["link"]);
  assertEquals(categories(claim("see shop.example.com")), ["link"]);
  assertEquals(categories(claim("카톡 아이디: abcd1234")), ["kakao_id"]);
  assertEquals(categories(claim("문의 주세요")), ["contact"]);
});

Deno.test("a finding points at the original text and holds none of it", () => {
  const verdict = screen(claim("앞 010-1234-5678 뒤"));
  const [finding] = verdict.findings;
  assertEquals(finding?.card, "h1");
  assertEquals(finding?.where, "front");
  assertEquals(finding?.block, 0);
  assertEquals([finding?.start, finding?.end], [2, 15]);
  assertEquals(JSON.stringify(verdict).includes("1234"), false);
});

Deno.test("a banned term matches through separators, case and width", () => {
  const terms = ["도박사이트"];
  assertEquals(categories(claim("도.박 사-이트", { terms })), ["term"]);
  assertEquals(categories(claim("ＢＥＴ", { terms: ["bet"] })), ["term"]);
  assertEquals(categories(claim("도박", { terms })), []);
});

Deno.test("the name and the description are screened", () => {
  const verdict = screen(
    claim("x", { name: "010-1234-5678", description: "https://a.com" }),
  );
  assertEquals(verdict.findings.map((f) => f.where), ["name", "description"]);
});

Deno.test("a text repeated on five cards is spam, on four it is not", () => {
  const line = "this exact promotional sentence again";
  const cards = (n: number) =>
    Array.from(
      { length: n },
      (_, i) => ({ hash: `h${i}`, front: text(line), back: text(`b${i}`) }),
    );
  assertEquals(screen(claim("x", { cards: cards(5) })).findings.length, 5);
  assertEquals(screen(claim("x", { cards: cards(4) })).outcome, "clean");
});

Deno.test("structural strings and media ids are not scanned", () => {
  const front = [{
    type: "image",
    v: 1,
    id: "b1",
    payload: { media: "01012345678", kind: "010-1234-5678" },
  }];
  assertEquals(
    screen({ ...claim("x"), cards: [{ hash: "h", front, back: [] }] }).outcome,
    "clean",
  );
});

Deno.test("findings stop at the cap", () => {
  const many = Array.from({ length: 80 }, () => "010-1234-5678").join(" ");
  assertEquals(screen(claim(many)).findings.length, 50);
});
