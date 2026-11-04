import { redirect } from "next/navigation";

/** 프롬프트 is 사진 AI now, and its form `/ai/new` (ADR 0155). The admin gate checks the role before this runs. */
export default async function Page({ searchParams }: PageProps<"/admin/prompts">) {
  const { from } = await searchParams;
  redirect(
    typeof from === "string" ? `/ai/new?${new URLSearchParams({ from }).toString()}` : "/ai",
  );
}
