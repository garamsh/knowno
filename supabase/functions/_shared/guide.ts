/** The MCP resource that tells a model which form of card fits what it is making. */

import { MAX_PHOTO_BYTES } from "./photo.ts";

export const GUIDE_URI = "knowno://guide/card-forms";

/** The guide as `resources/list` names it. */
export const GUIDE_RESOURCE = {
  uri: GUIDE_URI,
  name: "card-forms",
  title: "Choosing a card's form",
  description:
    "Which blocks fit what you are making, with an example of each. Read it before add_cards when the material is more than word and meaning pairs.",
  mimeType: "text/markdown",
};

export const GUIDE_TEXT = `# Choosing a card's form

A card is {"blocks": [...]}, one or more blocks in order. It needs something shown first and something added at the reveal; a cloze, a table or a photo with boxes counts for both.

- **A word and its meanings: senses.** {"type":"senses","term":"apple","ask":"term","senses":[{"labels":["명"],"meaning":"사과","examples":["An apple a day."]}]}. ask names what is shown first: term, or meaning to recall the word.
- **A question and its answer: text.** {"type":"text","front":"Capital of France?","back":"Paris"}.
- **A sentence to recall in context: cloze.** {"type":"cloze","text":"The capital of France is ___.","answers":["Paris"]}. One ___ for each answer, in order.
- **A comparison or classification: table.** {"type":"table","columns":["Organ","Job"],"rows":[["Heart","Pumps blood"],["Lung","Exchanges gas"]],"blanks":[{"row":0,"column":1},{"row":1,"column":1}]}. blanks are the cells to recall, counted from 0 among the rows, the headers not counted. To recall part of a cell, use spans: {"row":0,"column":1,"start":0,"end":5}, its run in UTF-16 code units.
- **A diagram or picture: image.** {"type":"image","url":"https://example.com/heart.png","side":"front"}, with a text back to say what it shows, or with boxes to hide its labels: {"type":"image","url":"https://example.com/heart.png","boxes":[{"x":0.1,"y":0.2,"w":0.3,"h":0.1,"answer":"aorta"}]}. A box's x, y, w and h are fractions from 0 to 1 of the image. side is given exactly when there are no boxes.

Blocks combine: a text front naming a table, or a photo with a text back. The url must be a public https address of a JPEG, PNG or WebP file of at most ${MAX_PHOTO_BYTES} bytes, and the file is stored as it is.
`;
