"use client";

import { useEffect } from "react";

/**
 * While 홈 shows, the browser's bar takes the sky's colour, `hero` in the theme the page is drawn
 * in, the user's choice (`data-theme`) or else the system's; from 1024 px, where the sky is in the
 * content column, and while a photo import's bar heads the page, the ground's. It puts its own
 * `theme-color` before the root layout's, which the browser then passes over, and takes it out
 * when 홈 goes. It draws nothing.
 */
export function SkyThemeColor() {
  useEffect(() => {
    const root = document.documentElement;
    const meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.prepend(meta);
    // A browser without media queries is drawn narrow, in the theme its page names.
    const query = (media: string) =>
      typeof window.matchMedia === "function" ? window.matchMedia(media) : null;
    const wide = query("(width >= 1024px)");
    const dark = query("(prefers-color-scheme: dark)");
    const update = () => {
      const ground =
        (wide?.matches ?? false) || root.style.getPropertyValue("--photo-import-bar") !== "";
      meta.content = getComputedStyle(root)
        .getPropertyValue(ground ? "--color-ground" : "--color-hero")
        .trim();
    };
    update();
    // The theme's attribute, and the style that carries the import bar's height.
    const observer = new MutationObserver(update);
    observer.observe(root, { attributeFilter: ["data-theme", "style"] });
    wide?.addEventListener("change", update);
    dark?.addEventListener("change", update);
    return () => {
      observer.disconnect();
      wide?.removeEventListener("change", update);
      dark?.removeEventListener("change", update);
      meta.remove();
    };
  }, []);
  return null;
}
