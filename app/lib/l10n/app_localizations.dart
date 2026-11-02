import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/intl.dart' as intl;

import 'app_localizations_en.dart';
import 'app_localizations_ko.dart';

// ignore_for_file: type=lint

/// Callers can lookup localized strings with an instance of AppLocalizations
/// returned by `AppLocalizations.of(context)`.
///
/// Applications need to include `AppLocalizations.delegate()` in their app's
/// `localizationDelegates` list, and the locales they support in the app's
/// `supportedLocales` list. For example:
///
/// ```dart
/// import 'l10n/app_localizations.dart';
///
/// return MaterialApp(
///   localizationsDelegates: AppLocalizations.localizationsDelegates,
///   supportedLocales: AppLocalizations.supportedLocales,
///   home: MyApplicationHome(),
/// );
/// ```
///
/// ## Update pubspec.yaml
///
/// Please make sure to update your pubspec.yaml to include the following
/// packages:
///
/// ```yaml
/// dependencies:
///   # Internationalization support.
///   flutter_localizations:
///     sdk: flutter
///   intl: any # Use the pinned version from flutter_localizations
///
///   # Rest of dependencies
/// ```
///
/// ## iOS Applications
///
/// iOS applications define key application metadata, including supported
/// locales, in an Info.plist file that is built into the application bundle.
/// To configure the locales supported by your app, you’ll need to edit this
/// file.
///
/// First, open your project’s ios/Runner.xcworkspace Xcode workspace file.
/// Then, in the Project Navigator, open the Info.plist file under the Runner
/// project’s Runner folder.
///
/// Next, select the Information Property List item, select Add Item from the
/// Editor menu, then select Localizations from the pop-up menu.
///
/// Select and expand the newly-created Localizations item then, for each
/// locale your application supports, add a new item and select the locale
/// you wish to add from the pop-up menu in the Value field. This list should
/// be consistent with the languages listed in the AppLocalizations.supportedLocales
/// property.
abstract class AppLocalizations {
  AppLocalizations(String locale)
    : localeName = intl.Intl.canonicalizedLocale(locale.toString());

  final String localeName;

  static AppLocalizations of(BuildContext context) {
    return Localizations.of<AppLocalizations>(context, AppLocalizations)!;
  }

  static const LocalizationsDelegate<AppLocalizations> delegate =
      _AppLocalizationsDelegate();

  /// A list of this localizations delegate along with the default localizations
  /// delegates.
  ///
  /// Returns a list of localizations delegates containing this delegate along with
  /// GlobalMaterialLocalizations.delegate, GlobalCupertinoLocalizations.delegate,
  /// and GlobalWidgetsLocalizations.delegate.
  ///
  /// Additional delegates can be added by appending to this list in
  /// MaterialApp. This list does not have to be used at all if a custom list
  /// of delegates is preferred or required.
  static const List<LocalizationsDelegate<dynamic>> localizationsDelegates =
      <LocalizationsDelegate<dynamic>>[
        delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
      ];

  /// A list of this localizations delegate's supported locales.
  static const List<Locale> supportedLocales = <Locale>[
    Locale('ko'),
    Locale('en'),
  ];

  /// The app's name, shown by the operating system.
  ///
  /// In ko, this message translates to:
  /// **'알아몰라'**
  String get appTitle;

  /// Title of the new-deck sheet and of the sheet that names a new deck, and the deck choosers' new deck.
  ///
  /// In ko, this message translates to:
  /// **'새 노트'**
  String get newDeck;

  /// Label of the menu button on a deck.
  ///
  /// In ko, this message translates to:
  /// **'노트 설정'**
  String get deckActions;

  /// Screen-reader name of the ⋯ menu in the photo import list's top bar, which holds the retake.
  ///
  /// In ko, this message translates to:
  /// **'사진 작업'**
  String get importActions;

  /// Menu item and dialog title for renaming a deck.
  ///
  /// In ko, this message translates to:
  /// **'노트 이름 바꾸기'**
  String get renameDeck;

  /// The deck menu's item, and the title of the sheet in which the user chooses the icon and colour of a deck's tile.
  ///
  /// In ko, this message translates to:
  /// **'노트 꾸미기'**
  String get deckAppearance;

  /// In the 노트 꾸미기 sheet: the heading over the icons a deck's tile can hold.
  ///
  /// In ko, this message translates to:
  /// **'아이콘'**
  String get deckAppearanceIcon;

  /// In the 노트 꾸미기 sheet: the heading over the colours a deck's tile can take.
  ///
  /// In ko, this message translates to:
  /// **'색'**
  String get deckAppearanceColor;

  /// In the 노트 꾸미기 sheet: the heading over the ways to put a photo on a deck's tile in place of its icon.
  ///
  /// In ko, this message translates to:
  /// **'사진 넣기'**
  String get deckAppearanceImage;

  /// In the 노트 꾸미기 sheet: the button that picks the tile's photo from the photo library.
  ///
  /// In ko, this message translates to:
  /// **'앨범에서 고르기'**
  String get deckImageFromAlbum;

  /// In the 노트 꾸미기 sheet: the button that takes the tile's photo with the camera.
  ///
  /// In ko, this message translates to:
  /// **'사진 찍기'**
  String get deckImageFromCamera;

  /// In the 노트 꾸미기 sheet: the button that takes the photo off the tile, which then shows its icon again.
  ///
  /// In ko, this message translates to:
  /// **'사진 빼기'**
  String get deckImageRemove;

  /// In the 노트 꾸미기 sheet: shown when the picked photo, the camera or the photo library could not be read.
  ///
  /// In ko, this message translates to:
  /// **'사진을 불러오지 못했어요. 다시 시도해 주세요.'**
  String get deckImageUnreadable;

  /// What a screen reader calls an icon in the 노트 꾸미기 sheet, by the icon's stored key.
  ///
  /// In ko, this message translates to:
  /// **'{icon, select, layers{카드 묶음} book{책} languages{언어} pencil{연필} flask{실험} calculator{계산기} globe{지구본} music{음악} palette{팔레트} brain{두뇌} code{코드} landmark{건축물} briefcase{서류 가방} star{별} other{아이콘}}'**
  String deckIconName(String icon);

  /// What a screen reader calls a colour in the 노트 꾸미기 sheet, by the colour's stored key.
  ///
  /// In ko, this message translates to:
  /// **'{color, select, blue{파랑} sky{하늘} violet{복숭아} sand{모래} amber{노랑} slate{회색} other{색}}'**
  String deckColorName(String color);

  /// Menu item for deleting a deck.
  ///
  /// In ko, this message translates to:
  /// **'노트 삭제'**
  String get deleteDeck;

  /// Title of the deck deletion confirmation.
  ///
  /// In ko, this message translates to:
  /// **'\"{name}\" 노트를 삭제할까요?'**
  String deleteDeckTitle(String name);

  /// Body of the deck deletion confirmation, naming how many cards go with the deck.
  ///
  /// In ko, this message translates to:
  /// **'{count, plural, =0{이 노트에는 카드가 없어요.} other{카드 {count}장도 함께 삭제돼요.}}'**
  String deleteDeckBody(int count);

  /// Label of the deck name field.
  ///
  /// In ko, this message translates to:
  /// **'노트 이름'**
  String get deckName;

  /// Error shown when a deck name is empty.
  ///
  /// In ko, this message translates to:
  /// **'이름을 입력해 주세요'**
  String get deckNameRequired;

  /// Shown when a deck has no card.
  ///
  /// In ko, this message translates to:
  /// **'아직 카드가 없어요'**
  String get noCards;

  /// Bottom-bar button for adding a card, and the title of the sheet of ways to add one.
  ///
  /// In ko, this message translates to:
  /// **'카드 추가'**
  String get newCard;

  /// Title of the card editor for a new card.
  ///
  /// In ko, this message translates to:
  /// **'새 카드'**
  String get newCardTitle;

  /// Screen title for editing a card.
  ///
  /// In ko, this message translates to:
  /// **'카드 편집'**
  String get editCard;

  /// Button at the end of the card editor that deletes the card, after a confirmation.
  ///
  /// In ko, this message translates to:
  /// **'카드 삭제'**
  String get deleteCard;

  /// Label of the card front field.
  ///
  /// In ko, this message translates to:
  /// **'앞면'**
  String get cardFront;

  /// Label of the card back field.
  ///
  /// In ko, this message translates to:
  /// **'뒷면'**
  String get cardBack;

  /// Error shown when a card side is empty.
  ///
  /// In ko, this message translates to:
  /// **'내용을 적어 주세요'**
  String get cardSideRequired;

  /// How a screen reader reads an empty blank of a table or cloze card.
  ///
  /// In ko, this message translates to:
  /// **'빈칸'**
  String get blank;

  /// Title of the sheet that shows a card whole: its front and back under labels of the same rank, or a table or cloze card with its blanks filled.
  ///
  /// In ko, this message translates to:
  /// **'카드'**
  String get wholeCard;

  /// A 빈칸 문장 block's one action, above the keyboard: makes the selected characters a blank, or inserts an empty blank at the cursor.
  ///
  /// In ko, this message translates to:
  /// **'빈칸 넣기'**
  String get clozeInsertBlank;

  /// A 빈칸 문장 block's one action while the caret or the selection is inside a blank: turns that blank back into text.
  ///
  /// In ko, this message translates to:
  /// **'빈칸 풀기'**
  String get clozeUndoBlank;

  /// Screen-reader name of a 빈칸 문장 block's action while the caret is inside a blank, naming the blank it turns back into text.
  ///
  /// In ko, this message translates to:
  /// **'빈칸 풀기, {answer}'**
  String clozeRemoveBlank(String answer);

  /// What the screen-reader name of 빈칸 풀기 says for a blank while nothing is typed into it yet.
  ///
  /// In ko, this message translates to:
  /// **'빈칸'**
  String get clozeEmptyBlank;

  /// Error under the cloze line on save when it has no blank holding text.
  ///
  /// In ko, this message translates to:
  /// **'빈칸을 하나 이상 넣어 주세요'**
  String get clozeBlankRequired;

  /// Error under a 빈칸 문장 block's line when the line holds underscores that would read as a blank of its own.
  ///
  /// In ko, this message translates to:
  /// **'줄에서 ___를 빼 주세요'**
  String get clozeBlankMarker;

  /// The row after the card editor's last group, after a +, the sheet of 칸 types it opens, and what a screen reader reads for it.
  ///
  /// In ko, this message translates to:
  /// **'칸 추가'**
  String get addBlock;

  /// A text block's type, in the add sheet and over the block in the card editor.
  ///
  /// In ko, this message translates to:
  /// **'글'**
  String get blockText;

  /// A 단어 칸's type, in the add sheet and over its group in the card editor.
  ///
  /// In ko, this message translates to:
  /// **'단어'**
  String get blockSenses;

  /// The line under 단어 in the add sheet.
  ///
  /// In ko, this message translates to:
  /// **'단어와 뜻을 함께 적어요'**
  String get blockSensesDescription;

  /// A table block's type, in the add sheet and over the block in the card editor.
  ///
  /// In ko, this message translates to:
  /// **'표'**
  String get blockTable;

  /// The line under 표 in the add sheet.
  ///
  /// In ko, this message translates to:
  /// **'가릴 부분을 골라요'**
  String get blockTableDescription;

  /// A cloze block's type, in the add sheet and over the block in the card editor.
  ///
  /// In ko, this message translates to:
  /// **'빈칸 문장'**
  String get blockCloze;

  /// The line under 빈칸 문장 in the add sheet, and the hint of a cloze block's line.
  ///
  /// In ko, this message translates to:
  /// **'문장 속 단어를 가려요'**
  String get blockClozeDescription;

  /// An image block's type, in the add sheet and over the block in the card editor, and what a card side's text and a screen reader say for a photo.
  ///
  /// In ko, this message translates to:
  /// **'사진'**
  String get blockImage;

  /// The line under 사진 in the add sheet.
  ///
  /// In ko, this message translates to:
  /// **'사진 위에 가릴 곳을 그려요'**
  String get blockImageDescription;

  /// In an image block of the card editor: the button that picks the photo from the photo library.
  ///
  /// In ko, this message translates to:
  /// **'앨범에서 고르기'**
  String get imageFromAlbum;

  /// In an image block of the card editor: the button that takes the photo with the camera.
  ///
  /// In ko, this message translates to:
  /// **'사진 찍기'**
  String get imageFromCamera;

  /// In an image block of the card editor: shown when the picked photo, the camera or the photo library could not be read.
  ///
  /// In ko, this message translates to:
  /// **'사진을 불러오지 못했어요. 다시 시도해 주세요.'**
  String get imageUnreadable;

  /// Error under an image block of the card editor on save while it holds no photo.
  ///
  /// In ko, this message translates to:
  /// **'사진을 골라 주세요'**
  String get imageRequired;

  /// Line under an image block's photo in the card editor, saying how to draw a box over it.
  ///
  /// In ko, this message translates to:
  /// **'사진 위를 끌어서 빈칸을 그리거나 \'빈칸 추가\'를 눌러요'**
  String get imageHint;

  /// Accessible name of a box over a photo in the card editor, and the heading of its tools while it is selected.
  ///
  /// In ko, this message translates to:
  /// **'빈칸 {number}'**
  String imageBox(int number);

  /// Button under an image block's photo that adds a box in its middle, the way to draw one without a drag.
  ///
  /// In ko, this message translates to:
  /// **'빈칸 추가'**
  String get imageAddBox;

  /// Field of the selected box over a photo: the answer shown in it once revealed.
  ///
  /// In ko, this message translates to:
  /// **'정답 (선택)'**
  String get imageBoxAnswer;

  /// Tooltip of the button that moves the selected box over a photo left, without a drag.
  ///
  /// In ko, this message translates to:
  /// **'왼쪽으로 옮기기'**
  String get imageBoxLeft;

  /// Tooltip of the button that moves the selected box over a photo right, without a drag.
  ///
  /// In ko, this message translates to:
  /// **'오른쪽으로 옮기기'**
  String get imageBoxRight;

  /// Tooltip of the button that moves the selected box over a photo up, without a drag.
  ///
  /// In ko, this message translates to:
  /// **'위로 옮기기'**
  String get imageBoxUp;

  /// Tooltip of the button that moves the selected box over a photo down, without a drag.
  ///
  /// In ko, this message translates to:
  /// **'아래로 옮기기'**
  String get imageBoxDown;

  /// Tooltip of the button that widens the selected box over a photo, without a drag.
  ///
  /// In ko, this message translates to:
  /// **'가로 늘리기'**
  String get imageBoxWider;

  /// Tooltip of the button that narrows the selected box over a photo, without a drag.
  ///
  /// In ko, this message translates to:
  /// **'가로 줄이기'**
  String get imageBoxNarrower;

  /// Tooltip of the button that makes the selected box over a photo taller, without a drag.
  ///
  /// In ko, this message translates to:
  /// **'세로 늘리기'**
  String get imageBoxTaller;

  /// Tooltip of the button that makes the selected box over a photo shorter, without a drag.
  ///
  /// In ko, this message translates to:
  /// **'세로 줄이기'**
  String get imageBoxShorter;

  /// Button that removes the selected box over a photo.
  ///
  /// In ko, this message translates to:
  /// **'빈칸 삭제'**
  String get imageBoxDelete;

  /// A sound block's type, in the add sheet and over the block in the card editor, and what a card side's text and a screen reader say for a sound.
  ///
  /// In ko, this message translates to:
  /// **'소리'**
  String get blockAudio;

  /// The line under 소리 in the add sheet.
  ///
  /// In ko, this message translates to:
  /// **'녹음하거나 파일을 넣어요'**
  String get blockAudioDescription;

  /// Accessible name and tooltip of a sound block's play control, and the study cards' screen reader action that plays the card's sound.
  ///
  /// In ko, this message translates to:
  /// **'소리 듣기'**
  String get playAudio;

  /// In a sound block of the card editor: the button that starts recording from the microphone.
  ///
  /// In ko, this message translates to:
  /// **'녹음하기'**
  String get audioRecord;

  /// In a sound block of the card editor: the button that picks an audio file.
  ///
  /// In ko, this message translates to:
  /// **'파일에서 고르기'**
  String get audioPick;

  /// In a sound block of the card editor holding a sound: the button that records a new one in its place.
  ///
  /// In ko, this message translates to:
  /// **'다시 녹음'**
  String get audioRecordAgain;

  /// In a sound block of the card editor holding a sound: the button that picks another audio file in its place.
  ///
  /// In ko, this message translates to:
  /// **'다른 파일 고르기'**
  String get audioPickAnother;

  /// In a sound block of the card editor holding a sound: the button that takes the sound out of the block.
  ///
  /// In ko, this message translates to:
  /// **'소리 빼기'**
  String get audioRemove;

  /// In a sound block of the card editor while recording: the button that stops recording and keeps it.
  ///
  /// In ko, this message translates to:
  /// **'녹음 끝내기'**
  String get audioStopRecording;

  /// In a sound block of the card editor while recording: the time recorded so far and the longest a recording may be, each as m:ss.
  ///
  /// In ko, this message translates to:
  /// **'녹음 중 {elapsed} / {limit}'**
  String audioRecording(String elapsed, String limit);

  /// In a sound block of the card editor: shown when the recording or the picked file could not be read.
  ///
  /// In ko, this message translates to:
  /// **'소리를 불러오지 못했어요. 다시 시도해 주세요.'**
  String get audioUnreadable;

  /// In a sound block of the card editor: shown when the picked file plays longer, or is larger, than a sound may be.
  ///
  /// In ko, this message translates to:
  /// **'{seconds}초, 5MB까지인 파일을 골라 주세요'**
  String audioTooLarge(int seconds);

  /// In a sound block of the card editor: shown when the user has not let the app use the microphone.
  ///
  /// In ko, this message translates to:
  /// **'마이크를 쓸 수 없어요. 설정에서 마이크 접근을 허용해 주세요.'**
  String get microphoneDenied;

  /// Error under a sound block of the card editor on save while it holds no sound.
  ///
  /// In ko, this message translates to:
  /// **'소리를 넣어 주세요'**
  String get audioRequired;

  /// Snack bar shown when a sound cannot be read or played, such as one not yet downloaded while offline.
  ///
  /// In ko, this message translates to:
  /// **'소리를 재생하지 못했어요'**
  String get audioUnplayable;

  /// Settings row: the switch that plays a study card's front sound once when the card appears.
  ///
  /// In ko, this message translates to:
  /// **'앞면 소리 자동 재생'**
  String get autoplayAudio;

  /// Screen-reader name of a 칸's menu in the card editor, which moves it up or down or deletes it.
  ///
  /// In ko, this message translates to:
  /// **'{number}번째 칸 메뉴'**
  String blockMenu(int number);

  /// Error under the card editor's column on save when the card shows nothing before the reveal.
  ///
  /// In ko, this message translates to:
  /// **'앞면에 보일 내용을 하나 이상 넣어 주세요'**
  String get cardNothingBefore;

  /// Error under the card editor's column on save when the reveal adds nothing to the card.
  ///
  /// In ko, this message translates to:
  /// **'뒷면이나 빈칸을 하나 이상 넣어 주세요'**
  String get cardNothingAdded;

  /// The word field of a 단어 칸, and its chip in 앞면에 보일 것.
  ///
  /// In ko, this message translates to:
  /// **'단어'**
  String get wordTerm;

  /// The row of a 단어 칸 choosing whether the word or its meanings show before the reveal.
  ///
  /// In ko, this message translates to:
  /// **'앞면에 보일 것'**
  String get wordAskFirst;

  /// Item of a block's menu in the card editor that deletes the block, and of a sense's menu or a preset's menu that deletes it.
  ///
  /// In ko, this message translates to:
  /// **'삭제'**
  String get deleteBlock;

  /// What a screen reader reads for a 표 block's toolbar over the table.
  ///
  /// In ko, this message translates to:
  /// **'표 도구'**
  String get tableToolbar;

  /// The table toolbar's toggle that makes the selected cell a blank or a plain cell again, shown on or off.
  ///
  /// In ko, this message translates to:
  /// **'빈칸'**
  String get tableBlankToggle;

  /// The table toolbar's button that removes the selected cell's row or column, and the final button of the question it may ask.
  ///
  /// In ko, this message translates to:
  /// **'삭제'**
  String get tableRemove;

  /// Question asked before removing a row of a 표 block that holds text.
  ///
  /// In ko, this message translates to:
  /// **'{row}행을 삭제할까요?'**
  String tableRemoveRowTitle(int row);

  /// Question asked before removing a column of a 표 block that holds text.
  ///
  /// In ko, this message translates to:
  /// **'{column}열을 삭제할까요?'**
  String tableRemoveColumnTitle(int column);

  /// The one sentence of the question asked before removing a row or column of a 표 block that holds text.
  ///
  /// In ko, this message translates to:
  /// **'그 줄에 적은 내용도 함께 삭제돼요.'**
  String get tableRemoveBody;

  /// What a screen reader reads for a column's header field in a 표 block.
  ///
  /// In ko, this message translates to:
  /// **'{column}열 머리글'**
  String tableHeaderCell(int column);

  /// A cell's place in a 표 block, as a screen reader reads it; rows count the table's body from 1.
  ///
  /// In ko, this message translates to:
  /// **'{row}행 {column}열'**
  String tableCell(int row, int column);

  /// Button under a 표 block's grid that adds a row.
  ///
  /// In ko, this message translates to:
  /// **'행 추가'**
  String get addRow;

  /// Button under a 표 block's grid that adds a column.
  ///
  /// In ko, this message translates to:
  /// **'열 추가'**
  String get addColumn;

  /// Item of a 표 block's 삭제 menu that deletes the selected cell's row; a table keeps at least one row.
  ///
  /// In ko, this message translates to:
  /// **'{row}행 삭제'**
  String deleteRow(int row);

  /// Item of a 표 block's 삭제 menu that deletes the selected cell's column; a table keeps at least one column.
  ///
  /// In ko, this message translates to:
  /// **'{column}열 삭제'**
  String deleteColumn(int column);

  /// Error under a 표 block's grid when a table is saved with no blank.
  ///
  /// In ko, this message translates to:
  /// **'빈칸으로 할 칸을 하나 이상 골라 주세요'**
  String get tableBlankRequired;

  /// Error under a 표 block's grid when a cell chosen as a blank holds no text.
  ///
  /// In ko, this message translates to:
  /// **'빈칸으로 고른 칸에 내용을 적어 주세요'**
  String get tableBlankEmpty;

  /// Under a card the card editor shows read-only, because it records a template, or a template version, this build does not know.
  ///
  /// In ko, this message translates to:
  /// **'새 버전의 앱에서 만든 카드라 이 버전에서는 편집할 수 없어요. 앱을 업데이트해 주세요.'**
  String get cardNeedsUpdate;

  /// What a screen reader reads for the deck name at the top of the card editor.
  ///
  /// In ko, this message translates to:
  /// **'{deck} 노트'**
  String cardDeck(String deck);

  /// The card editor's top-bar action that opens the card as study shows it, and that screen's title.
  ///
  /// In ko, this message translates to:
  /// **'미리보기'**
  String get previewCard;

  /// Hint under the preview's card while it shows the front of a card studied front then back.
  ///
  /// In ko, this message translates to:
  /// **'카드를 탭하면 뒷면이 보여요'**
  String get previewTapToBack;

  /// Hint under the preview's card while it shows the back.
  ///
  /// In ko, this message translates to:
  /// **'다시 탭하면 앞면으로 돌아가요'**
  String get previewTapToFront;

  /// Hint under the preview's card while it shows a card studied on one face with its blanks empty.
  ///
  /// In ko, this message translates to:
  /// **'카드를 탭하면 답이 보여요'**
  String get previewTapToReveal;

  /// Hint under the preview's card while it shows a card studied on one face with its blanks filled.
  ///
  /// In ko, this message translates to:
  /// **'다시 탭하면 빈칸으로 돌아가요'**
  String get previewTapToHide;

  /// Hint inside a sense's label field in a 뜻 목록 block, and what a screen reader reads for it while the block is one meaning.
  ///
  /// In ko, this message translates to:
  /// **'라벨'**
  String get senseLabelHint;

  /// What a screen reader reads for the label field of a numbered sense in a 뜻 목록 block.
  ///
  /// In ko, this message translates to:
  /// **'뜻 {number} 라벨'**
  String senseLabelField(int number);

  /// Title of the settings screen of the labels offered above the keyboard, its settings row, and the screen-reader name of that strip.
  ///
  /// In ko, this message translates to:
  /// **'라벨'**
  String get labelPresetsTitle;

  /// The one sentence under the 라벨 screen's title.
  ///
  /// In ko, this message translates to:
  /// **'카드를 만들 때 키보드 위에 이 순서로 나와요.'**
  String get labelPresetsBody;

  /// Button at the end of the label strip above the keyboard that opens the 라벨 screen.
  ///
  /// In ko, this message translates to:
  /// **'관리'**
  String get manageLabelPresets;

  /// The row at the end of the presets on the 라벨 screen that adds one, after a +.
  ///
  /// In ko, this message translates to:
  /// **'라벨 추가'**
  String get addLabelPreset;

  /// Item of a preset's menu, a block's menu or a sense's menu in the card editor, that moves it up one place.
  ///
  /// In ko, this message translates to:
  /// **'위로'**
  String get moveUp;

  /// Item of a preset's menu, a block's menu or a sense's menu in the card editor, that moves it down one place.
  ///
  /// In ko, this message translates to:
  /// **'아래로'**
  String get moveDown;

  /// Screen-reader name of a preset's row, which a tap edits; name may be empty.
  ///
  /// In ko, this message translates to:
  /// **'{label} {name} 편집'**
  String editLabelPreset(String label, String name);

  /// Screen-reader name of a preset's menu on the 라벨 screen, which moves it up or down or deletes it.
  ///
  /// In ko, this message translates to:
  /// **'{label} 메뉴'**
  String labelPresetMenu(String label);

  /// Label of the field of a preset's label, such as 명, while it is edited.
  ///
  /// In ko, this message translates to:
  /// **'라벨'**
  String get labelPresetLabel;

  /// Label of the field of a preset's optional name, such as 명사, while it is edited.
  ///
  /// In ko, this message translates to:
  /// **'이름 (선택)'**
  String get labelPresetName;

  /// Button that ends editing a preset and stores it.
  ///
  /// In ko, this message translates to:
  /// **'완료'**
  String get labelPresetDone;

  /// Error under an empty preset label when its editing is done.
  ///
  /// In ko, this message translates to:
  /// **'라벨을 적어 주세요'**
  String get labelPresetRequired;

  /// Label of a numbered sense's meaning field in a 뜻 목록 block, numbered from 1.
  ///
  /// In ko, this message translates to:
  /// **'뜻 {number}'**
  String senseHeading(int number);

  /// Hint inside the meaning field of a 뜻 목록 block that holds one sense, and what a screen reader reads for it.
  ///
  /// In ko, this message translates to:
  /// **'뜻'**
  String get senseMeaning;

  /// Screen-reader name of a sense's menu in a 뜻 목록 block, which moves the sense up or down or deletes it; numbered from 1.
  ///
  /// In ko, this message translates to:
  /// **'{number}번째 뜻 메뉴'**
  String senseMenu(int number);

  /// Label of the examples field of a sense stored with examples, in a 뜻 목록 block.
  ///
  /// In ko, this message translates to:
  /// **'예문'**
  String get senseExamples;

  /// Hint inside a sense's examples field: one example per line, optional.
  ///
  /// In ko, this message translates to:
  /// **'한 줄에 하나씩, 없으면 비워 두세요'**
  String get senseExamplesHint;

  /// Error under a numbered sense whose meaning is empty when the card is saved.
  ///
  /// In ko, this message translates to:
  /// **'뜻을 적어 주세요'**
  String get senseMeaningRequired;

  /// Button under a 뜻 목록 block's senses that adds a sense.
  ///
  /// In ko, this message translates to:
  /// **'뜻 추가'**
  String get addSense;

  /// The name of a part of speech of the closed list (ADR 0075), by its category.
  ///
  /// In ko, this message translates to:
  /// **'{category, select, noun{명사} verb{동사} adjective{형용사} adverb{부사} pronoun{대명사} preposition{전치사} conjunction{접속사} interjection{감탄사} determiner{관사} numeral{수사} particle{조사} auxiliary{조동사} classifier{양사} phrase{구} other{}}'**
  String partOfSpeechName(String category);

  /// Title of the sheet shown when a card's front duplicates another in the deck.
  ///
  /// In ko, this message translates to:
  /// **'이 노트에 이미 있는 카드예요'**
  String get duplicateTitle;

  /// Line under the duplicate sheet's title: comparing fronts ignores case and spacing.
  ///
  /// In ko, this message translates to:
  /// **'대소문자와 띄어쓰기는 구분하지 않아요.'**
  String get duplicateBody;

  /// Duplicate dialog action that opens the existing card.
  ///
  /// In ko, this message translates to:
  /// **'기존 카드 열기'**
  String get openExistingCard;

  /// Duplicate dialog action that adds the new card anyway.
  ///
  /// In ko, this message translates to:
  /// **'그래도 추가'**
  String get addAnyway;

  /// Duplicate dialog action that saves the edited card anyway.
  ///
  /// In ko, this message translates to:
  /// **'그래도 저장'**
  String get saveAnyway;

  /// Stands in for a content block of a type this version cannot show.
  ///
  /// In ko, this message translates to:
  /// **'[이 버전에서 표시할 수 없는 내용: {type}]'**
  String unsupportedContent(String type);

  /// Shown when the local database fails.
  ///
  /// In ko, this message translates to:
  /// **'기기 저장소를 읽거나 쓰지 못했어요. 다시 시도해 주세요.'**
  String get storageFailure;

  /// Shown when a stored card cannot be read.
  ///
  /// In ko, this message translates to:
  /// **'이 노트에 읽을 수 없는 카드가 있어요.'**
  String get unreadableCard;

  /// Dismisses a dialog without acting.
  ///
  /// In ko, this message translates to:
  /// **'취소'**
  String get cancel;

  /// Confirms a dialog.
  ///
  /// In ko, this message translates to:
  /// **'저장'**
  String get save;

  /// Primary button of the sheet that names a new deck.
  ///
  /// In ko, this message translates to:
  /// **'만들기'**
  String get create;

  /// Deck menu item for renaming.
  ///
  /// In ko, this message translates to:
  /// **'이름 바꾸기'**
  String get rename;

  /// Confirms a deletion.
  ///
  /// In ko, this message translates to:
  /// **'삭제'**
  String get delete;

  /// Answer: the user knew the card. Shown on the current card while it is dragged right, and the name of its screen-reader action.
  ///
  /// In ko, this message translates to:
  /// **'안다'**
  String get know;

  /// Answer: the user did not know the card. Shown on the current card while it is dragged left, and the name of its screen-reader action.
  ///
  /// In ko, this message translates to:
  /// **'모른다'**
  String get dontKnow;

  /// Label of the study screen's close button.
  ///
  /// In ko, this message translates to:
  /// **'닫기'**
  String get close;

  /// Study screen top bar: cards answered so far out of the cards in the session.
  ///
  /// In ko, this message translates to:
  /// **'{answered}/{total}'**
  String studyProgress(int answered, int total);

  /// Accessibility label of the study progress: cards answered out of the cards in the session.
  ///
  /// In ko, this message translates to:
  /// **'{total}장 중 {answered}장 응답함'**
  String studyProgressSemantics(int answered, int total);

  /// Accessibility label of the current card, which shows its front alone.
  ///
  /// In ko, this message translates to:
  /// **'앞면: {front}'**
  String currentCardSemantics(String front);

  /// Accessibility label of a card answered earlier in the session; changed is 'yes' when the answer differs from the one first given.
  ///
  /// In ko, this message translates to:
  /// **'앞면: {front}. 뒷면: {back}. 응답: {answer}{changed, select, yes{. 수정됨} other{}}'**
  String previousCardSemantics(
    String front,
    String back,
    String answer,
    String changed,
  );

  /// Accessibility hint of tapping the card answered just before the current one: it opens the whole card.
  ///
  /// In ko, this message translates to:
  /// **'카드 전체 보기'**
  String get showWholeCard;

  /// Screen-reader action on a card answered earlier as Don't know: changes its answer to Know.
  ///
  /// In ko, this message translates to:
  /// **'안다로 바꾸기'**
  String get changeToKnow;

  /// Screen-reader action on a card answered earlier as Know: changes its answer to Don't know.
  ///
  /// In ko, this message translates to:
  /// **'모른다로 바꾸기'**
  String get changeToDontKnow;

  /// Shown behind a card answered earlier while it is dragged right, toward Know.
  ///
  /// In ko, this message translates to:
  /// **'안다로 바꿔요'**
  String get changingToKnow;

  /// Shown behind a card answered earlier while it is dragged left, toward Don't know.
  ///
  /// In ko, this message translates to:
  /// **'모른다로 바꿔요'**
  String get changingToDontKnow;

  /// In the previous card's empty place, under an up arrow, before a session's first answer when no card of the day was answered earlier: answered cards stack up here.
  ///
  /// In ko, this message translates to:
  /// **'응답한 카드가 여기에 쌓여요'**
  String get previousPlaceholder;

  /// Label on the card in the previous card's place when a session opens on a study day with answers: the last card answered in an earlier session.
  ///
  /// In ko, this message translates to:
  /// **'지난번 마지막 카드'**
  String get earlierCard;

  /// Brief notice under the progress bar when a session opens on a study day that already has cards done: it goes on with the day, with the cards left and the minutes they take.
  ///
  /// In ko, this message translates to:
  /// **'이어서 해요 · 남은 {cards}장 · 약 {minutes}분'**
  String resumeToast(int cards, int minutes);

  /// First step of the study screen's coach: swipe the card right when you know it.
  ///
  /// In ko, this message translates to:
  /// **'알면 오른쪽으로 밀어요'**
  String get studyCoachKnow;

  /// Second step of the study screen's coach: swipe the card left when you don't know it.
  ///
  /// In ko, this message translates to:
  /// **'모르면 왼쪽으로 밀어요'**
  String get studyCoachDontKnow;

  /// Third step of the study screen's coach: an answered card comes up above, and a swipe changes its answer.
  ///
  /// In ko, this message translates to:
  /// **'응답한 카드는 위로 올라와요. 밀어서 응답을 바꿀 수 있어요'**
  String get studyCoachRedecide;

  /// Small text button alone, centred under the study screen's cards, that shows its coach again.
  ///
  /// In ko, this message translates to:
  /// **'안내 다시 보기'**
  String get studyCoachReplay;

  /// Front of the sample answered card the study screen's coach shows in its third step: an English word.
  ///
  /// In ko, this message translates to:
  /// **'deadline'**
  String get studyCoachSampleFront;

  /// Back of the sample answered card the study screen's coach shows in its third step: the word's meaning.
  ///
  /// In ko, this message translates to:
  /// **'마감 기한'**
  String get studyCoachSampleBack;

  /// Shown when an answer could not be written to the local database.
  ///
  /// In ko, this message translates to:
  /// **'응답을 기기에 저장하지 못했어요. 이 카드의 일정은 그대로예요.'**
  String get answerNotSaved;

  /// Shown when the daily study minutes could not be written to the local database.
  ///
  /// In ko, this message translates to:
  /// **'학습 시간을 기기에 저장하지 못했어요. 다시 시도해 주세요.'**
  String get settingNotSaved;

  /// Heading of the completion card, shown in the current card's place once no card is left today.
  ///
  /// In ko, this message translates to:
  /// **'오늘 학습 완료'**
  String get studyComplete;

  /// The study screen when no card is left today and none of its decks' cards was answered today.
  ///
  /// In ko, this message translates to:
  /// **'오늘은 학습할 카드가 없어요'**
  String get nothingToStudyToday;

  /// The completion card's time on screen today, in whole minutes rounded up.
  ///
  /// In ko, this message translates to:
  /// **'{minutes}분'**
  String completionMinutes(int minutes);

  /// The completion card's streak, after a flame icon: study days in a row.
  ///
  /// In ko, this message translates to:
  /// **'{days}일 연속'**
  String completionStreak(int days);

  /// What a screen reader reads for the completion card's line of counts.
  ///
  /// In ko, this message translates to:
  /// **'안다 {know}, 모른다 {dontKnow}, {minutes}분, {days}일 연속'**
  String completionSemantics(int know, int dontKnow, int minutes, int days);

  /// The completion card's primary button: goes on in the same session with the new cards past today's, each answer recorded.
  ///
  /// In ko, this message translates to:
  /// **'학습하기'**
  String get studyOn;

  /// The completion card's line in place of studyOn when no new card is left past today's.
  ///
  /// In ko, this message translates to:
  /// **'더 학습할 카드가 없어요'**
  String get noCardsLeft;

  /// The completion card's quiet button: closes the study screen.
  ///
  /// In ko, this message translates to:
  /// **'그만하기'**
  String get stopStudying;

  /// Shown when the scheduling engine refused a review.
  ///
  /// In ko, this message translates to:
  /// **'이 카드의 다음 복습 일정을 계산하지 못했어요. 일정은 그대로예요.'**
  String get schedulingFailure;

  /// Title of the settings screen.
  ///
  /// In ko, this message translates to:
  /// **'설정'**
  String get accountTitle;

  /// Sign-in screen line under the logo, saying what the app does, in two lines.
  ///
  /// In ko, this message translates to:
  /// **'밀어서 응답하고,\n잊을 때쯤 다시 만나는 암기 카드'**
  String get welcomeBody;

  /// Button that opens Google's account picker to sign in.
  ///
  /// In ko, this message translates to:
  /// **'Google로 계속하기'**
  String get signInWithGoogle;

  /// Disabled sign-in screen button holding the place of Apple sign-in, which is not available yet.
  ///
  /// In ko, this message translates to:
  /// **'Apple로 계속하기 · 준비 중'**
  String get signInWithAppleSoon;

  /// Accessible label of the progress indicator while signing in.
  ///
  /// In ko, this message translates to:
  /// **'로그인 중'**
  String get signingIn;

  /// Account screen text while signed in to an account without an email.
  ///
  /// In ko, this message translates to:
  /// **'로그인했어요'**
  String get signedIn;

  /// Button that signs out.
  ///
  /// In ko, this message translates to:
  /// **'로그아웃'**
  String get signOut;

  /// Accessible label of the progress indicator while signing out.
  ///
  /// In ko, this message translates to:
  /// **'로그아웃 중'**
  String get signingOut;

  /// Shown when signing in or out could not reach the server.
  ///
  /// In ko, this message translates to:
  /// **'서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.'**
  String get accountOffline;

  /// Shown when the app's sign-in configuration is missing or rejected by Google or Supabase.
  ///
  /// In ko, this message translates to:
  /// **'이 앱의 로그인 설정에 문제가 있어 로그인할 수 없어요.'**
  String get accountMisconfigured;

  /// Shown when Google or Supabase refused the sign-in.
  ///
  /// In ko, this message translates to:
  /// **'Google 로그인이 거부됐어요. 다시 시도해 주세요.'**
  String get accountRejected;

  /// Heading of the settings screen section that holds the account's email and sign-out.
  ///
  /// In ko, this message translates to:
  /// **'계정'**
  String get accountSection;

  /// Heading of the settings screen section that holds the theme.
  ///
  /// In ko, this message translates to:
  /// **'화면'**
  String get displaySection;

  /// The settings screen's theme row, with the current choice at its right, and the title of the sheet that chooses 시스템, 라이트 or 다크.
  ///
  /// In ko, this message translates to:
  /// **'테마'**
  String get themeTitle;

  /// Theme choice: follow the device light or dark setting.
  ///
  /// In ko, this message translates to:
  /// **'시스템'**
  String get themeSystem;

  /// Theme choice: always light.
  ///
  /// In ko, this message translates to:
  /// **'라이트'**
  String get themeLight;

  /// Theme choice: always dark.
  ///
  /// In ko, this message translates to:
  /// **'다크'**
  String get themeDark;

  /// Label above the deck rows, with how many decks there are.
  ///
  /// In ko, this message translates to:
  /// **'내 노트 {count}'**
  String myDecks(int count);

  /// How many cards a deck holds, under its name.
  ///
  /// In ko, this message translates to:
  /// **'카드 {count}장'**
  String cardCount(int count);

  /// Chip on a deck row: how many of its cards a session would study now.
  ///
  /// In ko, this message translates to:
  /// **'오늘 {count}'**
  String todayChip(int count);

  /// Sentence under the today count while so many reviews are due that a session takes no new card.
  ///
  /// In ko, this message translates to:
  /// **'밀린 복습을 마칠 때까지 새 카드는 쉬어요.'**
  String get backlogPaused;

  /// Hint of the card list search field.
  ///
  /// In ko, this message translates to:
  /// **'검색'**
  String get searchCards;

  /// Shown when no card matches the card list search.
  ///
  /// In ko, this message translates to:
  /// **'찾는 카드가 없어요. 다른 단어로 검색해 보세요.'**
  String get noMatches;

  /// Editor button that saves the card and opens an empty editor for the next one.
  ///
  /// In ko, this message translates to:
  /// **'저장하고 다음 카드'**
  String get saveAndNext;

  /// Title of the card deletion confirmation.
  ///
  /// In ko, this message translates to:
  /// **'이 카드를 삭제할까요?'**
  String get deleteCardTitle;

  /// Body of the card deletion confirmation: the card review history goes with it.
  ///
  /// In ko, this message translates to:
  /// **'이 카드의 학습 기록도 함께 삭제돼요.'**
  String get deleteCardBody;

  /// Title of the sign-out confirmation shown when some changes could not reach the server: a question.
  ///
  /// In ko, this message translates to:
  /// **'동기화하지 않고 로그아웃할까요?'**
  String get unsyncedChangesTitle;

  /// Body of the sign-out warning: unsynced changes are lost when signing out.
  ///
  /// In ko, this message translates to:
  /// **'동기화되지 않은 변경은 이 기기에서 삭제되고, 다른 기기에서도 볼 수 없어요.'**
  String get unsyncedChangesBody;

  /// Sign-out warning action that signs out despite unsynced changes.
  ///
  /// In ko, this message translates to:
  /// **'그래도 로그아웃'**
  String get signOutAnyway;

  /// Shown when sign-out could not clear the device's data.
  ///
  /// In ko, this message translates to:
  /// **'이 기기의 데이터를 삭제하지 못했어요. 다른 계정으로 로그인하면 삭제돼요.'**
  String get dataNotCleared;

  /// The settings screen's last row, in red, which deletes the account.
  ///
  /// In ko, this message translates to:
  /// **'계정 삭제'**
  String get deleteAccount;

  /// Title of the account deletion confirmation.
  ///
  /// In ko, this message translates to:
  /// **'계정을 삭제할까요?'**
  String get deleteAccountTitle;

  /// Body of the account deletion confirmation: what is removed, and what stays.
  ///
  /// In ko, this message translates to:
  /// **'서버와 이 기기의 노트, 카드, 학습 기록이 모두 삭제되고, 다른 사람이 가져간 노트와 Google 계정은 남아요.'**
  String get deleteAccountBody;

  /// Accessible label of the progress indicator while deleting the account.
  ///
  /// In ko, this message translates to:
  /// **'계정 삭제 중'**
  String get deletingAccount;

  /// Shown when the server refused to delete the account.
  ///
  /// In ko, this message translates to:
  /// **'계정을 삭제하지 못했어요. 다시 시도해 주세요.'**
  String get deleteAccountRejected;

  /// Account screen sync status while a sync runs.
  ///
  /// In ko, this message translates to:
  /// **'동기화 중'**
  String get syncSyncing;

  /// Account screen sync status after a sync finished.
  ///
  /// In ko, this message translates to:
  /// **'동기화됨'**
  String get syncSynced;

  /// Account screen sync status when the server could not be reached; sync retries by itself.
  ///
  /// In ko, this message translates to:
  /// **'오프라인 · 연결되면 동기화해요'**
  String get syncOffline;

  /// Account screen sync status when a sync failed.
  ///
  /// In ko, this message translates to:
  /// **'동기화하지 못했어요'**
  String get syncFailed;

  /// Button that runs sync again after a failure.
  ///
  /// In ko, this message translates to:
  /// **'다시 시도'**
  String get syncRetry;

  /// Title of the sheet on the photo review that chooses the deck the cards go into.
  ///
  /// In ko, this message translates to:
  /// **'추가할 노트'**
  String get photoTargetTitle;

  /// Row of the photo source sheet that opens the system camera.
  ///
  /// In ko, this message translates to:
  /// **'사진 찍기'**
  String get photoCamera;

  /// Row of the photo source sheet that opens the photo library.
  ///
  /// In ko, this message translates to:
  /// **'앨범에서 고르기'**
  String get photoAlbum;

  /// Shown when camera or photo library access is refused.
  ///
  /// In ko, this message translates to:
  /// **'카메라나 앨범 사용이 허용되지 않았어요. 설정에서 허용해 주세요.'**
  String get photoAccessDenied;

  /// Shown when the device has no camera to take the photo with.
  ///
  /// In ko, this message translates to:
  /// **'카메라를 열 수 없어요. 앨범에서 사진을 골라 주세요.'**
  String get cameraUnavailable;

  /// Button that opens this app's page in the system settings, where camera and photo access are allowed.
  ///
  /// In ko, this message translates to:
  /// **'설정 열기'**
  String get openSettings;

  /// Shown when this app's settings page could not be opened.
  ///
  /// In ko, this message translates to:
  /// **'설정을 열지 못했어요. 설정 앱에서 직접 허용해 주세요.'**
  String get settingsNotOpened;

  /// Semantic label of the photo thumbnail while cards are extracted.
  ///
  /// In ko, this message translates to:
  /// **'찍은 사진'**
  String get photoThumbnail;

  /// Title while the photo is sent for extraction.
  ///
  /// In ko, this message translates to:
  /// **'카드를 찾고 있어요'**
  String get extractingTitle;

  /// Privacy note shown while cards are extracted.
  ///
  /// In ko, this message translates to:
  /// **'사진은 카드를 만드는 데만 쓰고 서버에 남기지 않아요'**
  String get extractingNote;

  /// Heading while several photos are read, announced to screen readers: how many photos are read, as the bar under it shows, of how many.
  ///
  /// In ko, this message translates to:
  /// **'사진 {total}장 중 {read}장 읽음'**
  String readingTitle(int read, int total);

  /// Heading once every photo that could be read is read and some failed; each failed photo offers retry or remove.
  ///
  /// In ko, this message translates to:
  /// **'사진 {count}장을 읽지 못했어요'**
  String readingFailed(int count);

  /// Shown before reading when fewer photos are left in today's limit than were picked.
  ///
  /// In ko, this message translates to:
  /// **'오늘 {count}장 더 만들 수 있어요. 처음 {count}장만 읽어요.'**
  String photosLeftToday(int count);

  /// Shown before reading when fewer photos are left in this month's limit, on a plan counted by the calendar month, than were picked.
  ///
  /// In ko, this message translates to:
  /// **'이번 달 {count}장 더 만들 수 있어요. 처음 {count}장만 읽어요.'**
  String photosLeftThisMonth(int count);

  /// One photo of an import, by its place in the order picked.
  ///
  /// In ko, this message translates to:
  /// **'사진 {number}'**
  String photoNumber(int number);

  /// A photo waiting for its turn to be read.
  ///
  /// In ko, this message translates to:
  /// **'기다리는 중'**
  String get photoWaiting;

  /// A photo being read now.
  ///
  /// In ko, this message translates to:
  /// **'읽는 중'**
  String get photoReading;

  /// Leaves a photo that failed out of the import.
  ///
  /// In ko, this message translates to:
  /// **'빼기'**
  String get photoDrop;

  /// Adds more photos to the import, from the camera or the album.
  ///
  /// In ko, this message translates to:
  /// **'사진 더 추가'**
  String get addPhotos;

  /// Title of the confirmation before leaving or retaking a photo import list that holds cards.
  ///
  /// In ko, this message translates to:
  /// **'찾은 카드를 버릴까요?'**
  String get discardImportTitle;

  /// Body of the confirmation before leaving a photo import list: its cards are lost, and reading the photos again counts against today's limit again.
  ///
  /// In ko, this message translates to:
  /// **'찾은 카드 {count}장이 사라져요. 다시 읽으면 오늘 사진 한도가 다시 쓰여요.'**
  String discardImportBody(int count);

  /// Confirms discarding the cards a photo import found.
  ///
  /// In ko, this message translates to:
  /// **'버리기'**
  String get discardImport;

  /// Leaves a screen for the one under it, keeping what the screen was doing.
  ///
  /// In ko, this message translates to:
  /// **'뒤로'**
  String get navigateBack;

  /// Says a new photo import cannot start while one is under way.
  ///
  /// In ko, this message translates to:
  /// **'읽고 있는 사진이 있어요. 끝난 뒤에 새로 가져올 수 있어요.'**
  String get photoImportBusy;

  /// The bar over the tab bar while a photo import reads: the photos read of all.
  ///
  /// In ko, this message translates to:
  /// **'사진 읽는 중 {read}/{total}'**
  String importBarReading(int read, int total);

  /// The bar over the tab bar once a photo import's list waits: how many cards it would add.
  ///
  /// In ko, this message translates to:
  /// **'카드 {count}장 확인하기'**
  String importBarReady(int count);

  /// The bar over the tab bar while a photo import restored from a closed app waits to resume.
  ///
  /// In ko, this message translates to:
  /// **'읽던 사진 {count}장 이어서 읽기'**
  String importBarPaused(int count);

  /// Title of the offer, on opening the app, to resume a photo import a closed app left.
  ///
  /// In ko, this message translates to:
  /// **'읽던 사진 {count}장을 이어서 읽을까요?'**
  String resumeImportTitle(int count);

  /// Body of the offer to resume a photo import: photos already read are not sent again.
  ///
  /// In ko, this message translates to:
  /// **'이미 읽은 사진은 다시 보내지 않아요.'**
  String get resumeImportBody;

  /// Resumes a photo import a closed app left.
  ///
  /// In ko, this message translates to:
  /// **'이어서 읽기'**
  String get resumeImport;

  /// Screen reader name of a photo import thumbnail, which opens the photo full screen.
  ///
  /// In ko, this message translates to:
  /// **'사진 {number} 크게 보기'**
  String photoView(int number);

  /// Heading of the full-screen photo viewer: the photo shown and how many the import holds.
  ///
  /// In ko, this message translates to:
  /// **'사진 {current}/{total}'**
  String photoViewerTitle(int current, int total);

  /// Duplicate option: write nothing for this candidate.
  ///
  /// In ko, this message translates to:
  /// **'건너뛰기'**
  String get duplicateSkip;

  /// Duplicate option: append this back to the existing card's back.
  ///
  /// In ko, this message translates to:
  /// **'뒷면 합치기'**
  String get duplicateMergeBack;

  /// Duplicate option: add this candidate as a separate card.
  ///
  /// In ko, this message translates to:
  /// **'새 카드로 추가'**
  String get duplicateAddNew;

  /// Button that offers the camera and the album again for a new photo.
  ///
  /// In ko, this message translates to:
  /// **'다시 찍기'**
  String get retake;

  /// Takes another photo from the album, on photo import's list and failure screens, when the photo came from the album.
  ///
  /// In ko, this message translates to:
  /// **'다른 사진 고르기'**
  String get pickAnother;

  /// Button that sends the same photo again.
  ///
  /// In ko, this message translates to:
  /// **'다시 시도'**
  String get retry;

  /// Button that sends again every photo of the import whose failure a retry can help.
  ///
  /// In ko, this message translates to:
  /// **'실패한 사진 다시 시도'**
  String get retryFailedPhotos;

  /// Photo import failure: the server could not be reached.
  ///
  /// In ko, this message translates to:
  /// **'인터넷에 연결되지 않았어요. 연결을 확인하고 다시 시도해 주세요.'**
  String get extractionOffline;

  /// Photo import failure: the photo was too large or of an unsupported type.
  ///
  /// In ko, this message translates to:
  /// **'이 사진은 보낼 수 없어요. 다시 찍거나 다른 사진을 골라 주세요.'**
  String get photoRefused;

  /// Photo import failure: the model found no card on the page.
  ///
  /// In ko, this message translates to:
  /// **'카드를 찾지 못했어요. 더 밝고 반듯하게 찍어 보세요.'**
  String get noCardsFound;

  /// Shown when a suspended account tries to sign in or make cards from a photo.
  ///
  /// In ko, this message translates to:
  /// **'이 계정은 이용이 정지됐어요. 문의는 sauce@garam.sh로 보내 주세요.'**
  String get accountSuspended;

  /// Photo import failure: the user's plan's daily extraction limit, which the server states, was reached.
  ///
  /// In ko, this message translates to:
  /// **'오늘 사진으로 만들 수 있는 {limit}장을 다 썼어요. 내일 다시 시도해 주세요.'**
  String dailyLimitReachedOf(int limit);

  /// Photo import failure: the user's plan's monthly extraction limit, which the server states, was reached; it resets on the 1st at 00:00 Korean time.
  ///
  /// In ko, this message translates to:
  /// **'이번 달 사진으로 만들 수 있는 {limit}장을 다 썼어요. 다음 달 1일에 다시 시도해 주세요.'**
  String monthlyLimitReachedOf(int limit);

  /// Photo import failure: the model failed.
  ///
  /// In ko, this message translates to:
  /// **'카드를 읽지 못했어요. 잠시 후 다시 시도해 주세요.'**
  String get modelFailed;

  /// Photo import failure: no session, or one the server refused.
  ///
  /// In ko, this message translates to:
  /// **'로그인이 필요해요. 설정에서 다시 로그인해 주세요.'**
  String get signInRequired;

  /// Photo import failure: the server answered unexpectedly.
  ///
  /// In ko, this message translates to:
  /// **'지금은 사진으로 카드를 만들 수 없어요. 잠시 후 다시 시도해 주세요.'**
  String get serviceFailed;

  /// Photo import failure: the file is not an image the app reads.
  ///
  /// In ko, this message translates to:
  /// **'이 사진을 읽을 수 없어요. 다른 사진을 골라 주세요.'**
  String get photoUnreadable;

  /// Photo import failure: the photo could not be written to the device or read back from it.
  ///
  /// In ko, this message translates to:
  /// **'이 사진을 기기에 보관하지 못했어요. 저장 공간을 확인하고 다시 골라 주세요.'**
  String get photoNotKept;

  /// Shown when cards are saved into a deck that was deleted meanwhile, such as on another device.
  ///
  /// In ko, this message translates to:
  /// **'이 노트는 삭제됐어요. 다른 노트를 골라 주세요.'**
  String get deckDeleted;

  /// Opens other users' public decks; also the title of that screen.
  ///
  /// In ko, this message translates to:
  /// **'공개 노트'**
  String get browse;

  /// Deck menu item that publishes the deck.
  ///
  /// In ko, this message translates to:
  /// **'노트 공개'**
  String get publish;

  /// Deck menu item that makes a public deck private.
  ///
  /// In ko, this message translates to:
  /// **'비공개로 전환'**
  String get unpublish;

  /// Why publishing is disabled: the device is offline.
  ///
  /// In ko, this message translates to:
  /// **'인터넷에 연결되면 바꿀 수 있어요'**
  String get publishNeedsNetwork;

  /// Chip beside a deck the user has published.
  ///
  /// In ko, this message translates to:
  /// **'공개'**
  String get publicChip;

  /// Hint of the search field on the browse screen.
  ///
  /// In ko, this message translates to:
  /// **'노트 이름이나 설명으로 검색'**
  String get searchPublicDecks;

  /// Browse sort: most recently published first.
  ///
  /// In ko, this message translates to:
  /// **'최신순'**
  String get sortNewest;

  /// Browse sort: most copied first.
  ///
  /// In ko, this message translates to:
  /// **'가져오기 많은 순'**
  String get sortMostCopied;

  /// A public deck's owner display name, card count and copy count.
  ///
  /// In ko, this message translates to:
  /// **'{owner} · 카드 {cards}장 · 가져오기 {copies}회'**
  String publicDeckLine(String owner, int cards, int copies);

  /// Browse screen with no public deck.
  ///
  /// In ko, this message translates to:
  /// **'아직 공개된 노트가 없어요. 내 노트를 공개해 처음으로 나눠 보세요.'**
  String get noPublicDecks;

  /// Browse search with no match.
  ///
  /// In ko, this message translates to:
  /// **'찾는 노트가 없어요. 다른 단어로 검색해 보세요.'**
  String get noPublicMatches;

  /// Browse screen while offline.
  ///
  /// In ko, this message translates to:
  /// **'인터넷에 연결되지 않았어요. 연결되면 공개 노트를 볼 수 있어요.'**
  String get browseOffline;

  /// Label of a progress indicator.
  ///
  /// In ko, this message translates to:
  /// **'불러오는 중'**
  String get loading;

  /// Sharing failure: the server could not be reached.
  ///
  /// In ko, this message translates to:
  /// **'인터넷에 연결되지 않았어요. 연결을 확인하고 다시 시도해 주세요.'**
  String get sharingOffline;

  /// Sharing failure: the server refused the session or the request.
  ///
  /// In ko, this message translates to:
  /// **'요청이 거절됐어요. 설정에서 다시 로그인한 뒤 시도해 주세요.'**
  String get sharingRejected;

  /// Sharing failure: the server answered unexpectedly.
  ///
  /// In ko, this message translates to:
  /// **'지금은 처리할 수 없어요. 잠시 후 다시 시도해 주세요.'**
  String get sharingFailed;

  /// Copying a deck its owner made private, deleted, or that was hidden.
  ///
  /// In ko, this message translates to:
  /// **'이 노트는 더 이상 공개되어 있지 않아요.'**
  String get deckNoLongerPublic;

  /// Primary button of a public deck, and title of the sheet it opens.
  ///
  /// In ko, this message translates to:
  /// **'내 노트로 가져오기'**
  String get copyToMyDecks;

  /// Below a public deck's preview when it holds more cards than shown.
  ///
  /// In ko, this message translates to:
  /// **'카드 {total}장 중 처음 {shown}장'**
  String previewFirstCards(int shown, int total);

  /// Public deck menu item that opens the report sheet.
  ///
  /// In ko, this message translates to:
  /// **'노트 신고'**
  String get reportDeck;

  /// The report sheet's final button, which sends the report.
  ///
  /// In ko, this message translates to:
  /// **'신고'**
  String get reportConfirm;

  /// Menu item that blocks a public deck's owner.
  ///
  /// In ko, this message translates to:
  /// **'이 사용자 차단'**
  String get blockUser;

  /// Title of the report dialog.
  ///
  /// In ko, this message translates to:
  /// **'신고 이유'**
  String get reportTitle;

  /// Report reason.
  ///
  /// In ko, this message translates to:
  /// **'부적절한 내용'**
  String get reportInappropriate;

  /// Report reason.
  ///
  /// In ko, this message translates to:
  /// **'스팸'**
  String get reportSpam;

  /// Report reason.
  ///
  /// In ko, this message translates to:
  /// **'저작권 침해'**
  String get reportCopyright;

  /// Report reason.
  ///
  /// In ko, this message translates to:
  /// **'기타'**
  String get reportOther;

  /// After a report was filed.
  ///
  /// In ko, this message translates to:
  /// **'신고했어요. 검토할게요.'**
  String get reported;

  /// After a second report of the same deck.
  ///
  /// In ko, this message translates to:
  /// **'이미 신고한 노트예요.'**
  String get alreadyReported;

  /// Title of the block confirmation.
  ///
  /// In ko, this message translates to:
  /// **'{name} 님을 차단할까요?'**
  String blockTitle(String name);

  /// Body of the block confirmation.
  ///
  /// In ko, this message translates to:
  /// **'이 사용자의 노트가 공개 노트에 더 이상 나오지 않아요.'**
  String get blockBody;

  /// Confirms blocking a user.
  ///
  /// In ko, this message translates to:
  /// **'차단'**
  String get block;

  /// After a user was blocked.
  ///
  /// In ko, this message translates to:
  /// **'{name} 님을 차단했어요.'**
  String blocked(String name);

  /// Copy option: into a new deck.
  ///
  /// In ko, this message translates to:
  /// **'새 노트로'**
  String get copyAsNewDeck;

  /// Copy option: into one of the user's decks.
  ///
  /// In ko, this message translates to:
  /// **'기존 노트에 추가'**
  String get copyIntoExistingDeck;

  /// What copying into a new deck does.
  ///
  /// In ko, this message translates to:
  /// **'\"{name}\" 노트를 새로 만들어 모든 카드를 가져와요.'**
  String copyNewDeckHint(String name);

  /// Label of the deck chooser when copying into a deck.
  ///
  /// In ko, this message translates to:
  /// **'노트'**
  String get copyTargetDeck;

  /// Heading of the duplicate options when copying into a deck.
  ///
  /// In ko, this message translates to:
  /// **'이미 있는 카드는'**
  String get copyDuplicates;

  /// Button that copies a public deck.
  ///
  /// In ko, this message translates to:
  /// **'가져오기'**
  String get copyConfirm;

  /// After copying a public deck: how many cards were added or merged, and into which deck.
  ///
  /// In ko, this message translates to:
  /// **'{count, plural, =0{\"{deck}\"에 새로 가져온 카드가 없어요} other{\"{deck}\"에 카드 {count}장을 가져왔어요}}'**
  String copiedCards(String deck, int count);

  /// Title of the publish sheet.
  ///
  /// In ko, this message translates to:
  /// **'\"{name}\" 공개'**
  String publishTitle(String name);

  /// Label of the display name field.
  ///
  /// In ko, this message translates to:
  /// **'공개 이름'**
  String get displayName;

  /// Help below the display name field.
  ///
  /// In ko, this message translates to:
  /// **'공개한 노트에 이 이름이 표시돼요. 이메일은 표시되지 않아요.'**
  String get displayNameHelp;

  /// Error for a display name of the wrong length.
  ///
  /// In ko, this message translates to:
  /// **'2~20자로 입력해 주세요'**
  String get displayNameLength;

  /// Label of the description field when publishing.
  ///
  /// In ko, this message translates to:
  /// **'설명 (선택)'**
  String get deckDescription;

  /// Error for a description that is too long.
  ///
  /// In ko, this message translates to:
  /// **'{max}자 이내로 입력해 주세요'**
  String deckDescriptionTooLong(int max);

  /// Agreement checkbox the publish button requires.
  ///
  /// In ko, this message translates to:
  /// **'부적절하거나 저작권을 침해하는 내용은 공개하지 않을게요'**
  String get publishAgreement;

  /// Button that publishes a deck.
  ///
  /// In ko, this message translates to:
  /// **'공개'**
  String get publishConfirm;

  /// After a deck was published.
  ///
  /// In ko, this message translates to:
  /// **'노트를 공개했어요'**
  String get published;

  /// After a deck was made private.
  ///
  /// In ko, this message translates to:
  /// **'노트를 비공개로 전환했어요'**
  String get unpublished;

  /// 오늘 tab heading while the user has decks but no card in any.
  ///
  /// In ko, this message translates to:
  /// **'첫 카드를 만들어 볼까요?'**
  String get noCardsTitle;

  /// Button on the 오늘 tab's no-cards state, with several decks, that shows the 노트 tab.
  ///
  /// In ko, this message translates to:
  /// **'노트에서 카드 추가'**
  String get addCardsInDecks;

  /// Home screen heading before the user has any deck.
  ///
  /// In ko, this message translates to:
  /// **'첫 노트를 만들어 볼까요?'**
  String get emptyHomeTitle;

  /// The new-deck and add-card sheets' row that starts by typing: a deck named by hand, or a card in the editor.
  ///
  /// In ko, this message translates to:
  /// **'직접 입력'**
  String get createManually;

  /// Empty home screen button that opens the public decks.
  ///
  /// In ko, this message translates to:
  /// **'공개 노트 둘러보기'**
  String get browsePublicDecks;

  /// The entry that opens the new-deck sheet: the 노트 tab's button under the rows and the first-run home's primary.
  ///
  /// In ko, this message translates to:
  /// **'새 노트 만들기'**
  String get newDeckTitle;

  /// Sign-in screen note under the buttons; terms and privacy are the links termsOfService and privacyPolicy.
  ///
  /// In ko, this message translates to:
  /// **'계속하면 {terms}과 {privacy}에 동의하는 것으로 봐요.'**
  String consentNotice(String terms, String privacy);

  /// Link to the terms of service.
  ///
  /// In ko, this message translates to:
  /// **'이용약관'**
  String get termsOfService;

  /// Link to the privacy policy.
  ///
  /// In ko, this message translates to:
  /// **'개인정보 처리방침'**
  String get privacyPolicy;

  /// Shown when the terms or privacy link could not be opened.
  ///
  /// In ko, this message translates to:
  /// **'링크를 열지 못했어요. 다시 시도해 주세요.'**
  String get linkNotOpened;

  /// Account screen footer: the app's version.
  ///
  /// In ko, this message translates to:
  /// **'버전 {version}'**
  String appVersion(String version);

  /// Today card when no card is due or new now; todayStudy is its button.
  ///
  /// In ko, this message translates to:
  /// **'오늘 할 카드를 다 했어요'**
  String get todayDone;

  /// The today card's button when no card is left today: opens the study screen over every deck, on the new cards past today's or on nothing to study.
  ///
  /// In ko, this message translates to:
  /// **'학습하기'**
  String get todayStudy;

  /// The bottom bar's third tab: the study record.
  ///
  /// In ko, this message translates to:
  /// **'기록'**
  String get tabRecord;

  /// What a screen reader calls the bottom bar of tabs.
  ///
  /// In ko, this message translates to:
  /// **'탭'**
  String get tabsLabel;

  /// The hint in the decks tab's search field, which filters decks by name.
  ///
  /// In ko, this message translates to:
  /// **'노트 검색'**
  String get searchDecks;

  /// The decks tab when no deck name holds the search.
  ///
  /// In ko, this message translates to:
  /// **'찾는 노트가 없어요. 다른 단어로 검색해 보세요.'**
  String get noDeckMatches;

  /// Under a deck row's name and on the deck page's today card, over the progress bar: how many of the deck's cards are mastered (interval of 21 days or more).
  ///
  /// In ko, this message translates to:
  /// **'{cards}장 중 {mastered}장 익힘'**
  String deckMastered(int cards, int mastered);

  /// Under a deck row's name on the 노트 tab while its progress is read, and for a deck with no card: how many cards the deck holds.
  ///
  /// In ko, this message translates to:
  /// **'{count}장'**
  String deckRowCards(int count);

  /// What a screen reader reads for a progress bar of mastered, learning and new cards.
  ///
  /// In ko, this message translates to:
  /// **'익힘 {mastered}장, 학습 중 {learning}장, 새 카드 {fresh}장'**
  String progressSemantics(int mastered, int learning, int fresh);

  /// The deck page's top bar button that opens the card search.
  ///
  /// In ko, this message translates to:
  /// **'카드 검색'**
  String get searchCardsAction;

  /// The button that closes the deck page's card search.
  ///
  /// In ko, this message translates to:
  /// **'검색 닫기'**
  String get closeSearch;

  /// The label of the deck page's switch that shows or hides every card's back after its front; it stays the same while the switch shows its state.
  ///
  /// In ko, this message translates to:
  /// **'뒷면 보기'**
  String get showMeanings;

  /// What a screen reader reads for a card row whose back is hidden.
  ///
  /// In ko, this message translates to:
  /// **'{front}, 뒷면 가려짐'**
  String cardBackHidden(String front);

  /// What a screen reader reads for a card row whose back is shown.
  ///
  /// In ko, this message translates to:
  /// **'{front}, 뒷면 {back}'**
  String cardBackShown(String front, String back);

  /// A streak chip: study days in a row with an answer.
  ///
  /// In ko, this message translates to:
  /// **'{days}일 연속'**
  String streakDays(int days);

  /// A day chart's label for today: the last seven days' and the catch-up's.
  ///
  /// In ko, this message translates to:
  /// **'오늘'**
  String get dayToday;

  /// The catch-up's label and the next review's word for tomorrow.
  ///
  /// In ko, this message translates to:
  /// **'내일'**
  String get dayTomorrow;

  /// On the done card: when the next cards fall due, how many, and their minutes.
  ///
  /// In ko, this message translates to:
  /// **'다음 복습은 {day} · {cards}장, 약 {minutes}분'**
  String nextReview(String day, int cards, int minutes);

  /// On the done card when no card falls due in the next seven days.
  ///
  /// In ko, this message translates to:
  /// **'앞으로 7일 동안 복습할 카드가 없어요'**
  String get noNextReview;

  /// Heading of the today card in a backlog.
  ///
  /// In ko, this message translates to:
  /// **'다시 시작하면 돼요'**
  String get backlogTitle;

  /// Under the backlog heading: how many reviews are overdue, in what order, and that new cards pause.
  ///
  /// In ko, this message translates to:
  /// **'밀린 복습 {count}장을 급한 것부터 해요. 새 카드는 잠시 쉬어요.'**
  String backlogBody(int count);

  /// The 기록 tab's period selector, as a screen reader names it.
  ///
  /// In ko, this message translates to:
  /// **'기간'**
  String get statsPeriod;

  /// The period of the last 7 study days.
  ///
  /// In ko, this message translates to:
  /// **'7일'**
  String get statsPeriodWeek;

  /// The period of the last 30 study days.
  ///
  /// In ko, this message translates to:
  /// **'30일'**
  String get statsPeriodMonth;

  /// The period of every study day.
  ///
  /// In ko, this message translates to:
  /// **'전체'**
  String get statsPeriodAll;

  /// Over the retention figure: the share of scheduled reviews answered 안다.
  ///
  /// In ko, this message translates to:
  /// **'복습에서 맞힌 비율'**
  String get retentionTitle;

  /// A percentage figure on the 기록 tab.
  ///
  /// In ko, this message translates to:
  /// **'{percent}%'**
  String retentionPercent(int percent);

  /// The chip when retention is below the target, by whole percentage points.
  ///
  /// In ko, this message translates to:
  /// **'목표보다 {points}% 낮아요'**
  String retentionBelow(int points);

  /// The chip when retention is above the target, by whole percentage points.
  ///
  /// In ko, this message translates to:
  /// **'목표보다 {points}% 높아요'**
  String retentionAbove(int points);

  /// The chip when retention equals the target.
  ///
  /// In ko, this message translates to:
  /// **'목표만큼 맞혔어요'**
  String get retentionOnTarget;

  /// The label on the chart's dashed target line.
  ///
  /// In ko, this message translates to:
  /// **'목표 {percent}%'**
  String retentionTargetLine(int percent);

  /// Under the chart's left end: the period's first day.
  ///
  /// In ko, this message translates to:
  /// **'{days}일 전'**
  String retentionDaysAgo(int days);

  /// Under the chart's right end: today.
  ///
  /// In ko, this message translates to:
  /// **'오늘'**
  String get statsToday;

  /// The retention card when the period holds no scheduled review.
  ///
  /// In ko, this message translates to:
  /// **'이 기간에 복습한 카드가 없어요.'**
  String get retentionEmpty;

  /// What a screen reader reads for the retention chart, before each day and its share.
  ///
  /// In ko, this message translates to:
  /// **'복습에서 맞힌 비율, 목표 {target}%: {days}'**
  String retentionSemantics(int target, String days);

  /// One day of the retention chart as a screen reader reads it.
  ///
  /// In ko, this message translates to:
  /// **'{date} {percent}%'**
  String retentionDay(String date, int percent);

  /// Heading of the recall bands: how well the cards are remembered now.
  ///
  /// In ko, this message translates to:
  /// **'기억 상태'**
  String get recallTitle;

  /// Beside the recall heading: the mean probability of recall.
  ///
  /// In ko, this message translates to:
  /// **'평균 {percent}%'**
  String recallMean(int percent);

  /// The band of cards recalled with at least 95% probability.
  ///
  /// In ko, this message translates to:
  /// **'좋음'**
  String get recallStrong;

  /// The band of cards recalled with 80% up to 95% probability.
  ///
  /// In ko, this message translates to:
  /// **'보통'**
  String get recallFair;

  /// The band of cards recalled with below 80% probability.
  ///
  /// In ko, this message translates to:
  /// **'곧 잊음'**
  String get recallFading;

  /// A count of cards on the 기록 tab.
  ///
  /// In ko, this message translates to:
  /// **'{count}장'**
  String statsCards(int count);

  /// What a screen reader reads for the recall bar.
  ///
  /// In ko, this message translates to:
  /// **'{total}장 중 좋음 {strong}장, 보통 {fair}장, 곧 잊음 {fading}장, 평균 {mean}%'**
  String recallSemantics(int total, int strong, int fair, int fading, int mean);

  /// The recall card before any card has a stored review.
  ///
  /// In ko, this message translates to:
  /// **'아직 복습한 카드가 없어요.'**
  String get recallEmpty;

  /// Heading of the mastered cards per week.
  ///
  /// In ko, this message translates to:
  /// **'익힌 카드'**
  String get masteredTitle;

  /// Beside the mastered heading: how many more cards are mastered than at the end of the chart's first week, as many weeks ago as its first label says.
  ///
  /// In ko, this message translates to:
  /// **'{weeks}주 전보다 +{count}장'**
  String masteredGain(int weeks, int count);

  /// What a screen reader reads for the mastered bars, before each week's count.
  ///
  /// In ko, this message translates to:
  /// **'주별 익힌 카드, 7주 전부터 이번 주까지: {counts}'**
  String masteredSemantics(String counts);

  /// Heading of the study-day heatmap.
  ///
  /// In ko, this message translates to:
  /// **'학습한 날'**
  String get studyDaysTitle;

  /// Beside the heatmap heading: the current and the best streak.
  ///
  /// In ko, this message translates to:
  /// **'{current}일 연속 · 최고 {best}일'**
  String studyDaysStreak(int current, int best);

  /// Under the mastered cards' bars, at the first: how many weeks before this one it ends.
  ///
  /// In ko, this message translates to:
  /// **'{weeks}주 전'**
  String masteredWeeksAgo(int weeks);

  /// Under the mastered cards' bars, at the last: this week.
  ///
  /// In ko, this message translates to:
  /// **'이번 주'**
  String get masteredThisWeek;

  /// The study days' shade key, before its palest shade.
  ///
  /// In ko, this message translates to:
  /// **'적게'**
  String get studyDaysFewer;

  /// The study days' shade key, after its darkest shade.
  ///
  /// In ko, this message translates to:
  /// **'많이'**
  String get studyDaysMore;

  /// What a screen reader reads for the heatmap, before each studied day and its cards.
  ///
  /// In ko, this message translates to:
  /// **'최근 12주 동안 {count}일 학습했어요: {days}'**
  String studyDaysSemantics(int count, String days);

  /// What a screen reader reads for the heatmap with no studied day.
  ///
  /// In ko, this message translates to:
  /// **'최근 12주 동안 학습한 날이 없어요'**
  String get studyDaysNone;

  /// One studied day of the heatmap as a screen reader reads it.
  ///
  /// In ko, this message translates to:
  /// **'{date} {count}장'**
  String studyDay(String date, int count);

  /// The mastered card while no card was mastered in any of the eight weeks.
  ///
  /// In ko, this message translates to:
  /// **'아직 익힌 카드가 없어요.'**
  String get masteredEmpty;

  /// Title of the photo import list when every card is a vocabulary entry; the add button below counts the cards.
  ///
  /// In ko, this message translates to:
  /// **'단어를 찾았어요'**
  String get importTitleWords;

  /// Title of the photo import list for a notes page: how many cards were made.
  ///
  /// In ko, this message translates to:
  /// **'카드 {count}장을 만들었어요'**
  String importTitleCards(int count);

  /// Line under the import list title naming the deck the cards go into; the name opens the deck chooser.
  ///
  /// In ko, this message translates to:
  /// **'노트 \'{name}\'에 추가돼요'**
  String importDeck(String name);

  /// Line under the import list title while no deck is chosen: the cards go into a deck made on saving; name is newDeck, and opens the deck chooser.
  ///
  /// In ko, this message translates to:
  /// **'{name}에 추가돼요'**
  String importNewDeck(String name);

  /// The import list button that saves the cards, counting each form.
  ///
  /// In ko, this message translates to:
  /// **'카드 {count}장 추가'**
  String importAdd(int count);

  /// Header of a section of the import list: its topic and row count.
  ///
  /// In ko, this message translates to:
  /// **'{topic} {count}'**
  String importSection(String topic, int count);

  /// Title of a section holding a topic's identify cards.
  ///
  /// In ko, this message translates to:
  /// **'판별 · {topic}'**
  String importIdentifySection(String topic);

  /// Vocabulary section form: the word on the front, its meaning on the back.
  ///
  /// In ko, this message translates to:
  /// **'앞면에 단어'**
  String get importForward;

  /// Vocabulary section form: the meaning on the front, the word on the back.
  ///
  /// In ko, this message translates to:
  /// **'앞면에 뜻'**
  String get importBackward;

  /// Vocabulary section menu item: a card with the word on the front and one with the meaning on the front.
  ///
  /// In ko, this message translates to:
  /// **'양쪽 방향 모두'**
  String get importBoth;

  /// Vocabulary section header's form when cards go both ways.
  ///
  /// In ko, this message translates to:
  /// **'양쪽 방향'**
  String get importBothShort;

  /// Menu item: keep only the first meaning on each card.
  ///
  /// In ko, this message translates to:
  /// **'첫 뜻만'**
  String get importFirstSense;

  /// Menu item: show each meaning's labels.
  ///
  /// In ko, this message translates to:
  /// **'라벨 표시'**
  String get importShowPos;

  /// Menu item: show the pronunciation under the word.
  ///
  /// In ko, this message translates to:
  /// **'발음 표시'**
  String get importShowPronunciation;

  /// Menu item: show the extras, such as synonyms, after the meanings.
  ///
  /// In ko, this message translates to:
  /// **'유의어 등 표시'**
  String get importShowExtras;

  /// Note section form: the question on the front, as made.
  ///
  /// In ko, this message translates to:
  /// **'앞면에 질문'**
  String get importNoteForward;

  /// Note section form: the answer on the front, the question on the back.
  ///
  /// In ko, this message translates to:
  /// **'앞면에 답'**
  String get importNoteSwapped;

  /// Note section menu item: swap the front and back of the section's cards.
  ///
  /// In ko, this message translates to:
  /// **'앞면과 뒷면 바꾸기'**
  String get importSwap;

  /// Menu item: leave out every card of the section.
  ///
  /// In ko, this message translates to:
  /// **'이 묶음 빼기'**
  String get importDropSection;

  /// Menu item: include every card of the section.
  ///
  /// In ko, this message translates to:
  /// **'이 묶음 넣기'**
  String get importKeepSection;

  /// Screen reader label of a section's form menu button.
  ///
  /// In ko, this message translates to:
  /// **'{topic} 카드 모양, {form}'**
  String importFormMenu(String topic, String form);

  /// Screen reader label of an import row.
  ///
  /// In ko, this message translates to:
  /// **'{front}, {back}. 눌러서 편집해요'**
  String importRow(String front, String back);

  /// Screen reader label of a row's check.
  ///
  /// In ko, this message translates to:
  /// **'{front} 넣기'**
  String importInclude(String front);

  /// Label under a row swiped left.
  ///
  /// In ko, this message translates to:
  /// **'빼기'**
  String get importRemove;

  /// Note under a row the deck already holds.
  ///
  /// In ko, this message translates to:
  /// **'이미 노트에 있어요'**
  String get importInDeck;

  /// Title of the sheet that edits one card.
  ///
  /// In ko, this message translates to:
  /// **'카드 편집'**
  String get editTitle;

  /// Field label: the front of a card.
  ///
  /// In ko, this message translates to:
  /// **'앞면'**
  String get editFront;

  /// Field label: the back of a note card.
  ///
  /// In ko, this message translates to:
  /// **'뒷면'**
  String get editBack;

  /// Label over the meanings of a vocabulary card in the edit sheet.
  ///
  /// In ko, this message translates to:
  /// **'뜻'**
  String get editSenses;

  /// Field label of one meaning in the edit sheet.
  ///
  /// In ko, this message translates to:
  /// **'{number}번째 뜻'**
  String editSense(int number);

  /// Screen reader label of a meaning's check in the edit sheet.
  ///
  /// In ko, this message translates to:
  /// **'{number}번째 뜻 넣기'**
  String editKeepSense(int number);

  /// Screen-reader name of a meaning's ⋯ menu in the edit sheet, which moves it up or down.
  ///
  /// In ko, this message translates to:
  /// **'{number}번째 뜻 메뉴'**
  String editMoveSense(int number);

  /// The edit sheet button that applies the edits.
  ///
  /// In ko, this message translates to:
  /// **'완료'**
  String get editDone;

  /// What a screen reader reads for the coach: its step of how many.
  ///
  /// In ko, this message translates to:
  /// **'사용 방법, {total}단계 중 {step}단계'**
  String coachStep(int step, int total);

  /// Button that ends the review screen's coach.
  ///
  /// In ko, this message translates to:
  /// **'건너뛰기'**
  String get coachSkip;

  /// Button that moves the review screen's coach to its next step.
  ///
  /// In ko, this message translates to:
  /// **'다음'**
  String get coachNext;

  /// Button on the coach's last step, which ends it.
  ///
  /// In ko, this message translates to:
  /// **'시작하기'**
  String get coachStart;

  /// The title of the sheet that changes the daily study minutes, and the account screen's row.
  ///
  /// In ko, this message translates to:
  /// **'하루 학습 시간'**
  String get dailyMinutesTitle;

  /// The title of the daily study minutes sheet when it shows once as a first-run step.
  ///
  /// In ko, this message translates to:
  /// **'하루 몇 분 학습할까요?'**
  String get dailyMinutesFirstTitle;

  /// The daily study minutes sheet's one sentence: how the minutes are used.
  ///
  /// In ko, this message translates to:
  /// **'복습을 먼저 하고, 남는 시간에 새 카드를 시작해요.'**
  String get dailyMinutesBody;

  /// A choice of daily study minutes in the sheet, and the account row's value.
  ///
  /// In ko, this message translates to:
  /// **'{minutes}분'**
  String dailyMinutesChoice(int minutes);

  /// Tooltip of the button that lowers the custom minutes by 5.
  ///
  /// In ko, this message translates to:
  /// **'5분 줄이기'**
  String get dailyMinutesLess;

  /// Tooltip of the button that raises the custom minutes by 5.
  ///
  /// In ko, this message translates to:
  /// **'5분 늘리기'**
  String get dailyMinutesMore;

  /// The sheet's preview when the reviews fill the chosen minutes.
  ///
  /// In ko, this message translates to:
  /// **'이 시간은 복습으로 차서 새 카드는 시작하지 않아요'**
  String get dailyMinutesNoTime;

  /// The sheet's preview when no card is left unstarted.
  ///
  /// In ko, this message translates to:
  /// **'새 카드를 모두 시작했어요'**
  String get dailyMinutesAllStarted;

  /// The first-run step's button that keeps the default minutes.
  ///
  /// In ko, this message translates to:
  /// **'건너뛰기'**
  String get dailyMinutesSkip;

  /// The settings screen's section label over the daily study minutes, the front sound's autoplay and the labels.
  ///
  /// In ko, this message translates to:
  /// **'학습'**
  String get settingsStudy;

  /// The study top bar's count of the cards studied past the day's plan, beside the day's count.
  ///
  /// In ko, this message translates to:
  /// **'추가 {count}장'**
  String studyExtra(int count);

  /// What a screen reader reads for the top bar's count of cards past the day's plan.
  ///
  /// In ko, this message translates to:
  /// **'오늘 계획 밖으로 {count}장 더 학습함'**
  String studyExtraSemantics(int count);

  /// After the daily study minutes' large number.
  ///
  /// In ko, this message translates to:
  /// **'분'**
  String get dailyMinutesUnit;

  /// What a screen reader reads for the large number, which opens the keypad.
  ///
  /// In ko, this message translates to:
  /// **'하루 {minutes}분, 눌러서 직접 입력'**
  String dailyMinutesNumberSemantics(int minutes);

  /// The label a screen reader reads for the number while it is typed.
  ///
  /// In ko, this message translates to:
  /// **'하루 학습 시간(분)'**
  String get dailyMinutesInput;

  /// Under the typed number when it is outside 5 to 180; saving waits until it is fixed.
  ///
  /// In ko, this message translates to:
  /// **'5분에서 180분 사이로 입력해 주세요'**
  String get dailyMinutesOutOfRange;

  /// The first tile's label: today's new cards at the chosen minutes.
  ///
  /// In ko, this message translates to:
  /// **'하루 새 카드'**
  String get dailyMinutesFreshTitle;

  /// The first tile's value: today's new cards at the chosen minutes.
  ///
  /// In ko, this message translates to:
  /// **'약 {count}장'**
  String dailyMinutesFreshValue(int count);

  /// The second tile's label: when every unstarted card has been started.
  ///
  /// In ko, this message translates to:
  /// **'새 카드 모두 시작'**
  String get dailyMinutesAllTitle;

  /// The second tile's value: in how many study days every unstarted card has been started.
  ///
  /// In ko, this message translates to:
  /// **'{days}일 뒤'**
  String dailyMinutesAfterDays(int days);

  /// The second tile's value when today starts every unstarted card.
  ///
  /// In ko, this message translates to:
  /// **'오늘'**
  String get dailyMinutesAfterToday;

  /// Title of the sheet asked before leaving the card editor with changes.
  ///
  /// In ko, this message translates to:
  /// **'작성 중인 카드를 버릴까요?'**
  String get discardCardTitle;

  /// Consequence on the sheet asked before leaving the card editor with changes.
  ///
  /// In ko, this message translates to:
  /// **'입력한 내용은 저장되지 않아요.'**
  String get discardCardBody;

  /// The sheet's destructive button: leave the card editor without saving.
  ///
  /// In ko, this message translates to:
  /// **'버리기'**
  String get discardCard;

  /// The sheet's cancel: stay in the card editor with what was typed.
  ///
  /// In ko, this message translates to:
  /// **'계속 쓰기'**
  String get keepWriting;

  /// The option that adds cards from a spreadsheet file.
  ///
  /// In ko, this message translates to:
  /// **'엑셀·CSV 파일'**
  String get spreadsheetPick;

  /// The title of the sheet that opens a spreadsheet file.
  ///
  /// In ko, this message translates to:
  /// **'파일에서 카드 추가'**
  String get spreadsheetStartTitle;

  /// The sheet's body, stating the limits before a file is chosen.
  ///
  /// In ko, this message translates to:
  /// **'엑셀(.xlsx)이나 CSV 파일의 한 행이 카드 한 장이 돼요. 파일은 5MB, 1,000행까지 읽어요.'**
  String get spreadsheetStartBody;

  /// The button that opens the device's file picker.
  ///
  /// In ko, this message translates to:
  /// **'파일 고르기'**
  String get spreadsheetChoose;

  /// What a screen reader reads while a file is read.
  ///
  /// In ko, this message translates to:
  /// **'읽는 중'**
  String get spreadsheetReading;

  /// The action that replaces the file read.
  ///
  /// In ko, this message translates to:
  /// **'다른 파일'**
  String get spreadsheetAnother;

  /// The title of the screen listing a file's cards.
  ///
  /// In ko, this message translates to:
  /// **'카드 확인'**
  String get spreadsheetReviewTitle;

  /// The heading over the sheet and column choices.
  ///
  /// In ko, this message translates to:
  /// **'열'**
  String get spreadsheetColumns;

  /// The row choosing a workbook's sheet.
  ///
  /// In ko, this message translates to:
  /// **'시트'**
  String get spreadsheetSheet;

  /// The row choosing the label column.
  ///
  /// In ko, this message translates to:
  /// **'라벨'**
  String get spreadsheetLabelColumn;

  /// The row choosing the example column.
  ///
  /// In ko, this message translates to:
  /// **'예문'**
  String get spreadsheetExampleColumn;

  /// An optional column left unchosen.
  ///
  /// In ko, this message translates to:
  /// **'없음'**
  String get spreadsheetNoColumn;

  /// The switch: the first row makes no card.
  ///
  /// In ko, this message translates to:
  /// **'첫 행은 머리글'**
  String get spreadsheetHeaderRow;

  /// Said when two fields read one column.
  ///
  /// In ko, this message translates to:
  /// **'항목마다 다른 열을 골라 주세요'**
  String get spreadsheetDistinct;

  /// Leaves every card out.
  ///
  /// In ko, this message translates to:
  /// **'모두 빼기'**
  String get spreadsheetExcludeAll;

  /// Selects every card.
  ///
  /// In ko, this message translates to:
  /// **'모두 선택'**
  String get spreadsheetSelectAll;

  /// A row's number in the sheet.
  ///
  /// In ko, this message translates to:
  /// **'{row}행'**
  String spreadsheetRow(int row);

  /// What a screen reader reads for a card's check.
  ///
  /// In ko, this message translates to:
  /// **'{row}행 {front}'**
  String spreadsheetRowCard(int row, String front);

  /// Rows that make no card.
  ///
  /// In ko, this message translates to:
  /// **'앞면이나 뒷면이 빈 행 {count}개는 건너뛰어요'**
  String spreadsheetSkipped(int count);

  /// Rows refused for a long cell.
  ///
  /// In ko, this message translates to:
  /// **'{rows}은 {limit}자가 넘는 칸이 있어 뺐어요'**
  String spreadsheetTooLong(String rows, int limit);

  /// The first five rows and how many more.
  ///
  /// In ko, this message translates to:
  /// **'{rows} 외 {count}개 행'**
  String spreadsheetRowsMore(String rows, int count);

  /// A row repeating a stored card.
  ///
  /// In ko, this message translates to:
  /// **'{row}행은 이 노트에 이미 있는 카드예요'**
  String spreadsheetDuplicateStored(int row);

  /// A row repeating an earlier row.
  ///
  /// In ko, this message translates to:
  /// **'{row}행의 앞면이 {earlier}행과 같아요'**
  String spreadsheetDuplicateRow(int row, int earlier);

  /// Leaves the repeating row out.
  ///
  /// In ko, this message translates to:
  /// **'{row}행 빼기'**
  String spreadsheetLeaveOut(int row);

  /// Saves with the repeating row.
  ///
  /// In ko, this message translates to:
  /// **'그래도 추가'**
  String get spreadsheetAddAnyway;

  /// The sheet asked on leaving with unsaved cards.
  ///
  /// In ko, this message translates to:
  /// **'읽은 카드를 버릴까요?'**
  String get spreadsheetDiscardTitle;

  /// The sheet's consequence.
  ///
  /// In ko, this message translates to:
  /// **'저장하지 않은 카드는 사라져요.'**
  String get spreadsheetDiscardBody;

  /// A file of another type.
  ///
  /// In ko, this message translates to:
  /// **'.xlsx나 .csv 파일을 골라 주세요'**
  String get spreadsheetWrongType;

  /// A file over the limit.
  ///
  /// In ko, this message translates to:
  /// **'파일이 5MB보다 커서 읽지 못했어요. 파일을 나눠 다시 골라 주세요.'**
  String get spreadsheetTooLarge;

  /// A CSV that is not UTF-8.
  ///
  /// In ko, this message translates to:
  /// **'CSV를 읽지 못했어요. UTF-8 CSV로 저장해 다시 골라 주세요.'**
  String get spreadsheetNotUtf8;

  /// A workbook that cannot be read.
  ///
  /// In ko, this message translates to:
  /// **'파일을 읽지 못했어요. 엑셀에서 다시 저장해 골라 주세요.'**
  String get spreadsheetUnreadable;

  /// A sheet over the row limit.
  ///
  /// In ko, this message translates to:
  /// **'행이 1,000개보다 많아 읽지 못했어요. 파일을 나눠 다시 골라 주세요.'**
  String get spreadsheetTooManyRows;

  /// A file the device could not hand over.
  ///
  /// In ko, this message translates to:
  /// **'파일을 읽지 못했어요. 다시 골라 주세요.'**
  String get spreadsheetNotRead;

  /// The middle tab: today's study and the notes.
  ///
  /// In ko, this message translates to:
  /// **'홈'**
  String get tabHome;

  /// The settings tab.
  ///
  /// In ko, this message translates to:
  /// **'설정'**
  String get tabSettings;

  /// Today's cards, large on the home's hero.
  ///
  /// In ko, this message translates to:
  /// **'오늘 {count}장'**
  String homeToday(int count);

  /// How long today's cards take, under the count.
  ///
  /// In ko, this message translates to:
  /// **'약 {minutes}분이면 끝나요'**
  String homeMinutes(int minutes);

  /// The hero's button that studies every note.
  ///
  /// In ko, this message translates to:
  /// **'시작'**
  String get homeStart;

  /// The closed drawer's hint: pull it up for every note.
  ///
  /// In ko, this message translates to:
  /// **'올려서 보기'**
  String get drawerOpen;

  /// Closes the drawer back to its one row.
  ///
  /// In ko, this message translates to:
  /// **'접기'**
  String get drawerClose;

  /// The note screen's study button with today's count.
  ///
  /// In ko, this message translates to:
  /// **'이 노트 학습 · {count}장'**
  String studyThisDeck(int count);

  /// The note screen's study button while the count is not read.
  ///
  /// In ko, this message translates to:
  /// **'이 노트 학습'**
  String get studyThisDeckPlain;

  /// The note screen's heading over its cards.
  ///
  /// In ko, this message translates to:
  /// **'카드 {count}'**
  String cardsHeading(int count);

  /// The note's mastered cards, beside the cards heading.
  ///
  /// In ko, this message translates to:
  /// **'{count}장 익힘'**
  String deckMasteredShort(int count);

  /// The new note screen's colour group.
  ///
  /// In ko, this message translates to:
  /// **'표지 색'**
  String get newDeckColor;

  /// Saves the new note and opens it with the add-card sheet up.
  ///
  /// In ko, this message translates to:
  /// **'저장하고 카드 추가'**
  String get saveAndAddCards;
}

class _AppLocalizationsDelegate
    extends LocalizationsDelegate<AppLocalizations> {
  const _AppLocalizationsDelegate();

  @override
  Future<AppLocalizations> load(Locale locale) {
    return SynchronousFuture<AppLocalizations>(lookupAppLocalizations(locale));
  }

  @override
  bool isSupported(Locale locale) =>
      <String>['en', 'ko'].contains(locale.languageCode);

  @override
  bool shouldReload(_AppLocalizationsDelegate old) => false;
}

AppLocalizations lookupAppLocalizations(Locale locale) {
  // Lookup logic when only language code is specified.
  switch (locale.languageCode) {
    case 'en':
      return AppLocalizationsEn();
    case 'ko':
      return AppLocalizationsKo();
  }

  throw FlutterError(
    'AppLocalizations.delegate failed to load unsupported locale "$locale". This is likely '
    'an issue with the localizations generation tool. Please file an issue '
    'on GitHub with a reproducible sample app and the gen-l10n configuration '
    'that was used.',
  );
}
