import { Suspense } from "react";

import { DeckContent } from "../../_components/content";
import { AdminSkeleton } from "../../_components/admin-skeleton";

/** A public or reported deck, read-only, with its cards and the moderation actions. */
export default function Page({ params }: PageProps<"/admin/decks/[id]">) {
  return (
    <>
      <Suspense fallback={<AdminSkeleton />}>
        <DeckContent params={params} />
      </Suspense>
    </>
  );
}
