/**
 * What ESLint's `no-restricted-syntax` refuses in the web's UI code (`web/eslint.config.mjs`), as
 * the phone's `theme_test.dart` refuses a literal outside the theme: a class that writes a value
 * where a token exists, and, outside `src/design/`, a class or attribute that draws by hand a job
 * a component here draws. Each is an esquery selector over a string or a template's text, and
 * none holds a `/`, which ends an esquery pattern.
 */
type Restriction = { selector: string; message: string };

/** Each selector a class [pattern] is found by, in a string and in a template's text. */
function inClasses(pattern: string, message: string): Restriction[] {
  return [
    { selector: `Literal[value=/${pattern}/]`, message },
    { selector: `TemplateElement[value.raw=/${pattern}/]`, message },
  ];
}

/** Where a class starts: the string's start, a space, or the colon after a variant. */
const start = "(^|[\\s:])";
/** Where a class ends. */
const end = "(?![\\w-])";

const palette =
  "(white|black|(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\\d{2,3})";
const colourUtilities =
  "(bg|text|border(-[xytrblse])?|outline|ring|ring-offset|fill|stroke|from|via|to|divide|decoration|accent|caret|placeholder|shadow)";
const radiusSides = "(-(t|r|b|l|s|e|tl|tr|br|bl|ss|se|es|ee))?";
const lengthUtilities =
  "-?(p|px|py|pt|pr|pb|pl|ps|pe|m|mx|my|mt|mr|mb|ml|ms|me|gap|gap-x|gap-y|inset|inset-x|inset-y|top|right|bottom|left|start|end|w|h|size|min-w|min-h|max-w|max-h|space-x|space-y|translate-x|translate-y|basis)";

/** A value written where `globals.css` has a token: everywhere in the UI code, `src/design/` included. */
export const tokenRules: Restriction[] = [
  ...inClasses(
    `${start}${colourUtilities}-${palette}${end}`,
    "A colour is a token of globals.css (bg-surface, text-ink …), never Tailwind's palette.",
  ),
  ...inClasses(
    `${start}${colourUtilities}-\\[(#|rgb|hsl|oklch|color\\()`,
    "A colour is a token of globals.css, never written out.",
  ),
  ...inClasses(
    `${start}text-(xs|sm|base|lg|[2-9]?xl)${end}`,
    "A type size is an AppType token of globals.css (text-body, text-caption …), never Tailwind's scale.",
  ),
  ...inClasses(
    `${start}text-\\[\\d`,
    "A type size is an AppType token of globals.css, never written out.",
  ),
  ...inClasses(
    `${start}rounded${radiusSides}-([2-4]xl|\\[\\d)`,
    "A radius the scale holds is its AppRadius token (rounded-chip, rounded-button, rounded-sheet …), never Tailwind's value or a length.",
  ),
  ...inClasses(
    `${start}${lengthUtilities}-\\[\\d+(\\.\\d+)?(px|rem|em)\\]`,
    "A spacing or size is a step of the 4 px unit or an AppSize token of globals.css, never a length written out.",
  ),
];

/** A job a component of `src/design/` draws, drawn by hand: everywhere outside `src/design/`. */
export const sharedRules: Restriction[] = [
  ...inClasses(
    `${start}text-button${end}`,
    "A button is drawn through buttonClass of @/design/button, the one place the button type is written.",
  ),
  ...inClasses(
    `${start}bg-dont-know-text${end}`,
    "The red fill is the destructive final button's (@/design/button, @/design/confirm) or the don't-know chip's (@/design/chip).",
  ),
  ...inClasses(
    "rounded-chip.*text-section|text-section.*rounded-chip",
    "A status chip is Chip of @/design/chip.",
  ),
  {
    selector: 'JSXAttribute[name.name="type"][value.value="search"]',
    message: "A search over a list is SearchField of @/design/search-field.",
  },
  {
    selector:
      'JSXElement[openingElement.name.name="section"] > JSXElement[openingElement.name.name="h2"] > JSXOpeningElement > JSXAttribute[name.name="className"][value.value=/text-section/]',
    message: "A label over a group is Section of @/design/section.",
  },
];
