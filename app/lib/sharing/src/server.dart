import '../../account/account.dart';
import '../../deck/deck.dart';
import 'model.dart';

/// The server's public decks, profiles, reports and blocks, for the signed-in
/// user.
///
/// Every method throws a [SharingFailure] on an expected failure.
abstract interface class SharingServer {
  /// The public decks the user may browse whose name or description holds
  /// [search], ignoring case, in [sort] order, up to [limit]. Decks of users
  /// the user blocked are absent.
  Future<List<PublicDeckSummary>> listDecks({
    required String search,
    required BrowseSort sort,
    required int limit,
  });

  /// The live cards of the public deck [deck], oldest first, up to [limit];
  /// all of them without one.
  Future<List<PublicCard>> listCards(DeckId deck, {int? limit});

  /// Records a copy of [deck]; false when it is no longer public.
  Future<bool> recordCopy(DeckId deck);

  Future<ReportOutcome> report(DeckId deck, ReportReason reason);

  /// Leaves [user]'s decks out of the user's listing from now on.
  Future<void> block(UserId user);

  /// The user's display name, or null before the first publish.
  Future<DisplayName?> displayName();

  Future<void> setDisplayName(DisplayName name);

  /// Writes [deck]'s visibility to the server as an edit made [at], creating
  /// the deck's row there when sync has not pushed it yet. A [PublicDeck]
  /// takes [description] and is asked of the server's screening, which
  /// answers before this returns with where it has the note: public,
  /// checking, held or refused. A private one keeps the description it had
  /// and answers [DeckPublication.private].
  Future<Screening> writeVisibility(
    Deck deck,
    DeckVisibility visibility, {
    String? description,
    required DateTime at,
  });
}
