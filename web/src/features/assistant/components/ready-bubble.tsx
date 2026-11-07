"use client";

import { useSyncExternalStore } from "react";

import { checkedCount, conversationKey, parseConversation, readyProposal } from "../conversation";

function subscribe(changed: () => void) {
  window.addEventListener("storage", changed);
  return () => {
    window.removeEventListener("storage", changed);
  };
}

function storedText(): string | null {
  try {
    return window.localStorage.getItem(conversationKey);
  } catch {
    return null;
  }
}

/**
 * The speech bubble over 홈's mascot while 말랑이 has new cards ready (#722): "카드 n장 만들어
 * 뒀어요", the cards checked in the proposal not yet added, read from the chat this browser keeps;
 * nothing otherwise, and nothing on the server, which keeps no chat.
 */
export function ReadyBubble({ className }: { className: string }) {
  const stored = useSyncExternalStore(subscribe, storedText, () => null);
  const ready = stored === null ? null : readyProposal(parseConversation(stored));
  const count = ready && ready.proposal.kind === "cards" ? checkedCount(ready) : 0;
  if (count === 0) return null;
  return (
    <span className={className}>
      {/* Read after the link's own name, "말랑이와 대화하기". */}
      <span className="sr-only">, </span>카드 {count}장 만들어 뒀어요
    </span>
  );
}
