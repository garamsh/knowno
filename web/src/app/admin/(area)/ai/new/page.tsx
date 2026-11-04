import { redirect } from "next/navigation";

/** The new version's form is AI's `write` now, from the version `from` names or else the active one (#650). The admin gate checks the role before this runs. */
export default async function Page({ searchParams }: PageProps<"/admin/ai/new">) {
  const { from } = await searchParams;
  redirect(
    `/ai?${new URLSearchParams({ write: typeof from === "string" ? from : "" }).toString()}`,
  );
}
