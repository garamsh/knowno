import { redirect } from "next/navigation";

import { ReadFailureMessage, unreachableMessage } from "@/design/read-failure";
import { Section } from "@/design/section";
import { ThemeChoice } from "@/design/theme-choice";
import { getSession, SignOutForm } from "@/features/account";

import { AiConnection } from "./ai-connection";
import { readStudySetting, StudySetting } from "./study-setting";

/**
 * The settings read on the server, each section one group under its label, as the phone's 설정
 * draws them: "계정", the signed-in email and sign-out; "학습", the daily study minutes; "AI 연결",
 * the MCP server's address; and "화면", the theme the web is drawn in. While the server cannot be
 * reached, "다시 시도", AI 연결 and the theme.
 */
export async function Profile() {
  const session = await getSession();
  switch (session.kind) {
    case "signed-in": {
      const study = await readStudySetting();
      return (
        <>
          <Section label="계정" id="account-section">
            <div className="flex flex-col divide-y divide-hairline rounded-group bg-surface">
              <p className="min-w-0 px-4 py-3 text-body-strong break-all">{session.email}</p>
              <SignOutForm />
            </div>
          </Section>
          <StudySetting setting={study} />
          <AiConnection />
          <Display />
        </>
      );
    }
    case "unreachable":
      return (
        <>
          <ReadFailureMessage message={unreachableMessage} next="retry" />
          <AiConnection />
          <Display />
        </>
      );
    case "signed-out":
      redirect("/login");
  }
}

/** "화면": the theme the web is drawn in, which needs no server. */
function Display() {
  return (
    <Section label="화면" id="display-section">
      <ThemeChoice labelledBy="display-section" />
    </Section>
  );
}
