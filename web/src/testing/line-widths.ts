import { vi } from "vitest";

/**
 * Lays lines out as jsdom cannot, for `FittedLine`: every box [column] px wide, and every element
 * as wide as its text at 20 px a character, before any zoom. Returns the restore.
 */
export function layOutLines(column: number): () => void {
  const clientWidth = vi
    .spyOn(HTMLElement.prototype, "clientWidth", "get")
    .mockImplementation(() => column);
  const rect = vi
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: HTMLElement) {
      const width = this.textContent.length * 20;
      return new DOMRect(0, 0, width, 20);
    });
  return () => {
    clientWidth.mockRestore();
    rect.mockRestore();
  };
}

/** The zoom [element] is drawn at: its own, or its nearest ancestor's that sets one; 1 with none. */
export function zoomOf(element: Element): number {
  for (let at: Element | null = element; at; at = at.parentElement) {
    if (at instanceof HTMLElement && at.style.zoom) return Number(at.style.zoom);
  }
  return 1;
}
