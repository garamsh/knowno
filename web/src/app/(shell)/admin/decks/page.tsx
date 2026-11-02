import { Suspense } from "react";

import { AdminSkeleton } from "../_components/admin-skeleton";
import { NotesContent } from "../_components/content";

/** 노트: the reported, public or hidden notes, searched by name or owner, with their actions. */
export default function Page({ searchParams }: PageProps<"/admin/decks">) {
  return (
    <>
      <h1 className="text-display">노트</h1>
      <Suspense fallback={<AdminSkeleton />}>
        <NotesContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}
