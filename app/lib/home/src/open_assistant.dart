import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../assistant/assistant.dart';
import '../../deck/deck.dart';
import '../../l10n/app_localizations.dart';
import '../../sync/sync.dart';
import 'above_menu.dart';
import 'deck_screen.dart';

/// Opens 말랑이's chat over the menu, from [note] when it is opened inside
/// one. A note it added opens over the chat, so back returns to the same
/// conversation.
Future<void> openAssistant(BuildContext context, {ChatNote? note}) =>
    Navigator.of(aboveMenu(context)).push(
      MaterialPageRoute<void>(
        builder: (_) => Consumer(
          builder: (context, ref, _) => AssistantChatScreen(
            note: note,
            openNote: (context, deckId) => _openNote(context, ref, deckId),
          ),
        ),
      ),
    );

/// Opens the note [deckId] over [context]'s screen. The note's cards were
/// written on the server, so a sync runs first, and is waited for where the
/// note is not on the device yet.
Future<void> _openNote(
  BuildContext context,
  WidgetRef ref,
  String deckId,
) async {
  final navigator = Navigator.of(context);
  final messenger = ScaffoldMessenger.of(context);
  final l10n = AppLocalizations.of(context);
  Deck? find() => switch (ref.read(decksProvider)) {
    AsyncData(value: final decks) =>
      decks.where((deck) => deck.id == DeckId(deckId)).firstOrNull,
    _ => null,
  };
  final sync = ref.read(syncControllerProvider).sync();
  var deck = find();
  if (deck == null) {
    await sync;
    deck = find();
  } else {
    unawaited(sync);
  }
  if (deck == null) {
    messenger.showSnackBar(
      SnackBar(content: Text(l10n.assistantNoteNotSynced)),
    );
    return;
  }
  final opened = deck;
  await navigator.push(
    MaterialPageRoute<void>(
      builder: (_) => DeckScreen(deck: opened, assistantEdge: false),
    ),
  );
}
