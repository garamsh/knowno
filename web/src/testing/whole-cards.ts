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
