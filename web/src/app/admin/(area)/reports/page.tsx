import { redirect } from "next/navigation";

/** 신고 is 노트's reported view now (ADR 0155). The admin gate checks the role before this runs. */
export default function Page() {
  redirect("/decks");
}
