import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { AdminNav, readIsAdmin, readOpenReports } from "@/features/admin";

/**
 * [children] under the admin area's menu for an admin; the not-found page for anyone else. A
 * server that cannot answer is an error, which says nothing of the area.
 */
export async function AdminGate({ children }: { children: ReactNode }) {
  // The menu's count is read beside the check; the server refuses it to anyone but an admin.
  const [admin, reports] = await Promise.all([readIsAdmin(), readOpenReports()]);
  if (admin === false) notFound();
  if (admin !== true) throw new Error(`the admin check failed: ${admin.failure}`);
  return (
    <>
      {/* A count that could not be read shows none; 처리할 일 says what failed. */}
      <AdminNav openReports={"failure" in reports ? null : reports.data.notes} />
      {/* Korean breaks only between words on every admin page (design.md §Details). */}
      <div className="contents break-keep">{children}</div>
    </>
  );
}
