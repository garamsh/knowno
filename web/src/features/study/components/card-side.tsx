import { MarkupText } from "@/design/markup-text";
import type { Content } from "@/features/decks";

/**
 * Every block of a card side: text as written, and a block of an unknown type as a placeholder,
 * its lines broken only between words. With [size], centred in the front's or the back's size;
 * without it, in the size, alignment and wrapping of the face around it ([CardScroll]). A cloze or a
 * table is drawn only whole, through the card's faces, and a senses block through the card's
 * sides, so a split side shows none.
 */
export function CardSide({ blocks, size }: { blocks: Content[]; size?: "front" | "back" }) {
  return (
    <div
      className={`flex w-full flex-col gap-2 break-keep whitespace-pre-wrap ${
        size === undefined
          ? ""
          : `text-center wrap-break-word ${size === "front" ? "text-front" : "text-back"}`
      }`}
    >
      {blocks.map((block, index) =>
        block.kind === "text" ? (
          <p key={index}>
            {block.markup ? <MarkupText document={block.markup.document} /> : block.text}
          </p>
        ) : block.kind === "unsupported" ? (
          <p key={index} className="text-body text-muted italic">
            [이 버전에서 표시할 수 없는 내용: {block.type}]
          </p>
        ) : null,
      )}
    </div>
  );
}
