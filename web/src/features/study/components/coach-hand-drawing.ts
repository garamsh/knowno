// Written by tools/brand/generate.mjs from tools/brand/coach-hand.svg; run make brand after changing it.

/**
 * The study coach's pointing hand on a 120 square: its outline, its creases, both in lines
 * `line` wide, the edge under it `edge` off, and the `tip` it presses with.
 */
export const coachHand = {
  box: 120,
  line: 5,
  edge: { x: 6, y: 6 },
  tip: { x: 30, y: 16 },
  outline:
    "M24 22Q22 14 30 12Q37 11 39 18L49 44Q50 36 57 35Q63 35 64 42Q66 36 72 37Q78 39 77 46Q80 41 86 43Q92 46 91 54L91 80Q90 95 72 98L54 98Q42 97 33 88L19 72Q14 66 19 62Q24 58 30 63L40 70Z",
  creases: "M49 44L51 53M64 42L64 51M77 46L77 53",
};
