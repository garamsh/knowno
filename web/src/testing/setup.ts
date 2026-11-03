import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, vi } from "vitest";

import { server } from "./mocks/server";
import { testRouter } from "./router";

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
  // jsdom has no modal dialog, which every sheet (`@/design/sheet`) opens: open and close mark it.
  if (typeof HTMLDialogElement === "undefined") return;
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(() => {
  server.resetHandlers();
  for (const call of Object.values(testRouter)) call.mockClear();
  cleanup();
});
afterAll(() => {
  server.close();
});
