import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { render } from "@/testing/render";

/** An input counting the keys pressed in it. */
function Counter() {
  const [count, setCount] = useState(0);
  return (
    <input
      aria-label="keys"
      value={String(count)}
      readOnly
      onKeyDown={() => {
        setCount((value) => value + 1);
      }}
    />
  );
}

// The first test ends while work it started is still running, as a test that times out does; the
// second, which runs next, finds that work refused and its own page untouched.
describe("a test's work past its end", () => {
  let late: Promise<string> = Promise.resolve("none");
  // Lets the first test's late work go on once the second test has shown its control.
  let go = () => {};

  it("leaves a render and a key press running after it ends", () => {
    const released = new Promise<void>((resolve) => {
      go = resolve;
    });
    late = (async () => {
      await released;
      const outcomes: string[] = [];
      try {
        await userEvent.setup().keyboard("x");
        outcomes.push("pressed");
      } catch (error) {
        outcomes.push(String(error));
      }
      try {
        await render(() => <p>leaked</p>, {});
        outcomes.push("rendered");
      } catch (error) {
        outcomes.push(String(error));
      }
      return outcomes.join("\n");
    })();
  });

  it("stops that work at its next key press and render, and keeps its own", async () => {
    await render(() => <Counter />, {});
    const keys = screen.getByRole("textbox", { name: "keys" });
    keys.focus();
    // Control: this test's own key press reaches its page.
    await userEvent.setup().keyboard("y");
    expect(keys).toHaveValue("1");

    go();
    const outcomes = (await late).split("\n");

    expect(outcomes).toHaveLength(2);
    for (const outcome of outcomes) {
      expect(outcome).toMatch(
        /the test "leaves a render and a key press running after it ends" has ended/,
      );
    }
    expect(keys).toHaveValue("1");
    expect(screen.queryByText("leaked")).not.toBeInTheDocument();
  });
});
