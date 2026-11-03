# ADR 0079: Name a card's sides front and back and its grade the response, on the phone, the web and in the docs

> Status: accepted
> Date: 2026-10-19

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #243**, the QA audit of 2026-10-19:
  - A card's sides were 문제 and 답 (Question and Answer) in the card editor, the phone's previous-card dialog and the web's current card. They were 앞면 and 뒷면 (Front and Back) in photo import's edit sheet, the duplicate options and the web's previous-card dialog.
  - 답 also named the grade, 안다 or 모른다: "앞면: … 뒷면: … 답: 안다".
  - `docs/convention/style.md` §Naming consistency asks for one term per concept.
- **The PM's direction on #243, 2026-10-19:**
  - the sides are 앞면 and 뒷면 everywhere, in English Front and Back, since a vocabulary, table or cloze card is no question and answer, and front and back are what the keys and the data say;
  - the grade is 응답, in English Response;
  - in code `Answer` stays the grade, and what calls the back an answer is renamed.
- **The PM's decisions of 2026-10-19 on this change's questions:**
  - answering is 응답하다, to respond, as in "응답한 카드" and "마지막 응답 바꾸기";
  - the type scale's `question` and `answer` become `front` and `back` on the phone and the web;
  - photo import's `CandidateCard.answer` stays, since it is the extract-cards contract's field, a note's answer, not a stored side.
- Alternatives considered:
  - **문제 and 답 for the sides.** A vocabulary card's back is a meaning and a table card's front a table, neither of them a question and its answer, and 답 would still collide with the grade.
  - **Keeping 답 as the grade.** 답 has named the back on every deck screen since ADR 0036, so a reader would meet one word for two things during the change and after it.

## Decision

- **Sides.** A card's two sides are 앞면 and 뒷면, in English Front and Back, in every string, label and screen-reader text on the phone and the web, and in the docs.
- **The grade.** The grade a card is given, 안다 or 모른다, is 응답, in English Response, and answering is 응답하다, to respond: "앞면: … 뒷면: … 응답: 안다".
- **In code:**
  - `Answer` stays the grade;
  - a side is `front` or `back`: `CardAnswerRow` becomes `CardBackRow`, the ARB keys `showAnswer`, `hideAnswer`, `cardAnswerHidden` and `cardAnswerShown` become `showBack`, `hideBack`, `cardBackHidden` and `cardBackShown`, and the type scale's `question` and `answer` become `front` and `back` (`AppType` and the web's `--text-*`).
- `design/copy.md` §Terms records the terms.
- **Not changed:**
  - the terms of use and the privacy policy, whose wording takes effect on a stated date (`web.md`);
  - 답 where it means a reply that is not the grade, such as the server's or the model's;
  - the extract-cards contract's `answer`.

## Consequences

- One word names each side and one the grade, so a screen reader's "뒷면" and "응답" never mean the same thing.
- A future string about a side or the grade has its word in `design/copy.md` §Terms.
- The legal documents still say 답한 기록 until their next revision, which takes a new effective date.
- The English strings say respond and response where they said answer.

## Signs the decision was wrong

- Users read 응답 as a network or server response rather than their grade.
- 앞면 and 뒷면 read as stiff on a vocabulary card, where users expect 단어 and 뜻.
