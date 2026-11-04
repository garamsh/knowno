// ignore: unused_import
import 'package:intl/intl.dart' as intl;

import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for English (`en`).
class AppLocalizationsEn extends AppLocalizations {
  AppLocalizationsEn([String locale = 'en']) : super(locale);

  @override
  String get appTitle => 'knowno';

  @override
  String get newDeck => 'New note';

  @override
  String get deckActions => 'Note settings';

  @override
  String get importActions => 'Photo actions';

  @override
  String get renameDeck => 'Rename note';

  @override
  String get deckAppearance => 'Customize note';

  @override
  String get deckAppearanceIcon => 'Icon';

  @override
  String get deckAppearanceColor => 'Color';

  @override
  String get deckAppearanceImage => 'Photo';

  @override
  String get deckImageFromAlbum => 'Choose from album';

  @override
  String get deckImageFromCamera => 'Take a photo';

  @override
  String get deckImageAnother => 'Another photo';

  @override
  String get deckImageRemove => 'Remove photo';

  @override
  String get deckImageUnreadable => 'Couldn\'t load the photo. Try again.';

  @override
  String deckIconName(String icon) {
    String _temp0 = intl.Intl.selectLogic(icon, {
      'layers': 'Cards',
      'book': 'Book',
      'languages': 'Languages',
      'pencil': 'Pencil',
      'flask': 'Flask',
      'calculator': 'Calculator',
      'globe': 'Globe',
      'music': 'Music',
      'palette': 'Palette',
      'brain': 'Brain',
      'code': 'Code',
      'landmark': 'Landmark',
      'briefcase': 'Briefcase',
      'star': 'Star',
      'other': 'Icon',
    });
    return '$_temp0';
  }

  @override
  String deckColorName(String color) {
    String _temp0 = intl.Intl.selectLogic(color, {
      'blue': 'Blue',
      'sky': 'Sky',
      'violet': 'Peach',
      'sand': 'Sand',
      'amber': 'Amber',
      'slate': 'Slate',
      'other': 'Color',
    });
    return '$_temp0';
  }

  @override
  String get deleteDeck => 'Delete note';

  @override
  String deleteDeckTitle(String name) {
    return 'Delete \"$name\"?';
  }

  @override
  String deleteDeckBody(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'Its $count cards will be deleted too.',
      one: 'Its 1 card will be deleted too.',
      zero: 'This note has no cards.',
    );
    return '$_temp0';
  }

  @override
  String get deckName => 'Note name';

  @override
  String get deckNameRequired => 'Enter a name';

  @override
  String get noCards => 'No cards yet';

  @override
  String get newCard => 'Add card';

  @override
  String get newCardTitle => 'New card';

  @override
  String get editCard => 'Edit card';

  @override
  String get deleteCard => 'Delete card';

  @override
  String get cardFront => 'Front';

  @override
  String get cardBack => 'Back';

  @override
  String get cardSideRequired => 'Write something';

  @override
  String get blank => 'blank';

  @override
  String get wholeCard => 'Card';

  @override
  String get clozeInsertBlank => 'Insert blank';

  @override
  String get clozeUndoBlank => 'Undo blank';

  @override
  String clozeRemoveBlank(String answer) {
    return 'Undo blank, $answer';
  }

  @override
  String get clozeEmptyBlank => 'Blank';

  @override
  String get clozeBlankRequired => 'Insert at least one blank';

  @override
  String get clozeBlankMarker => 'Remove ___ from the line';

  @override
  String get addBlock => 'Add block';

  @override
  String get blockText => 'Text';

  @override
  String get blockTextDescription => 'Write a front and a back';

  @override
  String get blockSenses => 'Word';

  @override
  String get blockSensesDescription => 'A word and its meanings';

  @override
  String get blockTable => 'Table';

  @override
  String get blockTableDescription => 'Choose cells to hide';

  @override
  String get blockCloze => 'Cloze sentence';

  @override
  String get blockClozeDescription => 'Hide words in a sentence';

  @override
  String get blockImage => 'Photo';

  @override
  String get blockImageDescription => 'Draw what to hide over a photo';

  @override
  String get imageFromAlbum => 'Choose from album';

  @override
  String get imageFromCamera => 'Take a photo';

  @override
  String get imagePickAnother => 'Choose another photo';

  @override
  String get imageRetake => 'Take again';

  @override
  String get imageRemove => 'Delete photo';

  @override
  String get imageUnreadable => 'Couldn\'t load the photo. Try again.';

  @override
  String get imageRequired => 'Choose a photo';

  @override
  String get imageHint =>
      'Drag over the photo to draw a blank, or tap Add blank';

  @override
  String imageBox(int number) {
    return 'Blank $number';
  }

  @override
  String get imageAddBox => 'Add blank';

  @override
  String get imageBoxAnswer => 'Answer (optional)';

  @override
  String get imageBoxLeft => 'Move left';

  @override
  String get imageBoxRight => 'Move right';

  @override
  String get imageBoxUp => 'Move up';

  @override
  String get imageBoxDown => 'Move down';

  @override
  String get imageBoxWider => 'Wider';

  @override
  String get imageBoxNarrower => 'Narrower';

  @override
  String get imageBoxTaller => 'Taller';

  @override
  String get imageBoxShorter => 'Shorter';

  @override
  String get imageBoxDelete => 'Delete blank';

  @override
  String get blockAudio => 'Sound';

  @override
  String get blockAudioDescription => 'Record or add a file';

  @override
  String get playAudio => 'Play sound';

  @override
  String get audioRecord => 'Record';

  @override
  String get audioPick => 'Choose a file';

  @override
  String get audioRecordAgain => 'Record again';

  @override
  String get audioPickAnother => 'Choose another file';

  @override
  String get audioRemove => 'Delete sound';

  @override
  String get audioStopRecording => 'Stop recording';

  @override
  String audioRecording(String elapsed, String limit) {
    return 'Recording $elapsed / $limit';
  }

  @override
  String get audioUnreadable => 'Couldn\'t load the sound. Try again.';

  @override
  String audioTooLarge(int seconds) {
    return 'Choose a file of up to $seconds seconds and 5 MB';
  }

  @override
  String get microphoneDenied =>
      'Can\'t use the microphone. Allow microphone access in Settings.';

  @override
  String get audioRequired => 'Add a sound';

  @override
  String get audioUnplayable => 'Couldn\'t play the sound';

  @override
  String get autoplayAudio => 'Play front sound automatically';

  @override
  String blockMenu(int number) {
    return 'Block $number menu';
  }

  @override
  String get cardNothingBefore => 'Add something to show on the front';

  @override
  String get cardNothingAdded => 'Add a back or a blank';

  @override
  String get wordTerm => 'Word';

  @override
  String get wordAskFirst => 'Shown on the front';

  @override
  String get deleteBlock => 'Delete';

  @override
  String get tableToolbar => 'Table tools';

  @override
  String get tableBlankToggle => 'Blank';

  @override
  String get undo => 'Undo';

  @override
  String get deletedBlock => 'Block deleted';

  @override
  String get deletedSense => 'Meaning deleted';

  @override
  String get deletedBox => 'Blank deleted';

  @override
  String get deletedImage => 'Photo deleted';

  @override
  String get deletedAudio => 'Sound deleted';

  @override
  String deletedRow(int row) {
    return 'Row $row deleted';
  }

  @override
  String deletedColumn(int column) {
    return 'Column $column deleted';
  }

  @override
  String get tableRemove => 'Delete';

  @override
  String tableHeaderCell(int column) {
    return 'Column $column heading';
  }

  @override
  String tableCell(int row, int column) {
    return 'Row $row, column $column';
  }

  @override
  String get addRow => 'Add row';

  @override
  String get addColumn => 'Add column';

  @override
  String deleteRow(int row) {
    return 'Delete row $row';
  }

  @override
  String deleteColumn(int column) {
    return 'Delete column $column';
  }

  @override
  String get tableBlankRequired => 'Choose at least one cell as a blank';

  @override
  String get tableBlankEmpty => 'Fill in each cell chosen as a blank';

  @override
  String get cardNeedsUpdate =>
      'This card was made in a newer version of the app, so this version can\'t edit it. Update the app.';

  @override
  String cardDeck(String deck) {
    return 'Note $deck';
  }

  @override
  String get previewCard => 'Preview';

  @override
  String get previewTapToFront => 'Tap again to go back to the front';

  @override
  String get previewTapToReveal => 'Tap the card to see the answer';

  @override
  String get previewTapToHide => 'Tap again to empty its blanks';

  @override
  String get senseLabelHint => 'Label';

  @override
  String senseLabelField(int number) {
    return 'Meaning $number label';
  }

  @override
  String get labelPresetsTitle => 'Labels';

  @override
  String get labelPresetsBody =>
      'They appear above the keyboard in this order as you write a card.';

  @override
  String get manageLabelPresets => 'Manage';

  @override
  String get addLabelPreset => 'Add label';

  @override
  String get moveUp => 'Move up';

  @override
  String get moveDown => 'Move down';

  @override
  String editLabelPreset(String label, String name) {
    return 'Edit $label $name';
  }

  @override
  String labelPresetMenu(String label) {
    return '$label menu';
  }

  @override
  String get labelPresetLabel => 'Label';

  @override
  String get labelPresetName => 'Name (optional)';

  @override
  String get labelPresetDone => 'Done';

  @override
  String get labelPresetRequired => 'Write a label';

  @override
  String senseHeading(int number) {
    return 'Meaning $number';
  }

  @override
  String get senseMeaning => 'Meaning';

  @override
  String senseMenu(int number) {
    return 'Meaning $number menu';
  }

  @override
  String get senseExamples => 'Examples';

  @override
  String get senseExamplesHint => 'One per line, or leave it empty';

  @override
  String get senseMeaningRequired => 'Enter the meaning';

  @override
  String get addSense => 'Add meaning';

  @override
  String get duplicateTitle => 'This note already has this card';

  @override
  String get duplicateBody => 'Case and spacing are ignored when comparing.';

  @override
  String get openExistingCard => 'Open existing card';

  @override
  String get addAnyway => 'Add anyway';

  @override
  String get saveAnyway => 'Save anyway';

  @override
  String unsupportedContent(String type) {
    return '[Content this version cannot show: $type]';
  }

  @override
  String get storageFailure =>
      'Couldn\'t read or write the device\'s storage. Please try again.';

  @override
  String get unreadableCard => 'A card in this note can\'t be read.';

  @override
  String get cancel => 'Cancel';

  @override
  String get save => 'Save';

  @override
  String get create => 'Create';

  @override
  String get rename => 'Rename';

  @override
  String get delete => 'Delete';

  @override
  String get know => 'Know';

  @override
  String get dontKnow => 'Don\'t know';

  @override
  String get close => 'Close';

  @override
  String studyProgress(int answered, int total) {
    return '$answered/$total';
  }

  @override
  String studyProgressSemantics(int answered, int total) {
    return 'Responded to $answered of $total cards';
  }

  @override
  String currentCardSemantics(String front) {
    return 'Front: $front';
  }

  @override
  String previousCardSemantics(
    String front,
    String back,
    String answer,
    String changed,
  ) {
    String _temp0 = intl.Intl.selectLogic(changed, {
      'yes': '. Changed',
      'other': '',
    });
    return 'Front: $front. Back: $back. Response: $answer$_temp0';
  }

  @override
  String get showWholeCard => 'show the whole card';

  @override
  String get changeToKnow => 'Change to Know';

  @override
  String get changeToDontKnow => 'Change to Don\'t know';

  @override
  String get changingToKnow => 'Change to Know';

  @override
  String get changingToDontKnow => 'Change to Don\'t know';

  @override
  String get previousPlaceholder => 'Cards you responded to stack up here';

  @override
  String get earlierCard => 'Last card last time';

  @override
  String resumeToast(int cards, int minutes) {
    return 'Picking up · $cards left · about $minutes min';
  }

  @override
  String get studyCoachKnow => 'Swipe right if you know it';

  @override
  String get studyCoachDontKnow => 'Swipe left if you don\'t';

  @override
  String get studyCoachRedecide =>
      'Cards you responded to come up here. Swipe one to change its response';

  @override
  String get studyCoachReplay => 'Show the guide again';

  @override
  String get studyCoachSampleFront => 'deadline';

  @override
  String get studyCoachSampleBack => 'the date by which it is due';

  @override
  String get answerNotSaved =>
      'Couldn\'t save your response on this device. This card\'s schedule did not change.';

  @override
  String get settingNotSaved =>
      'Couldn\'t save your study time on this device. Please try again.';

  @override
  String get studyComplete => 'Done for today';

  @override
  String get nothingToStudyToday => 'No cards to study today';

  @override
  String completionSummary(int cards, int minutes, int days) {
    String _temp0 = intl.Intl.pluralLogic(
      cards,
      locale: localeName,
      other: '$cards cards',
      one: '1 card',
    );
    return '$_temp0 · $minutes min · $days-day streak';
  }

  @override
  String get studyOnQuestion => 'Study some more?';

  @override
  String get studyOn => 'Keep going';

  @override
  String get noCardsLeft => 'No more cards to study';

  @override
  String get stopStudying => 'Stop';

  @override
  String get studyDone => 'Done';

  @override
  String get schedulingFailure =>
      'Couldn\'t work out this card\'s next review. Its schedule did not change.';

  @override
  String get accountTitle => 'Settings';

  @override
  String get welcomeBody =>
      'Swipe to respond,\nand meet each card again just before you forget';

  @override
  String get signInWithGoogle => 'Continue with Google';

  @override
  String get signInWithApple => 'Continue with Apple';

  @override
  String get signingIn => 'Signing in';

  @override
  String get signedIn => 'Signed in';

  @override
  String get signOut => 'Sign out';

  @override
  String get signingOut => 'Signing out';

  @override
  String get accountOffline =>
      'Couldn\'t reach the server. Check your internet connection.';

  @override
  String get accountMisconfigured =>
      'Sign-in isn\'t set up correctly in this app, so you can\'t sign in.';

  @override
  String get accountRejected => 'Sign-in was refused. Please try again.';

  @override
  String get accountSection => 'Account';

  @override
  String get displaySection => 'Display';

  @override
  String get themeTitle => 'Theme';

  @override
  String get themeSystem => 'System';

  @override
  String get themeLight => 'Light';

  @override
  String get themeDark => 'Dark';

  @override
  String cardCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count cards',
      one: '1 card',
    );
    return '$_temp0';
  }

  @override
  String todayChip(int count) {
    return 'Today $count';
  }

  @override
  String get backlogPaused =>
      'New cards wait until you catch up on your reviews.';

  @override
  String get searchCards => 'Search';

  @override
  String get noMatches => 'No card matches. Try other words.';

  @override
  String get saveAndNext => 'Save and next card';

  @override
  String get deleteCardTitle => 'Delete this card?';

  @override
  String get deleteCardBody => 'Its study history is deleted with it.';

  @override
  String get unsyncedChangesTitle => 'Sign out without syncing?';

  @override
  String get unsyncedChangesBody =>
      'Changes that aren\'t synced are deleted from this device, and your other devices won\'t have them either.';

  @override
  String get signOutAnyway => 'Sign out anyway';

  @override
  String get dataNotCleared =>
      'Couldn\'t delete this device\'s data. It\'s deleted when another account signs in.';

  @override
  String get deleteAccount => 'Delete account';

  @override
  String get deleteAccountTitle => 'Delete your account?';

  @override
  String get deleteAccountBody =>
      'Your notes, cards and study history are deleted from the server and this device, while notes others copied and your Google account stay.';

  @override
  String get deletingAccount => 'Deleting account';

  @override
  String get deleteAccountRejected =>
      'Couldn\'t delete your account. Try again.';

  @override
  String get syncSyncing => 'Syncing';

  @override
  String get syncSynced => 'Synced';

  @override
  String get syncOffline => 'Offline · syncs when connected';

  @override
  String get syncFailed => 'Couldn\'t sync';

  @override
  String get syncRetry => 'Try again';

  @override
  String get photoTargetTitle => 'Add to';

  @override
  String get photoCamera => 'Take photo';

  @override
  String get photoAlbum => 'Choose from album';

  @override
  String get photoAccessDenied =>
      'The app isn\'t allowed to use the camera or your photos. Allow it in Settings.';

  @override
  String get cameraUnavailable =>
      'Couldn\'t open the camera. Choose a photo from your album.';

  @override
  String get openSettings => 'Open Settings';

  @override
  String get settingsNotOpened =>
      'Couldn\'t open Settings. Allow it in the Settings app.';

  @override
  String get photoThumbnail => 'Your photo';

  @override
  String get extractingTitle => 'Finding cards';

  @override
  String get extractingNote =>
      'Your photo is used only to make cards and isn\'t kept on the server';

  @override
  String readingTitle(int read, int total) {
    String _temp0 = intl.Intl.pluralLogic(
      total,
      locale: localeName,
      other: 'Read $read of $total photos',
      one: 'Read $read of 1 photo',
    );
    return '$_temp0';
  }

  @override
  String readingFailed(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'Couldn\'t read $count photos',
      one: 'Couldn\'t read 1 photo',
    );
    return '$_temp0';
  }

  @override
  String photosLeftToday(int count) {
    return 'You can read $count more today, so only the first $count will be read.';
  }

  @override
  String photosLeftThisMonth(int count) {
    return 'You can read $count more this month, so only the first $count will be read.';
  }

  @override
  String photoNumber(int number) {
    return 'Photo $number';
  }

  @override
  String get photoWaiting => 'Waiting';

  @override
  String get photoReading => 'Reading';

  @override
  String get photoDrop => 'Remove';

  @override
  String get addPhotos => 'Add more photos';

  @override
  String get discardImportTitle => 'Discard the cards found?';

  @override
  String discardImportBody(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'The $count cards found will be lost.',
      one: 'The 1 card found will be lost.',
    );
    return '$_temp0 Reading the photos again uses today\'s photo limit again.';
  }

  @override
  String get discardImport => 'Discard';

  @override
  String get navigateBack => 'Back';

  @override
  String get photoImportBusy =>
      'Photos are still being read. You can start a new import once they\'re done.';

  @override
  String importBarReading(int read, int total) {
    return 'Reading photos $read/$total';
  }

  @override
  String importBarReady(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'Review $count cards',
      one: 'Review 1 card',
    );
    return '$_temp0';
  }

  @override
  String importBarPaused(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'Resume reading $count photos',
      one: 'Resume reading 1 photo',
    );
    return '$_temp0';
  }

  @override
  String resumeImportTitle(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'Resume reading $count photos?',
      one: 'Resume reading 1 photo?',
    );
    return '$_temp0';
  }

  @override
  String get resumeImportBody => 'Photos already read aren\'t sent again.';

  @override
  String get resumeImport => 'Resume';

  @override
  String photoView(int number) {
    return 'View photo $number';
  }

  @override
  String photoViewerTitle(int current, int total) {
    return 'Photo $current of $total';
  }

  @override
  String get duplicateSkip => 'Skip';

  @override
  String get duplicateMergeBack => 'Merge back';

  @override
  String get duplicateAddNew => 'Add as new';

  @override
  String get retake => 'Retake';

  @override
  String get pickAnother => 'Choose again';

  @override
  String get retry => 'Try again';

  @override
  String get retryFailedPhotos => 'Retry failed photos';

  @override
  String get extractionOffline =>
      'You\'re offline. Check your connection and try again.';

  @override
  String get photoRefused =>
      'This photo can\'t be sent. Retake it or choose another.';

  @override
  String get noCardsFound =>
      'No cards found. Try a brighter, straighter photo.';

  @override
  String get accountSuspended =>
      'This account is suspended. Write to sauce@garam.sh with any questions.';

  @override
  String dailyLimitReachedOf(int limit) {
    return 'You\'ve used today\'s $limit photos. Try again tomorrow.';
  }

  @override
  String monthlyLimitReachedOf(int limit) {
    return 'You\'ve used this month\'s $limit photos. Try again on the 1st of next month.';
  }

  @override
  String get modelFailed =>
      'Couldn\'t read the cards. Please try again in a moment.';

  @override
  String get signInRequired =>
      'You need to sign in. Sign in again from Settings.';

  @override
  String get extractionUnavailable =>
      'Can\'t make cards from photos right now. Add them by hand or from an Excel or CSV file.';

  @override
  String get serviceFailed =>
      'Can\'t make cards from photos right now. Please try again in a moment.';

  @override
  String get photoUnreadable =>
      'Couldn\'t read this photo. Choose another one.';

  @override
  String get photoNotKept =>
      'Couldn\'t keep this photo on the device. Check the free space and choose it again.';

  @override
  String get deckDeleted => 'This note was deleted. Choose another note.';

  @override
  String get browse => 'Public notes';

  @override
  String get publish => 'Publish';

  @override
  String get unpublish => 'Make private';

  @override
  String get publishNeedsNetwork => 'Available when you\'re online';

  @override
  String get publicChip => 'Public';

  @override
  String get searchPublicDecks => 'Search names and descriptions';

  @override
  String get sortNewest => 'Newest';

  @override
  String get sortMostCopied => 'Most copied';

  @override
  String publicDeckLine(String owner, int cards, int copies) {
    String _temp0 = intl.Intl.pluralLogic(
      cards,
      locale: localeName,
      other: '$cards cards',
      one: '1 card',
    );
    String _temp1 = intl.Intl.pluralLogic(
      copies,
      locale: localeName,
      other: 'copied $copies times',
      one: 'copied once',
    );
    return '$owner · $_temp0 · $_temp1';
  }

  @override
  String get noPublicDecks =>
      'No public notes yet. Publish one of yours to be the first.';

  @override
  String get noPublicMatches => 'No notes match. Try other words.';

  @override
  String get browseOffline =>
      'You\'re offline. Public notes appear once you\'re connected.';

  @override
  String get loading => 'Loading';

  @override
  String get sharingOffline =>
      'You\'re offline. Check your connection and try again.';

  @override
  String get sharingRejected =>
      'The request was refused. Sign in again from Settings and try again.';

  @override
  String get sharingFailed =>
      'Can\'t do that right now. Please try again in a moment.';

  @override
  String get deckNoLongerPublic => 'This note is no longer public.';

  @override
  String get copyToMyDecks => 'Add to my notes';

  @override
  String previewFirstCards(int shown, int total) {
    return 'First $shown of $total cards';
  }

  @override
  String get reportDeck => 'Report note';

  @override
  String get reportConfirm => 'Report';

  @override
  String get blockUser => 'Block this user';

  @override
  String get reportTitle => 'Why are you reporting this note?';

  @override
  String get reportInappropriate => 'Inappropriate content';

  @override
  String get reportSpam => 'Spam';

  @override
  String get reportCopyright => 'Copyright infringement';

  @override
  String get reportOther => 'Other';

  @override
  String get reported => 'Reported. We\'ll review it.';

  @override
  String get alreadyReported => 'You\'ve already reported this note.';

  @override
  String blockTitle(String name) {
    return 'Block $name?';
  }

  @override
  String get blockBody => 'Their notes will no longer appear in public notes.';

  @override
  String get block => 'Block';

  @override
  String blocked(String name) {
    return 'Blocked $name.';
  }

  @override
  String get copyAsNewDeck => 'As a new note';

  @override
  String get copyIntoExistingDeck => 'Into a note';

  @override
  String copyNewDeckHint(String name) {
    return 'Creates the note \"$name\" with every card.';
  }

  @override
  String get copyTargetDeck => 'Note';

  @override
  String get copyDuplicates => 'Cards already in the note';

  @override
  String get copyConfirm => 'Add';

  @override
  String copiedCards(String deck, int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'Added $count cards to \"$deck\"',
      one: 'Added 1 card to \"$deck\"',
      zero: 'No new cards for \"$deck\"',
    );
    return '$_temp0';
  }

  @override
  String publishTitle(String name) {
    return 'Publish \"$name\"';
  }

  @override
  String get displayName => 'Public name';

  @override
  String get displayNameHelp =>
      'Shown with your public notes. Your email is never shown.';

  @override
  String get displayNameLength => 'Use 2 to 20 characters';

  @override
  String get deckDescription => 'Description (optional)';

  @override
  String deckDescriptionTooLong(int max) {
    return 'Use at most $max characters';
  }

  @override
  String get publishAgreement =>
      'I won\'t publish inappropriate or copyrighted content';

  @override
  String get publishConfirm => 'Publish';

  @override
  String get published => 'Note published';

  @override
  String get unpublished => 'Note is private again';

  @override
  String get noCardsTitle => 'Make your first card?';

  @override
  String get addCardsInDecks => 'Add cards in a note';

  @override
  String get emptyHomeTitle => 'Shall we make your first note?';

  @override
  String get createManually => 'Enter by hand';

  @override
  String get browsePublicDecks => 'Browse public notes';

  @override
  String get newDeckTitle => 'Create a note';

  @override
  String consentNotice(String terms, String privacy) {
    return 'By continuing, you agree to the $terms and the $privacy.';
  }

  @override
  String get termsOfService => 'Terms of Service';

  @override
  String get privacyPolicy => 'Privacy Policy';

  @override
  String get linkNotOpened => 'Couldn\'t open the link. Please try again.';

  @override
  String appVersion(String version) {
    return 'Version $version';
  }

  @override
  String get todayDone => 'All done';

  @override
  String get todayStudy => 'Study';

  @override
  String get tabRecord => 'Record';

  @override
  String get tabsLabel => 'Tabs';

  @override
  String get searchDecks => 'Search notes';

  @override
  String get noDeckMatches => 'No note matches. Try other words.';

  @override
  String deckMastered(int cards, int mastered) {
    return '$mastered of $cards mastered';
  }

  @override
  String deckRowCards(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count cards',
      one: '1 card',
    );
    return '$_temp0';
  }

  @override
  String progressSemantics(int mastered, int learning, int fresh) {
    return '$mastered mastered, $learning learning, $fresh new';
  }

  @override
  String get searchCardsAction => 'Search cards';

  @override
  String get closeSearch => 'Close search';

  @override
  String cardBackShown(String front, String back) {
    return '$front, back $back';
  }

  @override
  String moreRows(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'rows',
      one: 'row',
    );
    return '$count more $_temp0';
  }

  @override
  String streakDays(int days) {
    return '$days-day streak';
  }

  @override
  String get dayToday => 'Today';

  @override
  String get dayTomorrow => 'Tomorrow';

  @override
  String nextReview(String day, int cards, int minutes) {
    return 'Next review $day · $cards, about $minutes min';
  }

  @override
  String get noNextReview => 'No reviews in the next 7 days';

  @override
  String get backlogTitle => 'Pick up where you left off';

  @override
  String backlogBody(int count) {
    return '$count overdue reviews, most urgent first. New cards wait for now.';
  }

  @override
  String get statsPeriod => 'Period';

  @override
  String get statsPeriodWeek => '7 days';

  @override
  String get statsPeriodMonth => '30 days';

  @override
  String get statsPeriodAll => 'All';

  @override
  String get retentionTitle => 'Correct in reviews';

  @override
  String retentionPercent(int percent) {
    return '$percent%';
  }

  @override
  String retentionBelow(int points) {
    return '$points% below target';
  }

  @override
  String retentionAbove(int points) {
    return '$points% above target';
  }

  @override
  String get retentionOnTarget => 'On target';

  @override
  String retentionTargetLine(int percent) {
    return 'Target $percent%';
  }

  @override
  String retentionDaysAgo(int days) {
    return '$days days ago';
  }

  @override
  String get statsToday => 'Today';

  @override
  String get retentionEmpty => 'No reviews in this period.';

  @override
  String retentionSemantics(int target, String days) {
    return 'Correct in reviews, target $target%: $days';
  }

  @override
  String retentionDay(String date, int percent) {
    return '$date $percent%';
  }

  @override
  String get recallTitle => 'Memory';

  @override
  String recallMean(int percent) {
    return 'Average $percent%';
  }

  @override
  String get recallStrong => 'Good';

  @override
  String get recallFair => 'Fair';

  @override
  String get recallFading => 'Fading soon';

  @override
  String statsCards(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count cards',
      one: '1 card',
    );
    return '$_temp0';
  }

  @override
  String recallSemantics(
    int total,
    int strong,
    int fair,
    int fading,
    int mean,
  ) {
    return 'Of $total cards: good $strong, fair $fair, fading soon $fading, average $mean%';
  }

  @override
  String get recallEmpty => 'No card reviewed yet.';

  @override
  String get masteredTitle => 'Mastered cards';

  @override
  String masteredGain(int weeks, int count) {
    return '+$count since $weeks weeks ago';
  }

  @override
  String masteredSemantics(String counts) {
    return 'Mastered cards by week, from 7 weeks ago to this week: $counts';
  }

  @override
  String get studyDaysTitle => 'Study days';

  @override
  String studyDaysStreak(int current, int best) {
    return '$current-day streak · best $best';
  }

  @override
  String masteredWeeksAgo(int weeks) {
    return '$weeks weeks ago';
  }

  @override
  String get masteredThisWeek => 'This week';

  @override
  String get studyDaysFewer => 'Fewer';

  @override
  String get studyDaysMore => 'More';

  @override
  String studyDaysSemantics(int count, String days) {
    return 'Studied on $count days in the last 12 weeks: $days';
  }

  @override
  String get studyDaysNone => 'No study days in the last 12 weeks';

  @override
  String studyDay(String date, int count) {
    return '$date $count';
  }

  @override
  String get masteredEmpty => 'No card mastered yet.';

  @override
  String get importTitleWords => 'Words found';

  @override
  String importTitleCards(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'Made $count cards',
      one: 'Made 1 card',
    );
    return '$_temp0';
  }

  @override
  String importDeck(String name) {
    return 'Adds to the note \'$name\'';
  }

  @override
  String importNewDeck(String name) {
    return 'Adds to $name';
  }

  @override
  String importAdd(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'Add $count cards',
      one: 'Add 1 card',
    );
    return '$_temp0';
  }

  @override
  String importSection(String topic, int count) {
    return '$topic $count';
  }

  @override
  String importIdentifySection(String topic) {
    return 'Identify · $topic';
  }

  @override
  String get importForward => 'Word on the front';

  @override
  String get importBackward => 'Meaning on the front';

  @override
  String get importBoth => 'Both ways';

  @override
  String get importBothShort => 'Both ways';

  @override
  String get importFirstSense => 'First meaning only';

  @override
  String get importShowPos => 'Show labels';

  @override
  String get importShowPronunciation => 'Show pronunciation';

  @override
  String get importShowExtras => 'Show synonyms and more';

  @override
  String get importNoteForward => 'Question on the front';

  @override
  String get importNoteSwapped => 'Answer on the front';

  @override
  String get importSwap => 'Swap front and back';

  @override
  String get importDropSection => 'Leave out this group';

  @override
  String get importKeepSection => 'Include this group';

  @override
  String importFormMenu(String topic, String form) {
    return '$topic card form, $form';
  }

  @override
  String importRow(String front, String back) {
    return '$front, $back. Tap to edit';
  }

  @override
  String importInclude(String front) {
    return 'Include $front';
  }

  @override
  String get importRemove => 'Remove';

  @override
  String get importInDeck => 'Already in the note';

  @override
  String get editTitle => 'Edit card';

  @override
  String get editFront => 'Front';

  @override
  String get editBack => 'Back';

  @override
  String get editSenses => 'Meanings';

  @override
  String editSense(int number) {
    return 'Meaning $number';
  }

  @override
  String editKeepSense(int number) {
    return 'Include meaning $number';
  }

  @override
  String editMoveSense(int number) {
    return 'Meaning $number menu';
  }

  @override
  String get editDone => 'Done';

  @override
  String coachStep(int step, int total) {
    return 'How to use, step $step of $total';
  }

  @override
  String get coachNext => 'Next';

  @override
  String get coachStart => 'Start';

  @override
  String get dailyMinutesTitle => 'Daily study time';

  @override
  String get dailyMinutesFirstTitle => 'How many minutes a day will you study?';

  @override
  String get dailyMinutesBody =>
      'Reviews come first, and new cards fill the time left.';

  @override
  String dailyMinutesChoice(int minutes) {
    return '$minutes min';
  }

  @override
  String get dailyMinutesLess => '5 minutes less';

  @override
  String get dailyMinutesMore => '5 minutes more';

  @override
  String get dailyMinutesNoTime =>
      'Reviews fill this time, so no new card starts';

  @override
  String get dailyMinutesAllStarted => 'You\'ve started every new card';

  @override
  String get dailyMinutesSkip => 'Skip';

  @override
  String get settingsStudy => 'Study';

  @override
  String studyExtra(int count) {
    return '+$count extra';
  }

  @override
  String studyExtraSemantics(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count more cards studied past today\'s plan',
      one: '1 more card studied past today\'s plan',
    );
    return '$_temp0';
  }

  @override
  String get dailyMinutesUnit => 'min';

  @override
  String dailyMinutesNumberSemantics(int minutes) {
    return '$minutes minutes a day, tap to type';
  }

  @override
  String get dailyMinutesInput => 'Daily study time (minutes)';

  @override
  String get dailyMinutesOutOfRange => 'Enter 5 to 180 minutes';

  @override
  String get dailyMinutesFreshTitle => 'New cards a day';

  @override
  String dailyMinutesFreshValue(int count) {
    return 'About $count';
  }

  @override
  String get dailyMinutesAllTitle => 'All new cards started';

  @override
  String dailyMinutesAfterDays(int days) {
    String _temp0 = intl.Intl.pluralLogic(
      days,
      locale: localeName,
      other: 'In $days days',
      one: 'In 1 day',
    );
    return '$_temp0';
  }

  @override
  String get dailyMinutesAfterToday => 'Today';

  @override
  String get discardCardTitle => 'Discard this card?';

  @override
  String get discardCardBody => 'What you typed won\'t be saved.';

  @override
  String get discardCard => 'Discard';

  @override
  String get keepWriting => 'Keep writing';

  @override
  String get spreadsheetPick => 'Excel or CSV file';

  @override
  String get spreadsheetStartTitle => 'Add cards from a file';

  @override
  String get spreadsheetStartBody =>
      'Each row of an Excel (.xlsx) or CSV file becomes a card. Files up to 5 MB and 1,000 rows are read.';

  @override
  String get spreadsheetChoose => 'Choose file';

  @override
  String get spreadsheetReading => 'Reading';

  @override
  String get spreadsheetAnother => 'Another file';

  @override
  String get spreadsheetReviewTitle => 'Review cards';

  @override
  String get spreadsheetColumns => 'Columns';

  @override
  String get spreadsheetSheet => 'Sheet';

  @override
  String get spreadsheetLabelColumn => 'Label';

  @override
  String get spreadsheetExampleColumn => 'Example';

  @override
  String get spreadsheetNoColumn => 'None';

  @override
  String get spreadsheetHeaderRow => 'First row is a header';

  @override
  String get spreadsheetDistinct => 'Choose a different column for each field';

  @override
  String get spreadsheetExcludeAll => 'Leave all out';

  @override
  String get spreadsheetSelectAll => 'Select all';

  @override
  String spreadsheetRow(int row) {
    return 'Row $row';
  }

  @override
  String spreadsheetRowCard(int row, String front) {
    return 'Row $row $front';
  }

  @override
  String spreadsheetSkipped(int count) {
    return '$count rows with an empty front or back are skipped';
  }

  @override
  String spreadsheetTooLong(String rows, int limit) {
    return '$rows left out: a cell is over $limit characters';
  }

  @override
  String spreadsheetRowsMore(String rows, int count) {
    return '$rows and $count more';
  }

  @override
  String spreadsheetDuplicateStored(int row) {
    return 'Row $row is already in this note';
  }

  @override
  String spreadsheetDuplicateRow(int row, int earlier) {
    return 'Row $row has the same front as row $earlier';
  }

  @override
  String spreadsheetLeaveOut(int row) {
    return 'Leave out row $row';
  }

  @override
  String get spreadsheetAddAnyway => 'Add anyway';

  @override
  String get spreadsheetDiscardTitle => 'Discard the cards read?';

  @override
  String get spreadsheetDiscardBody => 'Unsaved cards will be lost.';

  @override
  String get spreadsheetWrongType => 'Choose an .xlsx or .csv file';

  @override
  String get spreadsheetTooLarge =>
      'The file is over 5 MB. Split it and choose it again.';

  @override
  String get spreadsheetNotUtf8 =>
      'The CSV could not be read. Save it as UTF-8 CSV and choose it again.';

  @override
  String get spreadsheetUnreadable =>
      'The file could not be read. Save it again in Excel and choose it.';

  @override
  String get spreadsheetTooManyRows =>
      'The file has over 1,000 rows. Split it and choose it again.';

  @override
  String get spreadsheetNotRead =>
      'The file could not be read. Choose it again.';

  @override
  String get tabHome => 'Home';

  @override
  String homeCards(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count cards',
      one: '1 card',
    );
    return '$_temp0';
  }

  @override
  String homeMinutes(int minutes) {
    return 'About $minutes min';
  }

  @override
  String get homeStart => 'Start';

  @override
  String studyThisDeck(int count) {
    return 'Study this note · $count';
  }

  @override
  String get studyThisDeckPlain => 'Study this note';

  @override
  String cardsHeading(int count) {
    return 'Cards $count';
  }

  @override
  String deckMasteredShort(int count) {
    return '$count learned';
  }

  @override
  String get deckNameHint => 'e.g. TOEIC words';

  @override
  String get notesActions => 'Notes menu';

  @override
  String get saveAndAddCards => 'Save and add cards';

  @override
  String previousCardLabel(
    String answer,
    String front,
    String back,
    String changed,
  ) {
    String _temp0 = intl.Intl.selectLogic(changed, {
      'yes': '. Changed',
      'other': '',
    });
    return 'Card just seen, $answer. Front: $front. Back: $back$_temp0';
  }

  @override
  String get coachPrevious => 'Back';

  @override
  String get tabNotes => 'Notes';

  @override
  String lastWeekCards(int count) {
    return 'Last 7 days: $count';
  }

  @override
  String weekDayCards(String day, int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count cards',
      one: '1 card',
    );
    return '$day: $_temp0';
  }
}
