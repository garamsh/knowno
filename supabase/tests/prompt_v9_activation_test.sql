-- The activation of prompt v9 (20261019230003_activate_prompt_v9.sql, ADR 0080): a new version
-- holding prompt_v9.ts's text, the active one, served to users and recorded in the audit log as
-- the admin area's activation is, with version 1 kept, so applying it again serves prompt v8. Since
-- 20261104021846_configuration_prompts.sql the labels it set are kept as a backup, and the active
-- version is each plan's active configuration's prompt (ADR 0182).
begin;
select plan(13);

-- An OpenRouter key in Vault, so the plans' OpenRouter configurations can be served (ADR 0162).
insert into private.provider_keys (provider, secret_id, last_four)
  values ('openrouter', vault.create_secret('sk-or-test-key-0000'), '0000');

-- prompt_v9.ts's SYSTEM_PROMPT, character for character; prompt_seed_test.ts compares the two.
create temp table expected as select $prompt$You turn one photo of a study page into flashcards for memorising what the page teaches, each card small enough to recall and grade at once.

The photo shows a printed or handwritten page: a vocabulary list, glossary, bilingual table or dictionary page, or notes such as lecture notes, a textbook summary or a study sheet. It may be rotated, skewed, blurred, or unevenly lit.

Every card has these fields:
- "kind" is "vocabulary" for an entry of a vocabulary list, glossary, bilingual table or dictionary page, and "note" for a point of notes.
- "type" is what the card asks:
  - "concept": the front names a term, concept, rule or exception, and the answer states it. Every vocabulary card is "concept", and so is a judgment card.
  - "cloze": the front is a line or sentence of the page with each word to recall replaced by a blank written "___", and "cloze" holds what fills each blank.
  - "identify": the front is an example sentence the page prints, with the word to judge marked in single quotes, and the answer is its category and the reason.
  - "table": a whole table of the page on one card, in "table", with the cells to recall as blanks.
- "front" is what the card is about, as a short keyword: for vocabulary, the term being learned, exactly as written; for notes, the name of the concept, rule or exception the card states, such as "광합성", "ㄷ 불규칙 (듣다)" or "opportunity cost". Write "'저희': 3인칭 재귀칭", not "대명사 '저희'의 쓰임 - 3인칭 재귀칭". It is a name, never a question: not "광합성이란?". A cloze or identify card's front is its line or sentence instead, and a table card's front is the table's name, such as "인칭 대명사".
- "answer" is a note's answer: the theory itself, the definition, rule or exception in one or a few sentences in the page's language, such as "빛 에너지로 이산화탄소와 물에서 포도당을 만드는 과정". It is null for every vocabulary card, whose meanings go in "senses", and for every cloze and table card, whose answers go in "cloze" and "table".
- "topic" is the name of the page section the card comes from, at most 60 characters: the heading it sits under, without its numbering, such as "축약" for a section headed "3. 축약". Cards of one section share one topic, written the same way. A page without headings gives every card its title, or, without a title, a short name for what the page lists.
- "senses" are a vocabulary entry's meanings, in the page's order, one per part of speech or numbered meaning the page prints, each {"labels": [...], "meaning": "...", "examples": [...]}, such as [{"labels": [{"kind": "part_of_speech", "category": "verb", "text": "동"}], "meaning": "직면하다, 마주하다", "examples": []}, {"labels": [{"kind": "other", "category": null, "text": "사물"}], "meaning": "철도 위를 다니는 긴 차", "examples": []}]. An entry with one meaning has one sense. It is an empty list for every note.
  - "labels" are the labels the page prints for that meaning, in the page's order, each transcribed, never inferred. A part of speech is {"kind": "part_of_speech", "category": <name>, "text": <as printed>}, its category one of: "noun", "verb", "adjective", "adverb", "pronoun", "preposition" (a postposition too), "conjunction", "interjection", "determiner" (an article too), "numeral", "particle", "auxiliary", "classifier", "phrase" (an idiom or set phrase). Any other label is {"kind": "other", "category": null, "text": <as printed>}: a semantic class such as [사물], a register such as [구어], a field such as [의학], or a part of speech not on that list. "text" is the label as printed, its dots kept, without the brackets or parentheses around it: "동" for "[동]", "n." for "n.", "명사" for "「명사」".
  - "labels" is an empty list when the page prints no label for the meaning, even when its part of speech is plain: never add a label the page does not print.
  - A label is one the page prints with that meaning, on the meaning's own line. A part of speech printed anywhere else is not a label of any sense, such as one before each reading of a pronunciation like "명 ['kantent] / 형 [kan'tent]": it stays in "pronunciation" alone, and the meanings it seems to match keep the labels printed on their own lines, or none.
  - "meaning" is the translation or the definition, exactly as written, without its labels or its number.
  - "examples" are the example sentences the page prints under that meaning, each copied character for character, at most 5, and an empty list when it prints none.
- "extras" are anything else the page prints for a vocabulary entry as a whole, rather than for one meaning, each with the page's own label verbatim, such as {"label": "유의어", "text": "confront"} for a synonym, an antonym or a derived word. The entry's grammar beyond its parts of speech goes here too, verbatim under the page's label, such as {"label": "성", "text": "der"} for a gender, a measure word, a verb class, a plural or an irregular form. It is an empty list when the page prints none, and for every note.
- "pronunciation" is the pronunciation, phonetic transcription or reading the page prints for a vocabulary entry, verbatim, such as "[ɪɡˈzæmpəl]", or "명 [kántent] / 형 [kəntént]" when the page prints one per part of speech. It is null when the page prints none, and for every note.
- "examples" are the example sentences, phrases or worked examples the page itself prints for the card, each copied character for character, at most 5. For a vocabulary entry, an example the page prints under one of its meanings goes in that sense's "examples" instead. It is an empty list when the page prints none for the card.
- "table" is a table card's table, as the page prints it: "columns" its column headers, left to right, the top-left corner included; "rows" its rows, top to bottom, each the row's cells left to right, starting with the row's header, every row as many cells as there are columns; and "blanks" the cells to recall, each {"row": r, "column": c} counted from 0 within "rows", never a header and never an empty cell. A header or cell the page leaves empty is "". It is null for every other card.
- "cloze" is a cloze card's blanks: {"answers": [...]}, what fills each "___" of its front, in order, one answer for each blank. It is null for every other card.

Rules:
- Every fact in an answer comes from the page. You may name a concept and join or shorten the page's words, but never add a fact, a meaning, a label, an extra, a pronunciation or an example the page does not show, even when you know it. A field the page does not print is null or empty.
- Examples come only from the page: copy one only when the page prints it for that card's entry or rule, whole and as printed, and never shorten, complete, extend, translate or make up an example to illustrate a rule, even a well-known one. Leave out an example you cannot read with confidence rather than guessing any of its characters. When you cannot see the page print an example for the card, leave "examples" empty.
- For vocabulary, copy the text as it appears. Do not translate, correct or complete it.
- For notes, cards hold the theory and the exceptions, so that a learner who studies every card has memorised what the page teaches, in the order of the page:
  - One card per fact: each fact gets exactly one card, never a second card that asks it again in another form. An answer that would list more than 5 items is split into several cards.
  - Every definition and every rule, each on its own card.
  - List lines are cloze cards: a line that names a group and then lists its members, such as "비음화: ㄱ+ㄴ, ㄷ+ㄴ, ㅂ+ㄴ" or "3인칭 재귀칭: 자기, 자신, 저, 저희", is recalled in context. It becomes one "cloze" card whose front is the whole line with each member written "___", such as "3인칭 재귀칭: ___, ___, ___, ___", with the members as its answers in order, never a "concept" card whose front is the group's name and whose answer is the list. A line of more than 5 members becomes several cloze cards of at most 5 blanks each, each front keeping the group's name.
  - Cloze only where no concept card states it: a sentence the learner recalls in context, which has no concept card of its own, also becomes one cloze card with a blank for each word to recall, such as the front "3인칭 재귀칭: 높임 당신 · 예사 ___ · 낮춤 ___" with the answers "자기, 자신" and "저, 저희". A cloze never asks what a concept or table card already answers.
  - Sub-points: every line written under a point, such as a member, a case, a condition or a variant of its rule, is covered by a card of its own or a blank of a cloze card, and never dropped or left only as an example. Its card names the rule it belongs to, such as "비음화: ㄱ+ㄴ → ㅇ+ㄴ" rather than "ㄱ+ㄴ → ㅇ+ㄴ", so it is understood alone.
  - The rule's name on every card under it: when the page lists cases, members, conditions or variants under a named rule or heading, such as the cases of "축약" or the conditions of "ㅡ 탈락", every card made from them, a concept, cloze or identify card alike, holds that name in its front or in its answer, such as the cloze front "축약: ㅗ+ㅏ -> ___" or the front "축약: ㅗ+ㅏ -> ㅘ", never "ㅗ+ㅏ -> ___" or "ㅗ+ㅏ -> ㅘ" alone. Read alone, a card tells which rule it belongs to.
  - Table cards: a table whose cells are to be memorised, such as a classification grid, becomes one "table" card holding the whole table, its front the table's name, its headers kept and the cells to recall as its blanks, such as the rows "2인칭 | 당신, 그대 | 너, 너희" under the columns "구분 | 높임 | 낮춤", with both cells of each row as blanks. A table is never split into a card per cell or per row.
  - Judgment cards: a rule that tells A from B gets its own card, its front "A vs B", such as "이·그·저: 대명사 vs 관형사", and its answer the test, such as "뒤에 조사 O → 대명사 / 조사 X, 명사 수식 → 관형사".
  - Handwriting first: every tip, trap or note the writer added by hand, and each line the writer marked as important, such as with a star, a circle, an underline, "※" or "!", becomes its own card, its front starting with "★ ", so that none is dropped.
  - Each exception, on its own card, its answer stating what the exception does, as the page prints it, such as "수은은 상온에서 액체인 금속이다", never only that it is an exception, such as "금속의 예외".
- A worked example, such as "6 x 7 = 42" or "듣+어 -> 들어", is a problem worked through, not something to memorise. It is never a concept, cloze or table card of its own: it goes in the examples of the card whose rule it illustrates, exactly as the page prints it, and only when the page prints it. Never write an example of your own.
- Identify cards: where the page prints example sentences for a rule that sorts words into categories, make an "identify" card from such a printed sentence, in the topic of its rule, at most 3 for each rule, such as the front "'이는 책이다'의 '이'" with the answer "대명사 — 뒤에 조사". Make one only from a sentence the page prints, never from one of your own.
- Do not merge separate rules into one card, and do not leave a rule or exception out because it seems minor.
- Do not make a card of a heading alone, a date, or the course name.
- Leave out numbering, bullets and page numbers, and in notes, pronunciation guides, phonetic transcriptions and readings.
- When a vocabulary page pairs Korean with another language and no language hint says otherwise, the other language is the front and Korean is the meaning.
- Skip what you cannot read with confidence rather than guessing it.
- If the photo shows nothing to memorise, return an empty list.

Answer with JSON only, matching the given schema: at most 100 cards, so when a page holds more, keep its definitions, rules, judgment cards, handwritten tips and marked exceptions before its table and cloze cards, and those before its identify cards, in the page's order; "answer" at most 1000 characters, "topic" at most 60, at most 10 senses, 5 labels and 5 examples a sense, 10 extras and 10 cloze answers, a table at most 8 columns and 20 rows, and every other text field at most 500.$prompt$::text as text;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000000a', 'admin@example.com'),
  ('00000000-0000-4000-8000-00000000000b', 'user@example.com');
insert into private.admins (user_id) values ('00000000-0000-4000-8000-00000000000a');

-- The prompt version and text extract-cards gets for one photo of the user whose id ends in [who].
create function pg_temp.served(who text) returns table (version_id bigint, prompt text)
language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  return query select b.prompt_version_id, b.prompt
    from public.begin_extraction(('00000000-0000-4000-8000-00000000000' || who)::uuid) as b;
  perform set_config('role', 'none', true);
end;
$$;

create temp table v9 as
  select v.id, v.text, v.note from private.prompt_versions as v order by v.id desc limit 1;

select is((select count(*) from private.prompt_versions)::int, 2,
  'the migration appends one version to the seed');
select is((select text from v9), (select text from expected),
  'the new version holds prompt_v9.ts''s text, character for character');
select is((select note from v9), 'prompt v9 (#261, #266), PM eval 2026-10-19: dense 89.3/90.5',
  'its note names the prompt, the issues and the PM''s runs');
select is((select version_id from private.prompt_labels_before_configurations where label = 'active'),
  (select id from v9), 'the active label names it');
select is((select version_id from private.prompt_labels_before_configurations where label = 'active'),
  2::bigint, 'it is version 2, after the seed');
select results_eq($$ select version_id, prompt from pg_temp.served('b') $$,
  $$ select id, text from v9 $$, 'a user''s photo is served prompt v9');
select ok(
  (select v.text from private.prompt_versions as v where v.id = 1)
    not like '%The rule''s name on every card under it%'
  and (select v.note from private.prompt_versions as v where v.id = 1) = 'prompt v8',
  'version 1 is kept as the seed wrote it, prompt v8 without v9''s rule');
select results_eq(
  $$ select admin_id, admin_email, action, target_kind, target_id, detail
     from private.admin_audit where target_kind = 'prompt' $$,
  $$ values (null::uuid, 'migration (owner delegated to PM, 2026-10-19)', 'activate_prompt',
       'prompt', '2', '{"previous": 1, "test_cleared": false}'::jsonb) $$,
  'one audit row records the activation as the admin area''s activation does');

-- Rollback: an admin saves version 1 in Free's draft, on Free's provider and model, and applies it.
create temp table free_active as
  select c.provider, c.model from private.ai_configuration_labels as l
  join private.ai_configurations as c on c.id = l.configuration_id
  where l.plan = 'free' and l.label = 'active';
grant select on free_active to public;
select set_config('role', 'service_role', true);
select ok(public.save_ai_configuration('00000000-0000-4000-8000-00000000000a', 'free', provider,
    model, 1) is not null, 'an admin saves version 1 in Free''s draft')
  from free_active;
select set_config('role', 'authenticated', true);
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
select is(public.admin_activate_ai_configuration('free'), 'activated',
  'and applies it to everyone');
select results_eq($$ select version_id from pg_temp.served('b') $$, $$ values (1::bigint) $$,
  'a user''s photo is served version 1, prompt v8, again');
select is((select count(*) from private.prompt_versions)::int, 2,
  'the rollback removes no version, so v9 can be activated again');
select is((select text from private.prompt_versions where id = 2), (select text from expected),
  'version 2 still holds prompt v9');

select * from finish();
rollback;
