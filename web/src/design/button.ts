/**
 * A button's role, as the phone's `AppButtonVariant` ranks the actions on a screen
 * (`design/components.md` §When each is used): the one primary fill, the primary on the hero, the
 * surface beside it, the tonal action beside a list's title, red text, the red fill as the last
 * step of a destructive action, and a quiet action in text, on the ground or on the hero.
 */
export type ButtonVariant =
  | "primary"
  | "onHero"
  | "secondary"
  | "tonal"
  | "destructive"
  | "destructiveFinal"
  | "text"
  | "onHeroText";

/**
 * A button's size, as the phone's `AppButtonSize`: `cta` for the actions at the foot of a screen
 * or a sheet and `regular` elsewhere, in the `button` type, and `header`, a tap target high in the
 * `label` type, for the action beside a title or in a row.
 */
export type ButtonSize = "regular" | "cta" | "header";

const fills: Record<ButtonVariant, string> = {
  primary: "bg-primary text-on-primary outline-ink",
  onHero: "bg-hero-button text-on-hero-button outline-on-hero",
  secondary: "bg-surface text-ink outline-ink",
  tonal: "bg-brand-tint text-accent outline-ink",
  destructive: "text-dont-know-text outline-ink",
  destructiveFinal: "bg-dont-know-text text-on-dont-know-text outline-ink",
  text: "text-ink outline-ink",
  onHeroText: "text-on-hero outline-on-hero",
};

/** A filled button's padding across; a text button keeps its words close to its tap target. */
const unfilled = new Set<ButtonVariant>(["destructive", "text", "onHeroText"]);

const sizes: Record<ButtonSize, string> = {
  regular: "min-h-button text-button",
  cta: "min-h-cta text-button",
  header: "min-h-tap-target text-label whitespace-nowrap",
};

/**
 * A button's height and type alone, for a button whose fill no role names: study's answers on
 * their 안다 and 모른다 tints, which the phone has no button for since it answers by a swipe,
 * drawn at the size the phone's `AppButton` gives a cta, `AppType.button`.
 */
export function buttonSize(size: ButtonSize): string {
  return sizes[size];
}

/**
 * The classes of the one button, for a `<button>`, a link or a label drawn as one: its role's fill
 * and text on the `button` radius, its size, the press of `.pressable`, a visible focus ring and
 * the disabled dim. A caller adds only where the button sits — its width, its flex share, its
 * alignment or a margin — never a colour, a size or a padding of its own.
 */
export function buttonClass(variant: ButtonVariant, size: ButtonSize = "regular"): string {
  const padding = unfilled.has(variant) ? "px-1" : size === "header" ? "px-4" : "px-5";
  return `pressable flex items-center justify-center gap-2 rounded-button text-center break-keep not-disabled:cursor-pointer outline-offset-2 focus-visible:outline-2 has-focus-visible:outline-2 disabled:opacity-50 ${padding} ${buttonSize(size)} ${fills[variant]}`;
}
