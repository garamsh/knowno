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

const same = (line: string, n: number) =>
  Array.from(
    { length: n },
    (_, i) => ({ hash: `h${i}`, front: text(line), back: text(`b${i}`) }),
  );

Deno.test("a text repeated on five cards beside a contact is spam, on four it is not", () => {
  const line = "this exact promotional sentence again";
  const ad = { name: "문의 주세요" };
  assertEquals(
    screen(claim("x", { cards: same(line, 5), ...ad })).findings
      .filter((f) => f.category === "repeat").length,
    5,
  );
  assertEquals(
    screen(claim("x", { cards: same(line, 4), ...ad })).findings
      .filter((f) => f.category === "repeat").length,
    0,
  );
});

Deno.test("a prompt shared by many cards is not spam", () => {
  const cards = same("Translate the following sentence into Korean", 8);
  assertEquals(screen(claim("x", { cards })), {
    outcome: "clean",
    findings: [],
  });
});

Deno.test("year ranges and dates are not phone numbers; a service number beside a cue is", () => {
  for (
    const t of [
      "임진왜란 1592-1598",
      "1939-1945",
      "2024-01-15",
      "2024.1.15",
      "1990-2000 and 1580-1620",
    ]
  ) {
    assertEquals(categories(claim(t)), [], t);
  }
  assertEquals(categories(claim("대표번호 1588-1234")), ["phone"]);
  assertEquals(categories(claim("고객센터: 1577-0000")), ["phone"]);
});

Deno.test("English words that end in a messenger's name are not ids", () => {
  for (
    const t of [
      "Deadline: tomorrow",
      "Timeline: 2020",
      "Error at line: 1024",
      "Pipeline: build1234",
      "line 1024",
    ]
  ) {
    assertEquals(categories(claim(t)), [], t);
  }
  assertEquals(categories(claim("LINE ID: abcd1234")), ["kakao_id"]);
  assertEquals(categories(claim("instagram @abcd_1234")), ["kakao_id"]);
});

Deno.test("an account needs a bank beside it, and citizens beside years are not one", () => {
  assertEquals(categories(claim("국민 1948 1950 1960 1970")), []);
  assertEquals(categories(claim("Bank of Korea 1998 2001 2005 2010")), []);
  assertEquals(categories(claim("국민은행 1002123456789")), ["account"]);
  assertEquals(categories(claim("계좌번호: 1002123456789")), ["account"]);
  assertEquals(categories(claim("1002123456789")), []);
});

Deno.test("narrower contact rules: a name, a product, a domain with a particle", () => {
  assertEquals(categories(claim("Call me Ishmael")), []);
  assertEquals(categories(claim("Learn ASP.NET")), []);
  assertEquals(categories(claim("Call me at 5")), ["contact"]);
  assertEquals(categories(claim("naver.com에서 검색")), ["link"]);
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

Deno.test("a banned term alone is unsure, and with any other finding the note is still refused", () => {
  const terms = ["도박사이트"];
  assertEquals(screen(claim("도박사이트", { terms })).outcome, "unsure");
  assertEquals(
    screen(claim("도박사이트 010-1234-5678", { terms })).outcome,
    "refused",
  );
  assertEquals(
    screen(claim("도박사이트 880101-1234568", { terms })).outcome,
    "severe",
  );
  assertEquals(screen(claim("010-1234-5678")).outcome, "refused");
});
