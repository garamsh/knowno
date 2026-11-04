import { redirect } from "next/navigation";

/** 관리자 has its own page now (ADR 0181). The admin gate checks the role before this runs. */
export default function Page() {
  redirect("/admins");
}
