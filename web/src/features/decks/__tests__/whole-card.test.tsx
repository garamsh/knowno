import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { blanksUnder } from "@/testing/whole-cards";

import type { Cell, Content } from "../card-content";
import { faceLength, WholeCard, WholeCells } from "../components/whole-card";

// A wide photo and a tall one, each with a box near the top left holding an answer and one near
// the bottom right without, as the app's `image_block_test.dart` draws them (ADR 0109).
const boxes = [
  { id: "1", x: 0.1, y: 0.2, w: 0.3, h: 0.15, answer: "Paris" },
  { id: "2", x: 0.55, y: 0.7, w: 0.4, h: 0.25, answer: null },
];
const photos: Content[] = [
  { kind: "image", media: "wide", width: 1600, height: 900, boxes },
  { kind: "image", media: "tall", width: 600, height: 1200, boxes },
];

/** [photo] drawn in a container [width] CSS pixels wide, revealed or not. */
function draw(photo: Content, width: number, revealed = false) {
  const { container } = render(
    <div style={{ width: `${String(width)}px` }}>
      <WholeCard blocks={[photo]} revealed={revealed} />
    </div>,
  );
  const frame = container.querySelector<HTMLElement>("[data-image]");
  const marks = [...container.querySelectorAll<HTMLElement>("[data-box]")];
  return { container, frame, marks };
}

/**
 * Where each box falls in pixels inside a frame [width] wide, from the CSS that places it: the
 * frame's height follows from its aspect ratio, and each box's place and size are percentages of
 * the frame. jsdom lays nothing out, so this reads the CSS rather than measuring the page.
 */
function placed(frame: HTMLElement, marks: HTMLElement[], width: number) {
  const [w, h] = frame.style.aspectRatio.split("/").map(Number);
  const height = (width * (h ?? 0)) / (w ?? 1);
  const at = (value: string, of: number) => (Number.parseFloat(value) / 100) * of;
  return marks.map((mark) => ({
    left: at(mark.style.left, width) / width,
    top: at(mark.style.top, height) / height,
    width: at(mark.style.width, width) / width,
    height: at(mark.style.height, height) / height,
  }));
}

describe("a photo on a whole card", () => {
  for (const photo of photos) {
    if (photo.kind !== "image") continue;
    it(`draws the ${photo.media} photo's frame at its aspect ratio and each box over the same part of it at 320 and 1024 px`, () => {
      for (const width of [320, 1024]) {
        const { frame, marks } = draw(photo, width);
        expect(frame, `${String(width)} px`).not.toBeNull();
        if (!frame) continue;
        expect(frame.style.aspectRatio).toBe(`${String(photo.width)} / ${String(photo.height)}`);
        expect(frame.className).toContain("w-full");
        const fractions = placed(frame, marks, width);
        expect(fractions).toHaveLength(photo.boxes.length);
        photo.boxes.forEach((box, index) => {
          const drawn = fractions[index];
          for (const [part, value] of [
            ["left", box.x],
            ["top", box.y],
            ["width", box.w],
            ["height", box.h],
          ] as const) {
            expect(drawn?.[part], `${String(width)} px, box ${box.id}, ${part}`).toBeCloseTo(
              value,
              9,
            );
          }
        });
      }
    });
  }

  it("bounds each photo's frame to a height, its width following from its aspect ratio, so a tall photo fits", () => {
    for (const photo of photos) {
      if (photo.kind !== "image") continue;
      const { frame } = draw(photo, 1024);
      // At most 60dvh tall: as wide as 60dvh times width over height, in whatever form jsdom
      // keeps the calc.
      const maxWidth = frame?.style.maxWidth ?? "";
      expect(maxWidth, photo.media).toMatch(/^(calc\()?[\d.]+dvh\)?$/);
      expect(Number.parseFloat(maxWidth.replace("calc(", "")), photo.media).toBeCloseTo(
        (60 * photo.width) / photo.height,
        2,
      );
      expect(frame?.className, photo.media).toContain("mx-auto");
    }
  });

  it("hides each box with an opaque fill until revealed, then outlines it with its answer", () => {
    const [photo] = photos;
    if (!photo) return;

    const hidden = draw(photo, 320);
    expect(hidden.marks.map((mark) => mark.dataset.box)).toEqual(["hidden", "hidden"]);
    expect(hidden.marks.every((mark) => mark.className.includes("bg-hero"))).toBe(true);
    expect(hidden.container.textContent).not.toContain("Paris");
    expect(hidden.container.querySelector("[role=group]")?.getAttribute("aria-label")).toBe(
      "사진, 빈칸, 빈칸",
    );

    const revealed = draw(photo, 320, true);
    expect(revealed.marks.map((mark) => mark.dataset.box)).toEqual(["revealed", "revealed"]);
    expect(revealed.marks.every((mark) => mark.className.includes("border-2"))).toBe(true);
    expect(revealed.marks[0]?.textContent).toBe("Paris");
    expect(revealed.marks[1]?.textContent).toBe("");
    expect(revealed.container.querySelector("[role=group]")?.getAttribute("aria-label")).toBe(
      "사진, Paris, 빈칸",
    );
  });

  it("draws the photo filling its frame from the URL a read signed, and the ground alone without one", () => {
    const [photo] = photos;
    if (photo?.kind !== "image") throw new Error("the wide photo");
    const signed = draw({ ...photo, url: "https://storage.test/wide?token=t" }, 320);
    expect(signed.frame?.style.backgroundImage).toBe('url("https://storage.test/wide?token=t")');
    expect(signed.frame?.className).toContain("bg-cover");
    expect(signed.marks).toHaveLength(2);
    expect(draw(photo, 320).frame?.style.backgroundImage).toBe("");
  });
});

// A table card whose cell holds a span blank, as the app's `study_screen_test.dart` draws it
// (ADR 0110).
describe("a table on a whole card", () => {
  const table: Content = {
    kind: "table",
    columns: ["", "정치"],
    rows: [["부여", "5부족 연맹체, 왕 아래 마가"]],
    blanks: [],
    spans: [{ row: 0, column: 1, start: 0, end: 7 }],
  };

  it("draws a span empty inside its cell's text, read as 빈칸, and fills it in place once revealed", () => {
    for (const revealed of [false, true]) {
      const { container, unmount } = render(<WholeCard blocks={[table]} revealed={revealed} />);
      const blank = container.querySelector<HTMLElement>("[data-blank]");
      expect(blanksUnder(container)).toEqual({ "5부족 연맹체": revealed });
      // The blank and the rest of the cell, the cue, are one cell.
      expect(blank?.parentElement?.textContent).toBe("5부족 연맹체, 왕 아래 마가");
      expect(container.querySelector("[role=group]")?.getAttribute("aria-label")).toBe(
        revealed ? ", 정치. 부여, 5부족 연맹체, 왕 아래 마가" : ", 정치. 부여, 빈칸, 왕 아래 마가",
      );
      unmount();
    }
  });
});

// A cloze's blank, as the app's `whole_card_view_test.dart` checks it (ADR 0119).
describe("a blank on a whole card", () => {
  const cloze: Content = { kind: "cloze", text: "Le ___ dort", answers: ["chat"] };

  it("is an empty gap over a muted underline with no fill while hidden, and its answer on the brand tint once filled", () => {
    const classes = (revealed: boolean) => {
      const { container, unmount } = render(<WholeCard blocks={[cloze]} revealed={revealed} />);
      const names = container.querySelector("[data-blank]")?.className.split(" ") ?? [];
      unmount();
      return names;
    };

    const empty = classes(false);
    // The answer keeps the gap's width but is not drawn, over the underline in `muted`.
    expect(empty).toEqual(
      expect.arrayContaining(["text-transparent", "underline", "decoration-muted"]),
    );
    // Nothing fills it: no grey bar that reads as loading.
    expect(empty.filter((name) => name.startsWith("bg-"))).toEqual([]);
    // Control: the filled blank is drawn on the brand tint, its answer in the text's colour.
    const filled = classes(true);
    expect(filled).toContain("bg-brand-tint");
    expect(filled).not.toContain("text-transparent");
    expect(filled).not.toContain("underline");
  });
});

// Study's cards, as the app's `whole_card_view_test.dart` and `study_screen_test.dart` check them
// (#635).
describe("a whole card on study's cards", () => {
  const cells = (answer: string): Cell[] => [
    { kind: "blank", block: { kind: "cloze", text: "Le ___ dort", answers: [answer] } },
  ];

  it("draws an empty blank as a box on the hatch two ems wide whatever its answer, with no underline and no answer, and a filled one its answer on the hatch", () => {
    for (const answer of ["a", "un chat très grand"]) {
      const { container, unmount } = render(
        <WholeCells cells={cells(answer)} revealed={false} studied />,
      );
      const blank = container.querySelector<HTMLElement>("[data-blank]");
      expect(blank?.dataset.blank).toBe("boxed");
      const names = blank?.className.split(" ") ?? [];
      expect(names).toEqual(expect.arrayContaining(["hatch", "inline-block"]));
      expect(names).not.toContain("underline");
      expect(blank?.style.width).toBe("2em");
      expect(blank?.textContent).toBe("");
      expect(container.textContent).not.toContain(answer);
      unmount();
    }
    // Control: revealed, the answer is on the same hatch.
    const { container } = render(<WholeCells cells={cells("chat")} revealed studied />);
    const filled = container.querySelector<HTMLElement>("[data-blank]");
    expect(filled?.className.split(" ")).toContain("hatch");
    expect(filled?.textContent).toBe("chat");
  });

  it("draws a table's hidden cell as the same box, and a photo's boxes on the hatch with the answer on it once revealed", () => {
    const table: Cell[] = [
      {
        kind: "blank",
        block: {
          kind: "table",
          columns: ["Capital", "Country"],
          rows: [["Paris", "France"]],
          blanks: [{ row: 0, column: 0 }],
          spans: [],
        },
      },
    ];
    const hidden = render(<WholeCells cells={table} revealed={false} studied />);
    expect(
      [...hidden.container.querySelectorAll<HTMLElement>("[data-blank]")].map(
        (blank) => blank.dataset.blank,
      ),
    ).toEqual(["boxed"]);
    expect(hidden.container.textContent).not.toContain("Paris");
    hidden.unmount();

    const [photo] = photos;
    if (photo?.kind !== "image") throw new Error("the wide photo");
    const photoCells: Cell[] = [{ kind: "blank", block: photo }];
    for (const revealed of [false, true]) {
      const { container, unmount } = render(
        <WholeCells cells={photoCells} revealed={revealed} studied />,
      );
      const marks = [...container.querySelectorAll<HTMLElement>("[data-box]")];
      expect(marks.every((mark) => mark.className.split(" ").includes("hatch"))).toBe(true);
      expect(marks.some((mark) => mark.className.includes("bg-hero"))).toBe(false);
      expect(marks[0]?.textContent).toBe(revealed ? "Paris" : "");
      unmount();
    }
  });

  it("keeps each box on one line with the word or punctuation it touches", () => {
    const { container } = render(
      <WholeCells
        cells={[
          {
            kind: "blank",
            block: { kind: "cloze", text: "모음: ___, ___이다 끝", answers: ["ㅏ", "ㅗ"] },
          },
        ]}
        revealed={false}
        studied
      />,
    );
    const words = [...container.querySelectorAll<HTMLElement>("[data-blank='boxed']")].map(
      (box) => box.parentElement,
    );
    expect(words.map((word) => word?.textContent)).toEqual([",", "이다"]);
    for (const word of words) expect(word?.className).toBe("whitespace-nowrap");
    // Control: a word with no box is not held together.
    expect(container.querySelectorAll(".whitespace-nowrap")).toHaveLength(2);
    expect(container.textContent).toBe("모음: , 이다 끝");
  });

  it("counts a front's length with each blank as its box's width", () => {
    expect(faceLength([{ kind: "text", text: "사과" }])).toBe(2);
    expect(
      faceLength([{ kind: "cloze", text: "Le ___ dort", answers: ["un chat très grand"] }]),
    ).toBe("Le  dort".length + 2);
  });
});

// A cloze card with a sound beside its sentence (ADR 0112).
describe("a sound on a whole card", () => {
  it("is named 소리 with its length, with no control inside the card, which a button holds", () => {
    const { container } = render(
      <WholeCard
        blocks={[
          { kind: "cloze", text: "___ says meow", answers: ["cat"] },
          { kind: "audio", media: "m1", durationMs: 1250 },
        ]}
        revealed={false}
      />,
    );

    expect(container.querySelector("[data-audio=m1]")?.textContent).toBe("소리 0:02");
    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector("[role=group]")?.getAttribute("aria-label")).toBe(
      "빈칸 says meow. 소리",
    );
  });
});

// A card of several 칸 drawn whole, each in place (ADR 0137).
describe("a whole card's 칸", () => {
  const cells: Cell[] = [
    { kind: "text", front: "Colour", back: "A flower." },
    { kind: "blank", block: { kind: "cloze", text: "___ is red.", answers: ["Rose"] } },
    { kind: "text", front: "", back: "After." },
    {
      kind: "word",
      term: "apple",
      ask: "term",
      senses: [{ labels: [], meaning: "사과", examples: [] }],
    },
    { kind: "placed", block: { kind: "audio", media: "before", durationMs: 1000 }, side: "front" },
    { kind: "placed", block: { kind: "audio", media: "after", durationMs: 2000 }, side: "back" },
  ];
  const draw = (revealed: boolean, inRow?: boolean) => {
    const { container, unmount } = render(
      <WholeCells cells={cells} revealed={revealed} inRow={inRow} />,
    );
    const group = container.querySelector<HTMLElement>("[role=group]");
    if (!group) throw new Error("no group drawn");
    return { group, parts: [...group.children] as HTMLElement[], unmount };
  };

  it("draws what shows before the reveal in order, with its blank empty and nothing of an added part", () => {
    const { group, parts } = draw(false);

    expect(parts.map((part) => part.textContent)).toEqual([
      "Colour",
      "Rose is red.",
      "apple",
      "소리 0:01",
    ]);
    expect(blanksUnder(group)).toEqual({ Rose: false });
    expect(group.getAttribute("aria-label")).toBe("Colour. 빈칸 is red.. apple. 소리");
    expect(group.querySelector("[data-audio=after]")).toBeNull();
  });

  it("draws every 칸 revealed in place, an added part under its larger first part, in ink-2", () => {
    const { group, parts } = draw(true);

    expect(parts.map((part) => part.textContent)).toEqual([
      "Colour",
      "A flower.",
      "Rose is red.",
      "After.",
      "apple",
      "사과",
      "소리 0:01",
      "소리 0:02",
    ]);
    expect(blanksUnder(group)).toEqual({ Rose: true });
    expect(group.getAttribute("aria-label")).toBe(
      "Colour. A flower.. Rose is red.. After.. apple. 사과. 소리. 소리",
    );
    for (const at of [1, 3, 5]) {
      expect(parts[at]?.className).toContain("text-whole-added");
      expect(parts[at]?.className).toContain("text-ink-2");
    }
    // Control: a first part keeps the title's style.
    expect(parts[0]?.className).toContain("text-whole-front");
    expect(parts[0]?.className).not.toContain("text-ink-2");
  });

  it("draws an added part at regular weight in ink-2 in a list row, keeping the row's size", () => {
    const { parts } = draw(true, true);
    expect(parts[1]?.className).toContain("font-normal");
    expect(parts[1]?.className).toContain("text-ink-2");
    expect(parts[1]?.className).not.toContain("text-whole-added");
    // Control: a first part keeps the row's style.
    expect(parts[0]?.className).not.toContain("text-ink-2");
  });
});
