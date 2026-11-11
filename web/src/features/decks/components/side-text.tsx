import { type Content, describeContent, labelShown, type Sense } from "../card-content";
import { MarkupText } from "@/design/markup-text";
import { PhotoFrame } from "./photo-frame";

/**
 * A card side's blocks, each on its line: text as written, or as the engine read it where it is
 * markup (ADR 0209), a cloze or a table filled, a senses
 * block as [SensesText] draws it, and a block this version cannot show as a placeholder. A photo
 * is named, as a list row names it, or with [photos], as a study card draws its side, drawn whole
 * (ADR 0109). It is spans throughout, so a button can hold it.
 */
export function SideText({ blocks, photos = false }: { blocks: Content[]; photos?: boolean }) {
  return blocks.map((block, index) => (
    <span key={index} className="block">
      {block.kind === "senses" ? (
        <SensesText senses={block.senses} />
      ) : block.kind === "text" ? (
        <MarkupText document={block.markup.document} />
      ) : photos && block.kind === "image" ? (
        <PhotoFrame image={block} revealed />
      ) : (
        describeContent([block])
      )}
    </span>
  ));
}

/**
 * Senses one per line, each label in its brackets as its own span with a gap of one spacing
 * step after it, narrower than a word space, then the meaning: `[명]` 사과 (ADR 0075).
 */
export function SensesText({ senses }: { senses: Sense[] }) {
  return senses.map((sense, index) => (
    <span key={index} data-sense className="block">
      {sense.labels.map((label, at) => (
        <span key={at} data-label className="mr-1">
          [{labelShown(label)}]
        </span>
      ))}
      {sense.meaning}
    </span>
  ));
}
