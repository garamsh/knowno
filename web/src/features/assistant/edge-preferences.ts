import { useSyncExternalStore } from "react";

/** The edge a browser keeps 말랑이 at, and whether it was told what tapping 말랑이 does (#711). */
const sideKey = "knowno.assistant.edge";
const hintKey = "knowno.assistant.hint";

export type EdgeSide = "left" | "right";

const changeEvent = "knowno-assistant-preference";

/** What was set while storage refused it: the choice holds for this page, not the next. */
const memory = new Map<string, string>();

function read(key: string): string | null {
  const kept = memory.get(key);
  if (kept !== undefined) return kept;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
    memory.delete(key);
  } catch {
    // Storage refused: the value holds until the page is left.
    memory.set(key, value);
  }
  window.dispatchEvent(new Event(changeEvent));
}

function subscribe(changed: () => void) {
  window.addEventListener("storage", changed);
  window.addEventListener(changeEvent, changed);
  return () => {
    window.removeEventListener("storage", changed);
    window.removeEventListener(changeEvent, changed);
  };
}

/** The edge 말랑이 sits at: the right until the user drags it to the left. */
export function useEdgeSide(): [EdgeSide, (side: EdgeSide) => void] {
  const stored = useSyncExternalStore(
    subscribe,
    () => read(sideKey),
    () => null,
  );
  return [
    stored === "left" ? "left" : "right",
    (side) => {
      write(sideKey, side);
    },
  ];
}

/**
 * Whether the one-time hint is gone for good, and the call that ends it. The server, knowing
 * nothing, counts it gone, so the hint is drawn only once the browser has said otherwise.
 */
export function useHintGone(): [boolean, () => void] {
  const stored = useSyncExternalStore(
    subscribe,
    () => read(hintKey) ?? "unset",
    () => "gone",
  );
  return [
    stored !== "unset",
    () => {
      write(hintKey, "gone");
    },
  ];
}
