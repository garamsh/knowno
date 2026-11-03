import {
  BookOpen,
  Brain,
  Briefcase,
  Calculator,
  Code,
  FlaskConical,
  Globe,
  Landmark,
  Languages,
  Layers,
  type LucideProps,
  Music,
  Palette,
  Pencil,
  Star,
} from "lucide-react";
import type { ReactNode } from "react";

import { type DeckIcon, parseDeckIcon } from "../deck-icon";
import { deckColor, deckFill } from "../deck-tint";
import type { Deck } from "../library";

/** Draws one icon with [props]. */
type DrawIcon = (props: LucideProps) => ReactNode;

/**
 * Each icon a deck's tile can hold, drawn with the Lucide icon the app draws for its key
 * (`deckIconData` in app/lib/deck/src/deck_row.dart).
 */
const drawings: Record<DeckIcon, DrawIcon> = {
  layers: (props) => <Layers {...props} />,
  book: (props) => <BookOpen {...props} />,
  languages: (props) => <Languages {...props} />,
  pencil: (props) => <Pencil {...props} />,
  flask: (props) => <FlaskConical {...props} />,
  calculator: (props) => <Calculator {...props} />,
  globe: (props) => <Globe {...props} />,
  music: (props) => <Music {...props} />,
  palette: (props) => <Palette {...props} />,
  brain: (props) => <Brain {...props} />,
  code: (props) => <Code {...props} />,
  landmark: (props) => <Landmark {...props} />,
  briefcase: (props) => <Briefcase {...props} />,
  star: (props) => <Star {...props} />,
};

/** [icon] drawn in ink at half the tile, as the tile and the 꾸미기 sheet's choices draw it. */
export function IconDrawing({
  icon,
  className = "size-1/2",
}: {
  icon: DeckIcon;
  className?: string;
}) {
  return drawings[icon]({ className, strokeWidth: 2 });
}

/** What a deck's tile draws: its icon, its colour and its photo. */
export type Tile = Pick<Deck, "icon" | "color" | "imageUrl">;

/**
 * A deck's icon in ink on its colour from the deck palette, as the app draws its tile (ADR 0103):
 * the icon it stores, or `layers` for none or a key this version does not know; with a photo, the
 * photo covering the tile, the icon drawn under it while the photo is read and where it cannot be
 * (ADR 0159). Hidden from screen readers. [size] sizes the tile; the icon takes half of it.
 */
export function DeckTile({ deck, size = "size-deck-tile" }: { deck: Tile; size?: string }) {
  return (
    <span
      aria-hidden
      className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-field text-ink ${size} ${deckFill(deckColor(deck))}`}
    >
      <IconDrawing icon={parseDeckIcon(deck.icon) ?? "layers"} />
      {deck.imageUrl && (
        <span
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url("${deck.imageUrl}")` }}
        />
      )}
    </span>
  );
}
