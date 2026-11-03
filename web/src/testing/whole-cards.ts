/** Each blank of a whole card under [element], by its answer: true where it is filled. */
export function blanksUnder(element: HTMLElement): Record<string, boolean> {
  return Object.fromEntries(
    [...element.querySelectorAll("[data-blank]")].map((blank) => [
      blank.textContent,
      blank.getAttribute("data-blank") === "filled",
    ]),
  );
}

/** Each blank of a card list's row under [element], by its answer, in order: those on the hatch. */
export function hatchedBlanksUnder(element: HTMLElement): (string | null)[] {
  return [...element.querySelectorAll('[data-blank="marked"]')].map((blank) => blank.textContent);
}

/**
 * How many empty blanks study's cards draw under [element] as a box on the hatch, with no answer in
 * it (#635).
 */
export function boxedBlanksUnder(element: HTMLElement): number {
  const boxes = [...element.querySelectorAll<HTMLElement>('[data-blank="boxed"]')];
  if (boxes.some((box) => !box.classList.contains("hatch") || box.textContent !== "")) {
    throw new Error("a box not on the hatch, or holding its answer");
  }
  return boxes.length;
}
