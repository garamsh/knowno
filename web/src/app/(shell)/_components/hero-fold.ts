/**
 * 홈's hero, shared by the page and its skeleton (ADR 0179). Below 1024 px it fills the first
 * screen from main's top: with nothing under it, `100dvh` less main's room for the tab bar; with
 * something under it, down to 16 px over that thing's top edge, which shows 16 px above the tab
 * bar (the tab bar's height and its 16 px off the foot), so that the rest reads as a scroll away.
 * It grows past the screen rather than cut a word. From 1024 px it takes its own height.
 */
export const heroFold = (under: boolean) =>
  `-mt-6 flex flex-col ${under ? "min-h-[calc(100dvh-var(--spacing-tab-bar)-3rem)]" : "min-h-[calc(100dvh-6rem)]"} lg:mt-0 lg:min-h-0`;

/**
 * The hero's group under its top bar: the mascot, its first item, at `mascot-hero` in every
 * state, over the words and the action, centred in what the top bar leaves.
 */
export const heroGroup =
  "flex flex-1 flex-col items-center justify-center gap-1 py-1 text-center [&>:first-child]:size-mascot-hero [&>:first-child]:shrink-0";

/** What is under the hero: 16 px under it, its top edge 16 px above the tab bar. */
export const belowHero = "mt-4 lg:mt-6";
