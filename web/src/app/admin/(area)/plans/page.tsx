import { redirect } from "next/navigation";

/** 요금제 is under 설정 now (ADR 0155). The admin gate checks the role before this runs. */
export default function Page() {
  redirect("/settings");
}
