import "@testing-library/jest-dom/vitest";

import { cleanup, configure, getConfig } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";

import { server } from "./mocks/server";
import { testRouter } from "./router";
import { assertTestRunning, endTest, enterTest } from "./running-test";

// A test renders outside any request, where `connection()` throws; it is always request time here.
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: () => Promise.resolve(),
}));

// A test renders outside the App Router, whose context `useRouter` reads (`./router`).
vi.mock("next/navigation", async (importOriginal) => {
  const { testRouter } = await import("./router");
  return {
    ...(await importOriginal<typeof import("next/navigation")>()),
    useRouter: () => testRouter,
  };
});

beforeAll(() => {
  server.listen({ onUnhandledFrame: "error" });
  // jsdom has no pointer capture, which a press on a draggable control (`EdgeAssistant`) takes: a
  // browser gives the press's pointer to the control, and here nothing is captured.
  if (typeof HTMLElement !== "undefined") HTMLElement.prototype.setPointerCapture = () => undefined;
  // jsdom has no modal dialog, which every sheet (`@/design/sheet`) opens: open and close mark it,
  // and opening focuses its first control, as a browser's dialog focusing steps do.
  if (typeof HTMLDialogElement === "undefined") return;
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
    this.querySelector<HTMLElement>(
      "button:not(:disabled), [href], input:not(:disabled), select, textarea, [tabindex]:not([tabindex='-1'])",
    )?.focus();
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  // Escape, once its keydown is over and nothing prevented it, asks the top open dialog to close
  // by its cancel event, as a browser's close request does.
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Escape") return;
      queueMicrotask(() => {
        const dialog = Array.from(document.querySelectorAll("dialog[open]")).at(-1);
        if (event.defaultPrevented || !(dialog instanceof HTMLDialogElement)) return;
        if (dialog.dispatchEvent(new Event("cancel", { cancelable: true }))) dialog.close();
      });
    },
    true,
  );
});
// A test's body that outlives it (a timeout) stops at its next event or render rather than act on
// the next test's page (`running-test.ts`). Synchronous, so the test runs inside what it enters.
beforeEach((context) => {
  enterTest(context.task.name);
});
const wrappers = getConfig();
configure({
  asyncWrapper: (callback) => {
    assertTestRunning();
    return wrappers.asyncWrapper(callback);
  },
  // The event's result is passed on: user-event reads from it whether the default was prevented.
  eventWrapper: (callback): unknown => {
    assertTestRunning();
    return (wrappers.eventWrapper as (wrapped: typeof callback) => unknown)(callback);
  },
});
afterEach(() => {
  endTest();
  server.resetHandlers();
  for (const call of Object.values(testRouter)) call.mockClear();
  cleanup();
});
afterAll(() => {
  server.close();
});
