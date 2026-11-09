import type { ReactNode } from "react";

/**
 * The frame of a screen the user lands on, as the phone's `ScreenSkeleton` draws it
 * (`design/frames.md` §Screen skeleton): the [title] with the screen's [actions] at its end, the
 * [search] under it, then the body, [children], a section gap apart. The shell's `main` holds the
 * gutters every slot sits on. A [topLevel] screen, one the menu opens, shares one line between the
 * title and the actions, wrapping the actions under a long title; any other screen has a bar of
 * the actions above its title. [userTitle] draws a name the user wrote, two lines at most.
 */
export function ScreenSkeleton({
  title,
  topLevel = false,
  userTitle = false,
  actions,
  search,
  children,
}: {
  title: ReactNode;
  topLevel?: boolean;
  userTitle?: boolean;
  actions?: ReactNode;
  search?: ReactNode;
  children: ReactNode;
}) {
  const name = (
    <h1
      className={
        userTitle ? "line-clamp-2 text-deck-name break-words break-keep" : "text-deck-title"
      }
    >
      {title}
    </h1>
  );
  return (
    <div className="flex flex-1 flex-col gap-4">
      {topLevel ? (
        <header
          data-slot="header"
          className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2"
        >
          {name}
          {actions}
        </header>
      ) : (
        <header data-slot="header" className="flex flex-col gap-2">
          {actions && (
            <div className="flex min-h-tap-target items-center justify-end gap-2">{actions}</div>
          )}
          {name}
        </header>
      )}
      {search && <div data-slot="search">{search}</div>}
      <div data-slot="body" className="flex flex-1 flex-col gap-section-gap">
        {children}
      </div>
    </div>
  );
}
