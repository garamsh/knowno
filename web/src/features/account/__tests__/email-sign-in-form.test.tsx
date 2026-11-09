import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EmailSignIn } from "../components/email-sign-in";
import type { SendCodeState } from "../email-sign-in";
import type { VerifyCodeState } from "../verify-email-code";

const sendEmailCode = vi.fn<(previous: SendCodeState, form: FormData) => Promise<SendCodeState>>();
const verifyEmailCode =
  vi.fn<(previous: VerifyCodeState, form: FormData) => Promise<VerifyCodeState>>();

vi.mock("../actions", () => ({
  sendEmailCode: (previous: SendCodeState, form: FormData) => sendEmailCode(previous, form),
  verifyEmailCode: (previous: VerifyCodeState, form: FormData) => verifyEmailCode(previous, form),
}));

const sentTo = (email: string, sent = 1, resendIn = 60): SendCodeState => ({
  sent,
  email,
  resendIn,
  message: null,
});

/** Opens the email step and sends a code to kim@example.com, leaving the code step on screen. */
async function toCodeStep(user: ReturnType<typeof userEvent.setup>) {
  sendEmailCode.mockResolvedValueOnce(sentTo("kim@example.com"));
  await user.click(screen.getByRole("button", { name: "이메일로 계속하기" }));
  await user.type(screen.getByRole("textbox", { name: "이메일 주소" }), "kim@example.com");
  await user.click(screen.getByRole("button", { name: "코드 받기" }));
  await screen.findByRole("textbox", { name: "인증 코드" });
}

beforeEach(() => {
  sendEmailCode.mockReset();
  verifyEmailCode.mockReset();
  // Only the countdown's interval is faked, so real time never moves it.
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("EmailSignIn", () => {
  it("is a button, 이메일로 계속하기, until it is pressed, and then the email step", async () => {
    const user = userEvent.setup();
    render(<EmailSignIn />);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "이메일로 계속하기" }));

    const email = screen.getByRole("textbox", { name: "이메일 주소" });
    expect(email).toHaveAttribute("type", "email");
    expect(email).toHaveAttribute("autocomplete", "email");
    expect(screen.getByRole("button", { name: "코드 받기" })).toBeEnabled();
  });

  it("sends the address typed, and shows the code step for it", async () => {
    const user = userEvent.setup();
    render(<EmailSignIn />);
    await toCodeStep(user);

    expect(sendEmailCode.mock.calls[0]?.[1].get("email")).toBe("kim@example.com");
    expect(screen.getByText(/kim@example.com로 보낸 6자리 코드/)).toBeInTheDocument();
  });

  it("takes the code as a one-time code, numeric, and sends it with the address", async () => {
    const user = userEvent.setup();
    verifyEmailCode.mockResolvedValue({ message: null });
    render(<EmailSignIn />);
    await toCodeStep(user);
    const code = screen.getByRole("textbox", { name: "인증 코드" });
    expect(code).toHaveAttribute("autocomplete", "one-time-code");
    expect(code).toHaveAttribute("inputmode", "numeric");

    // A paste of the whole code goes in whole.
    await user.click(code);
    await user.paste("123456");
    await user.click(screen.getByRole("button", { name: "확인" }));

    const form = verifyEmailCode.mock.calls[0]?.[1];
    expect(form?.get("code")).toBe("123456");
    expect(form?.get("email")).toBe("kim@example.com");
  });

  it("shows the sentence the server returns for a wrong code, and keeps the code step", async () => {
    const user = userEvent.setup();
    verifyEmailCode.mockResolvedValue({
      message: "코드가 맞지 않거나 만료됐어요. 새 코드를 받아 주세요.",
    });
    render(<EmailSignIn />);
    await toCodeStep(user);
    await user.type(screen.getByRole("textbox", { name: "인증 코드" }), "000000");
    await user.click(screen.getByRole("button", { name: "확인" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("코드가 맞지 않거나 만료됐어요");
    expect(screen.getByRole("textbox", { name: "인증 코드" })).toBeInTheDocument();
  });

  it("shows why the email step did not send, staying on it with the address kept", async () => {
    const user = userEvent.setup();
    sendEmailCode.mockResolvedValue({
      sent: 0,
      email: null,
      resendIn: null,
      message: "이메일 주소를 확인해 주세요.",
    });
    render(<EmailSignIn />);
    await user.click(screen.getByRole("button", { name: "이메일로 계속하기" }));
    await user.type(screen.getByRole("textbox", { name: "이메일 주소" }), "kim@example");
    await user.click(screen.getByRole("button", { name: "코드 받기" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("이메일 주소를 확인해 주세요.");
    expect(screen.queryByRole("textbox", { name: "인증 코드" })).not.toBeInTheDocument();
  });

  it("counts the resend down from the interval, and offers it once the count is over", async () => {
    const user = userEvent.setup();
    render(<EmailSignIn />);
    await toCodeStep(user);
    const resend = () => screen.getByRole("button", { name: /^코드 다시 받기/ });
    expect(resend()).toHaveAccessibleName("코드 다시 받기 (60초)");
    expect(resend()).toBeDisabled();

    act(() => {
      vi.advanceTimersByTime(59_000);
    });
    expect(resend()).toHaveAccessibleName("코드 다시 받기 (1초)");
    expect(resend()).toBeDisabled();
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(resend()).toHaveAccessibleName("코드 다시 받기");
    expect(resend()).toBeEnabled();
  });

  it("resends to the same address, and starts the count again", async () => {
    const user = userEvent.setup();
    render(<EmailSignIn />);
    await toCodeStep(user);
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    sendEmailCode.mockResolvedValueOnce(sentTo("kim@example.com", 2));

    await user.click(screen.getByRole("button", { name: "코드 다시 받기" }));

    expect(sendEmailCode.mock.calls.at(-1)?.[1].get("email")).toBe("kim@example.com");
    expect(await screen.findByRole("button", { name: "코드 다시 받기 (60초)" })).toBeDisabled();
  });

  it("counts down the wait a refused resend names", async () => {
    const user = userEvent.setup();
    render(<EmailSignIn />);
    await toCodeStep(user);
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    sendEmailCode.mockResolvedValueOnce({
      sent: 1,
      email: "kim@example.com",
      resendIn: 25,
      message: "코드를 너무 자주 요청했어요. 25초 뒤에 다시 받을 수 있어요.",
    });
    await user.click(screen.getByRole("button", { name: "코드 다시 받기" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("25초 뒤에");
    expect(screen.getByRole("button", { name: "코드 다시 받기 (25초)" })).toBeDisabled();
  });

  it("goes back to the email step with the address to change, and sends to the new one", async () => {
    const user = userEvent.setup();
    render(<EmailSignIn />);
    await toCodeStep(user);

    await user.click(screen.getByRole("button", { name: "이메일 바꾸기" }));

    const email = screen.getByRole("textbox", { name: "이메일 주소" });
    expect(email).toHaveValue("kim@example.com");
    expect(screen.queryByRole("textbox", { name: "인증 코드" })).not.toBeInTheDocument();
    sendEmailCode.mockResolvedValueOnce(sentTo("lee@example.com", 2));
    await user.clear(email);
    await user.type(email, "lee@example.com");
    await user.click(screen.getByRole("button", { name: "코드 받기" }));
    expect(await screen.findByText(/lee@example.com로 보낸/)).toBeInTheDocument();
  });

  it("shows progress and cannot be pressed again while a code is on its way", async () => {
    const user = userEvent.setup();
    sendEmailCode.mockReturnValue(new Promise(() => undefined));
    render(<EmailSignIn />);
    await user.click(screen.getByRole("button", { name: "이메일로 계속하기" }));
    await user.type(screen.getByRole("textbox", { name: "이메일 주소" }), "kim@example.com");
    const send = screen.getByRole("button", { name: "코드 받기" });
    expect(send).toHaveAttribute("aria-busy", "false");

    await user.click(send);

    expect(send).toBeDisabled();
    expect(send).toHaveAttribute("aria-busy", "true");
  });
});
