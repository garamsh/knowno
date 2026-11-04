import { headers } from "next/headers";
import type { ReactNode } from "react";

import { getSession } from "@/features/account";
import { AdminRefusal, AdminShell, readIsAdmin, readOpenReports } from "@/features/admin";
import { serviceOriginHeader } from "@/proxy";

/**
 * [children] in the admin host's shell for an admin; for a signed-in account that is not one, one
 * line and nothing of the area. A server that cannot answer is an error, which says nothing of the
 * area.
 */
export async function AdminGate({ children }: { children: ReactNode }) {
  // The menu's count is read beside the check; the server refuses it to anyone but an admin.
  const [admin, reports, session, request] = await Promise.all([
    readIsAdmin(),
    readOpenReports(),
    getSession(),
    headers(),
  ]);
  if (admin === false) return <AdminRefusal />;
  if (admin !== true) throw new Error(`the admin check failed: ${admin.failure}`);
  return (
    <AdminShell
      // A count that could not be read shows none; 처리할 일 says what failed.
      openReports={"failure" in reports ? null : reports.data.notes}
      email={session.kind === "signed-in" ? session.email : ""}
      serviceUrl={request.get(serviceOriginHeader)}
    >
      {children}
    </AdminShell>
  );
}
