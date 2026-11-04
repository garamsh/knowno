import { lineDiff } from "../prompt-diff";

/**
 * The lines prompt [to] changes against [from], collapsed under "프롬프트 v<from> → v<to> 다른 점",
 * each changed line marked − or + and named for a screen reader, a removed line on the amber tint.
 */
export function PromptChanges({
  from,
  to,
  before,
  after,
}: {
  from: number;
  to: number;
  before: string;
  after: string;
}) {
  const lines = lineDiff(before, after);
  const changed = lines.filter((line) => line.kind !== "same").length;
  return (
    <details className="px-4 py-3">
      <summary className="min-h-tap-target cursor-pointer content-center text-label text-ink-2 focus-visible:outline-2 focus-visible:outline-ink">
        프롬프트 v{from} → v{to} 다른 점
      </summary>
      {/* A details element does not lay its content out as flex items, so one block holds the gap. */}
      <div className="mt-3 flex flex-col gap-2">
        <p className="text-caption text-muted">
          {changed === 0
            ? "내용이 같아요."
            : `바뀐 줄 ${String(changed)}개: 빼는 줄은 −, 더하는 줄은 +로 표시해요.`}
        </p>
        <ol className="flex flex-col rounded-group bg-ground p-3 font-mono text-caption">
          {lines.map((line, index) => (
            <li
              key={index}
              className={`grid grid-cols-[1.5rem_1fr] whitespace-pre-wrap ${
                line.kind === "removed"
                  ? "bg-tint-amber text-ink"
                  : line.kind === "added"
                    ? "bg-brand-tint text-ink"
                    : "text-ink-2"
              }`}
            >
              <span aria-hidden>
                {line.kind === "removed" ? "−" : line.kind === "added" ? "+" : ""}
              </span>
              <span>
                <span className="sr-only">
                  {line.kind === "removed" ? "뺌: " : line.kind === "added" ? "더함: " : ""}
                </span>
                {line.text}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </details>
  );
}
