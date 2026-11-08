import { forwardJobPoll } from "@/features/assistant";

/**
 * A photo job's poll, passed on to the function (ADR 0205): a read the chat repeats from the
 * browser every few seconds, which stack-nextjs §3 gives a Route Handler.
 */
export async function GET(_request: Request, { params }: RouteContext<"/api/assistant/jobs/[id]">) {
  return forwardJobPoll((await params).id);
}
