// ignore: unused_import
import 'package:intl/intl.dart' as intl;

import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Korean (`ko`).
class AppLocalizationsKo extends AppLocalizations {
  AppLocalizationsKo([String locale = 'ko']) : super(locale);

  @override
  String get appTitle => '알아몰라';

  @override
  String get newDeck => '새 노트';

  @override
  String get deckActions => '노트 설정';

  @override
  String get importActions => '사진 작업';

  @override
  String get renameDeck => '노트 이름 바꾸기';

  @override
  String get deckAppearance => '노트 꾸미기';

  @override
  String get deckAppearanceIcon => '아이콘';

  @override
  String get deckAppearanceColor => '색';

  @override
  String get deckAppearanceImage => '사진';

  @override
  String get deckImageFromAlbum => '앨범에서 고르기';

  @override
  String get deckImageFromCamera => '사진 찍기';

  @override
  String get deckImageAnother => '다른 사진';

  @override
  String get deckImageRemove => '사진 삭제';

  @override
  String get deckImageUnreadable => '사진을 불러오지 못했어요. 다시 시도해 주세요.';

  @override
  String deckIconName(String icon) {
    String _temp0 = intl.Intl.selectLogic(icon, {
      'layers': '카드 묶음',
      'book': '책',
      'languages': '언어',
      'pencil': '연필',
      'flask': '실험',
      'calculator': '계산기',
      'globe': '지구본',
      'music': '음악',
      'palette': '팔레트',
      'brain': '두뇌',
      'code': '코드',
      'landmark': '건축물',
      'briefcase': '서류 가방',
      'star': '별',
      'other': '아이콘',
    });
    return '$_temp0';
  }

  @override
  String deckColorName(String color) {
    String _temp0 = intl.Intl.selectLogic(color, {
      'blue': '파랑',
      'sky': '하늘',
      'violet': '복숭아',
      'sand': '모래',
      'amber': '노랑',
      'slate': '회색',
      'other': '색',
    });
    return '$_temp0';
  }

  @override
  String get deleteDeck => '노트 삭제';

  @override
  String deleteDeckTitle(String name) {
    return '\"$name\" 노트를 삭제할까요?';
  }

  @override
  String deleteDeckBody(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '카드 $count장도 함께 삭제돼요.',
      zero: '이 노트에는 카드가 없어요.',
    );
    return '$_temp0';
  }

  @override
  String get deckName => '노트 이름';

  @override
  String get deckNameRequired => '이름을 입력해 주세요';

  @override
  String get noCards => '아직 카드가 없어요';

  @override
  String get newCard => '카드 추가';

  @override
  String get newCardTitle => '새 카드';

  @override
  String get editCard => '카드 편집';

  @override
  String get deleteCard => '카드 삭제';

  @override
  String get cardFront => '앞면';

  @override
  String get cardBack => '뒷면';

  @override
  String get cardSideRequired => '내용을 적어 주세요';

  @override
  String get blank => '빈칸';

  @override
  String get wholeCard => '카드';

  @override
  String get clozeInsertBlank => '빈칸 넣기';

  @override
  String get clozeUndoBlank => '빈칸 풀기';

  @override
  String clozeRemoveBlank(String answer) {
    return '빈칸 풀기, $answer';
  }

  @override
  String get clozeEmptyBlank => '빈칸';

  @override
  String get clozeBlankRequired => '빈칸을 하나 이상 넣어 주세요';

  @override
  String get clozeBlankMarker => '줄에서 ___를 빼 주세요';

  @override
  String get addBlock => '칸 추가';

  @override
  String get blockText => '글';

  @override
  String get blockTextDescription => '앞면과 뒷면에 글을 적어요';

  @override
  String get blockSenses => '단어';

  @override
  String get blockSensesDescription => '단어와 뜻을 함께 적어요';

  @override
  String get blockTable => '표';

  @override
  String get blockTableDescription => '가릴 부분을 골라요';

  @override
  String get blockCloze => '빈칸 문장';

  @override
  String get blockClozeDescription => '문장 속 단어를 가려요';

  @override
  String get blockImage => '사진';

  @override
  String get blockImageDescription => '사진 위에 가릴 곳을 그려요';

  @override
  String get imageFromAlbum => '앨범에서 고르기';

  @override
  String get imageFromCamera => '사진 찍기';

  @override
  String get imagePickAnother => '다른 사진 고르기';

  @override
  String get imageRetake => '다시 찍기';

  @override
  String get imageRemove => '사진 삭제';

  @override
  String get imageUnreadable => '사진을 불러오지 못했어요. 다시 시도해 주세요.';

  @override
  String get imageRequired => '사진을 골라 주세요';

  @override
  String get imageHint => '사진 위를 끌어서 빈칸을 그리거나 \'빈칸 추가\'를 눌러요';

  @override
  String imageBox(int number) {
    return '빈칸 $number';
  }

  @override
  String get imageAddBox => '빈칸 추가';

  @override
  String get imageBoxAnswer => '정답 (선택)';

  @override
  String get imageBoxLeft => '왼쪽으로 옮기기';

  @override
  String get imageBoxRight => '오른쪽으로 옮기기';

  @override
  String get imageBoxUp => '위로 옮기기';

  @override
  String get imageBoxDown => '아래로 옮기기';

  @override
  String get imageBoxWider => '가로 늘리기';

  @override
  String get imageBoxNarrower => '가로 줄이기';

  @override
  String get imageBoxTaller => '세로 늘리기';

  @override
  String get imageBoxShorter => '세로 줄이기';

  @override
  String get imageBoxDelete => '빈칸 삭제';

  @override
  String get blockAudio => '소리';

  @override
  String get blockAudioDescription => '녹음하거나 파일을 넣어요';

  @override
  String get playAudio => '소리 듣기';

  @override
  String get audioRecord => '녹음하기';

  @override
  String get audioPick => '파일에서 고르기';

  @override
  String get audioRecordAgain => '다시 녹음';

  @override
  String get audioPickAnother => '다른 파일 고르기';

  @override
  String get audioRemove => '소리 삭제';

  @override
  String get audioStopRecording => '녹음 끝내기';

  @override
  String audioRecording(String elapsed, String limit) {
    return '녹음 중 $elapsed / $limit';
  }

  @override
  String get audioUnreadable => '소리를 불러오지 못했어요. 다시 시도해 주세요.';

  @override
  String audioTooLarge(int seconds) {
    return '$seconds초, 5MB까지인 파일을 골라 주세요';
  }

  @override
  String get microphoneDenied => '마이크를 쓸 수 없어요. 설정에서 마이크 접근을 허용해 주세요.';

  @override
  String get audioRequired => '소리를 넣어 주세요';

  @override
  String get audioUnplayable => '소리를 재생하지 못했어요';

  @override
  String get autoplayAudio => '앞면 소리 자동 재생';

  @override
  String blockMenu(int number) {
    return '$number번째 칸 메뉴';
  }

  @override
  String get cardNothingBefore => '앞면에 보일 내용을 하나 이상 넣어 주세요';

  @override
  String get cardNothingAdded => '뒷면이나 빈칸을 하나 이상 넣어 주세요';

  @override
  String get wordTerm => '단어';

  @override
  String get wordAskFirst => '앞면에 보일 것';

  @override
  String get deleteBlock => '삭제';

  @override
  String get tableToolbar => '표 도구';

  @override
  String get tableBlankToggle => '빈칸';

  @override
  String get undo => '되돌리기';

  @override
  String get deletedBlock => '칸을 삭제했어요';

  @override
  String get deletedSense => '뜻을 삭제했어요';

  @override
  String get deletedBox => '빈칸을 삭제했어요';

  @override
  String get deletedImage => '사진을 삭제했어요';

  @override
  String get deletedAudio => '소리를 삭제했어요';

  @override
  String deletedRow(int row) {
    return '$row행을 삭제했어요';
  }

  @override
  String deletedColumn(int column) {
    return '$column열을 삭제했어요';
  }

  @override
  String get tableRemove => '삭제';

  @override
  String tableHeaderCell(int column) {
    return '$column열 머리글';
  }

  @override
  String tableCell(int row, int column) {
    return '$row행 $column열';
  }

  @override
  String get addRow => '행 추가';

  @override
  String get addColumn => '열 추가';

  @override
  String deleteRow(int row) {
    return '$row행 삭제';
  }

  @override
  String deleteColumn(int column) {
    return '$column열 삭제';
  }

  @override
  String get tableBlankRequired => '빈칸으로 할 칸을 하나 이상 골라 주세요';

  @override
  String get tableBlankEmpty => '빈칸으로 고른 칸에 내용을 적어 주세요';

  @override
  String get cardNeedsUpdate =>
      '새 버전의 앱에서 만든 카드라 이 버전에서는 편집할 수 없어요. 앱을 업데이트해 주세요.';

  @override
  String cardDeck(String deck) {
    return '$deck 노트';
  }

  @override
  String get previewCard => '미리보기';

  @override
  String get previewTapToFront => '다시 탭하면 앞면으로 돌아가요';

  @override
  String get previewTapToReveal => '카드를 탭하면 답이 보여요';

  @override
  String get previewTapToHide => '다시 탭하면 빈칸으로 돌아가요';

  @override
  String get senseLabelHint => '라벨';

  @override
  String senseLabelField(int number) {
    return '뜻 $number 라벨';
  }

  @override
  String get labelPresetsTitle => '라벨';

  @override
  String get labelPresetsBody => '카드를 만들 때 키보드 위에 이 순서로 나와요.';

  @override
  String get manageLabelPresets => '관리';

  @override
  String get addLabelPreset => '라벨 추가';

  @override
  String get moveUp => '위로';

  @override
  String get moveDown => '아래로';

  @override
  String editLabelPreset(String label, String name) {
    return '$label $name 편집';
  }

  @override
  String labelPresetMenu(String label) {
    return '$label 메뉴';
  }

  @override
  String get labelPresetLabel => '라벨';

  @override
  String get labelPresetName => '이름 (선택)';

  @override
  String get labelPresetDone => '완료';

  @override
  String get labelPresetRequired => '라벨을 적어 주세요';

  @override
  String senseHeading(int number) {
    return '뜻 $number';
  }

  @override
  String get senseMeaning => '뜻';

  @override
  String senseMenu(int number) {
    return '$number번째 뜻 메뉴';
  }

  @override
  String get senseExamples => '예문';

  @override
  String get senseExamplesHint => '한 줄에 하나씩, 없으면 비워 두세요';

  @override
  String get senseMeaningRequired => '뜻을 적어 주세요';

  @override
  String get addSense => '뜻 추가';

  @override
  String get duplicateTitle => '이 노트에 이미 있는 카드예요';

  @override
  String get duplicateBody => '대소문자와 띄어쓰기는 구분하지 않아요.';

  @override
  String get openExistingCard => '기존 카드 열기';

  @override
  String get addAnyway => '그래도 추가';

  @override
  String get saveAnyway => '그래도 저장';

  @override
  String unsupportedContent(String type) {
    return '[이 버전에서 표시할 수 없는 내용: $type]';
  }

  @override
  String get storageFailure => '기기 저장소를 읽거나 쓰지 못했어요. 다시 시도해 주세요.';

  @override
  String get unreadableCard => '이 노트에 읽을 수 없는 카드가 있어요.';

  @override
  String get cancel => '취소';

  @override
  String get save => '저장';

  @override
  String get create => '만들기';

  @override
  String get rename => '이름 바꾸기';

  @override
  String get delete => '삭제';

  @override
  String get know => '안다';

  @override
  String get dontKnow => '모른다';

  @override
  String get close => '닫기';

  @override
  String studyProgress(int answered, int total) {
    return '$answered/$total';
  }

  @override
  String studyProgressSemantics(int answered, int total) {
    return '$total장 중 $answered장 응답함';
  }

  @override
  String currentCardSemantics(String front) {
    return '앞면: $front';
  }

  @override
  String previousCardSemantics(
    String front,
    String back,
    String answer,
    String changed,
  ) {
    String _temp0 = intl.Intl.selectLogic(changed, {
      'yes': '. 수정됨',
      'other': '',
    });
    return '앞면: $front. 뒷면: $back. 응답: $answer$_temp0';
  }

  @override
  String get showWholeCard => '카드 전체 보기';

  @override
  String get changeToKnow => '안다로 바꾸기';

  @override
  String get changeToDontKnow => '모른다로 바꾸기';

  @override
  String get changingToKnow => '안다로 바꿔요';

  @override
  String get changingToDontKnow => '모른다로 바꿔요';

  @override
  String get previousPlaceholder => '응답한 카드가 여기에 쌓여요';

  @override
  String get earlierCard => '지난번 마지막 카드';

  @override
  String resumeToast(int cards, int minutes) {
    return '이어서 해요 · 남은 $cards장 · 약 $minutes분';
  }

  @override
  String get studyCoachKnow => '알면 오른쪽으로 밀어요';

  @override
  String get studyCoachDontKnow => '모르면 왼쪽으로 밀어요';

  @override
  String get studyCoachRedecide => '응답한 카드는 위로 올라와요. 밀어서 응답을 바꿀 수 있어요';

  @override
  String get studyCoachReplay => '안내 다시 보기';

  @override
  String get studyCoachSampleFront => 'deadline';

  @override
  String get studyCoachSampleBack => '마감 기한';

  @override
  String get answerNotSaved => '응답을 기기에 저장하지 못했어요. 이 카드의 일정은 그대로예요.';

  @override
  String get settingNotSaved => '학습 시간을 기기에 저장하지 못했어요. 다시 시도해 주세요.';

  @override
  String get studyComplete => '오늘 학습을 다 했어요';

  @override
  String get nothingToStudyToday => '오늘은 학습할 카드가 없어요';

  @override
  String completionSummary(int cards, int minutes, int days) {
    return '$cards장 · $minutes분 · $days일 연속';
  }

  @override
  String get studyOnQuestion => '이어서 더 할까요?';

  @override
  String get studyOn => '이어서 하기';

  @override
  String get noCardsLeft => '더 학습할 카드가 없어요';

  @override
  String get stopStudying => '그만하기';

  @override
  String get studyDone => '완료';

  @override
  String get schedulingFailure => '이 카드의 다음 복습 일정을 계산하지 못했어요. 일정은 그대로예요.';

  @override
  String get accountTitle => '설정';

  @override
  String get welcomeBody => '밀어서 응답하고,\n잊을 때쯤 다시 만나는 암기 카드';

  @override
  String get signInWithGoogle => 'Google로 계속하기';

  @override
  String get signInWithApple => 'Apple로 계속하기';

  @override
  String get signInWithEmail => '이메일로 계속하기';

  @override
  String get emailSignInBody => '이메일 주소로 6자리 코드를 보내 드려요. 처음이라면 계정이 만들어져요.';

  @override
  String get emailAddress => '이메일';

  @override
  String get emailAddressHint => 'name@example.com';

  @override
  String get emailAddressInvalid => '이메일 주소를 확인해 주세요.';

  @override
  String get sendEmailCode => '코드 받기';

  @override
  String get sendingEmailCode => '코드를 보내는 중';

  @override
  String emailCodeBody(String email) {
    return '$email로 보낸 6자리 코드를 입력해 주세요.';
  }

  @override
  String get emailCode => '6자리 코드';

  @override
  String get verifyEmailCode => '로그인';

  @override
  String get resendEmailCode => '코드 다시 받기';

  @override
  String resendEmailCodeIn(int seconds) {
    return '$seconds초 뒤에 코드를 다시 받을 수 있어요';
  }

  @override
  String get changeEmailAddress => '이메일 주소 바꾸기';

  @override
  String accountRateLimited(int seconds) {
    return '요청이 너무 많아요. $seconds초 뒤에 다시 시도해 주세요.';
  }

  @override
  String get accountRateLimitedLater => '요청이 너무 많아요. 잠시 뒤에 다시 시도해 주세요.';

  @override
  String get accountCodeRefused => '코드가 맞지 않거나 만료됐어요. 다시 확인하거나 새 코드를 받아 주세요.';

  @override
  String get accountAddressRefused => '이 주소로는 코드를 보낼 수 없어요. 이메일 주소를 확인해 주세요.';

  @override
  String get signingIn => '로그인 중';

  @override
  String get signedIn => '로그인했어요';

  @override
  String get signOut => '로그아웃';

  @override
  String get signingOut => '로그아웃 중';

  @override
  String get accountOffline => '서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.';

  @override
  String get accountMisconfigured => '이 앱의 로그인 설정에 문제가 있어 로그인할 수 없어요.';

  @override
  String get accountRejected => '로그인이 거부됐어요. 다시 시도해 주세요.';

  @override
  String get accountSection => '계정';

  @override
  String get displaySection => '화면';

  @override
  String get themeTitle => '테마';

  @override
  String get themeSystem => '시스템';

  @override
  String get themeLight => '라이트';

  @override
  String get themeDark => '다크';

  @override
  String cardCount(int count) {
    return '카드 $count장';
  }

  @override
  String todayChip(int count) {
    return '오늘 $count';
  }

  @override
  String get backlogPaused => '밀린 복습을 마칠 때까지 새 카드는 쉬어요.';

  @override
  String get searchCards => '카드 검색';

  @override
  String get noMatches => '찾는 카드가 없어요. 다른 단어로 검색해 보세요.';

  @override
  String get saveAndNext => '저장하고 다음 카드';

  @override
  String get deleteCardTitle => '이 카드를 삭제할까요?';

  @override
  String get deleteCardBody => '이 카드의 학습 기록도 함께 삭제돼요.';

  @override
  String get unsyncedChangesTitle => '동기화하지 않고 로그아웃할까요?';

  @override
  String get unsyncedChangesBody =>
      '동기화되지 않은 변경은 이 기기에서 삭제되고, 다른 기기에서도 볼 수 없어요.';

  @override
  String get signOutAnyway => '그래도 로그아웃';

  @override
  String get dataNotCleared => '이 기기의 데이터를 삭제하지 못했어요. 다른 계정으로 로그인하면 삭제돼요.';

  @override
  String get deleteAccount => '계정 삭제';

  @override
  String get deleteAccountTitle => '계정을 삭제할까요?';

  @override
  String get deleteAccountStoreNote =>
      '스토어 구독은 계정을 삭제해도 해지되지 않고, 스토어에서 해지하기 전까지 계속 결제돼요.';

  @override
  String get deleteAccountBody =>
      '서버와 이 기기의 노트, 카드, 학습 기록이 모두 삭제되고, 다른 사람이 가져간 노트와 Google 계정은 남아요.';

  @override
  String get deletingAccount => '계정 삭제 중';

  @override
  String get deleteAccountRejected => '계정을 삭제하지 못했어요. 다시 시도해 주세요.';

  @override
  String get syncSyncing => '동기화 중';

  @override
  String get syncSynced => '동기화됨';

  @override
  String get syncOffline => '오프라인 · 연결되면 동기화해요';

  @override
  String get syncFailed => '동기화하지 못했어요';

  @override
  String get syncRetry => '다시 시도';

  @override
  String get photoTargetTitle => '추가할 노트';

  @override
  String get photoCamera => '사진 찍기';

  @override
  String get photoAlbum => '앨범에서 고르기';

  @override
  String get photoAccessDenied => '카메라나 앨범 사용이 허용되지 않았어요. 설정에서 허용해 주세요.';

  @override
  String get cameraUnavailable => '카메라를 열 수 없어요. 앨범에서 사진을 골라 주세요.';

  @override
  String get openSettings => '설정 열기';

  @override
  String get settingsNotOpened => '설정을 열지 못했어요. 설정 앱에서 직접 허용해 주세요.';

  @override
  String get photoThumbnail => '찍은 사진';

  @override
  String get extractingTitle => '카드를 찾고 있어요';

  @override
  String get extractingNote => '사진은 카드를 만드는 데만 쓰고 서버에 남기지 않아요';

  @override
  String readingTitle(int read, int total) {
    return '사진 $total장 중 $read장 읽음';
  }

  @override
  String readingFailed(int count) {
    return '사진 $count장을 읽지 못했어요';
  }

  @override
  String photosLeftToday(int count) {
    return '오늘 $count장 더 만들 수 있어요. 처음 $count장만 읽어요.';
  }

  @override
  String photosLeftThisMonth(int count) {
    return '이번 달 $count장 더 만들 수 있어요. 처음 $count장만 읽어요.';
  }

  @override
  String photoNumber(int number) {
    return '사진 $number';
  }

  @override
  String get photoWaiting => '기다리는 중';

  @override
  String get photoReading => '읽는 중';

  @override
  String get photoDrop => '빼기';

  @override
  String get addPhotos => '사진 더 추가';

  @override
  String get discardImportTitle => '찾은 카드를 버릴까요?';

  @override
  String discardImportBody(int count) {
    return '찾은 카드 $count장이 사라져요. 다시 읽으면 오늘 사진 한도가 다시 쓰여요.';
  }

  @override
  String get discardImport => '버리기';

  @override
  String get navigateBack => '뒤로';

  @override
  String get photoImportBusy => '읽고 있는 사진이 있어요. 끝난 뒤에 새로 가져올 수 있어요.';

  @override
  String importBarReading(int read, int total) {
    return '사진 읽는 중 $read/$total';
  }

  @override
  String importBarReady(int count) {
    return '카드 $count장 확인하기';
  }

  @override
  String importBarPaused(int count) {
    return '읽던 사진 $count장 이어서 읽기';
  }

  @override
  String resumeImportTitle(int count) {
    return '읽던 사진 $count장을 이어서 읽을까요?';
  }

  @override
  String get resumeImportBody => '이미 읽은 사진은 다시 보내지 않아요.';

  @override
  String get resumeImport => '이어서 읽기';

  @override
  String photoView(int number) {
    return '사진 $number 크게 보기';
  }

  @override
  String photoViewerTitle(int current, int total) {
    return '사진 $current/$total';
  }

  @override
  String get duplicateSkip => '건너뛰기';

  @override
  String get duplicateMergeBack => '뒷면 합치기';

  @override
  String get duplicateAddNew => '새 카드로 추가';

  @override
  String get retake => '다시 찍기';

  @override
  String get pickAnother => '다시 선택';

  @override
  String get retry => '다시 시도';

  @override
  String get retryFailedPhotos => '실패한 사진 다시 시도';

  @override
  String get extractionOffline => '인터넷에 연결되지 않았어요. 연결을 확인하고 다시 시도해 주세요.';

  @override
  String get photoRefused => '이 사진은 보낼 수 없어요. 다시 찍거나 다른 사진을 골라 주세요.';

  @override
  String get noCardsFound => '카드를 찾지 못했어요. 더 밝고 반듯하게 찍어 보세요.';

  @override
  String get accountSuspended => '이 계정은 이용이 정지됐어요. 문의는 sauce@garam.sh로 보내 주세요.';

  @override
  String dailyLimitReachedOf(int limit) {
    return '오늘 사진으로 만들 수 있는 $limit장을 다 썼어요. 내일 다시 시도해 주세요.';
  }

  @override
  String monthlyLimitReachedOf(int limit) {
    return '이번 달 사진으로 만들 수 있는 $limit장을 다 썼어요. 다음 달 1일에 다시 시도해 주세요.';
  }

  @override
  String get modelFailed => '카드를 읽지 못했어요. 잠시 후 다시 시도해 주세요.';

  @override
  String get signInRequired => '로그인이 필요해요. 설정에서 다시 로그인해 주세요.';

  @override
  String get extractionUnavailable =>
      '지금은 사진으로 카드를 만들 수 없어요. 직접 입력이나 엑셀·CSV로 추가해 주세요.';

  @override
  String get serviceFailed => '지금은 사진으로 카드를 만들 수 없어요. 잠시 후 다시 시도해 주세요.';

  @override
  String get photoUnreadable => '이 사진을 읽을 수 없어요. 다른 사진을 골라 주세요.';

  @override
  String get photoNotKept => '이 사진을 기기에 보관하지 못했어요. 저장 공간을 확인하고 다시 골라 주세요.';

  @override
  String get deckDeleted => '이 노트는 삭제됐어요. 다른 노트를 골라 주세요.';

  @override
  String get browse => '공개 노트';

  @override
  String get publish => '노트 공개';

  @override
  String get unpublish => '비공개로 전환';

  @override
  String get publishNeedsNetwork => '인터넷에 연결되면 바꿀 수 있어요';

  @override
  String get publicChip => '공개';

  @override
  String get searchPublicDecks => '노트 이름이나 설명으로 검색';

  @override
  String get sortNewest => '최신순';

  @override
  String get sortMostCopied => '가져오기 많은 순';

  @override
  String publicDeckLine(String owner, int cards, int copies) {
    return '$owner · 카드 $cards장 · 가져오기 $copies회';
  }

  @override
  String get noPublicDecks => '아직 공개된 노트가 없어요. 내 노트를 공개해 처음으로 나눠 보세요.';

  @override
  String get noPublicMatches => '찾는 노트가 없어요. 다른 단어로 검색해 보세요.';

  @override
  String get browseOffline => '인터넷에 연결되지 않았어요. 연결되면 공개 노트를 볼 수 있어요.';

  @override
  String get loading => '불러오는 중';

  @override
  String get sharingOffline => '인터넷에 연결되지 않았어요. 연결을 확인하고 다시 시도해 주세요.';

  @override
  String get sharingRejected => '요청이 거절됐어요. 설정에서 다시 로그인한 뒤 시도해 주세요.';

  @override
  String get sharingFailed => '지금은 처리할 수 없어요. 잠시 후 다시 시도해 주세요.';

  @override
  String get deckNoLongerPublic => '이 노트는 더 이상 공개되어 있지 않아요.';

  @override
  String get copyToMyDecks => '내 노트로 가져오기';

  @override
  String previewFirstCards(int shown, int total) {
    return '카드 $total장 중 처음 $shown장';
  }

  @override
  String get reportDeck => '노트 신고';

  @override
  String get reportConfirm => '신고';

  @override
  String get blockUser => '이 사용자 차단';

  @override
  String get reportTitle => '신고 이유';

  @override
  String get reportInappropriate => '부적절한 내용';

  @override
  String get reportSpam => '스팸';

  @override
  String get reportCopyright => '저작권 침해';

  @override
  String get reportOther => '기타';

  @override
  String get reportSexual => '미성년자·성적인 내용';

  @override
  String get reported => '신고했어요. 검토할게요.';

  @override
  String get alreadyReported => '이미 신고한 노트예요.';

  @override
  String aiHiddenWhy(String category) {
    String _temp0 = intl.Intl.selectLogic(category, {
      'spam': '신고가 들어와 AI가 이 노트를 스팸으로 보고 숨겼어요',
      'ad': '신고가 들어와 AI가 이 노트를 광고로 보고 숨겼어요',
      'other': '신고가 들어와 AI가 이 노트를 숨겼어요',
    });
    return '$_temp0';
  }

  @override
  String get aiHiddenAppeal => '사람에게 다시 확인 요청';

  @override
  String get aiHiddenPending => '사람이 확인하고 있어요';

  @override
  String get aiHiddenUpheld => '사람이 확인했고 노트는 계속 숨겨져요';

  @override
  String blockTitle(String name) {
    return '$name 님을 차단할까요?';
  }

  @override
  String get blockBody => '이 사용자의 노트가 공개 노트에 더 이상 나오지 않아요.';

  @override
  String get block => '차단';

  @override
  String blocked(String name) {
    return '$name 님을 차단했어요.';
  }

  @override
  String get copyAsNewDeck => '새 노트로';

  @override
  String get copyIntoExistingDeck => '기존 노트에 추가';

  @override
  String copyNewDeckHint(String name) {
    return '\"$name\" 노트를 새로 만들어 모든 카드를 가져와요.';
  }

  @override
  String get copyTargetDeck => '노트';

  @override
  String get copyDuplicates => '이미 있는 카드는';

  @override
  String get copyConfirm => '가져오기';

  @override
  String copiedCards(String deck, int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '\"$deck\"에 카드 $count장을 가져왔어요',
      zero: '\"$deck\"에 새로 가져온 카드가 없어요',
    );
    return '$_temp0';
  }

  @override
  String publishTitle(String name) {
    return '\"$name\" 공개';
  }

  @override
  String get displayName => '공개 이름';

  @override
  String get displayNameHelp => '공개한 노트에 이 이름이 표시돼요. 이메일은 표시되지 않아요.';

  @override
  String get displayNameLength => '2~20자로 입력해 주세요';

  @override
  String get deckDescription => '설명 (선택)';

  @override
  String deckDescriptionTooLong(int max) {
    return '$max자 이내로 입력해 주세요';
  }

  @override
  String get publishAgreement => '부적절하거나 저작권을 침해하는 내용은 공개하지 않을게요';

  @override
  String get publishConfirm => '공개';

  @override
  String get published => '노트를 공개했어요';

  @override
  String get unpublished => '노트를 비공개로 전환했어요';

  @override
  String get publicationChecking => '확인 중';

  @override
  String get publicationHeld => '검토 중';

  @override
  String get publicationRefused => '공개 못 함';

  @override
  String get publicationCheckingWhy => '노트를 확인하고 있어요';

  @override
  String get publicationHeldWhy => '관리자가 검토한 뒤에 공개돼요';

  @override
  String get publicationRefusedWhy => '공개할 수 없는 내용이 있어 고친 뒤에 다시 공개할 수 있어요';

  @override
  String findingPlace(String place) {
    String _temp0 = intl.Intl.selectLogic(place, {
      'name': '노트 이름',
      'description': '설명',
      'front': '앞면',
      'back': '뒷면',
      'other': '노트',
    });
    return '$_temp0';
  }

  @override
  String findingCategory(String category) {
    String _temp0 = intl.Intl.selectLogic(category, {
      'resident_number': '주민등록번호처럼 보여요',
      'account': '계좌번호처럼 보여요',
      'phone': '전화번호처럼 보여요',
      'link': '링크나 주소가 있어요',
      'kakao_id': '메신저 아이디가 있어요',
      'contact': '연락을 유도하는 말이 있어요',
      'repeat': '같은 홍보 문구가 반복돼요',
      'term': '공개할 수 없는 말이 있어요',
      'other': '공개할 수 없는 내용이에요',
    });
    return '$_temp0';
  }

  @override
  String findingLine(String category, String place) {
    return '$place: $category';
  }

  @override
  String findingLinePassage(String category, String passage, String place) {
    return '$place: \"$passage\", $category';
  }

  @override
  String get noCardsTitle => '첫 카드를 만들어 볼까요?';

  @override
  String get addCardsInDecks => '노트에서 카드 추가';

  @override
  String get emptyHomeTitle => '첫 노트를 만들어 볼까요?';

  @override
  String get createManually => '직접 입력';

  @override
  String get browsePublicDecks => '공개 노트 둘러보기';

  @override
  String get newDeckTitle => '새 노트 만들기';

  @override
  String consentNotice(String terms, String privacy) {
    return '계속하면 $terms과 $privacy에 동의하는 것으로 봐요.';
  }

  @override
  String get termsOfService => '이용약관';

  @override
  String get privacyPolicy => '개인정보 처리방침';

  @override
  String get linkNotOpened => '링크를 열지 못했어요. 다시 시도해 주세요.';

  @override
  String appVersion(String version) {
    return '버전 $version';
  }

  @override
  String get todayDone => '다 했어요';

  @override
  String get todayStudy => '학습하기';

  @override
  String get tabRecord => '기록';

  @override
  String get tabsLabel => '탭';

  @override
  String get searchDecks => '노트 검색';

  @override
  String get noDeckMatches => '찾는 노트가 없어요. 다른 단어로 검색해 보세요.';

  @override
  String deckMastered(int cards, int mastered) {
    return '$cards장 중 $mastered장 익힘';
  }

  @override
  String deckRowCards(int count) {
    return '$count장';
  }

  @override
  String progressSemantics(int mastered, int learning, int fresh) {
    return '익힘 $mastered장, 학습 중 $learning장, 새 카드 $fresh장';
  }

  @override
  String get searchCardsAction => '카드 검색';

  @override
  String get closeSearch => '검색 닫기';

  @override
  String cardBackShown(String front, String back) {
    return '$front, 뒷면 $back';
  }

  @override
  String moreRows(int count) {
    return '외 $count행';
  }

  @override
  String streakDays(int days) {
    return '$days일 연속';
  }

  @override
  String get dayToday => '오늘';

  @override
  String get dayTomorrow => '내일';

  @override
  String nextReview(String day, int cards, int minutes) {
    return '다음 복습은 $day · $cards장, 약 $minutes분';
  }

  @override
  String get noNextReview => '앞으로 7일 동안 복습할 카드가 없어요';

  @override
  String get backlogTitle => '다시 시작하면 돼요';

  @override
  String backlogBody(int count) {
    return '밀린 복습 $count장을 급한 것부터 해요. 새 카드는 잠시 쉬어요.';
  }

  @override
  String get statsPeriod => '기간';

  @override
  String get statsPeriodWeek => '7일';

  @override
  String get statsPeriodMonth => '30일';

  @override
  String get statsPeriodAll => '전체';

  @override
  String get retentionTitle => '복습에서 맞힌 비율';

  @override
  String retentionPercent(int percent) {
    return '$percent%';
  }

  @override
  String retentionBelow(int points) {
    return '목표보다 $points% 낮아요';
  }

  @override
  String retentionAbove(int points) {
    return '목표보다 $points% 높아요';
  }

  @override
  String get retentionOnTarget => '목표만큼 맞혔어요';

  @override
  String retentionTargetLine(int percent) {
    return '목표 $percent%';
  }

  @override
  String retentionDaysAgo(int days) {
    return '$days일 전';
  }

  @override
  String get statsToday => '오늘';

  @override
  String get retentionEmpty => '이 기간에 복습한 카드가 없어요.';

  @override
  String retentionSemantics(int target, String days) {
    return '복습에서 맞힌 비율, 목표 $target%: $days';
  }

  @override
  String retentionDay(String date, int percent) {
    return '$date $percent%';
  }

  @override
  String get recallTitle => '기억 상태';

  @override
  String recallMean(int percent) {
    return '평균 $percent%';
  }

  @override
  String get recallStrong => '좋음';

  @override
  String get recallFair => '보통';

  @override
  String get recallFading => '곧 잊음';

  @override
  String statsCards(int count) {
    return '$count장';
  }

  @override
  String recallSemantics(
    int total,
    int strong,
    int fair,
    int fading,
    int mean,
  ) {
    return '$total장 중 좋음 $strong장, 보통 $fair장, 곧 잊음 $fading장, 평균 $mean%';
  }

  @override
  String get recallEmpty => '아직 복습한 카드가 없어요.';

  @override
  String get masteredTitle => '익힌 카드';

  @override
  String masteredGain(int weeks, int count) {
    return '$weeks주 전보다 +$count장';
  }

  @override
  String masteredSemantics(String counts) {
    return '주별 익힌 카드, 7주 전부터 이번 주까지: $counts';
  }

  @override
  String get studyDaysTitle => '학습한 날';

  @override
  String studyDaysStreak(int current, int best) {
    return '$current일 연속 · 최고 $best일';
  }

  @override
  String masteredWeeksAgo(int weeks) {
    return '$weeks주 전';
  }

  @override
  String get masteredThisWeek => '이번 주';

  @override
  String get studyDaysFewer => '적게';

  @override
  String get studyDaysMore => '많이';

  @override
  String studyDaysSemantics(int count, String days) {
    return '최근 12주 동안 $count일 학습했어요: $days';
  }

  @override
  String get studyDaysNone => '최근 12주 동안 학습한 날이 없어요';

  @override
  String studyDay(String date, int count) {
    return '$date $count장';
  }

  @override
  String get masteredEmpty => '아직 익힌 카드가 없어요.';

  @override
  String get importTitleWords => '단어를 찾았어요';

  @override
  String importTitleCards(int count) {
    return '카드 $count장을 만들었어요';
  }

  @override
  String importDeck(String name) {
    return '노트 \'$name\'에 추가돼요';
  }

  @override
  String importNewDeck(String name) {
    return '$name에 추가돼요';
  }

  @override
  String importAdd(int count) {
    return '카드 $count장 추가';
  }

  @override
  String importSection(String topic, int count) {
    return '$topic $count';
  }

  @override
  String importIdentifySection(String topic) {
    return '판별 · $topic';
  }

  @override
  String get importForward => '앞면에 단어';

  @override
  String get importBackward => '앞면에 뜻';

  @override
  String get importBoth => '양쪽 방향 모두';

  @override
  String get importBothShort => '양쪽 방향';

  @override
  String get importFirstSense => '첫 뜻만';

  @override
  String get importShowPos => '라벨 표시';

  @override
  String get importShowPronunciation => '발음 표시';

  @override
  String get importShowExtras => '유의어 등 표시';

  @override
  String get importNoteForward => '앞면에 질문';

  @override
  String get importNoteSwapped => '앞면에 답';

  @override
  String get importSwap => '앞면과 뒷면 바꾸기';

  @override
  String get importDropSection => '이 묶음 빼기';

  @override
  String get importKeepSection => '이 묶음 넣기';

  @override
  String importFormMenu(String topic, String form) {
    return '$topic 카드 모양, $form';
  }

  @override
  String importRow(String front, String back) {
    return '$front, $back. 눌러서 편집해요';
  }

  @override
  String importInclude(String front) {
    return '$front 넣기';
  }

  @override
  String get importRemove => '빼기';

  @override
  String get importInDeck => '이미 노트에 있어요';

  @override
  String get editTitle => '카드 편집';

  @override
  String get editFront => '앞면';

  @override
  String get editBack => '뒷면';

  @override
  String get editSenses => '뜻';

  @override
  String editSense(int number) {
    return '$number번째 뜻';
  }

  @override
  String editKeepSense(int number) {
    return '$number번째 뜻 넣기';
  }

  @override
  String editMoveSense(int number) {
    return '$number번째 뜻 메뉴';
  }

  @override
  String get editDone => '완료';

  @override
  String coachStep(int step, int total) {
    return '사용 방법, $total단계 중 $step단계';
  }

  @override
  String get coachNext => '다음';

  @override
  String get coachStart => '시작하기';

  @override
  String get dailyMinutesTitle => '하루 학습 시간';

  @override
  String get dailyMinutesFirstTitle => '하루 몇 분 학습할까요?';

  @override
  String get dailyMinutesBody => '복습을 먼저 하고, 남는 시간에 새 카드를 시작해요.';

  @override
  String dailyMinutesChoice(int minutes) {
    return '$minutes분';
  }

  @override
  String get dailyMinutesLess => '5분 줄이기';

  @override
  String get dailyMinutesMore => '5분 늘리기';

  @override
  String get dailyMinutesNoTime => '이 시간은 복습으로 차서 새 카드는 시작하지 않아요';

  @override
  String get dailyMinutesAllStarted => '새 카드를 모두 시작했어요';

  @override
  String get dailyMinutesSkip => '건너뛰기';

  @override
  String get settingsStudy => '학습';

  @override
  String studyExtra(int count) {
    return '추가 $count장';
  }

  @override
  String studyExtraSemantics(int count) {
    return '오늘 계획 밖으로 $count장 더 학습함';
  }

  @override
  String get dailyMinutesUnit => '분';

  @override
  String dailyMinutesNumberSemantics(int minutes) {
    return '하루 $minutes분, 눌러서 직접 입력';
  }

  @override
  String get dailyMinutesInput => '하루 학습 시간(분)';

  @override
  String get dailyMinutesOutOfRange => '5분에서 180분 사이로 입력해 주세요';

  @override
  String get dailyMinutesFreshTitle => '하루 새 카드';

  @override
  String dailyMinutesFreshValue(int count) {
    return '약 $count장';
  }

  @override
  String get dailyMinutesAllTitle => '새 카드 모두 시작';

  @override
  String dailyMinutesAfterDays(int days) {
    return '$days일 뒤';
  }

  @override
  String get dailyMinutesAfterToday => '오늘';

  @override
  String get discardCardTitle => '작성 중인 카드를 버릴까요?';

  @override
  String get discardCardBody => '입력한 내용은 저장되지 않아요.';

  @override
  String get discardCard => '버리기';

  @override
  String get keepWriting => '계속 쓰기';

  @override
  String get spreadsheetPick => '엑셀·CSV 파일';

  @override
  String get spreadsheetStartTitle => '파일에서 카드 추가';

  @override
  String get spreadsheetStartBody =>
      '엑셀(.xlsx)이나 CSV 파일의 한 행이 카드 한 장이 돼요. 파일은 5MB, 1,000행까지 읽어요.';

  @override
  String get spreadsheetChoose => '파일 고르기';

  @override
  String get spreadsheetReading => '읽는 중';

  @override
  String get spreadsheetAnother => '다른 파일';

  @override
  String get spreadsheetReviewTitle => '카드 확인';

  @override
  String get spreadsheetColumns => '열';

  @override
  String get spreadsheetSheet => '시트';

  @override
  String get spreadsheetLabelColumn => '라벨';

  @override
  String get spreadsheetExampleColumn => '예문';

  @override
  String get spreadsheetNoColumn => '없음';

  @override
  String get spreadsheetHeaderRow => '첫 행은 머리글';

  @override
  String get spreadsheetDistinct => '항목마다 다른 열을 골라 주세요';

  @override
  String get spreadsheetExcludeAll => '모두 빼기';

  @override
  String get spreadsheetSelectAll => '모두 선택';

  @override
  String spreadsheetRow(int row) {
    return '$row행';
  }

  @override
  String spreadsheetRowCard(int row, String front) {
    return '$row행 $front';
  }

  @override
  String spreadsheetSkipped(int count) {
    return '앞면이나 뒷면이 빈 행 $count개는 건너뛰어요';
  }

  @override
  String spreadsheetTooLong(String rows, int limit) {
    return '$rows은 $limit자가 넘는 칸이 있어 뺐어요';
  }

  @override
  String spreadsheetRowsMore(String rows, int count) {
    return '$rows 외 $count개 행';
  }

  @override
  String spreadsheetDuplicateStored(int row) {
    return '$row행은 이 노트에 이미 있는 카드예요';
  }

  @override
  String spreadsheetDuplicateRow(int row, int earlier) {
    return '$row행의 앞면이 $earlier행과 같아요';
  }

  @override
  String spreadsheetLeaveOut(int row) {
    return '$row행 빼기';
  }

  @override
  String get spreadsheetAddAnyway => '그래도 추가';

  @override
  String get spreadsheetDiscardTitle => '읽은 카드를 버릴까요?';

  @override
  String get spreadsheetDiscardBody => '저장하지 않은 카드는 사라져요.';

  @override
  String get spreadsheetWrongType => '.xlsx나 .csv 파일을 골라 주세요';

  @override
  String get spreadsheetTooLarge => '파일이 5MB보다 커서 읽지 못했어요. 파일을 나눠 다시 골라 주세요.';

  @override
  String get spreadsheetNotUtf8 => 'CSV를 읽지 못했어요. UTF-8 CSV로 저장해 다시 골라 주세요.';

  @override
  String get spreadsheetUnreadable => '파일을 읽지 못했어요. 엑셀에서 다시 저장해 골라 주세요.';

  @override
  String get spreadsheetTooManyRows =>
      '행이 1,000개보다 많아 읽지 못했어요. 파일을 나눠 다시 골라 주세요.';

  @override
  String get spreadsheetNotRead => '파일을 읽지 못했어요. 다시 골라 주세요.';

  @override
  String get tabHome => '홈';

  @override
  String homeCards(int count) {
    return '$count장';
  }

  @override
  String homeMinutes(int minutes) {
    return '약 $minutes분이면 끝나요';
  }

  @override
  String get homeStart => '시작';

  @override
  String studyThisDeck(int count) {
    return '이 노트 학습 · $count장';
  }

  @override
  String get studyThisDeckPlain => '이 노트 학습';

  @override
  String cardsHeading(int count) {
    return '카드 $count';
  }

  @override
  String deckMasteredShort(int count) {
    return '$count장 익힘';
  }

  @override
  String get deckNameHint => '예: 토익 단어';

  @override
  String get notesActions => '노트 탭 메뉴';

  @override
  String get saveAndAddCards => '저장하고 카드 추가';

  @override
  String previousCardLabel(
    String answer,
    String front,
    String back,
    String changed,
  ) {
    String _temp0 = intl.Intl.selectLogic(changed, {
      'yes': '. 수정됨',
      'other': '',
    });
    return '방금 본 카드, $answer. 앞면: $front. 뒷면: $back$_temp0';
  }

  @override
  String get coachPrevious => '이전';

  @override
  String get tabNotes => '노트';

  @override
  String weekDayCards(String day, int count) {
    return '$day $count장';
  }

  @override
  String get assistantOpen => '말랑이와 대화하기';

  @override
  String get assistantFirstNote => '말랑이와 첫 노트 만들기';

  @override
  String assistantReady(int count) {
    return '카드 $count장 만들어 뒀어요';
  }

  @override
  String get assistantName => '말랑이';

  @override
  String get assistantEmpty => '무엇을 외워 볼까요?';

  @override
  String assistantShareLeft(int percent) {
    return '오늘 $percent% 남았어요';
  }

  @override
  String get assistantMenu => '대화 메뉴';

  @override
  String get assistantClear => '대화 지우기';

  @override
  String get assistantClearTitle => '대화를 지울까요?';

  @override
  String get assistantClearBody => '지운 대화는 되돌릴 수 없어요.';

  @override
  String get assistantClearConfirm => '지우기';

  @override
  String get assistantMessageHint => '말랑이에게 부탁해 보세요';

  @override
  String get assistantSend => '보내기';

  @override
  String get assistantStop => '멈추기';

  @override
  String get assistantThinking => '말랑이가 생각하는 중이에요';

  @override
  String get assistantMe => '나';

  @override
  String get assistantSources => '출처';

  @override
  String assistantNewNote(String name) {
    return '새 노트 · $name';
  }

  @override
  String assistantSelectAll(String title) {
    return '$title 모두 선택';
  }

  @override
  String get assistantOtherForm => '다른 형식으로';

  @override
  String get assistantFormText => '글';

  @override
  String get assistantFormSenses => '단어';

  @override
  String get assistantFormCloze => '빈칸 문장';

  @override
  String get assistantFormTable => '표';

  @override
  String get assistantFormImage => '사진';

  @override
  String get assistantFormMixed => '섞어서';

  @override
  String assistantGroupCount(int count, String form) {
    return '카드 $count장 · $form';
  }

  @override
  String assistantRemake(String title, String form) {
    return '$title 부분은 $form 형식으로 다시 만들어 줘';
  }

  @override
  String assistantAdd(int count) {
    return '$count장 추가';
  }

  @override
  String assistantChange(int count) {
    return '$count장 바꾸기';
  }

  @override
  String assistantNoteCards(int count) {
    return '카드 $count장';
  }

  @override
  String assistantCardsSkipped(int count) {
    return '$count장은 이미 노트에 있어요';
  }

  @override
  String assistantCardsRefused(int count) {
    return '$count장은 추가하지 못했어요';
  }

  @override
  String get assistantStopped => '멈췄어요.';

  @override
  String get assistantModelError => '말랑이가 답하지 못했어요. 다시 시도해 주세요.';

  @override
  String get assistantCut => '답이 길어 중간에 멈췄어요. 이어서 해 달라고 해 보세요.';

  @override
  String get assistantLimit => '할 일이 많아 여기서 멈췄어요. 다시 시도해 주세요.';

  @override
  String get assistantWaiting => '앞의 메시지를 마무리하고 있어요. 잠시 후 다시 보낼게요.';

  @override
  String get assistantRateLimited => '오늘 말랑이와 이야기할 수 있는 만큼 다 썼어요. 내일 다시 이야기해요.';

  @override
  String get assistantBusy => '앞의 메시지를 아직 마무리하고 있어요. 잠시 후 다시 시도해 주세요.';

  @override
  String get assistantSignIn => '로그인이 끝났어요. 다시 로그인해 주세요.';

  @override
  String get assistantSuspended => '이 계정은 지금 말랑이와 이야기할 수 없어요.';

  @override
  String get assistantTooLong => '대화가 너무 길어요. 대화를 지우고 다시 시작해 주세요.';

  @override
  String get assistantUnavailable => '말랑이가 지금 답할 수 없어요. 잠시 후 다시 시도해 주세요.';

  @override
  String get assistantUnreachable => '연결하지 못했어요. 연결을 확인하고 다시 시도해 주세요.';

  @override
  String get assistantCommitRefused => '카드를 추가하지 못했어요. 말랑이에게 다시 만들어 달라고 해 주세요.';

  @override
  String get assistantCommitSignIn => '로그인이 끝나 카드를 추가하지 못했어요. 다시 로그인해 주세요.';

  @override
  String get assistantCommitFailed => '카드를 추가하지 못했어요. 잠시 후 다시 시도해 주세요.';

  @override
  String get assistantNoteNotSynced => '노트를 아직 불러오지 못했어요. 잠시 후 다시 눌러 주세요.';

  @override
  String assistantReadyShort(int count) {
    return '$count장 만들어 뒀어요';
  }

  @override
  String get assistantHint => '말랑이를 누르면 언제든 대화할 수 있어요';

  @override
  String get assistantHintClose => '안내 닫기';

  @override
  String assistantFromNote(String name) {
    return '$name 노트에서';
  }

  @override
  String get assistantAddByHand => '직접 추가';

  @override
  String get assistantPhotoAttach => '사진 첨부';

  @override
  String get assistantPhotoRemove => '사진 삭제';

  @override
  String assistantPhotos(int count) {
    return '사진 $count장';
  }

  @override
  String get assistantUploading => '사진을 올리는 중이에요';

  @override
  String get assistantUploadFailed => '사진을 올리지 못했어요. 다시 시도해 주세요.';

  @override
  String get assistantPhotoPickFailed => '사진을 가져오지 못했어요. 다시 시도해 주세요.';

  @override
  String assistantJobProgress(int done, int total) {
    return '$done/$total장 읽는 중';
  }

  @override
  String get assistantJobCancel => '읽기 취소';

  @override
  String assistantJobDone(int count) {
    return '사진 $count장을 다 읽었어요';
  }

  @override
  String get assistantJobCancelled => '사진 읽기를 취소했어요';

  @override
  String get clozeHide => '가리기';

  @override
  String get clozeHideUndo => '가리기 풀기';

  @override
  String get clozeMarkupHint => '가릴 부분을 고르고 가리기를 눌러요';

  @override
  String get markupPreview => '미리 보기';

  @override
  String get pasteImageFailed => '붙여넣은 사진을 가져오지 못했어요';

  @override
  String get planTitle => '내 플랜';

  @override
  String get planFree => '무료';

  @override
  String get planPlus => '플러스';

  @override
  String get planPro => '프로';

  @override
  String planPhotosUsed(int used, int limit) {
    return '사진 $used/$limit장 사용';
  }

  @override
  String get planNoLimit => '제한 없이 쓸 수 있어요';

  @override
  String planRenews(DateTime date) {
    final intl.DateFormat dateDateFormat = intl.DateFormat.yMd(localeName);
    final String dateString = dateDateFormat.format(date);

    return '다음 갱신 $dateString';
  }

  @override
  String planEnds(DateTime date) {
    final intl.DateFormat dateDateFormat = intl.DateFormat.yMd(localeName);
    final String dateString = dateDateFormat.format(date);

    return '$dateString까지 쓸 수 있어요';
  }

  @override
  String get planLearnPlus => '플러스 알아보기';

  @override
  String get planManage => '구독 관리';

  @override
  String get planRestore => '구매 복원';

  @override
  String get planRestoring => '구매 복원 중';

  @override
  String get planRestored => '구매를 복원했어요';

  @override
  String get planRestoreFailed => '구매를 복원하지 못했어요. 다시 시도해 주세요.';

  @override
  String get planLoadFailed => '플랜을 불러오지 못했어요. 눌러서 다시 시도해요.';

  @override
  String get plusSheetTitle => '플러스';

  @override
  String get plusSheetBody => '사진으로 더 많은 카드를 만들고, AI 연결을 쓸 수 있어요.';

  @override
  String plusPricePerWeek(String price) {
    return '주 $price';
  }

  @override
  String plusPricePerMonth(String price) {
    return '월 $price';
  }

  @override
  String plusPricePerYear(String price) {
    return '연 $price';
  }

  @override
  String get plusAutoRenew =>
      '구독은 취소하기 전까지 매 기간 자동으로 갱신돼요. 스토어의 구독 설정에서 언제든 취소할 수 있어요.';

  @override
  String get plusWithdrawal =>
      '플러스의 이용이 시작된 부분은 청약철회를 할 수 없어요. 환불은 구매한 앱 스토어의 절차로 요청해요.';

  @override
  String get plusSheetStart => '플러스 시작하기';

  @override
  String get plusNotReady => '구매는 아직 준비 중이에요. 조금만 기다려 주세요.';

  @override
  String get plusUnavailable => '지금은 구매할 수 없어요. 잠시 후 다시 시도해 주세요.';

  @override
  String get plusPending => '결제 승인을 기다리고 있어요. 끝나면 플랜이 바뀌어요.';

  @override
  String get plusFailed => '결제하지 못했어요. 다시 시도해 주세요.';

  @override
  String get plusStarted => '플러스를 시작했어요';

  @override
  String get plusStartedSlow => '결제가 끝났어요. 플랜에 반영되는 데 잠시 걸릴 수 있어요.';

  @override
  String get aiSection => 'AI 연결';

  @override
  String get aiServerAddress => '서버 주소';

  @override
  String get aiServerCopied => '서버 주소를 복사했어요';

  @override
  String get aiLocked => '플러스에서 쓸 수 있어요';

  @override
  String get aiClaudeHow => '커넥터 설정에서 커스텀 커넥터를 추가하고 서버 주소를 넣은 뒤 알아몰라로 로그인해요';

  @override
  String get aiChatGptHow =>
      'chatgpt.com/plugins에서 커스텀 MCP 서버를 추가하고 서버 주소를 넣은 뒤 알아몰라로 로그인해요';

  @override
  String get aiNote =>
      '연결한 AI는 노트와 카드를 읽고, 추가하고, 고치고, 지울 수 있어요. 연결할 수 있는 AI의 수와 기능은 각 서비스의 요금제에 따라 달라요.';
}
