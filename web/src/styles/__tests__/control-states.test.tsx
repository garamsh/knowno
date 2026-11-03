import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EnterLink } from "@/app/(shell)/_components/enter-link";
import { SideMenuAt, TabBarAt } from "@/app/(shell)/_components/shell-menu";
import { CardGrid, DeckList, parseCardId, parseDeckId } from "@/features/decks";
import { uuidOf } from "@/testing/library";

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  usePathname: () => "/",
}));

const globalsCss = readFileSync(path.join(import.meta.dirname, "../globals.css"), "utf8");

/** [id] parsed by [parse], which a test's fixed uuid always passes. */
function idOf<T>(parse: (id: string) => T | null, name: string): T {
  const id = parse(uuidOf(name));
  if (id === null) throw new Error(`${name} is no uuid`);
  return id;
}

/** Whether [element] carries the shared hover and pressed state. */
const pressable = (element: HTMLElement) => element.className.split(" ").includes("pressable");

describe("the controls' pointer, hover and pressed states", () => {
  afterEach(() => {
    document.head.querySelector("style[data-cursor]")?.remove();
  });

  it("points over an enabled button and not over a disabled one", () => {
    const rule = /@layer base \{\s*(button:not\(:disabled\) \{[^}]*\})/.exec(globalsCss)?.[1];
    expect(rule).toContain("cursor: pointer");
    const style = document.createElement("style");
    style.dataset.cursor = "";
    style.textContent = rule ?? "";
    document.head.append(style);
    render(
      <>
        <button type="button">enabled</button>
        <button type="button" disabled>
          disabled
        </button>
      </>,
    );

    expect(getComputedStyle(screen.getByRole("button", { name: "enabled" })).cursor).toBe(
      "pointer",
    );
    // Control: the same rule leaves a disabled button the arrow.
    expect(getComputedStyle(screen.getByRole("button", { name: "disabled" })).cursor).not.toBe(
      "pointer",
    );
  });

  it("moves a pressed solid object down onto its edge, the colour dim alone under reduce motion", () => {
    const motion =
      /@media \(prefers-reduced-motion: no-preference\) \{\s*\.pressable:not\(:disabled\):active \{([^}]*)\}/.exec(
        globalsCss,
      )?.[1];
    expect(motion).toContain(
      "translateY(max(0px, calc(var(--edge) - var(--spacing-edge-pressed))))",
    );
    expect(motion).toContain("box-shadow: 0 var(--spacing-edge-pressed) 0 var(--edge-colour)");
    // Control: no rule outside that query moves a control, so reduce motion keeps the dim alone.
    const outside = globalsCss.replace(
      /@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n  \}/,
      "",
    );
    expect(outside).not.toMatch(/:active[^{]*\{[^}]*transform/);
  });

  it("gives an edge to the object that declares it and not to a control inside it", () => {
    for (const name of ["--edge", "--edge-colour"]) {
      const rule = new RegExp(`@property ${name} \\{([^}]*)\\}`).exec(globalsCss)?.[1];
      expect(rule).toContain("inherits: false;");
    }
  });

  it("sits a solid object on a hard edge with no blur", () => {
    const edge = /box-shadow: 0 var\(--edge\) ([^;]*);/.exec(globalsCss)?.[1];
    expect(edge).toBe("0 var(--edge-colour)");
    for (const [name, token] of [
      ["--shadow-card", "edge-card"],
      ["--shadow-row", "edge-row"],
    ]) {
      expect(globalsCss).toContain(
        `${String(name)}: 0 var(--spacing-${String(token)}) 0 var(--color-edge);`,
      );
    }
  });

  it("dims a hovered or pressed control under a layer of its text colour, with no change of size", () => {
    const rule = /\.pressable \{([^}]*)\}/.exec(globalsCss)?.[1] ?? "";
    expect(rule).toContain("--state-layer: color-mix(in srgb, currentColor 4%, transparent);");
    for (const variant of ["not-disabled:hover:", "not-disabled:active:"]) {
      expect(rule).toContain(
        `${variant}bg-[linear-gradient(var(--state-layer),var(--state-layer))]`,
      );
    }
    // No scale, under any variant, and nothing to animate one.
    expect(rule).not.toMatch(/scale|transition/);
    // Nor does a control press with a scale of its own.
    const src = path.join(import.meta.dirname, "../..");
    const pressedScale = /active:[\w:-]*scale/;
    const components = readdirSync(src, { recursive: true, encoding: "utf8" }).filter(
      (file) => file.endsWith(".tsx") && !file.includes("__tests__"),
    );
    // Control: the walk reaches the components, and the pattern finds the scale it looks for.
    expect(components).toContain(path.join("features", "decks", "components", "card-grid.tsx"));
    expect("motion-safe:not-disabled:active:scale-98").toMatch(pressedScale);
    expect(
      components.filter((file) => pressedScale.test(readFileSync(path.join(src, file), "utf8"))),
    ).toEqual([]);
  });

  it("is on the menus' items, 모두 학습, a deck row and a deck page's cards and switch", () => {
    render(
      <>
        <SideMenuAt path="/" />
        <TabBarAt path="/" />
        <EnterLink href="/study" label="모두 학습" />
        <DeckList
          rows={[
            {
              deck: { id: idOf(parseDeckId, "d-fr"), name: "French", public: false },
              cards: 1,
              today: 1,
              mastered: 0,
              learning: 0,
            },
          ]}
        />
        <CardGrid
          deck={{ id: idOf(parseDeckId, "d-fr"), name: "French", public: false }}
          cards={[
            {
              id: idOf(parseCardId, "c-chat"),
              deckId: idOf(parseDeckId, "d-fr"),
              createdAt: 0,
              front: [{ kind: "text", text: "chat" }],
              back: [{ kind: "text", text: "cat" }],
              cells: [{ kind: "text", front: "chat", back: "cat" }],
            },
          ]}
        />
      </>,
    );

    const [side, bar] = screen.getAllByRole("navigation", { name: "주 메뉴" });
    for (const menu of [side, bar]) {
      for (const item of ["기록", "홈", "노트"]) {
        expect(pressable(within(menu as HTMLElement).getByRole("link", { name: item }))).toBe(true);
      }
    }
    expect(pressable(screen.getByRole("link", { name: "모두 학습" }))).toBe(true);
    expect(pressable(screen.getByRole("link", { name: /^French/ }))).toBe(true);
    expect(pressable(screen.getByRole("button", { name: "chat, 뒷면 가려짐" }))).toBe(true);
    expect(pressable(screen.getByRole("switch", { name: "뒷면 보기" }))).toBe(true);
    expect(pressable(screen.getByRole("button", { name: "카드 검색" }))).toBe(true);
    // Control: the note's name, a heading, takes no button state.
    expect(pressable(screen.getByRole("heading", { level: 1, name: "French" }))).toBe(false);
  });
});
