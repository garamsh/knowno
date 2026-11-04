/**
 * 홈's one screen, shared by the page and its skeleton, as the phone draws it: the sky over the
 * ground, in a box the height of the screen above the tab bar, less a photo import's bar. The sky
 * takes 58% of the screen where the ground's content leaves it room and shrinks to its own content
 * where not; the box grows past the screen, which then scrolls, rather than cut either. Under
 * `viewport-fit=cover` the sky runs up behind the status bar, its words in the safe area, and the
 * ground keeps clear of a side's inset. From 1024 px the same screen is the content column's.
 */
export const homeFrame =
  "-mt-6 flex h-[calc(100dvh-6rem-var(--photo-import-bar,0px)-env(safe-area-inset-bottom))] min-h-min flex-col lg:mt-0 lg:h-[calc(100dvh-5rem-var(--photo-import-bar,0px))]";

/** The sky: the hero's colour, edge to edge below 1024 px, its words clear of the insets. */
export const homeSky =
  "relative -mx-gutter flex shrink grow-0 basis-[58dvh] flex-col bg-hero pt-[calc(max(0px,env(safe-area-inset-top)-var(--photo-import-bar,0px))+0.5rem)] pr-[max(var(--spacing-gutter),env(safe-area-inset-right))] pl-[max(var(--spacing-gutter),env(safe-area-inset-left))] text-on-hero lg:mx-0 lg:rounded-t-card lg:px-8 lg:pt-6";

/** The sky's words, centred in what the top bar and the mascot leave. */
export const homeWords = "flex flex-1 flex-col items-center justify-center gap-1 text-center";

/**
 * The mascot's room at the sky's foot: `mascot-hero` and the hill's 32 px, less the 8 its feet
 * stand below the crest, so its box ends 24 px over the sky's foot.
 */
export const homeMascotRoom =
  "relative h-[calc(var(--spacing-mascot-hero)+6*var(--spacing))] shrink-0";

/** The mascot on the crest, centred; nothing else is drawn at its upper right (#721). */
export const homeMascot = "absolute bottom-6 left-1/2 size-mascot-hero -translate-x-1/2";

/** The ground: what it shows centred over the actions, clear of a side's inset. */
export const homeGround =
  "flex shrink-0 grow flex-col gap-3 pr-[max(0px,calc(env(safe-area-inset-right)-var(--spacing-gutter)))] pb-4 pl-[max(0px,calc(env(safe-area-inset-left)-var(--spacing-gutter)))]";
