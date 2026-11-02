"use client";

import { useEffect, useRef } from "react";

import { keepFocusInside } from "@/design/focus-trap";

/** Each keyboard shortcut of the study screen, and what it does. */
export const shortcuts = [
  { keys: ["→"], action: "안다" },
  { keys: ["←"], action: "모른다" },
  { keys: ["Z"], action: "마지막 응답 바꾸기" },
  { keys: ["Esc"], action: "그만하기" },
  { keys: ["?"], action: "단축키 보기" },
] as const;

/** The list of keyboard shortcuts, over the screen until "닫기", Esc or a click outside it closes it. */
export function ShortcutHelp({ onClose }: { onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    close.current?.focus();
  }, []);

  return (
    <div
      className="fixed inset-0 flex items-center justify-center bg-shadow/40 px-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcut-help-title"
        onKeyDown={keepFocusInside}
        className="flex w-full max-w-sm flex-col gap-4 rounded-card bg-surface p-6"
      >
        <h2 id="shortcut-help-title" className="text-xl font-bold">
          단축키
        </h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
          {shortcuts.map(({ keys, action }) => (
            <div key={action} className="contents">
              <dt className="flex gap-1">
                {keys.map((key) => (
                  <kbd key={key} className="rounded border border-hairline px-2 font-sans text-sm">
                    {key}
                  </kbd>
                ))}
              </dt>
              <dd>{action}</dd>
            </div>
          ))}
        </dl>
        <button
          ref={close}
          type="button"
          onClick={onClose}
          className="pressable min-h-button rounded-button bg-primary px-6 text-button text-on-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        >
          닫기
        </button>
      </div>
    </div>
  );
}
