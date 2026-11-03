const callbackErrors = {
  cancelled: "로그인이 취소되었어요. 다시 시도해 주세요.",
  failed: "로그인하지 못했어요. 잠시 후 다시 시도해 주세요.",
  suspended: "이 계정은 이용이 정지됐어요. 문의는 sauce@garam.sh로 보내 주세요.",
} as const;

/** The reason a previous sign-in failed, from `/auth/callback`'s redirect. */
export async function CallbackError({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const { error } = await searchParams;
  if (error !== "cancelled" && error !== "failed" && error !== "suspended") return null;
  return (
    <p role="alert" className="text-caption text-dont-know-text">
      {callbackErrors[error]}
    </p>
  );
}
