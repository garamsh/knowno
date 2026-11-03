"use client";

import { useEffect, useRef } from "react";
import { flushSync } from "react-dom";

/** An open modal, a sheet or an authoring screen, as the browser's back reaches it while it is the top one. */
type Layer = {
  /** Answers a back as the dialog's own close button does. */
  back: () => void;
  /** Whether the history entry pushed for it is still in the history. */
  held: boolean;
};

const layers: Layer[] = [];
/** Entries of dialogs that closed in this commit, which a dialog opening in it takes over. */
let spare = 0;
/** Traversals this module started to drop entries, which no dialog answers. */
let ownPops = 0;
/** What runs once the traversal `leaveThen` started lands. */
let landing: (() => void) | null = null;
let listening = false;

function onPopState() {
  if (ownPops > 0) {
    ownPops -= 1;
    return;
  }
  if (landing) {
    const then = landing;
    landing = null;
    then();
    return;
  }
  const top = layers.at(-1);
  if (!top?.held) return;
  top.held = false;
  // Rendered at once, so a dialog that closed has left `layers` before it is looked for.
  flushSync(top.back);
  if (layers.includes(top)) {
    // It stayed, asking first or stepping back inside itself, so it holds an entry again.
    window.history.pushState(null, "");
    top.held = true;
  }
}

/**
 * Holds one history entry while the calling dialog is open, so the browser's back reaches the top
 * dialog as the phone's back reaches its top route: [back] answers it as the dialog's close
 * button does, so it asks first where that asks. A dialog that closes itself drops its entry,
 * unless one opening in the same commit takes it over, as a sheet that leads on to a screen does.
 */
export function useBackEntry(back: () => void): void {
  const latest = useRef(back);
  useEffect(() => {
    latest.current = back;
  });
  useEffect(() => {
    if (!listening) {
      window.addEventListener("popstate", onPopState);
      listening = true;
    }
    const layer: Layer = {
      back: () => {
        latest.current();
      },
      held: true,
    };
    if (spare > 0) spare -= 1;
    else window.history.pushState(null, "");
    layers.push(layer);
    return () => {
      layers.splice(layers.indexOf(layer), 1);
      if (!layer.held) return;
      spare += 1;
      // After the commit's other effects, so a dialog opening in it has taken its entry over.
      queueMicrotask(() => {
        if (spare === 0) return;
        ownPops += 1;
        window.history.go(-spare);
        spare = 0;
      });
    };
  }, []);
}

/**
 * Drops every open dialog's entry, then runs [then], which closes them and opens the next page:
 * the phone pops its screens before it pushes the one a save opens.
 */
export function leaveThen(then: () => void): void {
  const held = layers.filter((layer) => layer.held).length;
  for (const layer of layers) layer.held = false;
  if (held === 0) {
    then();
    return;
  }
  landing = then;
  window.history.go(-held);
}
