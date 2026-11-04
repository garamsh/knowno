import { redirect } from "next/navigation";

/** A prompt version is listed in AI now, which has no page per version (#650). The admin gate checks the role before this runs. */
export default function Page() {
  redirect("/ai");
}
