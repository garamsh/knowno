import Link from "next/link";

import { switchLink } from "./admin-section";

/**
 * A section's switch between its views, each an address of its own: 노트's lists, 검토 중 and
 * 금칙어, and 설정's three pages. One solid surface on its edge, the current view marked by a flat
 * fill, as a segmented control draws it; the views wrap onto a second row where they do not fit, so
 * nothing hangs past the page.
 */
export function ViewSwitch({
  label,
  views,
}: {
  label: string;
  views: readonly { href: string; label: string; current: boolean }[];
}) {
  return (
    <nav aria-label={label} className="max-w-full self-start pb-2">
      <ul className="flex flex-wrap gap-1 rounded-button bg-surface p-1">
        {views.map((view) => (
          <li key={view.href}>
            <Link
              href={view.href}
              aria-current={view.current ? "page" : undefined}
              className={`${switchLink(view.current)} [--edge:0px]`}
            >
              {view.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
