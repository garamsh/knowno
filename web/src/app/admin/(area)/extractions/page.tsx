import { redirect } from "next/navigation";

/** 추출 결과 is AI's now (ADR 0155, ADR 0182). The admin gate checks the role before this runs. */
export default function Page() {
  redirect("/ai");
}
