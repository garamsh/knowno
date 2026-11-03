import { Section } from "@/design/section";

/**
 * The `mcp` Edge Function on the project's custom domain, which Claude and ChatGPT connect to
 * (ADR 0133), which the function's `CUSTOM_DOMAINS` lists.
 */
const MCP_SERVER_URL = "https://api.knowno.app/functions/v1/mcp";

/**
 * "AI 연결": the MCP server's address and how to add it in Claude and in ChatGPT (ADR 0126). It
 * needs no server, so it is drawn while the server cannot be reached too.
 */
export function AiConnection() {
  return (
    <Section label="AI 연결">
      <div className="flex flex-col divide-y divide-hairline rounded-group bg-surface">
        <div className="flex flex-col gap-1 px-4 py-3">
          <p className="text-caption text-muted">서버 주소</p>
          <p className="text-body break-all select-all">{MCP_SERVER_URL}</p>
        </div>
        <div className="flex flex-col gap-1 px-4 py-3">
          <p className="text-body-strong">Claude</p>
          <p className="text-caption break-keep text-muted">
            커넥터 설정에서 커스텀 커넥터를 추가하고 서버 주소를 넣은 뒤 알아몰라로 로그인해요
          </p>
        </div>
        <div className="flex flex-col gap-1 px-4 py-3">
          <p className="text-body-strong">ChatGPT</p>
          <p className="text-caption break-keep text-muted">
            chatgpt.com/plugins에서 커스텀 MCP 서버를 추가하고 서버 주소를 넣은 뒤 알아몰라로
            로그인해요
          </p>
        </div>
      </div>
      <p className="px-1 text-caption break-keep text-muted">
        연결한 AI는 노트와 카드를 읽고, 추가하고, 고치고, 지울 수 있어요. 연결할 수 있는 AI의 수와
        기능은 각 서비스의 요금제에 따라 달라요.
      </p>
    </Section>
  );
}
