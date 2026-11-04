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
 * state, over the words and the action, centred in what the top bar leaves. As the hero collapses
 * (`CollapsingHero`, `--hero-t` from 0 to 1) the group rises with the hero's centre, the mascot
 * shrinking and fading first, the title, its second item, shrinking and then fading, and the rest
 * fading, as the phone's do.
 */
export const heroGroup =
  "flex flex-1 flex-col items-center justify-center gap-1 py-1 text-center translate-y-[calc(var(--hero-hold,0px)/2)] [&>:first-child]:size-mascot-hero [&>:first-child]:shrink-0 [&>:first-child]:scale-[calc(1-var(--hero-t,0)/2)] [&>:first-child]:opacity-[calc(1-min(1,var(--hero-t,0)/0.6))] [&>:nth-child(2)]:scale-[calc(1-var(--hero-t,0)*0.4)] [&>:nth-child(2)]:opacity-[calc(1-clamp(0,(var(--hero-t,0)-0.3)/0.4,1))] [&>:nth-child(n+3)]:opacity-[calc(1-min(1,var(--hero-t,0)/0.4))]";

/** The hero's top bar, held at the top while the hero collapses and fading by half of it. */
export const heroTop =
  "translate-y-[var(--hero-hold,0px)] opacity-[calc(1-min(1,var(--hero-t,0)*2))]";

/** What fades with the hero's action as it collapses: why the day cannot be read. */
export const heroFading = "opacity-[calc(1-min(1,var(--hero-t,0)/0.4))]";

/** What is under the hero: 16 px under it, its top edge 16 px above the tab bar. */
export const belowHero = "mt-4 lg:mt-6";
