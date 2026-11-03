/// The deck domain: decks, the cards inside them, and the duplicate rule.
library;

export 'src/appearance_sheet.dart' show showDeckAppearanceSheet;
export 'src/add_cards.dart'
    show
        CardsAdded,
        DuplicateChoice,
        FromFile,
        FromPhoto,
        FromCopy,
        IncomingCard,
        AddSource,
        AddToDeck,
        AddToNewDeck,
        AddTarget,
        mergeBack;
export 'src/audio_block.dart' show playAudio;
export 'src/card_editor_screen.dart' show CardEditorScreen;
export 'src/new_deck_screen.dart' show NewDeck, NewDeckScreen;
export 'src/card_frame.dart'
    show
        BlankCell,
        Cell,
        CellSide,
        FrameProblem,
        PlacedCell,
        TextCell,
        UnknownCell,
        WordAsk,
        WordCell,
        cellsFromSides,
        cellsOf,
        decodeCells,
        encodeCells,
        frameKey,
        frameProblem,
        sidesOf;
export 'src/card_key.dart' show CardKey;
export 'src/card_list.dart'
    show CardBackRow, describeContent, spokenCells, spokenContent;
export 'src/card_template.dart' show isFramed;
export 'src/content.dart'
    show
        AudioContent,
        CardSense,
        ClozeContent,
        Content,
        ImageBox,
        ImageContent,
        OtherLabel,
        PartOfSpeech,
        PartOfSpeechLabel,
        SenseLabel,
        SensesContent,
        TableBlank,
        TableContent,
        TextContent,
        UnsupportedContent,
        audioOf,
        clozeBlank,
        decodeContent,
        encodeContent,
        decodeSense,
        plainText;
export 'src/card_text.dart' show CardScroll, cardSteps, steppedStyle;
export 'src/content_view.dart'
    show CardFit, ContentView, ShrinkFit, StepFit, contentSpan, sensesSpan;
export 'src/deck_repository.dart'
    show CardSaved, DeckRepository, DuplicateFront, SaveCardResult;
export 'src/deck_row.dart' show DeckLook, DeckRow, DeckTile;
export 'src/failure.dart'
    show DeckDeleted, DeckFailure, StorageFailure, UnreadableCard;
export 'src/failure_message.dart'
    show describeFailure, describeProviderError, reportingFailure;
export 'src/name_sheet.dart' show showNameSheet;
export 'src/label_presets.dart' show deckStorageKeys, deckStorageProvider;
export 'src/label_presets_screen.dart' show PartOfSpeechPresetsRow;
export 'src/model.dart'
    show
        Card,
        CardId,
        CardSource,
        Deck,
        DeckColor,
        DeckIcon,
        DeckId,
        DeckSelection,
        DeckVisibility,
        PrivateDeck,
        PublicDeck;
export 'src/providers.dart'
    show
        cardCountsProvider,
        cardsProvider,
        deckProvider,
        deckRepositoryProvider,
        decksProvider;
export 'src/split_card.dart' show SideBuilder, SplitCard;
export 'src/spreadsheet.dart'
    show
        OpenedFile,
        RefusedFile,
        Spreadsheet,
        SpreadsheetRefusal,
        parseSpreadsheet;
export 'src/spreadsheet_import.dart'
    show SpreadsheetPick, importFromSpreadsheet, spreadsheetPickProvider;
export 'src/whole_card_view.dart'
    show
        SteppedWholeCardView,
        WholeCardView,
        blankEms,
        cellsToDraw,
        drawnCellsOf,
        faceLength,
        isDrawnWhole;
