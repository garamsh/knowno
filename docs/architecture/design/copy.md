# Design copy

The voice every string on the phone and the web is written in, the one term per concept, and the one form per role.

## Current decisions

### Voice

Every string is written as one writer would write it ([ADR 0024](../adr/0024-one-voice-and-a-sheet-action-rule.md)).

- Korean, in `app/lib/l10n/app_ko.arb`, is 해요체 throughout: plain, short, and consistent in its sentence endings ("아직 노트가 없어요.", "카드 3장을 만들었어요"). No sentence ends in 합쇼체 ("…ㅂ니다", "…ㅂ니까"); `app/test/l10n/voice_test.dart` fails on one.
- A label or a button names its action ("로그아웃", "그래도 추가").
- English, in `app_en.arb`, matches it in tone: plain, second person, no exclamation marks.

### Terms

One term per concept, in every string on the phone and the web (#446) ([ADR 0118](../adr/0118-name-each-concept-once-write-each-role-in-one-form-hold-every-screen-to-one-set-of-visual-details-and-redraw-settings-and-the-deck-screen-by-them.md), issue #454).

| Concept | Term | Not |
|---|---|---|
| A deck | 노트 | 덱 |
| The entry that makes a deck | 새 노트 만들기 | 노트 만들기 |
| Writing by hand, a deck's name or a card | 직접 입력 | 직접 만들기 |
| The new card editor's title | 새 카드 | 카드 추가, as a title |
| Editing | 편집 | 고치기 |
| Removing something stored | 삭제, the card editor's "소리 삭제" and "사진 삭제" among them | 지우기 |
| Leaving something out of a selection | 빼기, in the import lists alone | |
| Discarding an unsaved draft | 버리기 | |
| Studying | 학습 | 공부 |
| A card's two sides | 앞면 and 뒷면; in English Front and Back | 단어 and 뜻, 앞 and 뒤, 문제 and 답, for a side |
| What a card is made of | 칸: "+ 칸 추가", "칸 추가"; a 사진's "빈칸 추가" stays, told apart by 빈 | 블록 |
| A card's grade, 안다 or 모른다 | 응답, answering it 응답하다; in English Response | |
| The mark before a meaning | 라벨 (#447) | 품사, 품사 표시 |
| The sound block | 소리 | 음성 |
| The settings screen | 설정, its first section 계정 | 계정, as its title |
| Public decks, and copying one | 공개 노트, 가져오기 | 둘러보기 or 복사, in a sentence |
| Counting cards and photos | 장 | 개 |

- The sides' and the grade's terms hold in every string, label and screen-reader text on the phone and the web, and in the docs: "앞면: … 뒷면: … 응답: 안다" ([ADR 0079](../adr/0079-name-a-card-s-sides-front-and-back-and-its-grade-the-response-on-the-phone-the-web-and-in-the-docs.md), #243). A photo import section names its form by what goes on the front: "앞면에 단어", "앞면에 뜻", "양쪽 방향 모두", "앞면에 질문", "앞면에 답".
- In code, `Answer` stays the grade, and a side is `front` or `back`, the type scale's `front` and `back` among them.
- A deck is a 노트 in every string a user reads, in English a note; 카드 stays. Code, tables, routes (`/decks`), API and MCP tool names, ARB keys and stored keys keep `deck` ([ADR 0148](../adr/0148-call-a-deck-a-note-in-every-string-a-user-reads-on-both-clients.md), #577). `app/test/l10n/note_naming_test.dart` and `web/src/__tests__/note-naming.test.ts` fail on a 덱 left in a string a user reads.

### Forms

One sentence form per role.

| Role | Form | For example |
|---|---|---|
| A sheet's final button | an action noun with no 하기; a native verb keeps -기 | 저장 · 삭제 · 공개 · 신고 · 만들기 |
| An entry button or a menu item | object and action | 새 노트 만들기 · 카드 추가 · 이름 바꾸기 · 노트 공개 · 노트 신고 |
| A sheet's title, choosing or making | a noun phrase | 새 노트 · 테마 · 추가할 노트 · 신고 이유 |
| A sheet's title, confirming | a question in -할까요? | 동기화하지 않고 로그아웃할까요? |
| A row's second line | one 해요체 sentence of the result, no period; none where the title says enough, but in "칸 추가", where every row has one ([ADR 0171](../adr/0171-give-every-type-in-the-add-sheet-an-icon-and-a-line-and-keep-a-field-s-selection-through-a-scrolling-drag.md)) | 단어장을 찍으면 카드를 찾아 드려요 |
| An empty state | one sentence of what is true, no period; the screen's one action is its button | 아직 카드가 없어요 |
| A field's error | …해 주세요, no period | 이름을 입력해 주세요 |
| A screen's error | what failed, then what to do | 사진을 불러오지 못했어요. 다시 시도해 주세요. |
| An undo bar's message | what went, in -했어요, no period; its action "되돌리기" ([ADR 0174](../adr/0174-undo-every-delete-in-the-card-editor-focus-what-an-add-makes-and-show-what-a-refused-save-refuses.md)) | 칸을 삭제했어요 |
| A section label | a noun | 계정 · 학습 · 화면 · 카드 |

The study buttons are "시작" on 홈, "학습하기" once the day is done, "이어서 하기" on the completion sheet, and "이 노트 학습 · n장" on the deck screen ([ADR 0150](../adr/0150-open-on-a-home-of-today-on-the-hero-with-the-notes-in-a-drawer-keep-the-menu-on-a-note-and-make-a-note-on-a-full-screen.md), [ADR 0120](../adr/0120-state-today-s-progress-once-put-every-study-button-in-its-card-name-the-record-plainly-and-draw-photo-import-s-bar-checks-and-moves-as-the-other-screens-do.md)).

## Rationale

- [ADR 0024](../adr/0024-one-voice-and-a-sheet-action-rule.md) records why the strings are 해요체; issue #64 records the voice as the PM decided it.
- [ADR 0118](../adr/0118-name-each-concept-once-write-each-role-in-one-form-hold-every-screen-to-one-set-of-visual-details-and-redraw-settings-and-the-deck-screen-by-them.md) records why every string takes one term per concept and one form per role; issue #454 records the owner's approval, and #452's decisions 학습 and 설정.
- [ADR 0079](../adr/0079-name-a-card-s-sides-front-and-back-and-its-grade-the-response-on-the-phone-the-web-and-in-the-docs.md) records why a card's sides are 앞면 and 뒷면 and its grade 응답, and what keeps its wording.
- [ADR 0148](../adr/0148-call-a-deck-a-note-in-every-string-a-user-reads-on-both-clients.md) records why a deck is a 노트 in every string a user reads.
- [ADR 0174](../adr/0174-undo-every-delete-in-the-card-editor-focus-what-an-add-makes-and-show-what-a-refused-save-refuses.md) records why these terms now bind the card editor, its "소리 빼기" become "소리 삭제".

## Open questions

None.
