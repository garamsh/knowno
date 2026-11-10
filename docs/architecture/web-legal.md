# Web legal

The web's `legal` feature: the terms of service and the privacy policy at `/terms` and `/privacy`, and the links to them. The app's links to them are [`account.md`](account.md)'s.

## Current decisions

### Documents

- The web publishes the terms of service at `/terms` and the privacy policy at `/privacy`, in Korean, and every link to them, the app's included, leads there ([ADR 0032](adr/0032-publish-the-legal-documents-on-the-web-and-link-both-clients-to-them.md)). The login page's consent line and the account page's foot link to them by those relative paths, through `web/src/features/legal/legal-links.tsx`; nothing configures them.
- Each page is a static Server Component that reads nothing, so `next build` prerenders it; the proxy lets a signed-out visitor reach both.
- `web/src/features/legal/legal-document.tsx` draws both in the list column with the theme's tokens: the title with a back link, "시행일" and the date, the opening paragraph, a "목차" navigation linking to each section, then each section under a second-level heading whose `id` is its anchor.
- The privacy policy's sections are the items collected and how, the purposes, retention and destruction, third-party provision, processors, overseas transfer, the user's rights, automatically collected data and cookies, protection measures, the contact and the effective date with how changes are announced. The terms' are the service, accounts and sign-in, the user's content and the licence for public decks, public sharing with reports, blocks and prohibited content, AI-made cards, service changes, account deletion, liability, governing law, the contact and the effective date (issue #86).
- The terms' AI-made cards section states that each plan limits the photos made into cards, counted by the month or the day in Korean time depending on the plan, and that 맥스 has no limit beyond a fair-use cap of 1,000 photos a day ([ADR 0097](adr/0097-give-each-plan-versions-of-its-terms-with-a-start-free-10-a-month-pro-100-a-day-and-max-unlimited-to-1000-a-day-each-grant-taking-the-latest-at-its-monthly-renewal.md), issue #373). It names no other plan's amount, which an admin's new plan version could change.
- Both name the service 알아몰라 and the operator "알아몰라 운영자" ([ADR 0134](adr/0134-name-the-app-knowno-serve-it-at-knowno-app-identify-it-as-app-knowno-and-reach-the-backend-at-api-knowno-app.md)) and the contact `sauce@garam.sh`. The privacy policy takes effect on 2026-11-17, seven days after issue #866's change as issue #373 did for the terms, and it says in its third-party section that a note to be made public is checked automatically before others see it (name, description and cards, by banned words, contacts and links, and an automatic judgement), that a flagged note waits or is not made public, and that an operator can read a held note to decide it, and the terms on 2026-11-03, the date issue #373's change takes effect. A change to either is a pull request to its `page.tsx`, and states the new date.

### Tests

Each line names a file and what it covers; the file holds the cases.

- `web/src/app/__tests__/legal-documents.test.tsx` — each document's required section headings, its table of contents links to their anchors, its title, effective date in the header and the 시행일 section, and contact; the terms' photo limits and 맥스's fair-use cap; and the privacy policy's sentence that a note is checked automatically before it is public.
- `web/src/features/legal/__tests__/legal.test.tsx` — the legal links' targets; the login and account pages' tests check the links there ([`web-account.md`](web-account.md)).

## Rationale

- [ADR 0032](adr/0032-publish-the-legal-documents-on-the-web-and-link-both-clients-to-them.md) records why the web hosts the legal documents and why no variable configures the links.
- Issue #86 records the legal documents. Issue #373 records the terms' photo limits and the effective date of 2026-11-03, seven days after the change, so the page announces it before it takes effect.

## Open questions

- Whether the terms' change of issue #373 is unfavourable to users and so needs 30 days' notice, which would move the terms' date to 2026-11-26. The owner confirms (issue #373).
