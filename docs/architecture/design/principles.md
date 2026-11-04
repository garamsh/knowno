# Design principles

The rules every screen and sheet on the phone and the web follows, each citable by its heading, and where each is applied today.

## Current decisions

A new screen, or a change to one, follows every rule below and lays itself out with a frame from [`frames.md`](frames.md). Values are [`theme.md`](theme.md)'s, components [`components.md`](components.md)'s, strings [`copy.md`](copy.md)'s, marks and icons [`brand.md`](brand.md)'s. A screen redesigned from now on follows every rule; one not yet redesigned is brought to them when it is ([ADR 0118](../adr/0118-name-each-concept-once-write-each-role-in-one-form-hold-every-screen-to-one-set-of-visual-details-and-redraw-settings-and-the-deck-screen-by-them.md), issue #454).

### One primary action per screen

- A screen or a sheet has one primary, `AppButtonVariant.primary` (`onHero` on the hero), its most prominent element, in thumb reach at the foot (`BottomActions`, a sheet's pinned actions) or inside the card it acts on.
- Every other action takes another `AppButtonVariant`, whose doc comments say when each is used, or is an item in ⋯.
- A destructive action is red text at the end of a screen or in ⋯; a red fill, `destructiveFinal`, is only a confirmation's last button.

Applied today:

- Study: the current card, low on the screen, answered by a swipe, with "안내 다시 보기" alone under it and no answer button ([ADR 0099](../adr/0099-answer-study-cards-by-swipe-alone-and-grade-the-previous-card-by-its-colour-alone-on-the-phone.md)); closing is a small icon at the top. On the completion panel, on the hero ([ADR 0151](../adr/0151-draw-the-previous-study-card-as-one-centred-scrolling-column-on-a-grade-line-put-the-mascot-between-the-cards-finish-on-a-hero-panel-and-redraw-the-record.md)), "학습하기" is the one fill, `heroButton`, while new cards are left past today's, with "그만하기" as onHeroText below it; with none left, "그만하기" is that fill at the cta height under "더 학습할 카드가 없어요" ([ADR 0093](../adr/0093-make-stopping-the-finished-completion-card-s-primary-and-show-the-resume-notice-in-the-progress-bar-s-place-on-the-phone.md)). The whole-card sheet is titled "카드", its "앞면" and "뒷면" two section labels of one rank (#318).
- Card editor: "저장하고 다음 카드" is the primary in `BottomActions`, "저장" secondary beside it; editing an existing card offers "저장" alone and ends its form with "카드 삭제" in red text. "미리보기" is a text action in the top bar ([ADR 0117](../adr/0117-draw-the-card-editor-as-one-group-per-side-with-a-full-screen-preview-and-every-action-in-words-or-a-row-menu.md)).
- Card editor: one block list, with no kind to choose ([ADR 0114](../adr/0114-write-every-card-as-a-free-block-list-remove-the-flip-cloze-and-table-forms-and-migrate-every-card-to-free.md)). Each 칸 is one group headed by its type's name in `muted`, with no icon and a ⋯ at the heading's end, its fields borderless until focused, and the column ends with "+ 칸 추가" in `ink2` ([ADR 0137](../adr/0137-frame-a-card-by-its-blocks-each-block-type-deciding-whether-it-has-a-front-and-a-back.md), [ADR 0117](../adr/0117-draw-the-card-editor-as-one-group-per-side-with-a-full-screen-preview-and-every-action-in-words-or-a-row-menu.md)). Its sheet, "칸 추가", lists the types in one group, each row the type's icon, plain in `ink2` with no tinted square, its name and one line, 글 included ([ADR 0171](../adr/0171-give-every-type-in-the-add-sheet-an-icon-and-a-line-and-keep-a-field-s-selection-through-a-scrolling-drag.md), [`brand.md`](brand.md) §Icons). A 글's rows are named "앞면" and "뒷면" inline in `muted`; a 사진's, a 소리's and a 단어's choice of side is two `AppChip.action` chips; "+ 뜻 추가" is `ink2` text at the end of its block.
- Card editor: a 표 has no mode; its toolbar of chips over the table acts on the selected cell, never a second segmented bar ([ADR 0102](../adr/0102-edit-a-table-in-its-cells-with-a-toolbar-over-it-and-no-mode-switch.md)). A cloze's one action follows the caret, "빈칸 넣기" or, inside a blank, "빈칸 풀기", a small outlined chip under its line and never a primary fill, with no second row repeating the blanks ([ADR 0117](../adr/0117-draw-the-card-editor-as-one-group-per-side-with-a-full-screen-preview-and-every-action-in-words-or-a-row-menu.md)). A cloze blank in its line and a chosen table cell are `brandTint`, as every blank is (issue #313, [ADR 0101](../adr/0101-edit-a-cloze-as-one-face-with-its-blanks-as-blocks-in-the-line-and-a-single-insert-blank-action.md)); a blank "빈칸 넣기" just opened is drawn as a hidden blank is, a gap over a `muted` underline ending at the caret (issue #483). While a sense's label field has focus, the user's labels sit in a strip above the keyboard, the field tinted `brandTint`.
- 홈: "시작" on the hero, or "학습하기" once the day is done, "카드 추가" or "노트에서 카드 추가" while no deck holds a card, is the hero's one action ([ADR 0150](../adr/0150-open-on-a-home-of-today-on-the-hero-with-the-notes-in-a-drawer-keep-the-menu-on-a-note-and-make-a-note-on-a-full-screen.md), [ADR 0120](../adr/0120-state-today-s-progress-once-put-every-study-button-in-its-card-name-the-record-plainly-and-draw-photo-import-s-bar-checks-and-moves-as-the-other-screens-do.md)). 설정 opens from 홈's profile button at the top right, never a tab ([ADR 0165](../adr/0165-open-on-today-over-the-last-seven-days-move-the-notes-to-a-tab-and-open-settings-from-the-profile-button.md)).
- 노트 tab and deck screen: [`frames.md`](frames.md) §Screen skeleton, its header action "+ 새 노트" and "+ 카드 추가", its ⋯ holding the rest ("공개 노트 둘러보기" on the 노트 tab, with sharing); the deck screen draws the deck's name on its own line under the bar, at most two lines, offers "+ 카드 추가" in every state and, while the deck holds a card, "이 노트 학습 · n장" at the top as its one primary, with no foot bar; rename, 꾸미기, 공개 and delete sit in its "노트 설정" ([ADR 0066](../adr/0066-open-a-deck-made-by-hand-and-lead-an-empty-deck-and-a-cardless-today-tab-to-adding-cards.md), [ADR 0172](../adr/0172-make-a-note-with-the-choices-of-its-customization-head-the-notes-and-a-note-with-a-tonal-action-and-a-menu-over-an-always-shown-search.md)).
- First-run home: "새 노트 만들기" the primary and "공개 노트 둘러보기" quiet. 새 노트: "저장" beside the primary "저장하고 카드 추가" in `BottomActions`. The "새 노트" and "이름 바꾸기" sheets: one field and one primary, "만들기" or "저장".
- Daily study minutes: the first-run sheet's one primary is "저장", with its quiet "건너뛰기" above it, and the settings screen's "저장" is pinned at its foot ([ADR 0091](../adr/0091-draw-the-today-card-as-a-progress-bar-and-change-the-daily-study-minutes-only-in-settings.md)); the minutes are one number in `figure` between a − and a +, typed in place on the number keypad, with no choice to pick from ([ADR 0090](../adr/0090-pick-the-daily-study-minutes-as-one-large-number-between-minus-and-plus-typed-in-place-with-two-tiles-of-what-they-mean.md), [ADR 0086](../adr/0086-show-and-change-the-daily-study-minutes-on-the-today-card-the-completion-card-a-one-time-first-run-step-the-account-screen-and-the-web-s-today-page.md)).
- Sign-in: the stacked logo and its two lines on the ground's panel in the upper part; Google's button, with the quieter Apple slot and the terms below it, at the foot.

### Content over chrome

- No label, hint or heading restates what the screen already shows. Remove before adding.
- The same text never appears twice on one screen.

Applied today:

- Study: no deck name and no hint text, but the empty previous card's place's one line, "응답한 카드가 여기에 쌓여요", the 3 s notice that a resumed day goes on, and the first-use coach, which teaches on the cards themselves and is replayed only on request ([ADR 0064](../adr/0064-teach-study-with-a-first-use-finger-coach-and-show-the-day-s-last-card-and-a-brief-notice-when-a-day-resumes.md)); the completion card carries no sentence beyond its heading and one line of counts, and "더 학습할 카드가 없어요" in place of "학습하기" where no new card is left; studying past today's cards is not marked apart ([ADR 0049](../adr/0049-study-in-one-flow-that-goes-on-past-today-s-cards-as-recorded-study-with-the-current-card-showing-its-front-alone.md)).
- Deck screen: each row shows the whole card, with no switch to show or hide its back, and marks what study hides with the hatch alone, with no label or icon ([ADR 0175](../adr/0175-show-every-card-whole-in-a-note-s-card-list-and-mark-what-study-hides-with-one-hatch.md)); the deck name is the only title, the `muted` line under it the screen's one count of its cards, and the row above the cards the section label "카드" ([ADR 0118](../adr/0118-name-each-concept-once-write-each-role-in-one-form-hold-every-screen-to-one-set-of-visual-details-and-redraw-settings-and-the-deck-screen-by-them.md)).
- Tabs: no line explains a long-press or a tab; 기록 has no explanatory paragraph, only each chart's heading, its figures and a line beside the heading.
- Every sheet: [`frames.md`](frames.md) §Sheet and dialog: a title and at most one or two sentences of body; a field shows its label once (§Form field).
- Daily study minutes: the settings row says only "하루 학습 시간" and the minutes, the picker one sentence, its two tiles saying what the choice means rather than how it is computed.

### Direct manipulation where it is natural

- Swipe to answer, tap to toggle. Every gesture has an accessible alternative: a semantics action or a visible control.
- A reorder or a delete inside a form is a ⋯ menu of "위로", "아래로" and a red "삭제", named for a screen reader by its place, not a drag ([ADR 0108](../adr/0108-add-a-free-template-and-an-add-control-that-puts-any-block-on-either-side-of-every-template.md)).
- A sheet is dismissed by a drag, by a tap on the scrim and by Android's back.

Applied today:

- Study: on the phone a horizontal swipe answers, with the custom actions "안다" and "모른다" for a screen reader and no answer button ([ADR 0099](../adr/0099-answer-study-cards-by-swipe-alone-and-grade-the-previous-card-by-its-colour-alone-on-the-phone.md)); a horizontal drag on the previous card changes its answer, with the custom action "안다로 바꾸기" or "모른다로 바꾸기", and a tap on it opens the whole card; a drag on either card moves that card alone. The web is in §One style on every client.
- Deck screen: a tap on a card row opens it in the editor; a screen reader hears the row as one button with the hint "카드 편집" ([ADR 0118](../adr/0118-name-each-concept-once-write-each-role-in-one-form-hold-every-screen-to-one-set-of-visual-details-and-redraw-settings-and-the-deck-screen-by-them.md)).
- Card editor: a listed block, and a 단어's sense, move and are deleted through its ⋯; a label is typed in its own chip ([ADR 0100](../adr/0100-merge-the-word-kind-into-basic-type-each-sense-s-label-and-offer-the-user-s-labels-above-the-keyboard.md), [ADR 0117](../adr/0117-draw-the-card-editor-as-one-group-per-side-with-a-full-screen-preview-and-every-action-in-words-or-a-row-menu.md)).
- 라벨: a preset moves by a drag on its handle, which a screen reader skips, or by its ⋯ of "위로" and "아래로", which also deletes it, and is edited in place by a tap.
- Photo import list: a swipe left leaves a row out, and its check, which a screen reader hears and taps, leaves it out or puts it back; a tap opens the row's edit sheet. In the edit sheet a meaning is kept by the same round check and moves through its ⋯ ([ADR 0120](../adr/0120-state-today-s-progress-once-put-every-study-button-in-its-card-name-the-record-plainly-and-draw-photo-import-s-bar-checks-and-moves-as-the-other-screens-do.md)).

### Never wait

- Act at once and sync in the background. Show progress only for work the user asked for and must wait on, such as photo extraction.
- A pressed button whose work takes time shows `AppButton`'s loading state in itself and cannot be pressed twice ([ADR 0174](../adr/0174-undo-every-delete-in-the-card-editor-focus-what-an-add-makes-and-show-what-a-refused-save-refuses.md)).

Applied today:

- Study: the next card is on screen before the answer's write finishes.
- Photo import: extraction shows the photo, a progress bar and skeleton rows, and can be cancelled. With several photos one screen states "사진 n장 중 k장 읽음" as a heading a screen reader hears as it changes, over a bar of the k photos read, and each photo's row with its thumbnail and its state in words beside an icon, so colour never carries it alone; a failure shows on its row with its actions, and the other photos go on ([ADR 0089](../adr/0089-import-up-to-ten-photos-into-one-list-read-two-at-a-time-and-state-today-s-limit-before-reading.md)).
- Photo import: reading goes on while the user leaves the screen, and a failed import, with nothing left to read, ends as the screen is left (#690); a bar above the tab bar, one button a screen reader hears as it changes, states "사진 읽는 중 k/n" over a bar of the k photos read, then "카드 n장 확인하기", and leads back; a closed app's import is offered again on the next open, its photos already read not read again ([ADR 0094](../adr/0094-read-a-photo-import-of-up-to-fifty-photos-three-at-a-time-as-an-app-level-job-kept-on-the-device-and-offered-again-after-a-restart.md)).
- Photo import: a thumbnail opens the photo full screen, a button named "사진 i 크게 보기"; the viewer's swipes, swipe down and pinch have its close, the system back and the thumbnails' order as alternatives. With several photos each photo's group is headed by its thumbnail, "사진 i" and its row count, read as a heading and a button whose state is expanded or collapsed, at least `AppSize.tapTarget` high.
- Photo import: a swipe removes or puts back a card at once, a topic's switch drops or keeps its cards at once; nothing is written until the cards are added.
- Settings: a theme choice applies at once and is stored after. Daily study minutes: "저장" stores them on the device, sync pushes them after, and the counts behind the sheet are read again as it closes; the preview moves with each choice before anything is stored.
- Settings, photo import and the card editor's photo and sound picks show progress in the pressed button.

### Correct, don't confirm

- Prefer undo or a toggle to a confirmation. A delete that can be undone acts at once and offers "되돌리기" (the undo bar, [`copy.md`](copy.md)).
- Confirm only what cannot be undone, through `showAppConfirm` ([`frames.md`](frames.md) §Sheet and dialog): deleting a deck, a card with its study history, or the account; signing out with unsynced changes; blocking a user; leaving the card editor with changes, its cancel "계속 쓰기"; and discarding a photo import that holds cards, whose photos cost today's limit again to read.

Applied today:

- Study: any answer of the session is corrected by a drag on the centred card, or its action, with no confirmation.
- Card editor: a duplicate front opens a sheet that offers to add anyway or open the existing card, and is dismissed to do neither; nothing is overwritten. Every delete in the editor, a 칸, a 뜻, a photo's 빈칸, the photo, the sound, or a 표 row or column, acts at once and offers "되돌리기"; nothing in it asks first ([ADR 0174](../adr/0174-undo-every-delete-in-the-card-editor-focus-what-an-add-makes-and-show-what-a-refused-save-refuses.md)).
- Photo import: the top bar's × and the retake in its ⋯ on an import that would save a card confirm "찾은 카드를 버릴까요?", "버리기" last; the system back only leaves the screen, and the import is kept.

### One visual language

- Every colour, spacing, size, radius, edge and type style comes from [`theme.md`](theme.md)'s scales: on the phone `AppColors`, `AppSpace`, `AppSize`, `AppRadius`, `AppShadow` and `AppType`, on the web the same tokens in `globals.css`. For example the screen gutter is `AppSpace.gutter`, never a number; a group's corner is `AppRadius.group`, never `BorderRadius.circular` of a number. On the phone `app/test/design/theme_test.dart` fails on a literal outside the theme and the components; the web has no such check yet.
- Rounded surfaces on the `ground` colour; a solid object stands on a hard edge (`AppShadow`); a shadow that blurs only on what floats: the study card, the preview card and the sheets, never a group or a row.
- At most three type sizes per screen's own chrome: a title, the body and a caption, `AppType`'s two sizes below the titles. A large figure with its unit, a card's own content on the study and preview cards, a button's label and Google's button are outside the count; a sheet is counted apart from the screen under it ([ADR 0119](../adr/0119-draw-every-screen-from-one-radius-scale-one-chip-three-type-sizes-a-press-dim-and-three-haptics-and-a-hidden-blank-as-an-empty-underlined-gap.md)).
- A large figure is `figure`, about −2% tracking and tabular digits, its unit, such as 장 or 분, right after it, smaller and `muted`.
- Coral is the mascot's alone; `accent` the one coloured word and mark; `primary` the one fill. Green and red mean 안다 and 모른다 alone; a selection, sync and a read photo take `accent` or the word alone.
- Hidden content shows as nothing, never as a grey bar that reads as loading: an empty blank is a gap over an underline; on study's cards and the card list, what study hides is on the hatch, never a solid fill ([ADR 0176](../adr/0176-start-study-s-front-at-a-size-its-length-gives-and-draw-what-study-hides-on-the-hatch.md)).
- Never: a gradient, glass blur, or an emoji or illustration as decoration, the mascot's expressions at [`brand.md`](brand.md)'s moments being the one exception ([ADR 0141](../adr/0141-polish-the-coral-mascot-make-coral-the-primary-action-and-place-its-expressions-on-both-clients.md)); an icon in a tinted square; a second chip style; everything centred.
- Targets are at least `AppSize.tapTarget`.

Applied today:

- The split card: front left and back right, each half's content centred across and down, wherever a card shows both sides: the duplicate sheet and the card preview through `deck`'s `SplitCard` ([`deck.md`](../deck.md)). The study's current card shows its front alone, centred ([ADR 0049](../adr/0049-study-in-one-flow-that-goes-on-past-today-s-cards-as-recorded-study-with-the-current-card-showing-its-front-alone.md)). Study's previous card is the exception: its front over its back in one column, centred both ways and scrolling inside where it is taller ([ADR 0151](../adr/0151-draw-the-previous-study-card-as-one-centred-scrolling-column-on-a-grade-line-put-the-mascot-between-the-cards-finish-on-a-hero-panel-and-redraw-the-record.md)). The card editor shows no card of its own: its "미리보기" draws the card as study's current card does, its front and, a tap later, its back, or its one face with its blanks as boxes on the hatch and then filled on it ([ADR 0117](../adr/0117-draw-the-card-editor-as-one-group-per-side-with-a-full-screen-preview-and-every-action-in-words-or-a-row-menu.md)).
- A table or cloze card is drawn whole wherever a card is drawn split, through `deck`'s `WholeCardView`: a text block as its title, in `wholeFront` on a card and, in a list row's smaller style, that style in bold, a part the reveal adds under it in the smaller `wholeAdded` in `ink2` ([ADR 0145](../adr/0145-redraw-the-screens-for-the-coral-mascot-rounder-with-one-current-tab-two-chart-colours-and-one-way-out-of-an-empty-state.md)); a cloze centred and fitted as a front is; a table in the body size inside `outline` lines, its header row on `ground`, its header row and each row's first cell bold; an empty blank a gap of its answer's width over a `muted` underline, its answer not drawn, and a filled one the answer on `brandTint`, but on study's cards and the card editor's preview, where an empty blank is a box on the hatch 2 em wide whatever its answer and a filled one its answer on the hatch ([ADR 0176](../adr/0176-start-study-s-front-at-a-size-its-length-gives-and-draw-what-study-hides-on-the-hatch.md)) ([ADR 0068](../adr/0068-store-a-table-or-cloze-card-as-typed-content-blocks-and-draw-it-whole-its-blanks-filled-in-place-once-answered.md), [ADR 0119](../adr/0119-draw-every-screen-from-one-radius-scale-one-chip-three-type-sizes-a-press-dim-and-three-haptics-and-a-hidden-blank-as-an-empty-underlined-gap.md)). A photo card is drawn whole the same way: the photo whole, its hidden boxes filled in `hero`, a revealed one outlined in 2 px of `brand` with its answer on `brandTint` at its top left ([ADR 0109](../adr/0109-store-an-image-block-s-boxes-in-fractions-of-the-image-and-draw-them-with-the-image-s-one-transform.md)); on study's cards each box is on the hatch, its answer on it once revealed ([ADR 0176](../adr/0176-start-study-s-front-at-a-size-its-length-gives-and-draw-what-study-hides-on-the-hatch.md)).
- A vocabulary sense reads the same from every book: each label in brackets, a part of speech by its fixed short form, as `[명]`, another label as printed, then the meaning, one sense per line; the label is its own span followed by a gap of `AppSpace.s4` (`mr-1` on the web), narrower than a word space; a sense with no label shows its meaning alone ([ADR 0075](../adr/0075-store-a-vocabulary-card-s-senses-as-a-typed-block-and-show-each-label-in-brackets-before-its-meaning.md)).
- 홈's first screen is the `hero` surface, rounded at its foot, its words in `onHero`, over the week card on the ground ([ADR 0150](../adr/0150-open-on-a-home-of-today-on-the-hero-with-the-notes-in-a-drawer-keep-the-menu-on-a-note-and-make-a-note-on-a-full-screen.md), [ADR 0165](../adr/0165-open-on-today-over-the-last-seven-days-move-the-notes-to-a-tab-and-open-settings-from-the-profile-button.md)).

### One component per UI job

- A job that recurs is drawn through its one component and never rebuilt: a button, a text field or search, a confirmation, a chip, a list row, a group with its section label, an empty state, a read failure with "다시 시도", a pager. [`components.md`](components.md) names each job's component on both clients.
- A piece two features or domains use lives where [`structure.md`](../structure.md) allows sharing: `app/lib/design/` or `web/src/design/`. A piece one feature or domain uses stays in it, as `CardText` stays in `deck`.
- A job with no component yet gets one in the change that draws it a second time; the change does not add a second copy. For example a second screen needing a search field reuses the 노트 tab's `ListSearchField`, moving it to `app/lib/design/` once a second domain needs it.

### No over-splitting

- A component earns its own file by a responsibility of its own or by reuse.
- No pass-through wrapper, one that only forwards to another component, is added, and no one-use piece is split out that has no responsibility of its own.
- For example a `SaveButton` that returns `AppButton(label: '저장')` is not added; the caller draws `AppButton` itself.

### Alignment

- The sections of one screen share one left and one right edge, the gutter (`AppSpace.gutter`; `px-5` on the web): a group, a field, a list and a bottom bar all start and end on it. Anything inset further is inset by its frame ([`frames.md`](frames.md)), never by an amount of its own.
- In a row, an icon and its text share a centre line, and text beside text shares a baseline.
- A field's label starts on the field's left edge, as `AppTextField` draws it.

### Nothing clipped

- A box sized for its text grows with the system text size: the tab bar from `AppSize.tabBar` by the text scale, a top bar that holds an action to that action's line (`AppButton.barHeight`), a filled or outlined button to its wrapped label with room above and below it, a chip's label wrapping inside the chip (issues #295 and #655).
- A raised object's hard edge has room below it: its parent leaves at least the edge's height (`AppShadow`) under it, so the edge is never cut by a scroll view, a bar or a group.
- Text breaks only between words, our own text and a user's: `keepWords` (`app/lib/design/word_break.dart`) on the phone, `word-break: keep-all` (`break-keep`) on the web, every card surface included ([ADR 0123](../adr/0123-step-a-long-card-side-down-through-three-sizes-then-scroll-it-inside-a-card-that-keeps-its-size.md), issues #321 and #368). Only a word longer than its whole line breaks inside it (PR #631). Where a line cannot wrap, stack the parts or ellipsize; never break a word.
- A figure or label in a narrow column, the day bars' and the tab bar's among them, stays on one line and shrinks to the column only where it is wider: `FittedBox` with `BoxFit.scaleDown` on the phone, `FittedLine` on the web.
- A card's text starts at the size its length gives, smaller as it grows, steps down through the card's sizes until it fits, never below `cardBody`, then scrolls inside the card with a fading bottom edge ([ADR 0176](../adr/0176-start-study-s-front-at-a-size-its-length-gives-and-draw-what-study-hides-on-the-hatch.md)); it is never cut on the current card or the preview, and the card keeps its size (`CardText`, [`components.md`](components.md)).
- A bottom pair stays in one row only while both labels fit on one line at the text size shown; otherwise it stacks, the primary last (`BottomActions`, [ADR 0173](../adr/0173-keep-a-bottom-pair-in-one-row-only-while-both-labels-fit-on-one-line-and-stack-it-otherwise.md)).

### Meaningful motion

- Motion shows where things go. Under reduce motion each motion is replaced by a cross-fade or happens at once.
- A press moves a button or row down onto its edge and dims it, under its text's colour at 10%, with no splash and no scale bounce; under reduce motion only the dim stays ([ADR 0147](../adr/0147-draw-both-clients-in-cobalt-with-solid-surfaces-on-hard-edges-jua-for-what-we-write-and-pretendard-for-what-a-user-wrote.md)).
- A light haptic marks answering a card, saving one in the editor and `showAppConfirm`'s red button, and no other press ([ADR 0119](../adr/0119-draw-every-screen-from-one-radius-scale-one-chip-three-type-sizes-a-press-dim-and-three-haptics-and-a-hidden-blank-as-an-empty-underlined-gap.md)).

Applied today:

- Study: an answered card flies off and rises into the previous card's place while the next emerges from below; under reduce motion they cross-fade. A re-decided card springs back into place, at once under reduce motion.
- Photo import list: a row swiped left follows the finger and springs back into place, left out.
- The preview and study cards turn over about their vertical axis in 200 to 250 ms; the card editor's 미리보기 in 220 ms ([ADR 0117](../adr/0117-draw-the-card-editor-as-one-group-per-side-with-a-full-screen-preview-and-every-action-in-words-or-a-row-menu.md)).
- Study's coach: the card moves out with an ease, holds and springs back under the brand's tilted hand on its touch ring, a dashed trail behind it, each step looping until the user moves on; the mascot and its bubble rise in as the coach starts ([ADR 0166](../adr/0166-draw-no-mascot-during-a-study-session-let-it-present-the-coach-with-a-back-and-a-next-and-a-tilted-hand-and-fill-an-empty-day-s-bar.md)); under reduce motion each step is a still image, the card held out ([ADR 0064](../adr/0064-teach-study-with-a-first-use-finger-coach-and-show-the-day-s-last-card-and-a-brief-notice-when-a-day-resumes.md)). The notice that a day goes on slides in and out, or fades.
- Every sheet: `showAppSheet` slides it up with the platform's sheet motion.
- The mascot's blink and breath are [`brand.md`](brand.md)'s.

### Plain-language states

- Empty, offline and error states say what happened and what to do next, in one or two short sentences in [`copy.md`](copy.md)'s voice, laid out by [`frames.md`](frames.md) §Empty and failure state.

Applied today:

- First-run home, a cardless 홈 and the deck screen: [`frames.md`](frames.md) §Empty and failure state, with the mascot ([ADR 0145](../adr/0145-redraw-the-screens-for-the-coral-mascot-rounder-with-one-current-tab-two-chart-colours-and-one-way-out-of-an-empty-state.md)); a search with no match, on the 노트 tab or the deck screen, says to try other words. The first-run home keeps the quiet "공개 노트 둘러보기", which the 노트 tab's ⋯ holds once there is a deck. A cardless 홈 draws no week card: the hero's one action is its way out.
- 홈: in a backlog, the hero's one sentence says new cards wait until the reviews are caught up ([`study.md`](../study.md)).
- Study: with no card left and none answered today, one sentence says there is nothing to study today, over "닫기", its way back as a button beside the ✕ ([ADR 0145](../adr/0145-redraw-the-screens-for-the-coral-mascot-rounder-with-one-current-tab-two-chart-colours-and-one-way-out-of-an-empty-state.md)).
- 기록: a chart with nothing to show says so in one sentence: no review in the period, no card reviewed, no card mastered.
- Every screen: a storage failure says what failed and to try again.
- Browse: offline, it says the public decks appear once connected; the deck menu says why publishing is disabled.

### One style on every client

- The web shares the app's style at every width: the same tokens, colours, raised surfaces, type faces and sizes, mascot, copy and component shapes ([ADR 0151](../adr/0151-draw-the-previous-study-card-as-one-centred-scrolling-column-on-a-grade-line-put-the-mascot-between-the-cards-finish-on-a-hero-panel-and-redraw-the-record.md)).
- Mobile web is the app: used by touch (`(pointer: coarse)`), the web's layout, copy, components, controls, coach and gestures are the phone's.
- The web differs only in input and in the layout a width calls for: by a pointer, arrow keys and buttons in place of swipes, with a coach that teaches them; from 1024 px, the side menu and wider columns.
- A difference in style found between the clients is a defect of the web, fixed by drawing the phone's.

Applied today:

- Study: by touch a swipe answers with no answer button drawn and the phone's touch coach ([ADR 0084](../adr/0084-answer-the-web-s-current-study-card-by-a-touch-swipe-as-the-phone-does.md)); by a pointer "모른다" and "안다" with their keys, "마지막 응답 바꾸기" with Z and a coach that marks each; at every width the phone's cards, gaps, notice in the progress bar's place, coach caption and completion panel.
- 기록 and 학습 완료: the phone's tokens, tiles and edges; from 1024 px the recall and mastered cards side by side.
- 홈: below 1024 px the hero fills the screen above the tab bar, its mascot the phone's in every state and at the phone's size, with the week card's top edge under it and the rest a scroll away ([ADR 0179](../adr/0179-fill-home-s-first-screen-with-the-hero-and-reach-the-week-card-by-scrolling.md)); from 1024 px the hero over the week card in the one column, and the profile button at the foot of the side menu ([ADR 0165](../adr/0165-open-on-today-over-the-last-seven-days-move-the-notes-to-a-tab-and-open-settings-from-the-profile-button.md)).
- Authoring: below 1024 px 새 노트, 새 카드, photo import and spreadsheet import's 카드 확인 are the phone's full screens, the browser's back their back; from 1024 px each is a dialog ([ADR 0158](../adr/0158-open-the-web-s-authoring-flows-as-full-screens-below-1024-px-with-the-browser-s-back-as-the-phone-s-back.md)).

### Before and after shots

A pull request that changes how a screen or sheet looks attaches a before and an after shot of each changed screen:

- the phone at 390 wide, and the web at 390 and 1280 wide;
- each in light and dark;
- and, where the screen holds text that grows with the system text size, at the largest text size as well.

`app/test/screenshots/screenshots_test.dart` writes the phone's ([`checks.md`](checks.md)).

## Rationale

- [ADR 0118](../adr/0118-name-each-concept-once-write-each-role-in-one-form-hold-every-screen-to-one-set-of-visual-details-and-redraw-settings-and-the-deck-screen-by-them.md) records the visual details every redesigned screen follows and the settings and deck screens drawn by them; issue #454 records the owner's approval.
- [ADR 0119](../adr/0119-draw-every-screen-from-one-radius-scale-one-chip-three-type-sizes-a-press-dim-and-three-haptics-and-a-hidden-blank-as-an-empty-underlined-gap.md) records why every screen draws one radius scale, one chip, three sizes, the press and three haptics through the shared layer, why a hidden blank is an underlined gap, and what is outside the three sizes.
- [ADR 0176](../adr/0176-start-study-s-front-at-a-size-its-length-gives-and-draw-what-study-hides-on-the-hatch.md) records why a study card's front starts at a size its length gives on the app's type tokens rather than a continuous size, why its fourth step is `deckName`, and why study draws what it hides on the card list's hatch with a blank of fixed width.
- [ADR 0174](../adr/0174-undo-every-delete-in-the-card-editor-focus-what-an-add-makes-and-show-what-a-refused-save-refuses.md) records why the card editor's deletes take an undo bar and none asks first.
- [ADR 0173](../adr/0173-keep-a-bottom-pair-in-one-row-only-while-both-labels-fit-on-one-line-and-stack-it-otherwise.md) records why a bottom pair stacks once its labels no longer fit on one line.
- [ADR 0179](../adr/0179-fill-home-s-first-screen-with-the-hero-and-reach-the-week-card-by-scrolling.md) records why 홈's hero fills the first screen at its full mascot and the week card follows by scrolling, on both clients.
- [ADR 0165](../adr/0165-open-on-today-over-the-last-seven-days-move-the-notes-to-a-tab-and-open-settings-from-the-profile-button.md) records why 홈 is today over the week card with the notes on their own tab and 설정 from the profile button, and the fit of the hero by its mascot that ADR 0179 supersedes.
- [ADR 0158](../adr/0158-open-the-web-s-authoring-flows-as-full-screens-below-1024-px-with-the-browser-s-back-as-the-phone-s-back.md) records why the web's authoring flows are the phone's full screens below 1024 px and a dialog from it.
- [ADR 0151](../adr/0151-draw-the-previous-study-card-as-one-centred-scrolling-column-on-a-grade-line-put-the-mascot-between-the-cards-finish-on-a-hero-panel-and-redraw-the-record.md) records the previous card's centred, scrolling column, the completion panel on the hero, and why the figure and counts keep the three sizes a screen has.
- [ADR 0150](../adr/0150-open-on-a-home-of-today-on-the-hero-with-the-notes-in-a-drawer-keep-the-menu-on-a-note-and-make-a-note-on-a-full-screen.md) records why 홈 was today on the hero, which ADR 0165 supersedes, and why a bottom pair gives its secondary its label's width; issues #570 and #578 record the owner's and the PM's decisions.
- [ADR 0145](../adr/0145-redraw-the-screens-for-the-coral-mascot-rounder-with-one-current-tab-two-chart-colours-and-one-way-out-of-an-empty-state.md) records the shape of an empty state and a whole card's two sizes.
- [ADR 0120](../adr/0120-state-today-s-progress-once-put-every-study-button-in-its-card-name-the-record-plainly-and-draw-photo-import-s-bar-checks-and-moves-as-the-other-screens-do.md) records why every study button sits in its card and photo import's top bar, check and move.
- [ADR 0117](../adr/0117-draw-the-card-editor-as-one-group-per-side-with-a-full-screen-preview-and-every-action-in-words-or-a-row-menu.md) records why each side of the card editor is one group, why its preview is a screen of its own drawn as study draws, and why every move and delete there is in a row's ⋯.
- [ADR 0114](../adr/0114-write-every-card-as-a-free-block-list-remove-the-flip-cloze-and-table-forms-and-migrate-every-card-to-free.md) records why the card editor is one block list, with no kind to choose.
- [ADR 0108](../adr/0108-add-a-free-template-and-an-add-control-that-puts-any-block-on-either-side-of-every-template.md) records why a block reorders through a menu rather than a drag.
- [ADR 0099](../adr/0099-answer-study-cards-by-swipe-alone-and-grade-the-previous-card-by-its-colour-alone-on-the-phone.md) records why the phone's study screen has no answer button, and what a colour-blind user without a screen reader gives up for it.
- [ADR 0064](../adr/0064-teach-study-with-a-first-use-finger-coach-and-show-the-day-s-last-card-and-a-brief-notice-when-a-day-resumes.md) records the first-use coach, the one line in the empty place, and a resumed day's notice; [ADR 0044](../adr/0044-show-a-guide-with-the-session-s-size-in-the-previous-card-s-place-at-every-session-s-start.md) the guide it replaced.
- [ADR 0042](../adr/0042-show-only-the-previous-and-the-current-study-card-at-one-size-re-decide-the-previous-card-by-a-swipe-and-open-it-on-a-tap.md) records why the study screen shows two cards of one size, re-decided by a swipe and opened on a tap; [ADR 0035](../adr/0035-show-the-previous-and-current-study-card-reach-earlier-cards-three-at-a-time-re-decide-the-centred-card-and-grade-each-card-by-its-colour-and-a-chip.md) the split card drawn once in `deck`; [ADR 0023](../adr/0023-scroll-the-current-study-card-with-the-stack-and-centre-each-half.md) why each half of a split card centres its content.
- [ADR 0007](../adr/0007-study-swipe-screen-and-session-toggle.md) records the study screen these principles generalize; issue #22 records the principles as the owner approved them on 2026-10-15.
- The rules §One component per UI job, §No over-splitting, §Alignment, §Nothing clipped's edge and stacking rules and §Before and after shots are the owner's direction of 2026-11-03 (#647).

## Open questions

- Whether deleting a card should become undoable, so it needs no confirmation. Its study history is deleted with it today, which an undo would have to restore.
