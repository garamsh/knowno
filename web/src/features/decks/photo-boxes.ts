import type { BoxDraft } from "./authoring";

/** How far a tool moves, grows or shrinks a box, as a fraction of the photo, as the phone's. */
export const boxStep = 0.05;

/** The smallest side a box may have, as a fraction of the photo; a drag drawing less draws none. */
export const minBoxSide = 0.02;

/** The box "빈칸 추가" adds, in the photo's middle. */
export const newBox = { x: 0.35, y: 0.4, w: 0.3, h: 0.2 };

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

/** [box] with its sides at least [minBoxSide] and its far edges inside the photo. */
function clamped(box: BoxDraft): BoxDraft {
  const w = clamp(box.w, minBoxSide, 1);
  const h = clamp(box.h, minBoxSide, 1);
  return { ...box, x: clamp(box.x, 0, 1 - w), y: clamp(box.y, 0, 1 - h), w, h };
}

/**
 * [boxes] with a box at [rect] added last, kept inside the photo, its id one more than the
 * highest number among their ids, so it is unique in the block, as the phone's `ImageDraft.add`.
 */
export function withBox(
  boxes: BoxDraft[],
  rect: { x: number; y: number; w: number; h: number },
): BoxDraft[] {
  const number = (id: string) => (/^-?\d+$/.test(id) ? Number(id) : 0);
  const next = boxes.reduce((most, box) => Math.max(most, number(box.id)), 0) + 1;
  return [...boxes, clamped({ id: String(next), ...rect, answer: "" })];
}

/**
 * [boxes] with the one at [index] changed by [change], clamped first too, since a box another
 * writer stored can sit a rounding past the photo or be narrower than the least side.
 */
function changed(boxes: BoxDraft[], index: number, change: (box: BoxDraft) => BoxDraft) {
  return boxes.map((box, at) => (at === index ? clamped(change(clamped(box))) : box));
}

/** [boxes] with the one at [index] moved by [dx], [dy], kept inside the photo. */
export function movedBox(boxes: BoxDraft[], index: number, dx: number, dy: number): BoxDraft[] {
  return changed(boxes, index, (box) => ({
    ...box,
    x: clamp(box.x + dx, 0, 1 - box.w),
    y: clamp(box.y + dy, 0, 1 - box.h),
  }));
}

/**
 * [boxes] with the one at [index] grown by [dw], [dh] from its top left, kept inside the photo and
 * no smaller than [minBoxSide].
 */
export function resizedBox(boxes: BoxDraft[], index: number, dw: number, dh: number): BoxDraft[] {
  return changed(boxes, index, (box) => ({
    ...box,
    w: clamp(box.w + dw, minBoxSide, 1 - box.x),
    h: clamp(box.h + dh, minBoxSide, 1 - box.y),
  }));
}
