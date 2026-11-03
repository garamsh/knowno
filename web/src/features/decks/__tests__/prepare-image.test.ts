import { createHash } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { prepareImage } from "../prepare-image";

const encoded = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 7, 7, 7]);

/**
 * Whether [value] holds the members `prepareImage` uses of a 2D context. jsdom has no 2D context,
 * so the stub holds only those members; this check is what lets it stand for one.
 */
function isDrawingContext(value: unknown): value is CanvasRenderingContext2D {
  return (
    typeof value === "object" &&
    value !== null &&
    "fillStyle" in value &&
    "fillRect" in value &&
    typeof value.fillRect === "function" &&
    "drawImage" in value &&
    typeof value.drawImage === "function"
  );
}

/**
 * jsdom decodes and draws nothing: the browser's decoder and canvas, as far as the crop uses
 * them, recording each draw's source rectangle and canvas size and each encoding's quality.
 */
function stubBrowserImages({
  width,
  height,
  decodes = true,
}: {
  width: number;
  height: number;
  decodes?: boolean;
}) {
  const drawn: { source: number[]; canvas: [number, number] }[] = [];
  const encodings: { type?: string; quality?: number }[] = [];
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(() =>
      decodes
        ? Promise.resolve({ width, height, close: vi.fn() })
        : Promise.reject(new DOMException("unsupported", "InvalidStateError")),
    ),
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    const context: unknown = {
      fillStyle: "",
      fillRect: vi.fn(),
      drawImage: (_: unknown, ...rest: number[]) => {
        drawn.push({ source: rest.slice(0, 4), canvas: [this.width, this.height] });
      },
    };
    if (!isDrawingContext(context)) throw new Error("the stub lacks what prepareImage draws with");
    return context;
  });
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(
    (type?: string, quality?: unknown) => {
      encodings.push({ type, quality: typeof quality === "number" ? quality : undefined });
      return `data:${type ?? ""};base64,${Buffer.from(encoded).toString("base64")}`;
    },
  );
  return { drawn, encodings };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a tile's photo, prepared as the phone's cropImage", () => {
  it("crops a wide photo to its centred square and scales it to 1024 px, as JPEG at 85 with its digest", async () => {
    const { drawn, encodings } = stubBrowserImages({ width: 4000, height: 3000 });
    const prepared = await prepareImage(new Blob([new Uint8Array(10)]), "square");

    expect(drawn).toEqual([{ source: [500, 0, 3000, 3000], canvas: [1024, 1024] }]);
    expect(encodings).toEqual([{ type: "image/jpeg", quality: 0.85 }]);
    expect(prepared?.sha256).toBe(createHash("sha256").update(encoded).digest("hex"));
    expect(vi.mocked(createImageBitmap).mock.calls[0]?.[1]).toEqual({
      imageOrientation: "from-image",
    });
  });

  it("crops a tall photo from its middle, and keeps a small square's size rather than scaling it up", async () => {
    const tall = stubBrowserImages({ width: 600, height: 900 });
    await prepareImage(new Blob([new Uint8Array(10)]), "square");
    expect(tall.drawn).toEqual([{ source: [0, 150, 600, 600], canvas: [600, 600] }]);
  });

  it("gives nothing for a file the browser cannot decode, against one it can", async () => {
    stubBrowserImages({ width: 10, height: 10, decodes: false });
    expect(await prepareImage(new Blob([new Uint8Array(1)]), "square")).toBeNull();
    vi.restoreAllMocks();
    stubBrowserImages({ width: 10, height: 10 });
    expect(await prepareImage(new Blob([new Uint8Array(1)]), "square")).not.toBeNull();
  });
});

describe("a card's photo, prepared whole as the phone's ImageShape.whole", () => {
  it("keeps a wide photo whole at its aspect ratio, scaled to 1024 px on its longer side, with its size", async () => {
    const { drawn, encodings } = stubBrowserImages({ width: 4000, height: 3000 });
    const prepared = await prepareImage(new Blob([new Uint8Array(10)]), "whole");

    expect(drawn).toEqual([{ source: [0, 0, 4000, 3000], canvas: [1024, 768] }]);
    expect(encodings).toEqual([{ type: "image/jpeg", quality: 0.85 }]);
    expect(prepared).toMatchObject({ width: 1024, height: 768 });
  });

  it("keeps a small tall photo whole at its own size rather than scaling it up", async () => {
    const { drawn } = stubBrowserImages({ width: 600, height: 900 });
    const prepared = await prepareImage(new Blob([new Uint8Array(10)]), "whole");
    expect(drawn).toEqual([{ source: [0, 0, 600, 900], canvas: [600, 900] }]);
    expect(prepared).toMatchObject({ width: 600, height: 900 });
  });
});
