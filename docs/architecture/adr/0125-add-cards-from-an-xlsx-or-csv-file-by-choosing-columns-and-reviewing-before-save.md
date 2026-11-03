# ADR 0125: Add cards from an xlsx or csv file by choosing columns and reviewing before save

> Status: accepted; on the phone, its SSF drawing, its requests of 100 cards, its "저장됨" and its stable ids superseded by ADR-0142; §Writes' free version 1 superseded by ADR 0137
> Date: 2026-10-29

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

Issue #494 asks for cards added from a spreadsheet: the owner chose spreadsheets as the first file to read ("엑셀 기능이 좋을듯"). The rows are the cards, so no AI call is made. The web builds it first, on ADR 0122's authoring and save path; the phone's issue, #495, follows this record, so the behaviour and limits below are stated for both platforms.

## Decision

- **Entry.** One more choice beside 직접 입력, 사진 찍기 and 앨범에서 고르기: "파일에서 고르기", second line "엑셀이나 CSV 파일의 행을 카드로 만들어요". 가져오기 is not used: `design/copy.md` keeps it for copying a public deck.
- **Files.** `.xlsx`, and `.csv` in UTF-8 with or without a byte order mark, comma-separated, quoted as RFC 4180 quotes. Any other extension is refused, and a CSV that is not valid UTF-8 is refused with "CSV를 읽지 못했어요. UTF-8 CSV로 저장해 다시 골라 주세요." The file is read on the device and never uploaded.
- **Limits.** The start sheet's body, its only two sentences, states them before a file is chosen: "엑셀(.xlsx)이나 CSV 파일의 한 행이 카드 한 장이 돼요. 파일은 5MB, 1,000행까지 읽어요." The UTF-8 requirement is said only in the refusal of a CSV that does not decode as UTF-8. The limits:
  - a file over 5 MB (5,242,880 bytes) is refused by its size before a byte of it is read;
  - a sheet with more than 1,000 rows holding text is refused before any row becomes a card; rows with no text in any cell are not counted;
  - a workbook part that unpacks past 50 MB is refused as unreadable.
- **Sheets.** The visible sheets are offered, the first chosen by default; a hidden sheet is not offered. A workbook with one visible sheet shows no sheet choice.
- **Columns.** Front and back are required and offered as the sheet's columns, by letter and the first row's text, preset to A and B. Label and example are optional, "없음" by default. The chosen columns must differ. Columns not chosen are ignored.
- **Header.** A switch, "첫 행은 머리글". When on, the first row makes no card. It starts on only when the sheet has a second row and the first row is recognisably a header:
  - one of its cells, trimmed, NFKC-normalized and case-folded, is a common column name: 단어, 뜻, 의미, 앞면, 뒷면, 라벨, 예문, 품사, front, back, word, term, meaning, definition, example or label; or
  - one of its cells is text, and the non-empty cells below it in its column are all numbers, dates or other values that are not text. In a CSV a cell is text unless it reads as a number.

  Otherwise it starts off, so a headerless word list loses no word to the default.
- **Cells.** A cell is its text as the sheet shows it: a string as written; a number or a date through its cell's number format, drawn by SSF 0.11.2, with the built-in date formats 14 and 22 as Korean Excel draws them, `yyyy-mm-dd` and `yyyy-mm-dd h:mm`, and the East Asian built-in ids 27 to 31, 34 to 36 and 50 to 58 as `yyyy-mm-dd`; a formula as its cached value, empty when the file holds none; a boolean as TRUE or FALSE. Cells are trimmed; their line breaks are kept, CRLF and Excel's escaped carriage return read as one line break.
- **Cards.** The front is a text block. With no label or example column, the back is a text block. With either, every back is one meaning, as direct entry writes it: the back cell its meaning, the label cell's words its labels, short part-of-speech forms read as the phone reads them, and the example cell's lines its examples.
- **Skipped and refused rows.** A row whose front or back cell is empty makes no card, and the count is shown: "앞면이나 뒷면이 빈 행 n개는 건너뛰어요". A row with a used cell over 500 characters, counted in code points, the extraction function's field limit, makes no card and is named: "3행, 9행은 500자가 넘는 칸이 있어 뺐어요", the first five rows and then how many more.
- **Review.** Every card is listed before anything is saved, with its sheet row, each selected by default with the round check photo import draws; "모두 빼기" and "모두 선택" toggle all. Only the explicit "n장 추가" saves the selected cards (ADR 0122), into the deck it was opened from, or a chosen or newly named deck. Closing with unsaved cards asks "읽은 카드를 버릴까요?".
- **Duplicates.** As direct entry: nothing is overwritten. A card whose normalized front repeats a stored card, or an earlier card of the same save, stops the save with the row named, "n행은 이 덱에 이미 있는 카드예요" or "n행의 앞면이 m행과 같아요", and offers "n행 빼기" and "그래도 추가". Requests of at most 100 cards each save in order; cards already saved stay saved, are marked "저장됨" and cannot be left out, and the mapping is locked.
- **Writes.** Saved cards are ordinary `free` version 1 cards (ADR 0114), `source` `import`, owner-scoped, their revisions assigned by the server, so the phone syncs them. Each card's id is stable for its row and mapping, so a retried request inserts nothing twice.
- **Parsing on the web.** `fflate` 0.8.3 (MIT) unpacks the workbook and `ssf` 0.11.2 (Apache-2.0, with `frac` 1.1.2, Apache-2.0) draws number formats; the browser's `DOMParser` reads the XML. The npm `xlsx` package is not used: its npm releases carry GHSA-4r6h-8v6p-xvw6 and GHSA-5pgg-2g8v-p4x9 with no patched version on npm.

## Consequences

- No schema migration and no extraction allowance: a file costs no photo.
- A Korean Excel "CSV" saved in the system encoding (EUC-KR) is refused, with a sentence on saving it as UTF-8, rather than read as broken text.
- A formula the writer saved without a cached value reads as empty; such a row is skipped or counted.
- `.xls`, `.ods`, `.numbers` and tab-separated files are not read.
- A sheet's custom number formats follow SSF's reading, which can differ from Excel's on locale-specific codes.

## Signs the decision was wrong

- Users regularly hit the 1,000-row or 5 MB limit with ordinary word lists.
- Users regularly switch the header on for sheets whose header the column names and value columns do not recognise.
- Many files arrive in EUC-KR, so the refusal is met more than the reading.
