import { forwardMessage } from "@/features/assistant";

/**
 * A message to 말랑이, streamed back (ADR 0200): the chat's one request that is not a Server
 * Action, since its answer is a stream of events, which stack-nextjs §3 gives a Route Handler.
 */
export function POST(request: Request) {
  return forwardMessage(request);
}
