import { Suspense } from "react";

import { AdminGate } from "./_components/admin-gate";

/**
 * The admin area (ADR 0070), served on the admin host in a shell of its own (ADR 0178). Nothing
 * of it renders until the server says the signed-in user is an admin; anyone else gets one line.
 */
export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <Suspense fallback={null}>
      <AdminGate>{children}</AdminGate>
    </Suspense>
  );
}
