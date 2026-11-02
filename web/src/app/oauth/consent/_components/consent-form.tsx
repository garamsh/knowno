"use client";

import { useState, useTransition } from "react";

import { createClient } from "@/supabase/browser";

/** Hosts that name the user's own computer, which any program on it can claim to be. */
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * What an AI app asks of the account, and the user's answer, sent from the browser to Supabase
 * Auth, which returns the address to send the browser back to: "연결" grants, "취소" refuses. While
 * an answer is on its way, neither button can be pressed again.
 */
export function ConsentForm({
  authorizationId,
  appName,
  host,
  email,
}: {
  authorizationId: string;
  appName: string;
  host: string;
  email: string;
}) {
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);
  const loopback = LOOPBACK.has(host.replace(/:\d+$/, ""));

  function answer(approve: boolean) {
    setFailed(false);
    startTransition(async () => {
      const oauth = createClient().auth.oauth;
      const { data, error } = approve
        ? await oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true })
        : await oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true });
      if (error) {
        setFailed(true);
        return;
      }
      window.location.assign(data.redirect_url);
    });
  }

  return (
    <>
      <h1 className="text-deck-name break-keep">{appName}에 연결할까요?</h1>
      <section aria-labelledby="consent-section" className="flex flex-col gap-2">
        <h2 id="consent-section" className="px-1 text-section text-muted">
          연결 내용
        </h2>
        <dl className="flex flex-col divide-y divide-hairline rounded-group bg-surface">
          <div className="flex flex-col gap-1 px-4 py-3">
            <dt className="text-caption text-muted">계정</dt>
            <dd className="text-body break-all">{email}</dd>
          </div>
          <div className="flex flex-col gap-1 px-4 py-3">
            <dt className="text-caption text-muted">돌아갈 주소</dt>
            <dd className="text-body break-all">{host}</dd>
          </div>
          <div className="flex flex-col gap-1 px-4 py-3">
            <dt className="text-caption text-muted">할 수 있는 일</dt>
            <dd className="text-body break-keep">
              노트와 카드를 읽고, 추가하고, 고치고, 지울 수 있어요.
            </dd>
          </div>
        </dl>
      </section>
      {loopback && (
        <p className="text-body break-keep text-ink-2">
          이 주소는 이 컴퓨터 안의 프로그램이에요. 직접 시작한 프로그램일 때만 연결해 주세요.
        </p>
      )}
      {failed && (
        <p role="alert" className="text-body break-keep text-dont-know-text">
          연결하지 못했어요. AI 앱에서 다시 연결해 주세요.
        </p>
      )}
      <div className="mt-auto flex flex-col gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            answer(false);
          }}
          className="pressable flex min-h-cta items-center justify-center rounded-button bg-surface px-6 text-button text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-50"
        >
          취소
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            answer(true);
          }}
          className="pressable flex min-h-cta items-center justify-center rounded-button bg-primary px-6 text-button text-on-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-50"
        >
          연결
        </button>
      </div>
    </>
  );
}
