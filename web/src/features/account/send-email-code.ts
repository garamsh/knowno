"use server";

import { createClient } from "@/supabase/server";

import {
  emailFailure,
  emailMessages,
  parseEmail,
  resendSeconds,
  type SendCodeState,
} from "./email-sign-in";

/**
 * Sends a 6-digit code to the form's `email`: Supabase creates the account on first use. The
 * address is parsed here. A failure comes back as its sentence, and the rate limit with when the
 * next send is allowed.
 */
export async function sendEmailCode(
  previous: SendCodeState,
  form: FormData,
): Promise<SendCodeState> {
  const email = parseEmail(form.get("email"));
  if (email === null) {
    return { sent: previous.sent, email: null, resendIn: null, message: emailMessages.address };
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  });
  if (error) {
    const failure = emailFailure(error);
    return {
      sent: previous.sent,
      email: previous.email === email ? email : null,
      resendIn: failure.resendIn,
      message: failure.message,
    };
  }
  return { sent: previous.sent + 1, email, resendIn: resendSeconds, message: null };
}
