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

/// The edge the character rests at.
enum EdgeSide { left, right }

/// Which edge the character rests at on this device, the right until the
/// user drags it to the left.
final assistantEdgeSideProvider = NotifierProvider<EdgeSideNotifier, EdgeSide>(
  EdgeSideNotifier.new,
);

class EdgeSideNotifier extends Notifier<EdgeSide> {
  @override
  EdgeSide build() =>
      ref.watch(assistantStorageProvider).getString(edgeSideKey) == 'left'
      ? EdgeSide.left
      : EdgeSide.right;

  void rest(EdgeSide side) {
    state = side;
    unawaited(
      ref.read(assistantStorageProvider).setString(edgeSideKey, side.name),
    );
  }
}

/// Whether the one-time hint beside the character has shown and gone, on
/// this device.
final assistantHintShownProvider = NotifierProvider<HintShownNotifier, bool>(
  HintShownNotifier.new,
);

class HintShownNotifier extends Notifier<bool> {
  @override
  bool build() =>
      ref.watch(assistantStorageProvider).getBool(edgeHintShownKey) ?? false;

  void dismiss() {
    if (state) return;
    state = true;
    unawaited(
      ref.read(assistantStorageProvider).setBool(edgeHintShownKey, true),
    );
  }
}
