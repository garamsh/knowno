import { redirect } from "next/navigation";

/** AI 제공자 is part of AI now (#650). The admin gate checks the role before this runs. */
export default function Page() {
  redirect("/ai");
}
