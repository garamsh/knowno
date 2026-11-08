/// The assistant domain: the chat with 말랑이, one conversation kept on the
/// device, its streamed replies, and the proposals the user adds as notes
/// and cards.
library;

export 'src/assistant_client.dart'
    show AssistantClient, HttpAssistantClient, assistantUrl;
export 'src/assistant_controller.dart' show ChatNote, assistantStorageKeys;
export 'src/chat_screen.dart' show AssistantChatScreen, OpenNote;
export 'src/device_time_zone.dart' show deviceTimeZone;
export 'src/edge_assistant.dart'
    show EdgeAssistant, edgeReserve, edgeReturnDelay, edgeSize;
export 'src/supabase_photo_store.dart' show SupabasePhotoStore;
export 'src/providers.dart'
    show
        assistantClientProvider,
        assistantPhotoSourceProvider,
        assistantReadyCardsProvider,
        assistantStorageProvider;
