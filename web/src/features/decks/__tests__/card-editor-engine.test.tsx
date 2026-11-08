import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useMarkupReady } from "@/design/use-markup-ready";

import { CardEditor } from "../components/card-editor";
import { parseDeckId } from "../library";

vi.mock("@/design/use-markup-ready", () => ({ useMarkupReady: vi.fn() }));
vi.mock("next/headers", () => import("@/testing/next-headers"));

const deckId = parseDeckId("00000000-0000-4000-8000-000000000001");
if (!deckId) throw new Error("fixture id");
const deck = { id: deckId, name: "단어장", public: false };

describe("the card editor and the engine's module", () => {
  it("draws nothing until the module has loaded, and the editor once it has", () => {
    vi.mocked(useMarkupReady).mockReturnValue(false);
    const { container, rerender } = render(<CardEditor deck={deck} close={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();

    vi.mocked(useMarkupReady).mockReturnValue(true);
    rerender(<CardEditor deck={deck} close={vi.fn()} />);
    expect(container.querySelector("textarea")).not.toBeNull();
  });
});
