# Web legal

The web's `legal` feature: the terms of service and the privacy policy at `/terms` and `/privacy`, the links to them, and the seller's business details shown beside them. The app's links to them are [`account.md`](account.md)'s.

## Current decisions

### Documents

- The web publishes the terms of service at `/terms` and the privacy policy at `/privacy`, in Korean, and every link to them, the app's included, leads there ([ADR 0032](adr/0032-publish-the-legal-documents-on-the-web-and-link-both-clients-to-them.md)). The login page's consent line and the account page's foot link to them by those relative paths, through `web/src/features/legal/legal-links.tsx`; nothing configures them.
- Each page is a static Server Component that reads nothing, so `next build` prerenders it; the proxy lets a signed-out visitor reach both.
- `web/src/features/legal/legal-document.tsx` draws both in the list column with the theme's tokens: the title with a back link, "시행일" and the date, the opening paragraph, a "목차" navigation linking to each section, then each section under a second-level heading whose `id` is its anchor.
- The privacy policy's sections are the items collected and how, the purposes, retention and destruction, third-party provision, processors, overseas transfer, the user's rights, automatically collected data and cookies, protection measures, the contact and the effective date with how changes are announced. The terms' are the service, accounts and sign-in, the user's content and the licence for public decks, public sharing with reports, blocks and prohibited content, AI-made cards, service changes, account deletion, liability, governing law, the contact and the effective date (issue #86).
- The terms' AI-made cards section states that each plan limits the photos made into cards, counted by the month or the day in Korean time depending on the plan, and that 프로 has no limit beyond a fair-use cap of 1,000 photos a day ([ADR 0097](adr/0097-give-each-plan-versions-of-its-terms-with-a-start-free-10-a-month-pro-100-a-day-and-max-unlimited-to-1000-a-day-each-grant-taking-the-latest-at-its-monthly-renewal.md), issue #373). It names no other plan's amount, which an admin's new plan version could change.
- Both name the service 알아몰라 and the operator "알아몰라 운영자" ([ADR 0134](adr/0134-name-the-app-knowno-serve-it-at-knowno-app-identify-it-as-app-knowno-and-reach-the-backend-at-api-knowno-app.md)) and the contact `sauce@garam.sh`. The privacy policy takes effect on 2026-11-17, seven days after issue #866's change as issue #373 did for the terms, and it says in its third-party section that a note to be made public is checked automatically before others see it (name, description and cards, by fixed rules alone, for banned words, contacts such as phone numbers and messenger ids, links, resident registration numbers and account numbers, and no automatic judgement, [ADR 0240](adr/0240-keep-note-screening-to-rules-and-let-reports-catch-the-rest-and-return-each-finding-s-field.md); issue #879), that a flagged note waits or is not made public, and that an operator can read a held note to decide it, and the terms on 2026-11-03, the date issue #373's change takes effect. A change to either is a pull request to its `page.tsx`, and states the new date.
- The terms carry the paid plan (issue #893, part of #599). At launch 플러스 is sold only in the app, through the App Store by way of RevenueCat; the web sells nothing, and web sales come later through Toss Payments (issue #895), whose terms are written then. A "플러스 요금제와 구독" section states what 플러스 includes without naming amounts, automatic renewal until cancelled, cancelling in the app store the purchase was made in, price changes, and the plan at the end of a period and at a refund. A "환불과 청약철회" section states 청약철회 under 전자상거래법 제17조 and sends a refund to that app store's process (Apple's for the App Store). Neither names a store beyond Apple, so Google Play needs no edit when Android ships. The notice that 제17조 제6항 requires before purchase is the app's purchase sheet's to give (issue #885). There is no separate refund page. The terms' effective date moves to 2026-11-17, seven days after the change; the pull request recomputes it when it merges after 2026-11-10. The AI-cards section names the plans by the display names of issue #599 (프로 for the unlimited one).
- The privacy policy names RevenueCat as a processor (처리위탁) with what it receives, and lists a purchase record among the items collected. Apple is not a processor: in an App Store purchase Apple is the seller and collects the Apple ID and payment details under its own privacy policy, and the third-party section says so. The overseas section names the United States for RevenueCat (its privacy policy: data stored on AWS in the USA; its DPA: sub-processors in the USA, plus one in Korea that applies to Korean customers only). The policy's date stays 2026-11-17: it is not yet in force, so the change rides the date issue #866 set.
- `web/src/features/legal/seller-details.ts` holds the seller's details that 전자상거래법 제10조 제1항 and 제13조 제1항 require (상호, 대표자, 주소, 전화번호, 이메일, 사업자등록번호, 통신판매업 신고번호) and the link to 공정거래위원회's 통신판매사업자 등록현황 page. The business fields are bracketed placeholders until the owner supplies them; nothing is invented. `SellerInfo` draws them as a footer at the end of `LegalDocument` and on the sign-in page. The account page draws it too once issue #886 lands.

### Tests

Each line names a file and what it covers; the file holds the cases.

- `web/src/app/__tests__/legal-documents.test.tsx` — each document's required section headings, its table of contents links to their anchors, its title, effective date in the header and the 시행일 section, and contact; the terms' photo limits and 프로's fair-use cap; the paid plan's renewal, cancellation and refund sections, with no mention of a processor the web does not use; and the privacy policy's sentence that a note is checked by rules before it is public, RevenueCat as processor, Apple as seller and RevenueCat's country.
- `web/src/features/legal/__tests__/seller-info.test.tsx` — each required detail and the lookup link, and that the terms, the privacy policy and the sign-in page show them.
- `web/src/features/legal/__tests__/legal.test.tsx` — the legal links' targets; the login and account pages' tests check the links there ([`web-account.md`](web-account.md)).

## Rationale

- [ADR 0032](adr/0032-publish-the-legal-documents-on-the-web-and-link-both-clients-to-them.md) records why the web hosts the legal documents and why no variable configures the links.
- Issue #86 records the legal documents. Issue #373 records the terms' photo limits and the effective date of 2026-11-03, seven days after the change, so the page announces it before it takes effect.

## Open questions

- The owner supplies the seller's details in `seller-details.ts` before the paid launch (issue #893).

- Whether the terms' change of issue #373 is unfavourable to users and so needs 30 days' notice, which would move the terms' date to 2026-11-26. The owner confirms (issue #373).
