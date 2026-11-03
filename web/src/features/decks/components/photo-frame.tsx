import type { Content, ImageBox } from "../card-content";

/**
 * The tallest a photo's frame is drawn. Its width is bounded by the same height through its aspect
 * ratio, so a tall photo fits whole on the screen, as the app's `imageFrame` fits it.
 */
const photoMaxHeight = "60dvh";

/**
 * A photo drawn whole with the phone's one transform (ADR 0109): a frame the full width, at most
 * [photoMaxHeight] tall, at the photo's aspect ratio, the photo filling it from its signed URL
 * over the ground, which shows while it is read and where it has none, and each box over it;
 * [marked], as a note's card list draws it, at the start of its line and at most the
 * `listed-photo` height, and each box on the hatch, with no border and no label (#629);
 * [studied], as study's cards draw it, each box on the hatch, its answer on it once revealed
 * (#635).
 */
export function PhotoFrame({
  image,
  revealed,
  marked = false,
  studied = false,
}: {
  image: Extract<Content, { kind: "image" }>;
  revealed: boolean;
  marked?: boolean;
  studied?: boolean;
}) {
  return (
    <span
      aria-hidden
      data-image={image.media}
      className={`relative block w-full rounded-sm bg-ground bg-cover bg-center ${marked ? "" : "mx-auto"}`}
      style={{
        aspectRatio: `${String(image.width)} / ${String(image.height)}`,
        maxWidth: `calc(${marked ? "var(--spacing-listed-photo)" : photoMaxHeight} * ${String(image.width)} / ${String(image.height)})`,
        ...(image.url && { backgroundImage: `url("${image.url}")` }),
      }}
    >
      {image.boxes.map((box) => (
        <ImageBoxMark
          key={box.id}
          box={box}
          revealed={revealed}
          marked={marked}
          studied={studied}
        />
      ))}
    </span>
  );
}

/** A percentage of the photo's frame, the CSS form of a box's fraction. */
function percent(fraction: number): string {
  return `${String(fraction * 100)}%`;
}

/**
 * A box over a photo, placed in percentages of the frame, which has the photo's aspect ratio, so
 * the one transform that sizes the frame places the box (ADR 0109): an opaque fill hiding what it
 * covers, or, revealed, a border with its answer at its top left; [marked], the hatch alone;
 * [studied], the hatch, with its answer on it once revealed. The border, corners and label stay in
 * CSS pixels at every width.
 */
function ImageBoxMark({
  box,
  revealed,
  marked,
  studied,
}: {
  box: ImageBox;
  revealed: boolean;
  marked: boolean;
  studied: boolean;
}) {
  if (studied) {
    return (
      <span
        data-box={revealed ? "studied-revealed" : "studied"}
        className="hatch absolute flex items-center justify-center overflow-hidden rounded-sm p-1 text-caption font-bold text-ink"
        style={{
          left: percent(box.x),
          top: percent(box.y),
          width: percent(box.w),
          height: percent(box.h),
        }}
      >
        {revealed && box.answer !== null && box.answer.trim() !== "" && (
          <span className="truncate">{box.answer}</span>
        )}
      </span>
    );
  }
  if (marked) {
    return (
      <span
        data-box="marked"
        className="absolute rounded-sm hatch"
        style={{
          left: percent(box.x),
          top: percent(box.y),
          width: percent(box.w),
          height: percent(box.h),
        }}
      />
    );
  }
  return (
    <span
      data-box={revealed ? "revealed" : "hidden"}
      className={`absolute rounded-sm ${revealed ? "border-2 border-brand" : "bg-hero"}`}
      style={{
        left: percent(box.x),
        top: percent(box.y),
        width: percent(box.w),
        height: percent(box.h),
      }}
    >
      {revealed && box.answer !== null && box.answer.trim() !== "" && (
        <span className="absolute top-0 left-0 rounded-sm bg-brand-tint px-1 text-caption text-ink">
          {box.answer}
        </span>
      )}
    </span>
  );
}
