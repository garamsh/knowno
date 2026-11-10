import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { SellerInfo } from "./seller-info";

/** One numbered section of a legal document: its anchor, its heading and its text. */
export type LegalSection = { id: string; heading: string; body: ReactNode };

/**
 * A legal document titled [title]: when it takes effect, a table of contents linking to each
 * section's heading, then the sections in order.
 */
export function LegalDocument({
  title,
  effectiveDate,
  intro,
  sections,
}: {
  title: string;
  effectiveDate: string;
  intro: ReactNode;
  sections: readonly LegalSection[];
}) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-list flex-col gap-section-gap px-gutter py-6">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-1">
          <Link
            href="/"
            aria-label="처음으로"
            className="-ml-3 flex size-tap-target items-center justify-center rounded-full text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          >
            <ChevronLeft aria-hidden className="size-6" strokeWidth={2} />
          </Link>
          <h1 className="text-title">{title}</h1>
        </div>
        <p className="text-secondary text-muted">시행일 {effectiveDate}</p>
      </header>
      <div className="flex flex-col gap-3 text-body text-ink-2">{intro}</div>
      <nav aria-labelledby="toc" className="rounded-row bg-surface px-gutter py-4">
        <h2 id="toc" className="text-section text-muted">
          목차
        </h2>
        <ol className="mt-2 flex flex-col">
          {sections.map(({ id, heading }) => (
            <li key={id}>
              <a
                href={`#${id}`}
                className="flex min-h-tap-target items-center text-label text-ink underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
              >
                {heading}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      {sections.map(({ id, heading, body }) => (
        <section key={id} aria-labelledby={id} className="flex flex-col gap-3">
          <h2 id={id} className="scroll-mt-6 text-body-strong">
            {heading}
          </h2>
          <div className="flex flex-col gap-3 text-body text-ink-2 [&_a]:underline [&_li]:ml-5 [&_ul]:flex [&_ul]:list-disc [&_ul]:flex-col [&_ul]:gap-1">
            {body}
          </div>
        </section>
      ))}
      <SellerInfo />
    </main>
  );
}
