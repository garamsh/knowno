import { redirect } from "next/navigation";

/** 관리자 is under 설정 now (ADR 0155). The admin gate checks the role before this runs. */
export default function Page() {
  redirect("/admin/settings/admins");
}
