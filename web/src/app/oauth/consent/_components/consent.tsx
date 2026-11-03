import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { redirect } from "next/navigation";

import { ReadFailureMessage, unreachableMessage } from "@/design/read-failure";
import { createClient } from "@/supabase/server";

import { ConsentForm } from "./consent-form";

/** The form Supabase Auth gives an authorization's id, which is read before any request. */
const AUTHORIZATION_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** A web address the browser may be sent on to: http or https alone. */
function sendable(url: string): boolean {
  try {
    return ["http:", "https:"].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

/**
 * An AI app's request to connect, read from Supabase Auth with the user's session, which binds it
 * to the user (ADR 0126): the form that answers it, or, for a request the user already allowed,
 * the browser sent straight back to the app.
 */
export async function Consent({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { authorization_id: raw } = await searchParams;
  const id = typeof raw === "string" && AUTHORIZATION_ID.test(raw) ? raw : null;
  if (id === null) return <Failure />;
  const client = await createClient();
  const { data, error } = await client.auth.oauth.getAuthorizationDetails(id);
  if (error) return <Failure unreachable={isAuthRetryableFetchError(error)} />;
  if ("redirect_url" in data) {
    if (!sendable(data.redirect_url)) return <Failure />;
    redirect(data.redirect_url);
  }
  if (!sendable(data.redirect_uri)) return <Failure />;
  return (
    <ConsentForm
      authorizationId={data.authorization_id}
      appName={data.client.name.trim() || "이 앱"}
      host={new URL(data.redirect_uri).host}
      email={data.user.email}
    />
  );
}

/** A request that cannot be shown: what failed, then what to do. */
function Failure({ unreachable = false }: { unreachable?: boolean }) {
  return (
    <>
      <h1 className="text-display">AI 연결</h1>
      <ReadFailureMessage
        message={
          unreachable
            ? unreachableMessage
            : "연결 요청을 찾을 수 없어요. AI 앱에서 다시 연결해 주세요."
        }
        next={unreachable ? "retry" : "none"}
      />
    </>
  );
}
