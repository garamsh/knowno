import type { Page } from "@playwright/test";

/**
 * Each interactive element that overlaps another or is clipped, as the page lies at its top: a
 * link, a button, a summary, a field, a select or a `.pressable` (a pager's arrow, a pressed row
 * included), its whole box taken with the hard edge it draws under it (`--edge`). Two overlap when
 * their boxes intersect and neither holds the other. One is clipped when an ancestor that clips
 * its overflow does not hold its box: inside the ancestor's box where it hides what overflows, and
 * inside what the ancestor scrolls through where it scrolls, so a row scrolled away is not clipped
 * but an edge past a scrolling menu's foot is. While a modal dialog is open, only what is inside it
 * is looked at, as the rest lies under it. Each is named by its tag and label.
 */
export async function overlaps(page: Page): Promise<string[]> {
  return await page.evaluate(() => {
    window.scrollTo(0, 0);
    const interactive =
      'a[href], button, summary, select, textarea, input:not([type="hidden"]), [role="button"], .pressable';
    const modal = [...document.querySelectorAll("dialog")].find((dialog) =>
      dialog.matches(":modal"),
    );
    const scope = modal ?? document.body;
    const name = (element: Element) =>
      `${element.tagName} "${(element.getAttribute("aria-label") ?? element.textContent).trim().slice(0, 24)}"`;
    const boxes = [...scope.querySelectorAll<HTMLElement>(interactive)].flatMap((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      // A visually hidden element, as a skip link at rest, is one pixel wide.
      if (rect.width <= 1 || rect.height <= 1 || style.visibility !== "visible") return [];
      const edge = parseFloat(style.getPropertyValue("--edge")) || 0;
      return [
        {
          element,
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom + edge,
        },
      ];
    });
    const found: string[] = [];
    boxes.forEach((a, index) => {
      for (const b of boxes.slice(index + 1)) {
        if (a.element.contains(b.element) || b.element.contains(a.element)) continue;
        const across = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const down = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (across > 0.5 && down > 0.5) {
          found.push(`${name(a.element)} overlaps ${name(b.element)}`);
        }
      }
      // A modal lies in the top layer, clipped by none of the elements it sits inside.
      for (
        let parent = a.element.parentElement;
        parent && scope.contains(parent);
        parent = parent.parentElement
      ) {
        const style = getComputedStyle(parent);
        if (style.overflowX === "visible" && style.overflowY === "visible") continue;
        const clip = parent.getBoundingClientRect();
        const hides = (overflow: string) => overflow === "hidden" || overflow === "clip";
        const x = a.left - clip.left - parent.clientLeft + parent.scrollLeft;
        const y = a.top - clip.top - parent.clientTop + parent.scrollTop;
        const width = hides(style.overflowX) ? parent.clientWidth : parent.scrollWidth;
        const height = hides(style.overflowY) ? parent.clientHeight : parent.scrollHeight;
        if (
          x < -0.5 ||
          y < -0.5 ||
          x + a.right - a.left > width + 0.5 ||
          y + a.bottom - a.top > height + 0.5
        ) {
          found.push(`${name(a.element)} clipped by ${name(parent)}`);
        }
      }
    });
    return [...new Set(found)];
  });
}
