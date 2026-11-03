import { redirect } from "next/navigation";

/** A prompt version's page is under 사진 AI now (ADR 0155). The admin gate checks the role before this runs. */
export default async function Page({ params }: PageProps<"/admin/prompts/[id]">) {
  const { id } = await params;
  redirect(`/ai/${encodeURIComponent(id)}`);
}
