/** The sentence `/login` shows after the account was deleted, from `deleteAccount`'s redirect. */
export async function DeletedNotice({
  searchParams,
}: {
  searchParams: Promise<{ deleted?: string | string[] }>;
}) {
  const { deleted } = await searchParams;
  if (deleted !== "1") return null;
  return (
    <p role="status" className="text-caption text-ink-2">
      계정을 삭제했어요.
    </p>
  );
}
