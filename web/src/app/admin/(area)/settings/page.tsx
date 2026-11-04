import { redirect } from "next/navigation";

/** 요금제 has its own page now (ADR 0181). The admin gate checks the role before this runs. */
export default function Page() {
  redirect("/plans");
}
