import { useSyncExternalStore } from "react";

import { markupLoaded, onMarkupLoaded } from "./markup-engine";

/**
 * Whether the engine's module has loaded in the browser, so a client that reads card text itself,
 * the card editor and the chat's card preview, draws nothing until it can. Never ready on the
 * server's render, where the page draws what the server read.
 */
export function useMarkupReady(): boolean {
  return useSyncExternalStore(onMarkupLoaded, markupLoaded, () => false);
}
