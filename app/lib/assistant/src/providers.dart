import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'assistant_client.dart';
import 'assistant_controller.dart';
import 'protocol.dart';

/// The assistant; null while the app has no Supabase project, which hides
/// every way into the chat. The composition site overrides it.
final assistantClientProvider = Provider<AssistantClient?>((ref) => null);

/// Where the conversation and its draft are kept. The composition site
/// overrides it with the app's preferences; it is read only once
/// [assistantClientProvider] holds a client.
final assistantStorageProvider = Provider<SharedPreferencesWithCache>(
  (ref) => throw UnimplementedError(
    'assistantStorageProvider is overridden at the composition site',
  ),
);

/// The chat: its conversation, what it is doing and the day's tokens.
final assistantProvider = NotifierProvider<AssistantController, ChatState>(
  AssistantController.new,
);

/// How many cards 말랑이 has ready, for 홈's bubble; 0 for none.
final assistantReadyCardsProvider = Provider<int>((ref) {
  if (ref.watch(assistantClientProvider) == null) return 0;
  return ref.watch(
    assistantProvider.select((chat) {
      final ready = chat.conversation.ready;
      return ready != null && ready.proposal.kind == ProposalKind.cards
          ? ready.checkedCount
          : 0;
    }),
  );
});
