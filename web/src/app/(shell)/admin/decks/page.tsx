import { Suspense } from "react";

import { PublicDecksContent } from "../_components/content";
import { AdminSkeleton } from "../_components/admin-skeleton";

/** Every public deck, searched by name, with the moderation actions. */
export default function Page({ searchParams }: PageProps<"/admin/decks">) {
  return (
    <>
      <h1 className="text-display">공개 노트</h1>
      <Suspense fallback={<AdminSkeleton />}>
        <PublicDecksContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}
