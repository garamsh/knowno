import { redirect } from "next/navigation";

/** 작업 기록 is on 관리자's page now (ADR 0181). The admin gate checks the role before this runs. */
export default function Page() {
  redirect("/admins");
}
