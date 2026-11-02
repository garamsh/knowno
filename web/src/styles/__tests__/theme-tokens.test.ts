// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = path.join(import.meta.dirname, "../../../..");
const themeDart = readFileSync(path.join(root, "app/lib/design/theme.dart"), "utf8");
const googleButtonDart = readFileSync(
  path.join(root, "app/lib/account/src/google_button.dart"),
  "utf8",
);
const globalsCss = readFileSync(path.join(root, "web/src/styles/globals.css"), "utf8");

/** A Dart name in kebab case, as the web's tokens spell it: `deckTitle` is `deck-title`. */
function kebab(name: string): string {
  return name.replace(/[A-Z]|\d+/g, (part) => `-${part.toLowerCase()}`);
}

/** The body of `abstract final class [name]` in theme.dart. */
function dartClass(name: string): string {
  const body = new RegExp(`abstract final class ${name} \\{([\\s\\S]*?)\\n\\}`).exec(
    themeDart,
  )?.[1];
  if (body === undefined) throw new Error(`theme.dart has no ${name}`);
  return body;
}

/** The colours of one `AppColors` set in theme.dart, by token name, as lowercase #rrggbb. */
function dartColors(set: "light" | "dark"): Map<string, string> {
  const body = new RegExp(`static const ${set} = AppColors\\(([^;]*)\\);`).exec(themeDart)?.[1];
  if (body === undefined) throw new Error(`theme.dart has no AppColors.${set}`);
  return new Map(
    [...body.matchAll(/(\w+): Color\(0xFF([0-9A-Fa-f]{6})\)/g)].map(([, name, hex]) => [
      kebab(String(name)),
      `#${String(hex).toLowerCase()}`,
    ]),
  );
}

/** The `--color-*` tokens a CSS block declares, by token name. */
function cssColors(block: string): Map<string, string> {
  return new Map(
    [...block.matchAll(/--color-([\w-]+):\s*(#[0-9a-f]{6});/g)].map(([, name, hex]) => [
      String(name),
      String(hex),
    ]),
  );
}

const lightCss = /@theme \{([^}]*)\}/.exec(globalsCss)?.[1] ?? "";
/** The dark set the system's dark mode applies while the user's choice is the system's. */
const systemDarkCss =
  /prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\) \{([^}]*)\}/.exec(
    globalsCss,
  )?.[1] ?? "";
/** The dark set the user's "다크" applies, whatever the system's mode. */
const chosenDarkCss =
  /:root\[data-theme="dark"\] \{([^}]*--color[^}]*)\}/.exec(globalsCss)?.[1] ?? "";

/** Google's button colours are GoogleButtonStyle's, not AppColors'; they are compared below. */
const isGoogle = ([name]: [string, unknown]) => name.startsWith("google");
const withoutGoogle = <T>(tokens: Map<string, T>) =>
  new Map([...tokens].filter((entry) => !isGoogle(entry)));
const onlyGoogle = <T>(tokens: Map<string, T>) => new Map([...tokens].filter(isGoogle));

describe("the web theme's colour tokens", () => {
  it("are the light tokens of app/lib/design/theme.dart", () => {
    expect(dartColors("light").size).toBe(49);
    expect(withoutGoogle(cssColors(lightCss))).toEqual(dartColors("light"));
  });

  it("are the dark tokens of app/lib/design/theme.dart, for the system's dark mode and for 다크", () => {
    expect(dartColors("dark").size).toBe(49);
    expect(withoutGoogle(cssColors(systemDarkCss))).toEqual(dartColors("dark"));
    expect(withoutGoogle(cssColors(chosenDarkCss))).toEqual(dartColors("dark"));
  });
});

/** The body of `static const [set] = GoogleButtonStyle._(…);` in google_button.dart. */
function dartGoogleStyle(set: "light" | "dark"): string {
  const body = new RegExp(`static const ${set} = GoogleButtonStyle\\._\\(([^;]*)\\);`).exec(
    googleButtonDart,
  )?.[1];
  if (body === undefined) throw new Error(`google_button.dart has no GoogleButtonStyle.${set}`);
  return body;
}

/** GoogleButtonStyle's colours of one theme, as the web's `google-*` tokens name them. */
function dartGoogleColors(set: "light" | "dark"): Map<string, string> {
  return new Map(
    [...dartGoogleStyle(set).matchAll(/(fill|stroke|label): Color\(0xFF([0-9A-Fa-f]{6})\)/g)].map(
      ([, name, hex]) => [`google-${String(name)}`, `#${String(hex).toLowerCase()}`],
    ),
  );
}

describe("the web's Google button tokens", () => {
  it("are GoogleButtonStyle's light colours, the guidelines' white button", () => {
    // Control: google_button.dart's light button is the guidelines' fill, stroke and label.
    expect(dartGoogleColors("light")).toEqual(
      new Map([
        ["google-fill", "#ffffff"],
        ["google-stroke", "#747775"],
        ["google-label", "#1f1f1f"],
      ]),
    );
    expect(onlyGoogle(cssColors(lightCss))).toEqual(dartGoogleColors("light"));
  });

  it("are GoogleButtonStyle's dark colours in either dark set", () => {
    expect(dartGoogleColors("dark").size).toBe(3);
    expect(onlyGoogle(cssColors(systemDarkCss))).toEqual(dartGoogleColors("dark"));
    expect(onlyGoogle(cssColors(chosenDarkCss))).toEqual(dartGoogleColors("dark"));
  });

  it("are GoogleButtonStyle's label, mark and Android and web spacing", () => {
    const body = /final class GoogleButtonStyle \{([\s\S]*?)\n\}/.exec(googleButtonDart)?.[1] ?? "";
    const label = /labelStyle = TextStyle\(([^)]*)\)/.exec(body)?.[1] ?? "";
    const spacing = /_ => \(start: ([\d.]+), gap: ([\d.]+), end: ([\d.]+)\)/.exec(body);
    // Control: both sides are read.
    expect(Number(/markSize = ([\d.]+);/.exec(body)?.[1])).toBe(20);
    expect(spacing).not.toBeNull();

    expect(cssType().get("google")).toEqual({
      size: Number(/fontSize: ([\d.]+)/.exec(label)?.[1]),
      lineHeight: 20,
      weight: Number(/fontWeight: FontWeight\.w(\d+)/.exec(label)?.[1]),
      letterSpacing: 0,
    });
    expect(/height: 20 \/ 14/.test(label)).toBe(true);
    expect(onlyGoogle(cssSpacing)).toEqual(
      new Map([
        ["google-mark", Number(/markSize = ([\d.]+);/.exec(body)?.[1])],
        ["google-start", Number(spacing?.[1])],
        ["google-gap", Number(spacing?.[2])],
        ["google-end", Number(spacing?.[3])],
      ]),
    );
  });
});

/** The radii of `AppRadius` in theme.dart, by token name, in logical pixels. */
function dartRadii(): Map<string, number> {
  const body = /abstract final class AppRadius \{([^}]*)\}/.exec(themeDart)?.[1];
  if (body === undefined) throw new Error("theme.dart has no AppRadius");
  return new Map(
    [...body.matchAll(/static const (\w+) = ([\d.]+);/g)].map(([, name, value]) => [
      String(name),
      Number(value),
    ]),
  );
}

describe("the web theme's radius tokens", () => {
  it("are the radii of app/lib/design/theme.dart's AppRadius", () => {
    const radii = new Map(
      [...lightCss.matchAll(/--radius-([\w-]+):\s*([\d.]+)px;/g)].map(([, name, value]) => [
        String(name),
        Number(value),
      ]),
    );
    // Control: both sides read their tokens, the card's radius among them.
    expect(dartRadii().get("card")).toBe(28);
    expect([...radii.keys()].sort()).toEqual([
      "button",
      "card",
      "chip",
      "field",
      "group",
      "panel",
      "previous",
      "row",
      "sheet",
    ]);

    for (const [name, value] of radii) {
      expect({ name, value }).toEqual({ name, value: dartRadii().get(name) });
    }
  });
});

/** A type style's size, line height and letter spacing in pixels, and its weight. */
type TypeStyle = { size: number; lineHeight: number; weight: number; letterSpacing: number };

/** The styles of `AppType` in theme.dart, by token name. */
function dartType(): Map<string, TypeStyle> {
  return new Map(
    [...dartClass("AppType").matchAll(/static const (\w+) = TextStyle\(([^)]*)\);/g)].map(
      ([, name, body = ""]) => {
        const size = Number(/fontSize: ([\d.]+)/.exec(body)?.[1]);
        const [, over, under] = /height: ([\d.]+) \/ ([\d.]+)/.exec(body) ?? [];
        return [
          kebab(String(name)),
          {
            size,
            lineHeight: Math.round((Number(over) / Number(under)) * size * 100) / 100,
            // Jua's one face: the phone asks for its own weight, which Flutter would thicken
            // otherwise, and the web declares it at 800 so its fallback is Pretendard ExtraBold.
            weight: body.includes("appDisplayFontFamily")
              ? 800
              : Number(/fontWeight: FontWeight\.w(\d+)/.exec(body)?.[1]),
            letterSpacing: Number(/letterSpacing: (-?[\d.]+)/.exec(body)?.[1] ?? 0),
          },
        ];
      },
    ),
  );
}

/** The `--text-*` styles `@theme` declares, by token name; an absent letter spacing is 0. */
function cssType(): Map<string, TypeStyle> {
  const value = (name: string, part: string) =>
    new RegExp(`--text-${name}${part}:\\s*(-?[\\d.]+)(?:px)?;`).exec(lightCss)?.[1];
  return new Map(
    [...lightCss.matchAll(/--text-([a-z]+(?:-[a-z]+)*):\s*[\d.]+px;/g)].map(([, name = ""]) => [
      name,
      {
        size: Number(value(name, "")),
        lineHeight: Number(value(name, "--line-height")),
        weight: Number(value(name, "--font-weight")),
        letterSpacing: Number(value(name, "--letter-spacing") ?? 0),
      },
    ]),
  );
}

describe("the web theme's type tokens", () => {
  it("are the styles of app/lib/design/theme.dart's AppType: size, line height, weight and tracking", () => {
    // Control: both sides read every style, the front's tracking among them.
    expect(dartType().size).toBe(20);
    expect(dartType().get("front")).toEqual({
      size: 42,
      lineHeight: 46,
      weight: 800,
      letterSpacing: -0.6,
    });
    expect(withoutGoogle(cssType())).toEqual(dartType());
  });
});

/** The `static const` numbers of [body], by name, a name standing for another's value resolved. */
function dartNumbers(body: string): Map<string, number> {
  const numbers = new Map<string, number>();
  for (const [, name = "", value = ""] of body.matchAll(/static const (\w+) = ([\w.]+);/g)) {
    const resolved = /^[\d.]+$/.test(value) ? Number(value) : numbers.get(value);
    if (resolved !== undefined) numbers.set(name, resolved);
  }
  return numbers;
}

/** The `--spacing-*` tokens `@theme` declares, by name, in pixels. */
const cssSpacing = new Map(
  [...lightCss.matchAll(/--spacing-([\w-]+):\s*([\d.]+)px;/g)].map(([, name, value]) => [
    String(name),
    Number(value),
  ]),
);

/** The spacing tokens named for one of AppSpace's named gaps; every other is a size. */
const namedGaps = ["gutter", "row-gap", "section-gap"];

describe("the web theme's spacing tokens", () => {
  it("make every step of app/lib/design/theme.dart's AppSpace a whole number of the 4 px unit", () => {
    const steps = dartNumbers(dartClass("AppSpace"));
    // Control: the steps and the named gaps are read.
    expect(steps.get("s40")).toBe(40);
    expect(steps.get("sectionGap")).toBe(28);
    expect(/--spacing:\s*([\d.]+)px;/.exec(lightCss)?.[1]).toBe("4");

    for (const [name, value] of steps) {
      expect({ name, steps: value / 4 }).toEqual({ name, steps: Math.round(value / 4) });
    }
  });

  it("name AppSpace's gutter, row gap and section gap with their values", () => {
    const steps = dartNumbers(dartClass("AppSpace"));
    for (const name of namedGaps) {
      expect({ name, value: cssSpacing.get(name) }).toEqual({
        name,
        value: steps.get(name.replace(/-(\w)/g, (_, letter: string) => letter.toUpperCase())),
      });
    }
  });
});

describe("the web theme's size tokens", () => {
  it("are the sizes of app/lib/design/theme.dart's AppSize under the same names", () => {
    const sizes = new Map(
      [...dartNumbers(dartClass("AppSize"))].map(([name, value]) => [kebab(name), value]),
    );
    const web = [...withoutGoogle(cssSpacing)].filter(([name]) => !namedGaps.includes(name));
    // Control: both sides read their sizes, the button's height among them.
    expect(sizes.get("button")).toBe(64);
    expect(web.length).toBe(17);

    for (const [name, value] of web) {
      expect({ name, value }).toEqual({ name, value: sizes.get(name) });
    }
  });
});
