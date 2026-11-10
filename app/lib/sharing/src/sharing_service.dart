import 'package:flutter/material.dart' hide Card;

import '../../account/account.dart';
import '../../deck/deck.dart';
import '../../l10n/app_localizations.dart';
import 'browse_screen.dart';
import 'failure.dart';
import 'failure_message.dart';
import 'model.dart';
import 'publish_sheet.dart';
import 'reachability.dart';
import 'server.dart';

/// How a copy saves into the user's decks.
sealed class CopyTarget {
  const CopyTarget();
}

/// Into a new deck named after the public one.
final class CopyIntoNewDeck extends CopyTarget {
  const CopyIntoNewDeck();
}

/// Into the user's [deck], where each card whose key the deck already holds
/// does what [onDuplicate] says.
final class CopyIntoDeck extends CopyTarget {
  const CopyIntoDeck(this.deck, this.onDuplicate);

  final DeckId deck;
  final DuplicateChoice onDuplicate;
}

/// Sharing decks between users: browsing, previewing, copying, reporting and
/// blocking others' public decks, and publishing the user's own.
///
/// Every server call throws a [SharingFailure] on an expected failure, and
/// every local write a [DeckFailure].
class SharingService {
  SharingService({
    required this.server,
    required this.decks,
    required this.reachability,
    required this.clock,
  });

  final SharingServer server;
  final DeckRepository decks;
  final Reachability reachability;
  final DateTime Function() clock;

  /// How many decks the listing shows.
  static const listLimit = 100;

  /// How many cards a preview shows.
  static const previewLimit = 20;

  /// Whether the device is online now, kept current. Publishing needs the
  /// network, so the deck menu disables it while offline.
  Stream<bool> watchOnline() => reachability.watchOnline();

  /// The screen that browses other users' public decks.
  Widget browseScreen() => BrowseScreen(sharing: this);

  /// Asks for what publishing [deck] needs and publishes it, reporting a
  /// failure to the user itself. [openCard] opens a card a finding names.
  Future<void> publish(
    BuildContext context,
    Deck deck, {
    required void Function(CardId card) openCard,
  }) =>
      showPublishSheet(context, sharing: this, deck: deck, openCard: openCard);

  /// The cards of [deck], which a finding names by id.
  Future<List<Card>> cardsOf(DeckId deck) => decks.listCards(deck);

  /// Makes [deck] private again, reporting a failure to the user itself.
  Future<void> unpublish(BuildContext context, Deck deck) async {
    final messenger = ScaffoldMessenger.of(context);
    final l10n = AppLocalizations.of(context);
    final message = await describing(l10n, () async {
      await makePrivate(deck.id);
      return l10n.unpublished;
    });
    messenger.showSnackBar(SnackBar(content: Text(message)));
  }

  Future<List<PublicDeckSummary>> listDecks(String search, BrowseSort sort) =>
      server.listDecks(search: search.trim(), sort: sort, limit: listLimit);

  Future<List<PublicCard>> preview(DeckId deck) =>
      server.listCards(deck, limit: previewLimit);

  /// Copies every card of [deck] into the user's decks as [target] says, as
  /// ordinary cards that record where they came from. Refused with
  /// [DeckNoLongerPublic] once the deck is no longer public.
  Future<CardsAdded> copy(PublicDeckSummary deck, CopyTarget target) async {
    final cards = await server.listCards(deck.id);
    if (!await server.recordCopy(deck.id)) throw const DeckNoLongerPublic();
    final onDuplicate = switch (target) {
      CopyIntoNewDeck() => DuplicateChoice.addNew,
      CopyIntoDeck(:final onDuplicate) => onDuplicate,
    };
    return decks.addCards(
      switch (target) {
        CopyIntoNewDeck() => AddToNewDeck(deck.name),
        CopyIntoDeck(:final deck) => AddToDeck(deck),
      },
      [
        for (final card in cards)
          IncomingCard(
            front: card.front,
            back: card.back,
            cells: card.cells,
            onDuplicate: onDuplicate,
          ),
      ],
      source: FromCopy(deck.id, owner: deck.owner.value),
    );
  }

  Future<ReportOutcome> report(DeckId deck, ReportReason reason) =>
      server.report(deck, reason);

  Future<void> block(UserId user) => server.block(user);

  Future<DisplayName?> displayName() => server.displayName();

  /// Publishes the deck [id] on the server, then on the device as the
  /// server's screening answered: public, or still checking or held, which
  /// sync then keeps as the server has it, or refused, which leaves the deck
  /// private. Sets the user's display name first when [name] is given.
  Future<Screening> makePublic(
    DeckId id, {
    DisplayName? name,
    String? description,
  }) async {
    if (name != null) await server.setDisplayName(name);
    final deck = await decks.getDeck(id);
    final at = clock();
    final visibility = PublicDeck(at);
    final screening = await server.writeVisibility(
      deck,
      visibility,
      description: description,
      at: at,
    );
    await decks.setVisibility(id, switch (screening.state) {
      DeckPublication.public => visibility,
      DeckPublication.checking => CheckingDeck(at),
      DeckPublication.held => HeldDeck(at),
      DeckPublication.refused => const RefusedDeck(),
      DeckPublication.private => const PrivateDeck(),
    }, description: description);
    return screening;
  }

  /// Makes the deck [id] private on the server, then on the device.
  Future<void> makePrivate(DeckId id) async {
    final deck = await decks.getDeck(id);
    const visibility = PrivateDeck();
    await server.writeVisibility(deck, visibility, at: clock());
    await decks.setVisibility(id, visibility);
  }
}

/// Runs [action] and returns its message, or the message for the sharing or
/// deck failure it raised. Any other exception propagates.
Future<String> describing(
  AppLocalizations l10n,
  Future<String> Function() action,
) async {
  try {
    return await action();
  } on SharingFailure catch (failure) {
    return describeSharingFailure(l10n, failure);
  } on DeckFailure catch (failure) {
    return describeFailure(l10n, failure);
  }
}
