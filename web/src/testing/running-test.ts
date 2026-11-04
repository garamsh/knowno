import { AsyncLocalStorage } from "node:async_hooks";

/** A test as its own asynchronous work sees it: its name, and whether it has ended. */
type RunningTest = { name: string; ended: boolean };

const owner = new AsyncLocalStorage<RunningTest>();
let current: RunningTest | null = null;

/**
 * Marks [name] as the running test. Called before each test (`setup.ts`): every piece of work the
 * test starts, its awaits and timers included, carries it, so work still running after the test
 * has ended is known as that test's.
 */
export function enterTest(name: string): void {
  current = { name, ended: false };
  owner.enterWith(current);
}

/** Marks the running test as ended, after each test (`setup.ts`), whether it passed or not. */
export function endTest(): void {
  if (current) current.ended = true;
  current = null;
}

/**
 * Throws when called from the work of a test that has ended. Vitest stops waiting for a test that
 * times out but cannot stop its body, which then goes on rendering, clearing the page and pressing
 * keys in the next test's page. The render helper and every Testing Library event call this, so
 * such a body stops at its next step instead.
 */
export function assertTestRunning(): void {
  const test = owner.getStore();
  if (test?.ended) {
    throw new Error(
      `the test "${test.name}" has ended, but its body went on; stopped before it reached the next test's page`,
    );
  }
}
