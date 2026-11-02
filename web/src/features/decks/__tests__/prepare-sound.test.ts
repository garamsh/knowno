import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { prepareSound } from "../prepare-sound";

const bytes = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]);
const file = (name: string, size = bytes.length) => {
  const body = new Uint8Array(size);
  body.set(bytes.subarray(0, Math.min(size, bytes.length)));
  return new File([body], name);
};

describe("a sound, prepared as the phone's prepareAudio", () => {
  it("takes a picked .m4a or .mp3 with the length the player reads, and its digest", async () => {
    const lengthOf = vi.fn(() => Promise.resolve(7_200.4));
    const prepared = await prepareSound(file("voice.M4A"), undefined, lengthOf);
    expect(prepared).toMatchObject({
      durationMs: 7_200,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
    expect(await prepareSound(file("voice.mp3"), undefined, lengthOf)).toMatchObject({
      durationMs: 7_200,
    });
  });

  it("refuses a file of another kind, and one no player reads, as unreadable", async () => {
    const lengthOf = vi.fn(() => Promise.resolve(1_000));
    expect(await prepareSound(file("voice.wav"), undefined, lengthOf)).toBe("unreadable");
    expect(lengthOf).not.toHaveBeenCalled();
    expect(await prepareSound(file("voice.m4a"), undefined, () => Promise.resolve(null))).toBe(
      "unreadable",
    );
    expect(await prepareSound(file("voice.m4a", 0), undefined, lengthOf)).toBe("unreadable");
  });

  it("refuses a sound past 60 seconds or 5 MiB as too large, against one at each limit", async () => {
    const at = (ms: number) => () => Promise.resolve(ms);
    expect(await prepareSound(file("a.m4a"), undefined, at(60_001))).toBe("tooLarge");
    expect(await prepareSound(file("a.m4a"), undefined, at(60_000))).toMatchObject({
      durationMs: 60_000,
    });
    expect(await prepareSound(file("a.m4a", 5 * 1024 * 1024 + 1), undefined, at(1))).toBe(
      "tooLarge",
    );
    expect(await prepareSound(file("a.m4a", 5 * 1024 * 1024), undefined, at(1))).toMatchObject({
      durationMs: 1,
    });
  });

  it("takes a recording for the time it ran, whatever its name, without reading its length", async () => {
    const lengthOf = vi.fn(() => Promise.resolve(1));
    const recording = new Blob([bytes], { type: "audio/mp4" });
    expect(await prepareSound(recording, 3_000, lengthOf)).toMatchObject({ durationMs: 3_000 });
    expect(lengthOf).not.toHaveBeenCalled();
  });
});
