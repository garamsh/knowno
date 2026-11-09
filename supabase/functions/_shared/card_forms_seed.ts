/**
 * Each form's first skill version, which 20261105150000_card_form_skills.sql seeds as active
 * (ADR 0197). What is served is the database's: an admin edits it there. card_forms_seed_test.ts
 * holds the migration to these texts, the photo limits among them as the tools enforce them.
 */

import type { Form } from "./card_forms.ts";
import { MAX_PHOTO_BYTES } from "./photo.ts";
import { MAX_PHOTOS } from "./tools.ts";

export const SEED: Readonly<
  Record<Form, { readonly summary: string; readonly text: string }>
> = {
  text: {
    summary:
      "A question and its answer, or a name and what it means: one fact a card.",
    text: `# text: a question and its answer

Use it for a fact recalled from a prompt: a question and its answer, a concept and its definition, a rule and what it says.

Rules
- {"blocks":[{"type":"text","front":"…","back":"…"}]}: front is shown first and back at the reveal, each at most 2000 characters. The plain {"front":"…","back":"…"} is the same card.
- One fact a card. The front names what is asked, short enough to read at once, so the card is understood alone: "광합성", "Capital of France?". The back answers it and nothing more.

Good
{"blocks":[{"type":"text","front":"광합성","back":"빛 에너지로 이산화탄소와 물에서 포도당을 만드는 과정"}]}

Bad
{"blocks":[{"type":"text","front":"광합성에 대해 설명하시오","back":"빛 에너지로 포도당을 만드는 과정. 엽록체에서 일어나며 명반응과 암반응으로 나뉜다."}]} — three facts on one back cannot be graded at once; make a card of each.

Edge cases
- A word and its meanings is senses, not text.
- A sentence to recall word for word is cloze, and so is a line listing a group's members.
- An answer that would list more than five items is split into several cards, or made a table or a cloze.
`,
  },
  senses: {
    summary:
      "A word or expression and its meanings, as a word list or glossary holds them: one card a word.",
    text: `# senses: a word and its meanings

Use it for vocabulary: a word, an idiom or a term learned with its meanings, as a word list, a glossary or a dictionary page holds them.

Rules
- {"blocks":[{"type":"senses","term":"…","ask":"term","senses":[{"labels":[…],"meaning":"…","examples":[…]}]}]}: each sense a meaning with at most 10 labels and 10 examples, at most 20 senses a word.
- ask names what is shown first: term to recall the meaning, or meaning to recall the word. Give a whole group one ask unless the user asks otherwise.
- A meaning is the translation or the definition as the material gives it. A label is a part of speech or a tag the material prints, such as 명 or 동; add none it does not print.
- Examples are sentences the material prints for that meaning; never make one up.
- A word with several meanings is one card with several senses, never a card a meaning.

Good
{"blocks":[{"type":"senses","term":"run","ask":"term","senses":[{"labels":["동"],"meaning":"달리다","examples":["She runs every morning."]},{"labels":["명"],"meaning":"달리기","examples":[]}]}]}

Bad
{"blocks":[{"type":"text","front":"run (동)","back":"달리다; 명: 달리기"}]} — a word list made text cards loses its senses and labels, and two meanings share one back.

Edge cases
- An idiom or a set phrase is a term too: "give up" with the meaning "포기하다".
- A word the material gives no meaning for is not a card: ask the user, or leave it out.
- The same word twice in the material with different meanings is one card holding both senses.
- The term is the word being learned, in the material's direction, whichever language it is.
`,
  },
  cloze: {
    summary:
      "A sentence or a line to recall in context, its key words blanked: one ___ for each answer.",
    text: `# cloze: a sentence with blanks

Use it when the words matter in their place: a definition to recall word for word, a line listing a group's members, a formula, a sentence of a text.

Rules
- {"blocks":[{"type":"cloze","text":"…","answers":["…"]}]}: text holds one ___ for each answer, in order, and each answer holds text.
- Blank the words worth recalling, at most five a card, and keep enough of the sentence that each blank has one answer.
- A line naming a group and its members keeps the group's name and blanks the members.

Good
{"blocks":[{"type":"cloze","text":"3인칭 재귀칭: ___, ___, ___, ___","answers":["자기","자신","저","저희"]}]}

Bad
{"blocks":[{"type":"cloze","text":"___ is the ___ of ___.","answers":["Paris","capital","France"]}]} — with almost every word blanked, nothing is left to recall them from.

Edge cases
- A line of more than five members becomes several cloze cards, each keeping the group's name.
- A blank whose answer has several right forms takes the material's.
- A blank that asks what another card already answers is left out: one fact, one card.
`,
  },
  table: {
    summary:
      "A comparison or classification laid out in rows and columns: the whole table on one card, the cells to recall as blanks.",
    text: `# table: a table with cells to recall

Use it for material laid out in rows and columns: a classification, a comparison, a conjugation, a timeline.

Rules
- {"blocks":[{"type":"table","columns":[…],"rows":[[…],…],"blanks":[{"row":0,"column":1}]}]}: columns are the headers, left to right; each row has as many cells as there are columns; blanks are the cells to recall, counted from 0 among the rows, the headers not counted.
- Each blank is a distinct cell holding text. To recall part of a cell, use spans: {"row":0,"column":1,"start":0,"end":5}, its run in UTF-16 code units, overlapping no other span and in no blank cell.
- The whole table is one card, never a card a row or a cell. A text block before it names it when the headers alone do not.
- Keep the material's headers; a row's first cell is usually its header and not a blank.

Good
{"blocks":[{"type":"text","front":"인칭 대명사"},{"type":"table","columns":["구분","높임","낮춤"],"rows":[["1인칭","저","나"],["2인칭","당신","너"]],"blanks":[{"row":0,"column":1},{"row":0,"column":2},{"row":1,"column":1},{"row":1,"column":2}]}]}

Bad
Two text cards, "1인칭 높임?" with "저" and "1인칭 낮춤?" with "나" — the grid is lost, and each cell is recalled apart from the row and column that place it.

Edge cases
- A table of more than 8 columns or 20 rows is split by its rows into several tables, each keeping the headers.
- An empty cell is "" and is never a blank.
- A table with nothing to recall is not a card.
`,
  },
  image: {
    summary:
      "A diagram, map or picture whose parts are learned: its labels hidden under boxes, or a text back saying what it shows.",
    text: `# image: a picture

Use it when the picture is what is learned: a labelled diagram, a map, a structure, a painting to name.

Rules
- {"type":"image","url":"https://…"}: url is a public https address of a JPEG, PNG or WebP file of at most ${
      MAX_PHOTO_BYTES / 1024 / 1024
    } MiB, stored as it is; at most ${MAX_PHOTOS} photos are fetched a call.
- With boxes, the picture is the whole card: {"type":"image","url":"…","boxes":[{"x":0.1,"y":0.2,"w":0.3,"h":0.1,"answer":"aorta"}]}. A box hides a label; x, y, w and h are fractions from 0 to 1 of the picture.
- Without boxes, give side, front or back, and a text block for the other side: the picture on the front and what it shows on the back, or a question on the front and the picture as its answer.
- side is given exactly when there are no boxes.

Good
{"blocks":[{"type":"image","url":"https://example.com/heart.png","boxes":[{"x":0.42,"y":0.18,"w":0.16,"h":0.06,"answer":"aorta"},{"x":0.2,"y":0.55,"w":0.18,"h":0.06,"answer":"right ventricle"}]}]}

Bad
{"blocks":[{"type":"image","url":"https://example.com/heart.png","side":"front"}]} — a picture alone adds nothing at the reveal; give it boxes or a text back.

Edge cases
- A picture with no public https address cannot be a card: ask the user for one, or put what it teaches in another form.
- A photo of a page is material to read, not a picture to learn: make its words the forms they are.
- A box needs the label's place in the picture; when you cannot see it, use a text back.
`,
  },
  mixed: {
    summary:
      "Two or more of senses, cloze, table and image on one card, only when one fact needs them together.",
    text: `# mixed: forms combined on one card

A card's form is the one block type it holds besides text; text may accompany any form, as a name before a table or a back for a picture. A card holding two or more of senses, cloze, table and image is mixed.

Use it rarely: when one fact needs two forms at once, such as a picture whose label is recalled with a sentence about it.

Rules
- The blocks are shown in their order. The card needs something shown first and something added at the reveal; a cloze, a table or a picture with boxes counts for both.
- Every card of a mixed group is mixed; cards of one form go in a group of that form.

Good
{"blocks":[{"type":"image","url":"https://example.com/cell.png","boxes":[{"x":0.3,"y":0.4,"w":0.2,"h":0.1,"answer":"nucleus"}]},{"type":"cloze","text":"The ___ holds the cell's DNA.","answers":["nucleus"]}]}

Bad
A mixed group of a senses card for each word and a cloze card for each sentence — those are two groups, senses and cloze.

Edge cases
- A text block beside a senses, cloze, table or image block is that block's form, not mixed.
- Two cards of one form each are better than one mixed card when the facts can be recalled apart.
`,
  },
};

/**
 * The versions of `text` and `cloze` that teach the card text markup (ADR 0216): migration
 * `20261109150000_card_markup_switch.sql` seeds them with the label `markup`, which
 * `card_form_skills` serves only while the switch is on. `card_forms_seed_test.ts` compares the
 * migration with these.
 */
export const SEED_MARKUP: Readonly<
  Record<"text" | "cloze", { readonly summary: string; readonly text: string }>
> = {
  text: {
    summary:
      "A question and its answer, or a name and what it means: one fact a card.",
    text: `# text: a question and its answer

Use it for a fact recalled from a prompt: a question and its answer, a concept and its definition, a rule and what it says.

Rules
- {"blocks":[{"type":"text","front":"…","back":"…"}]}: front is shown first and back at the reveal, each at most 2000 characters. The plain {"front":"…","back":"…"} is the same card.
- One fact a card. The front names what is asked, short enough to read at once, so the card is understood alone: "광합성", "Capital of France?". The back answers it and nothing more.
- Front and back are markup: **bold**, *italic* or _italic_, \`code\`, a list of lines starting "- " or "1. " (a sub-item indented by two spaces, one level), and each line break as typed. Headings, links, images and tables are not markup and stay as typed.
- Use a mark only where it teaches: bold on the one word that decides the answer, code for a formula or a command, a list for steps in order. Never to decorate.
- A backslash before \\ * _ \` { } or : makes that character literal: write \\* for a * that is not a mark, and \\- at the start of a line that is not a list. list_cards shows a stored text with the backslashes it needs, and a text sent back as shown keeps its meaning.

Good
{"blocks":[{"type":"text","front":"광합성","back":"빛 에너지로 **이산화탄소**와 물에서 포도당을 만드는 과정"}]}
{"blocks":[{"type":"text","front":"Steps of mitosis","back":"1. prophase\\n2. metaphase\\n3. anaphase\\n4. telophase"}]}

Bad
{"blocks":[{"type":"text","front":"광합성에 대해 설명하시오","back":"빛 에너지로 포도당을 만드는 과정. 엽록체에서 일어나며 명반응과 암반응으로 나뉜다."}]} — three facts on one back cannot be graded at once; make a card for each.
{"blocks":[{"type":"text","front":"**광합성**","back":"**빛** **에너지**로 **포도당**을 **만든다**"}]} — with everything bold nothing stands out.

Edge cases
- A word and its meanings is senses, not text.
- A sentence to recall word for word is cloze, and so is a line listing a group's members.
- An answer that would list more than five items is split into several cards, or made a table or a cloze.
- A * or _ that is plain text, as in 2*3*4 or snake_case, is written \\* or \\_ when it could be read as a mark.
`,
  },
  cloze: {
    summary:
      "A sentence or a line to recall in context, its key words hidden: {{c1::answer}} for each.",
    text: `# cloze: a sentence with blanks

Use it when the words matter in their place: a definition to recall word for word, a line listing a group's members, a formula, a sentence of a text.

Rules
- {"blocks":[{"type":"cloze","text":"…"}]}: text is the sentence with each hidden part written {{c1::answer}}, or {{c1::answer::hint}} to show a hint in the blank. The number after c starts at 1.
- Hidden parts with the same number are hidden together and graded as one blank; each number is its own blank. Give each part of a card its own number unless they are one fact, as a word and its repeat.
- An answer is not blank and holds no other {{c…::…}}. A text with no {{c1::…}} is refused.
- The text is markup as in the text guide: **bold**, *italic*, lists, line breaks, and a backslash before \\ * _ \` { } or : for a literal one. A mark may sit inside an answer.
- Blank the words worth recalling, at most five numbers a card, and keep enough of the sentence that each blank has one answer.
- A line naming a group and its members keeps the group's name and blanks the members.
- The older form, text with one ___ for each of "answers", is still accepted; give the {{c1::…}} form.

Good
{"blocks":[{"type":"cloze","text":"3인칭 재귀칭: {{c1::자기}}, {{c2::자신}}, {{c3::저}}, {{c4::저희}}"}]}
{"blocks":[{"type":"cloze","text":"광합성은 {{c1::엽록체::세포 소기관}}에서 일어난다."}]}

Bad
{"blocks":[{"type":"cloze","text":"{{c1::Paris}} is the {{c2::capital}} of {{c3::France}}."}]} — with almost every word hidden, nothing is left to recall them from.
{"blocks":[{"type":"cloze","text":"The capital is {{c1::}}."}]} — an answer cannot be empty.

Edge cases
- A line of more than five members becomes several cloze cards, each keeping the group's name.
- A blank whose answer has several right forms takes the material's.
- A blank that asks what another card already answers is left out: one fact, one card.
- A { or : of plain text, as in a formula, is written after a backslash so that it is not read as part of a {{c1::…}}.
`,
  },
};
