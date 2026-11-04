/**
 * 홈's hero, shared by the page and its skeleton (ADR 0178). Below 1024 px it fills the screen
 * above the tab bar, `100dvh` less main's room for the tab bar, from main's top; with something
 * under it, less that thing's top edge, 16 px, and the space over it, so that the first screen
 * shows the edge and the rest follows by scrolling. It grows past the screen rather than cut a
 * word. From 1024 px it takes its own height.
 */
export const heroFold = (under: boolean) =>
  `-mt-6 flex flex-col ${under ? "min-h-[calc(100dvh-8rem)]" : "min-h-[calc(100dvh-6rem)]"} lg:mt-0 lg:min-h-0`;

/**
 * The hero's group under its top bar: the mascot, its first item, at `mascot-hero` in every
 * state, over the words and the action, centred in what the top bar leaves.
 */
export const heroGroup =
  "flex flex-1 flex-col items-center justify-center gap-1 py-1 text-center [&>:first-child]:size-mascot-hero [&>:first-child]:shrink-0";

/** What is under the hero: 16 px under it, its top edge the last 16 px of the first screen. */
export const belowHero = "mt-4 lg:mt-6";
