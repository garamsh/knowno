import { beforeEach, describe, expect, it, vi } from "vitest";

/** The module as a page meets it first: not loaded, its state its own. */
async function fresh() {
  vi.resetModules();
  return import("../markup-engine");
}

beforeEach(() => {
  vi.resetModules();
});

describe("the markup engine before and after its module loads", () => {
  it("refuses a read before it has loaded, naming what to call", async () => {
    const engine = await fresh();

    expect(engine.markupLoaded()).toBe(false);
    expect(() => engine.parse("a")).toThrow("loadMarkupEngine");
    expect(() => engine.plainText("a")).toThrow("loadMarkupEngine");
    expect(() => engine.markedOf("a")).toThrow("loadMarkupEngine");
  });

  it("reads once loaded as the browser loads it, and tells a listener", async () => {
    const engine = await fresh();
    const loaded = vi.fn();
    const stop = engine.onMarkupLoaded(loaded);

    await engine.loadMarkupEngine();

    expect(engine.markupLoaded()).toBe(true);
    expect(loaded).toHaveBeenCalledTimes(1);
    expect(engine.plainText("**a**")).toBe("a");
    stop();
  });

  it("loads from a registered synchronous load on the server's first read", async () => {
    const engine = await fresh();
    const { readEngineModule } = await import("../markup-engine-server");
    const load = vi.fn(() => {
      engine.installMarkupModule(readEngineModule());
    });
    engine.setServerMarkupLoad(load);

    expect(engine.plainText("**a**")).toBe("a");
    expect(engine.plainText("*b*")).toBe("b");
    expect(load).toHaveBeenCalledTimes(1);
  });
});
