"use client";

import { Sheet } from "@/design/sheet";

/** Each keyboard shortcut of the study screen, and what it does. */
export const shortcuts = [
  { keys: ["→"], action: "안다" },
  { keys: ["←"], action: "모른다" },
  { keys: ["Z"], action: "마지막 응답 바꾸기" },
  { keys: ["Esc"], action: "그만하기" },
  { keys: ["?"], action: "단축키 보기" },
] as const;

/** The list of keyboard shortcuts, in the sheet until "닫기", Esc, "?" or a click outside it closes it. */
export function ShortcutHelp({ onClose }: { onClose: () => void }) {
  return (
    // "?" is caught on its way in: the sheet keeps every key it holds from the study screen's.
    <div
      className="contents"
      onKeyDownCapture={(event) => {
        if (event.key !== "?") return;
        event.preventDefault();
        onClose();
      }}
    >
      <Sheet title="단축키" close={onClose}>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
          {shortcuts.map(({ keys, action }) => (
            <div key={action} className="contents">
              <dt className="flex gap-1">
                {keys.map((key) => (
                  <kbd
                    key={key}
                    className="rounded border border-hairline px-2 font-sans text-caption"
                  >
                    {key}
                  </kbd>
                ))}
              </dt>
              <dd>{action}</dd>
            </div>
          ))}
        </dl>
      </Sheet>
    </div>
  );
}
