import { redirect } from "next/navigation";

/** 추출 결과 is 사진 AI's now (ADR 0155). The admin gate checks the role before this runs. */
export default function Page() {
  redirect("/admin/ai");
}
