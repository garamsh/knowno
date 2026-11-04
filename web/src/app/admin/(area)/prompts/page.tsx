import { redirect } from "next/navigation";

/** 프롬프트 is AI now, and its form AI's `write` (ADR 0155, #650). The admin gate checks the role before this runs. */
export default async function Page({ searchParams }: PageProps<"/admin/prompts">) {
  const { from } = await searchParams;
  redirect(
    typeof from === "string" ? `/ai?${new URLSearchParams({ write: from }).toString()}` : "/ai",
  );
}
