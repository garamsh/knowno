# ADR 0076: Ask prompt v8 for each sense's printed labels and examples, transcribed and never inferred, and eval labels on pages that print none

> Status: accepted; its owner approval of a cost change superseded by ADR-0246
> Date: 2026-10-19

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #228**, the owner's decision of 2026-10-19:
  - A vocabulary sense shows the same way whatever the book prints. The model records what a label is, and the app decides how it looks.
  - A label is transcribed, never inferred: a page that prints no label for a meaning gives none.
  - Grammar the parts of speech do not hold goes in the entry's `extras`, verbatim under the page's label, such as `{label: "성", text: "der"}`. Examples are a German gender, a Chinese measure word, a Japanese verb class and irregular forms.
- **The PM's revised contract on #228**, after the owner's case '기차 [사물] 철도 위를 다니는 긴 차':
  - A sense is `{labels, meaning, examples}`.
  - `labels` holds every label the page prints for that sense, in order, each `{kind, category, text}`. A part of speech has a `category` from a closed list. Any other label has `kind: 'other'` and `category: null`: a semantic class, a register, a field, or a part of speech the list does not hold.
  - `meaning` is a translation or a definition, as printed. `examples` are the sentences the page prints under that sense.
  - The eval must score "a label given that the page does not print", which must be 0. It needs a Korean dictionary sample with a semantic class and a definition, and an entry with per-sense examples.
- **[ADR 0075](0075-store-a-vocabulary-card-s-senses-as-a-typed-block-and-show-each-label-in-brackets-before-its-meaning.md)**, on PR #254 (#228's PR 2), states the JSON the app expects from this change:
  - each sense `{"labels": [...], "meaning": "...", "examples": [...]}`, `examples` present even when empty;
  - each label `{"kind": "part_of_speech", "category": "<name>", "text": "..."}` or `{"kind": "other", "category": null, "text": "..."}`;
  - `text` as printed, without the brackets around it;
  - the fourteen categories of its table.
- **Prompt v7** asks for each sense as `{pos, meaning}`, `pos` copied verbatim with its brackets, so every book shows its own form (`supabase/functions/extract-cards/prompt_v7.ts` on `main` at `806c7b241635809142a763a713135fe00994be17`).
- **#250**, the owner on 2026-10-19: nothing is released, so until the first store release no compatibility with older app builds is kept.
- **The coordinator's merge order of 2026-10-19**, which ADR 0075 records: #228's PR 1, this change, merges first, and #254 right after.
- **The app on `main`** reads a sense's `meaning` and its `pos`, and takes a missing `pos` as none (`_parseSense` in `app/lib/photo_import/src/extraction_client.dart` at `806c7b241635809142a763a713135fe00994be17`). It needs each card's `front` and `back`.
- Alternatives considered:
  - **Keep `pos` verbatim and map it to a category in the function**, by a table of printed forms. Each book prints its own forms, such as `n.`, `(동)`, `명사` or a boxed `형`, so no table covers them. The model reads the label where it is printed, and the closed list bounds what it may answer.
  - **One `category` per sense**, #228's first contract. It cannot hold a semantic class beside a part of speech.
  - **A gender as a sense's `other` label.** The owner's decision puts grammar beyond the parts of speech in `extras`. A gender belongs to the entry, not to one of its meanings.
  - **Keeping `prompt_v7.ts` beside v8.** Nothing would import it. As in ADR 0069, git keeps the old version.

## Decision

- **Prompt v8.** `prompt_v8.ts` replaces `prompt_v7.ts` and keeps v7's rules, except as follows:
  1. A sense is `{labels, meaning, examples}`.
  2. `labels` are the labels the page prints for that meaning, in its order, each transcribed, never inferred:
     - a part of speech is `{"kind": "part_of_speech", "category": <name>, "text": <as printed>}`, its category one of ADR 0075's fourteen;
     - any other label is `{"kind": "other", "category": null, "text": <as printed>}`;
     - `text` keeps the label's dots and drops the brackets around it: `동` for `[동]`, `n.` for `n.`;
     - `labels` is empty when the page prints no label for the meaning, even when its part of speech is plain.
     - a label is one printed with that meaning, on its own line. A part of speech printed elsewhere, such as before each reading of a pronunciation like `명 ['kantent] / 형 [kan'tent]`, labels no sense and stays in `pronunciation` alone. The PM's first run of this change (below) put such markers on senses of samples 57 and 58.
  3. `meaning` is the translation or the definition, without its labels or number.
  4. A sense's `examples` are those the page prints under that meaning. A vocabulary card's own `examples` keep only those the page prints for the entry as a whole.
  5. **Labels and extras.** A label printed for one meaning goes in that sense's `labels`. Grammar printed for the entry as a whole goes in `extras`, verbatim under the page's label: a gender, a measure word, a verb class, a plural or an irregular form.
  - The rule "never add" names a label in place of a part of speech.
- **The contract.** Each `senses` item is the sense above, as ADR 0075 states it.
  - At most 5 labels and 5 examples a sense. Each label's `text` and each example is 1 to 500 characters.
  - The schema states each label's `kind` and `category` as enums, the category `null` for another label.
- **The parser refuses a broken sense** as invalid output, which answers `502` after the one call ([ADR 0071](0071-give-each-user-a-plan-whose-model-and-daily-limit-an-admin-sets-in-the-database-and-make-one-model-call-per-photo.md)):
  - a label whose `kind` is unknown;
  - a part of speech whose `category` is not on the list;
  - another label with a `category`;
  - a label, meaning or example empty or over its limit;
  - a key outside the shape, the old `{pos, meaning}` included.
  - A label written with its brackets, `[]`, `()`, `<>`, `「」`, `『』`, `〈〉`, `《》`, `【】` or `〔〕`, keeps only what they enclose.
- **For apps that read only `answer` and `back`**, a sense's labels are written in brackets before its meaning: `[명] [사물] 철도 위를 다니는 긴 차`. One sense's labels so written are its `partOfSpeech`. Dropping these fields is #250's.
- **Merge order.** This change merges first, and #254 right after.
  - Between the two, an app built from `main` reads each new sense's `meaning` and no label, so vocabulary imports work without labels.
  - #254's app refuses the `{pos, meaning}` sense, so it must not deploy before this change.
- **The eval:**
  - Every vocabulary truth holds `senses` of `{labels, meaning, examples}`, read through the function's own `parseSense`, and `examples` and `extras` where its page prints them.
  - `generate.py` writes the 27 vocabulary truths of samples 01 to 24 and 45 to 47 in this shape. Their images and the notes samples stay byte-identical. A printed label's category comes from a table of the forms the pages print: `n.`, `v.`, `adj.`, `adv.`, `명`, `동`, `형`, `부`, `명사`, `동사` and `형용사`.
  - New samples, each in print, handwriting and harsh:
    - 56 to 58: the word book of samples 45 to 47 with no label printed. Samples 45 to 47 are their labelled control.
    - 59 to 61: four English headwords with an example printed under each sense.
    - 62 to 64: a Korean dictionary page of seven headwords. Their labels are semantic classes such as `[사물]`, alone or after a part of speech such as `「명사」`, and each meaning is a definition.
    - 65 to 67: six German nouns and verbs. Their gender, plural or past forms are printed as extras under 성, 복수, 과거 and 과거분사.
  - The metrics, over the matched cards, whose senses pair with the page's in order:
    - labels P and R: returned labels equal in text to the page's for that sense, and printed labels so returned;
    - category: of those equal labels, the share whose kind and category are the page's too;
    - unprinted labels: the share of senses the page prints no label for that were given one. It must be 0.
    - examples: returned examples, on the card or a sense, that the page prints for the entry;
    - sense examples: examples printed under a sense that the returned sense holds;
    - extras: printed extras returned with an equal label and text;
    - invented: returned label lists, example lists and extras where the page prints none.
    - A sense matches the page's when its labels and its meaning are equal.
  - The report adds a table with each vocabulary page's F1 and these shares.
- **Before merge.**
  - The PM runs the eval on Claude Haiku 5.5. The report shows, against prompt v7:
    - unprinted labels on samples 56 to 58 and the other pages printing none;
    - labels and category on samples 45 to 47 and the dictionary pages;
    - the Korean dictionary's senses, the German extras and the sense examples;
    - vocabulary F1 and senses;
    - notes coverage, and the cost per photo.
  - Merging deploys the function. The owner approves any change in the cost per photo first ([`server.md`](../server.md) §Edge Function deploys).
  - `--dry-run` estimated the run on 2026-10-19 at $0.0774: the 67 samples on Claude Haiku 5.5, with $4.0135 of the budget remaining.
- **Supersessions:**
  - [ADR 0069](0069-ask-prompt-v7-for-whole-table-and-cloze-cards-as-structured-fields-exception-cards-that-state-what-they-do-and-examples-only-from-the-page.md)'s prompt v7;
  - [ADR 0063](0063-ask-prompt-v6-for-atomic-typed-cards-and-a-vocabulary-entry-s-senses-and-eval-long-answers-and-senses.md)'s sense of `pos` and `meaning`, and its senses and part-of-speech scores.

- **The PM's first run**, on 2026-10-19 at `6e62564c206163a612eb2a02936d49f1d68e8484`, Claude Haiku 5.5 over the 67 samples, $0.1468:
  - Vocabulary F1 was 99.4, labels P, R and category 94.9, 100 and 100, and the Korean dictionary, German, sense-example and extras scores 100. Table and cloze blanks were 100, and the cost per photo $0.0022, as v7's.
  - Unprinted labels were 15.4 on sample 57 and 53.8 on sample 58, and 0.0 on 56. Each wrong label sat on an entry whose pronunciation prints a part of speech before each reading, such as `명 ['kantent] / 형 [kan'tent]`. The model moved those markers onto the senses, so the rule above was added.
  - The dense grammar pages 33 to 36 covered 81.0, 61.9, 90.5 and 66.7, against 95.2, 90.5, 95.2 and 85.7 for v7 at `048da7553c1212fc21352b10f39167aeccd6334f`. v8's notes rules are v7's word for word, except that the rule against adding names a label in place of a part of speech.
    - On samples 33, 34 and 36, the four contraction lines missed for want of the rule's name, 축약: they came back as cloze or concept cards fronted "ㅗ+ㅏ -> ___" or "ㅗ+ㅏ -> ㅘ", or were dropped. ADR 0069 records the same failure on v7's first run. On sample 35 the cards named the rule, and two answers were misread, 궈 for ㅝ and 겨 for ㅕ.
    - The other misses were misreads on harsh or handwritten pages, such as 깡총 for 깡충 and 굽다 for 곱다, and the vowel lists, dropped on sample 34 and split across two cloze cards on 36.
  - Invented examples on the notes pages were 10 of 132, all on notes cards: misreads such as "보아라 -> 봐라" for "보+아라 -> 봐라" on sample 36, and "삼 면". None was a sense's example.

## Consequences

- A sense reaches the app with what each label is, so #254 shows `[명]` for every book's noun label.
- A page with no labels yields senses with none, and the eval measures whether the model holds to that.
- Strict structured outputs bound each label's kind and category, so a model cannot return a category off the list. It can still choose the wrong one, which the category score measures.
- Each sense carries an `examples` list, so a reply grows by a few tokens a sense. The cost change is unmeasured until the PM's run.
- The parser refuses the old `{pos, meaning}` sense, so the function no longer reads a reply written to prompt v7's schema.

## Signs the decision was wrong

- Unprinted labels stay above 0 on samples 56 to 58, so the model infers labels despite the rule.
- Category accuracy falls short on the dictionary pages, or labels R falls on samples 45 to 47 against v7's part of speech, so the closed list is harder to use than copying.
- On samples 65 to 67, the gender lands among a sense's labels rather than in `extras`, so the line between the two does not reach the model.
- Invalid outputs rise on vocabulary pages, through labels the schema allows and the parser refuses.
- The cost per photo rises more than the owner accepts.
