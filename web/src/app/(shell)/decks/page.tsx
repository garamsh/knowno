import { redirect } from "next/navigation";

/** The notes live in 홈's drawer, so an address kept from the 노트 tab opens 홈 (ADR 0150). */
export default function DecksPage() {
  redirect("/");
}
