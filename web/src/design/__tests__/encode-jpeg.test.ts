import { afterEach, describe, expect, it, vi } from "vitest";

import { encodeJpeg } from "../encode-jpeg";

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 128, 255, 0xff, 0xd9]);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("encodeJpeg", () => {
  it("answers the canvas's JPEG at the quality asked, byte for byte, without waiting on the browser", async () => {
    // jsdom encodes nothing: the canvas answers these bytes as the browser's data URL would.
    const asked: unknown[] = [];
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation((...args) => {
      asked.push(args);
      return `data:image/jpeg;base64,${Buffer.from(jpeg).toString("base64")}`;
    });
    const blob = encodeJpeg(document.createElement("canvas"), 0.7);

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("image/jpeg");
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(jpeg);
    expect(asked).toEqual([["image/jpeg", 0.7]]);
  });
});
