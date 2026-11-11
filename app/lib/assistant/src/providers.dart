import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'assistant_client.dart';
import '../../photo_import/photo_import.dart';
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

/// Where a photo for the chat is taken or picked; null hides the chat's
/// photo button. The composition site overrides it.
final assistantPhotoSourceProvider = Provider<PhotoSource?>((ref) => null);

/// The clock 홈's chat bubble reads the local day from; a test sets it.
final assistantClockProvider = Provider<DateTime Function()>(
  (ref) => DateTime.now,
);

/// Whether 홈's chat bubble may show today: at most once per local day, kept
/// on this device and not synced.
final assistantInviteProvider = Provider<ChatInvite>((ref) {
  if (ref.watch(assistantClientProvider) == null) return const ChatInvite.off();
  return ChatInvite._(
    ref.watch(assistantStorageProvider),
    ref.watch(assistantClockProvider),
  );
});

class ChatInvite {
  const ChatInvite._(this._storage, this._clock);

  /// With no assistant: never due.
  const ChatInvite.off() : _storage = null, _clock = null;

  final SharedPreferencesWithCache? _storage;
  final DateTime Function()? _clock;

  String get _today {
    final now = _clock!();
    String two(int n) => n.toString().padLeft(2, '0');
    return '${now.year}-${two(now.month)}-${two(now.day)}';
  }

  /// Whether the bubble has not shown on today's date.
  bool due() => _storage != null && _storage.getString(inviteDayKey) != _today;

  /// Records that the bubble showed today.
  void spend() {
    if (_storage == null) return;
    unawaited(_storage.setString(inviteDayKey, _today));
  }
}
