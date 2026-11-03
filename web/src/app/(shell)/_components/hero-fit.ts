/**
 * 홈 as one grid, shared by the page and its skeleton: the hero's rows, then a last row for what is
 * under the hero. Below 1024 px it is the screen's height above the tab bar, and the mascot's row
 * takes what the other rows leave, from `mascot-hero` down to `mascot-floor`; the spaces round the
 * hero's group give way first. Its least height is every row with the mascot at its floor, so it
 * grows past the screen rather than cut a word. One grid, not the hero in a row of another: a row's
 * least height is read with the mascot at its largest, so a nested hero never gives way.
 */
export const homeFit =
  "-mt-6 grid h-[calc(100dvh-6rem)] min-h-min gap-y-1 grid-rows-[auto_1fr_minmax(var(--spacing-mascot-floor),var(--spacing-mascot-hero))_auto_auto_auto_1fr_auto] lg:mt-0 lg:h-auto";

/**
 * The hero over the first seven rows of [homeFit]: its top bar, then the group centred between two
 * spaces. It takes the grid's gap: a gap of its own would add half its difference to the rows'.
 */
export const heroFit = "row-span-7 grid grid-rows-subgrid";

/** What is under the hero, the hero's gap and this margin apart. */
export const belowHero = "mt-3 lg:mt-5";

/**
 * The hero's group over the mascot's row and the three under it, its first item filling its row.
 * It takes the hero's gap, as the hero takes the grid's.
 */
export const heroFitGroup =
  "row-span-4 row-start-3 grid grid-rows-subgrid justify-items-center text-center [&>:first-child]:h-full [&>:first-child]:w-auto";
