# ADR 0251: Hold the web assistant's conversation flow in a `useAssistantChat` hook that the component draws, as the app's `AssistantController` does

> Status: accepted
> Date: 2026-11-11

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #943**, Decision 4 of #941: the web's chat flow moves out of the component, as the app's did.
- **Before.** `AssistantChat` (953 lines) held the conversation, the status, the allowance, the staged photos, the commit's state, the requests, the stored conversation, the reply's abort, the job's poll and the drawing. Two refs, `working` and `latest`, were kept equal to state by hand so that an action started during a render saw the current value.
- **Why it hurt.** Testing the flow meant rendering the whole chat and reading it through the DOM: a send's request, a retry, a poll and a commit's payload were asserted by finding text and clicking, so a test of a flow rule broke when the drawing changed and the reverse.
- **The app's shape.** `AssistantController` is one Riverpod notifier holding `ChatState` (conversation, status, allowance) and the actions, over the `AssistantClient` port; the screen reads the state and calls the actions ([`assistant-app.md`](../assistant-app.md)).
- **Alternatives considered:**
  - **A reducer with effects in the component.** Rejected: the actions are asynchronous and each reads the state after an await (a retry, a poll that sends a turn of its own, a send that waits out a stream), so the reducer would hold the synchronous part and the effects the rest, and the order between them would be the `working` and `latest` refs again.
  - **A store outside React (a class or a library).** Rejected: no new dependency, and nothing else reads the chat's state; a class would add a subscription to what a hook already gets from React.
  - **Splitting the component into smaller components and leaving the flow in the top one.** Rejected: it moves the drawing and leaves the flow where its tests are hard to write.

## Decision

- **`useAssistantChat(client, readAllowance)` in `web/src/features/assistant/use-assistant-chat.ts` holds the flow.** It returns the conversation's turns and draft, the status, the allowance, whether a reply is busy, the typing state, the open proposal, the commit's state, the staged photos and the actions: send, submit, attach, unstage, retry, retry after a refusal, stop, cancel a job, check, commit and clear.
- **It owns the stored conversation, the reply's abort on unmount and the job's 3 s poll.** `AssistantClient` is unchanged and is the seam the hook's tests fake.
- **`AssistantChat` draws.** It keeps the profile by each run of 말랑이's turns and the face it takes, the notices, the scroll's restore and follow, the clear confirmation and the layout. It follows the reply by watching the status turn to streaming, which the hook does not know of.
- **The flow's tests move to the hook through `renderHook`; the component's keep what it draws.** The fake client they share is in `__tests__/fake-client.ts`.
- **No behaviour, screen or request changes.**

## Consequences

- A flow rule is tested without a DOM, and a drawing rule without a client script.
- The component is the drawing alone; the hook is a second place to read for a chat's behaviour, as the app's controller is.
- Scroll position is not testable in jsdom, which has no layout. The follow after the status turns to streaming has no test in vitest; the e2e spec for the chat, run in CI, is where a scroll that does not follow would show.
- Not verified here: the e2e spec, which runs in CI only.

## Signs the decision was wrong

- A flow rule keeps needing the component's state, so the hook's interface grows to pass drawing's facts back.
- The hook's file grows past what the controller's did, with the actions again reading refs kept equal by hand.
