import { render as renderTree } from "@testing-library/react";
import type { ReactNode } from "react";

import { assertTestRunning } from "./running-test";

/**
 * Renders [component] with Testing Library, first awaiting it when it is an async Server
 * Component, which Testing Library cannot render itself; refused to a test that has ended.
 */
export async function render<P extends object>(
  component: (props: P) => ReactNode | Promise<ReactNode>,
  props: P,
) {
  assertTestRunning();
  const tree = await component(props);
  assertTestRunning();
  return renderTree(<>{tree}</>);
}
