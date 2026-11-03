"use client";

import { type PointerEvent, useRef, useState } from "react";

import type { Answer } from "../answer-write";

/** The swipe past which a release gives an answer, in pixels, as on the phone. */
const commitDistance = 100;

/** The release speed, in pixels per millisecond, that gives it whatever the distance. */
const commitVelocity = 0.7;

/** How long, in milliseconds, a swipe's last movement counts toward a fling. */
const flingWindow = 100;

/** How far a card follows a swipe toward the answer it already has. */
const sameAnswerResistance = 0.25;

/** How far a touch moves before it is read as a swipe or as a scroll. */
const slop = 8;

/** A touch under way: where it started, its latest point and time in milliseconds, its speed. */
type Touch = {
  id: number;
  x: number;
  y: number;
  lastX: number;
  lastAt: number;
  velocity: number;
  swiping: boolean;
};

/**
 * A card's horizontal touch swipe, by the phone's rules: the card follows the finger, and a
 * release past [commitDistance], or a fling, toward an answer other than [held] gives it to
 * [onCommit]; toward [held] the card follows a quarter as far and gives nothing. A mostly
 * vertical touch is left to the page's scroll, and a mouse or pen drags nothing. Without
 * [onCommit] the card takes no swipe.
 */
export function useSwipe({
  held,
  onCommit,
}: {
  held?: Answer;
  onCommit?: (toward: Answer) => void;
}) {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const touch = useRef<Touch | null>(null);
  /** Whether the click that ends a swipe is to be ignored. */
  const swiped = useRef(false);

  function onPointerDown(event: PointerEvent) {
    if (event.pointerType !== "touch" || !onCommit) return;
    touch.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      lastX: event.clientX,
      lastAt: Date.now(),
      velocity: 0,
      swiping: false,
    };
  }
  function onPointerMove(event: PointerEvent) {
    const at = touch.current;
    if (at?.id !== event.pointerId) return;
    const dx = event.clientX - at.x;
    if (!at.swiping) {
      // Mostly vertical: a scroll, which the page keeps (touch-action: pan-y).
      if (Math.abs(event.clientY - at.y) > slop && Math.abs(event.clientY - at.y) > Math.abs(dx)) {
        touch.current = null;
        return;
      }
      if (Math.abs(dx) <= slop) return;
      at.swiping = true;
      setDragging(true);
    }
    const now = Date.now();
    const elapsed = now - at.lastAt;
    if (elapsed > 0) at.velocity = (event.clientX - at.lastX) / elapsed;
    at.lastX = event.clientX;
    at.lastAt = now;
    const toward: Answer = dx > 0 ? "know" : "dontKnow";
    setOffset(toward === held ? dx * sameAnswerResistance : dx);
  }
  function onPointerEnd(event: PointerEvent, cancelled: boolean) {
    const at = touch.current;
    if (at?.id !== event.pointerId) return;
    touch.current = null;
    if (!at.swiping) return;
    swiped.current = true;
    const dx = event.clientX - at.x;
    const toward: Answer = dx > 0 ? "know" : "dontKnow";
    // A finger held still before it lifts flings nothing.
    const velocity = Date.now() - at.lastAt > flingWindow ? 0 : at.velocity;
    const committed =
      !cancelled &&
      toward !== held &&
      (Math.abs(dx) >= commitDistance ||
        (Math.abs(velocity) >= commitVelocity && Math.sign(velocity) === Math.sign(dx)));
    setDragging(false);
    setOffset(0);
    if (committed) onCommit?.(toward);
  }

  return {
    /** How far the card follows the finger, in pixels; 0 at rest. */
    offset,
    /** Whether a finger is moving the card, so it follows without easing. */
    dragging,
    /** The answer the card is moving toward, or null at rest. */
    toward: offset === 0 ? null : offset > 0 ? ("know" as const) : ("dontKnow" as const),
    /** The handlers the card's swipe area takes. */
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: (event: PointerEvent) => {
        onPointerEnd(event, false);
      },
      onPointerCancel: (event: PointerEvent) => {
        onPointerEnd(event, true);
      },
    },
    /** Whether a click is the end of a swipe, which it then consumes. */
    endsSwipe: (): boolean => {
      if (!swiped.current) return false;
      swiped.current = false;
      return true;
    },
  };
}
