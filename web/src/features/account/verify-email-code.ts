"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/supabase/server";

import { emailFailure, emailMessages, parseCode, parseEmail } from "./email-sign-in";

/** What the code step shows after a code that did not sign in. */
export type VerifyCodeState = { message: string | null };

/**
 * Signs in with the form's `email` and 6-digit `code`, setting the session as cookies on the host
 * that asked, and opens `/`; or returns why not. Supabase answers a wrong code and an expired one
 * alike, so one sentence covers both.
 */
export async function verifyEmailCode(
  _previous: VerifyCodeState,
  form: FormData,
): Promise<VerifyCodeState> {
  const email = parseEmail(form.get("email"));
  const token = parseCode(form.get("code"));
  if (email === null) return { message: emailMessages.address };
  if (token === null) return { message: emailMessages.code };
  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
  if (error) return { message: emailFailure(error).message };
  redirect("/");
}
