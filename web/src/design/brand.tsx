"use client";

import Image from "next/image";
import { useEffect, useState, useSyncExternalStore, type CSSProperties } from "react";

import { mascotDrawings } from "./mascot-drawings";

/** The brand's lockup, 알아몰라 beside or under the mark, in its light-ground and dark-ground files under public/brand/. */
type Mark = "lockup" | "stacked";

const sizes: Record<Mark, { width: number; height: number }> = {
  lockup: { width: 674, height: 200 },
  stacked: { width: 446, height: 421 },
};

/**
 * The brand's [mark], its words cobalt on a light theme and the dark accent on a dark one, sized by [className].
 * With [alt] it is read as that name; without, it is decorative.
 */
export function BrandMark({
  mark,
  className,
  alt = "",
}: {
  mark: Mark;
  className: string;
  alt?: string;
}) {
  const { width, height } = sizes[mark];
  return (
    <>
      <Image
        src={`/brand/knowno-${mark}-light.svg`}
        alt={alt}
        width={width}
        height={height}
        unoptimized
        className={`${className} dark:hidden`}
      />
      <Image
        src={`/brand/knowno-${mark}-dark.svg`}
        alt={alt}
        width={width}
        height={height}
        unoptimized
        className={`${className} hidden dark:block`}
      />
    </>
  );
}

/** The moods of the mascot, each the same drawing (ADR 0141). */
export type MascotExpression = "thinking" | "happy" | "sad" | "sleepy";

/**
 * How much a mascot moves at its size (ADR 0152, ADR 0193): it blinks from 41 to 127 px across, and
 * from 128 it also breathes, wobbles or dozes.
 */
type Motion = "blink" | "full";

/** Whether [expression]'s eyes are open in the drawing, so it can blink. */
const blinks = (expression: MascotExpression) => mascotDrawings[expression].includes('class="eye"');

/**
 * What a mascot of [expression] [width] px across does, or null where it holds still; with
 * [breathes] it breathes though it is under 128 across, if it is over 40.
 */
function motionOf(expression: MascotExpression, width: number, breathes: boolean): Motion | null {
  if (width >= 128 || (breathes && width > 40)) return "full";
  if (width > 40 && blinks(expression)) return "blink";
  return null;
}

const reduceMotion = "(prefers-reduced-motion: reduce)";

/** Whether the system asks for reduced motion; the server, knowing nothing, holds still. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (changed) => {
      if (typeof window.matchMedia !== "function") return () => undefined;
      const query = window.matchMedia(reduceMotion);
      query.addEventListener("change", changed);
      return () => {
        query.removeEventListener("change", changed);
      };
    },
    () => typeof window.matchMedia === "function" && window.matchMedia(reduceMotion).matches,
    () => true,
  );
}

/** The eyes between gestures: open, looking ahead. */
const ahead: { shut: boolean; glance: [number, number] | null } = { shut: false, glance: null };

/**
 * The mascot in its [expression], on no ground of its own, sized by [className], decorative.
 *
 * On screen it moves, drawn inline from the parts `make brand` writes (ADR 0152): at 128 px and
 * more it blinks and breathes, the happy one wobbles and the sleepy one dozes; from 41 to 127 px it
 * only blinks, unless it [breathes], as the character at a screen's edge does at 72 px (#722). At 40 px or less, under reduce motion, off screen, and where its expression has
 * nothing to move at its size, it is the still image.
 */
export function Mascot({
  expression,
  className,
  breathes = false,
}: {
  expression: MascotExpression;
  className: string;
  breathes?: boolean;
}) {
  const reduced = useReducedMotion();
  const [element, setElement] = useState<Element | null>(null);
  const [seen, setSeen] = useState({ onScreen: false, width: 0 });
  const [eyes, setEyes] = useState(ahead);
  const motion = reduced || !seen.onScreen ? null : motionOf(expression, seen.width, breathes);

  // One observer tells whether the mascot is on screen, and how wide it is drawn.
  useEffect(() => {
    if (!element || reduced || typeof IntersectionObserver !== "function") return;
    const observer = new IntersectionObserver((entries) => {
      const entry = entries.at(-1);
      if (!entry) return;
      setSeen({ onScreen: entry.isIntersecting, width: entry.boundingClientRect.width });
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [element, reduced]);

  // The width it is drawn at changes while it stays on screen, which the intersection observer
  // does not report: the drawing is the one its width now calls for (#627).
  useEffect(() => {
    if (!element || reduced || typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries.at(-1);
      if (!entry) return;
      const { width } = entry.target.getBoundingClientRect();
      setSeen((now) => (now.width === width ? now : { ...now, width }));
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [element, reduced]);

  // A blink or a glance every 3 to 7 s while it moves, as the app's mascot makes them.
  useEffect(() => {
    if (!motion || !blinks(expression)) return;
    const timers = new Set<number>();
    const later = (ms: number, run: () => void) => {
      const timer = window.setTimeout(() => {
        timers.delete(timer);
        run();
      }, ms);
      timers.add(timer);
    };
    const hold = expression === "sad" ? 160 : 110;
    const blink = (twice: boolean) => {
      setEyes({ shut: true, glance: null });
      later(hold, () => {
        setEyes(ahead);
        if (twice) {
          later(170, () => {
            blink(false);
          });
        }
      });
    };
    const next = () => {
      later(3000 + Math.random() * 4000, () => {
        const roll = Math.random();
        if (roll < 0.2) blink(true);
        else if (roll >= 0.32) blink(false);
        else if (expression === "thinking") {
          const to: [number, number] = [(Math.random() * 2 - 1) * 22, (Math.random() * 2 - 1) * 14];
          setEyes({ shut: false, glance: to });
          later(1400, () => {
            setEyes(ahead);
          });
        }
        next();
      });
    };
    next();
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
      setEyes(ahead);
    };
  }, [motion, expression]);

  if (!motion) {
    return (
      <Image
        ref={setElement}
        src={`/brand/knowno-${expression}.svg`}
        alt=""
        width={128}
        height={128}
        unoptimized
        className={className}
      />
    );
  }
  const glance: CSSProperties | undefined = eyes.glance
    ? ({
        "--glance-x": `${String(eyes.glance[0])}px`,
        "--glance-y": `${String(eyes.glance[1])}px`,
      } as CSSProperties)
    : undefined;
  return (
    <svg
      ref={setElement}
      viewBox="0 0 1024 1024"
      aria-hidden
      className={`mascot ${className}`}
      data-expression={expression}
      data-motion={motion}
      data-eyes={eyes.shut ? "shut" : undefined}
      style={glance}
      dangerouslySetInnerHTML={{ __html: mascotDrawings[expression] }}
    />
  );
}
