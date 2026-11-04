"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";

import { belowHero } from "./hero-fold";

/** Below this width the hero collapses; from it the side menu's column takes it at its height. */
const narrow = "(width < 64rem)";

/** Past this share of the collapse the bar is the hero's to read and press, as on the phone. */
const swap = 0.5;

/**
 * 홈's hero below 1024 px as the phone draws it (#728): at rest it fills the first screen, its blue
 * up behind the status bar; scrolled, it shrinks into a slim bar pinned at the top, [bar], the day
 * in a line and a compact 시작, while what is under it, [below], goes up beneath. Where its words
 * need more than the first screen, the page scrolls by what they need past it before the hero
 * shrinks. A scroll the user started that ends part way collapses or expands it fully.
 *
 * The hero is sticky at a negative top, so it rises with the page until only the bar's height of
 * it shows; its content is held against that rise, the face at half of it, and fades as the phone's
 * does through `--hero-t`, 0 at rest and 1 collapsed (`heroGroup`).
 */
export function CollapsingHero({
  className,
  labelledBy,
  bar,
  below,
  children,
}: {
  className: string;
  labelledBy: string;
  bar: ReactNode;
  below?: ReactNode;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const hero = useRef<HTMLElement>(null);
  const barBox = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const page = root.current;
    const section = hero.current;
    const pinned = barBox.current;
    if (!page || !section || !pinned) return;
    // Without them, as in jsdom, the hero stays at rest.
    if (typeof window.matchMedia !== "function" || typeof ResizeObserver === "undefined") return;
    const width = window.matchMedia(narrow);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const scrollEnds = "onscrollend" in window;
    // The hero's height at rest, the first screen's share of it, the bar's height, and where the
    // hero's top is in the document.
    let rest = 0;
    let fill = 0;
    let min = 0;
    let top = 0;
    let frame = 0;
    // Whether the scroll under way is the user's, and whether a finger is still on the screen.
    let user = false;
    let touching = false;
    let quiet = 0;

    const scrolled = () => Math.min(Math.max(window.scrollY - top, 0), rest - min);
    const draw = () => {
      frame = 0;
      const shift = scrolled();
      const follow = Math.min(shift, Math.max(rest - fill, 0));
      const travel = fill - min;
      const t = travel <= 0 ? 0 : Math.min(Math.max((shift - follow) / travel, 0), 1);
      section.style.setProperty("--hero-t", String(t));
      section.style.setProperty("--hero-hold", `${String(shift - follow)}px`);
      section.style.setProperty("--hero-pin", `${String(shift)}px`);
      setCollapsed(t >= swap);
    };
    const measure = () => {
      if (!width.matches) {
        section.style.removeProperty("top");
        for (const name of ["--hero-t", "--hero-hold", "--hero-pin"]) {
          section.style.removeProperty(name);
        }
        page.style.removeProperty("--hero-bar");
        setCollapsed(false);
        return;
      }
      rest = section.offsetHeight;
      fill = Math.min(parseFloat(getComputedStyle(section).minHeight) || rest, rest);
      min = pinned.offsetHeight;
      // Where the hero's top lies in the page, read with its pin let go.
      section.style.removeProperty("top");
      top = section.getBoundingClientRect().top + window.scrollY;
      section.style.top = `${String(min - rest)}px`;
      page.style.setProperty("--hero-bar", `${String(min)}px`);
      draw();
    };
    const settle = () => {
      if (!user || touching || !width.matches) return;
      user = false;
      const shift = window.scrollY - top;
      const from = Math.max(rest - fill, 0);
      const to = rest - min;
      if (shift <= from || shift >= to) return;
      window.scrollTo({
        top: top + (shift - from < (to - from) / 2 ? from : to),
        behavior: reduce.matches ? "instant" : "smooth",
      });
    };
    const onScroll = () => {
      frame ||= requestAnimationFrame(draw);
      // Where the browser sends no scrollend, the scroll has ended once it is quiet a moment.
      if (!scrollEnds) {
        window.clearTimeout(quiet);
        quiet = window.setTimeout(settle, 150);
      }
    };
    const byUser = () => {
      user = true;
    };
    const onTouchStart = () => {
      user = true;
      touching = true;
    };
    const onTouchEnd = () => {
      touching = false;
      window.clearTimeout(quiet);
      quiet = window.setTimeout(settle, 150);
    };

    measure();
    const resized = new ResizeObserver(measure);
    resized.observe(section);
    resized.observe(pinned);
    width.addEventListener("change", measure);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("scrollend", settle);
    window.addEventListener("wheel", byUser, { passive: true });
    window.addEventListener("keydown", byUser);
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchend", onTouchEnd);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(quiet);
      resized.disconnect();
      width.removeEventListener("change", measure);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("scrollend", settle);
      window.removeEventListener("wheel", byUser);
      window.removeEventListener("keydown", byUser);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, []);

  return (
    // One block, so that main's gap does not come between the hero and what is under it.
    <div ref={root}>
      <section
        ref={hero}
        aria-labelledby={labelledBy}
        className={`${className} relative overflow-clip max-lg:sticky max-lg:z-10`}
      >
        <div className="flex flex-1 flex-col" inert={collapsed} aria-hidden={collapsed}>
          {children}
        </div>
        {/* Hidden, and out of reach, until the bar is the hero's. */}
        <div
          ref={barBox}
          aria-hidden={!collapsed}
          className={`absolute inset-x-0 top-0 translate-y-[var(--hero-pin,0px)] px-gutter pt-[env(safe-area-inset-top)] opacity-[clamp(0,(var(--hero-t,0)-0.5)*2,1)] lg:hidden ${collapsed ? "" : "invisible"}`}
        >
          <div className="flex items-center gap-3 pt-1.5 pb-2.5">{bar}</div>
        </div>
      </section>
      {below && (
        // As tall as the screen less the bar and main's foot, so the hero can collapse fully.
        <div className={`${belowHero} min-h-[calc(100dvh-var(--hero-bar,0px)-7rem)] lg:min-h-0`}>
          {below}
        </div>
      )}
    </div>
  );
}
