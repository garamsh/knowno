import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../deck/deck.dart';
import 'photo_imports.dart';
import 'photo_source.dart';

/// How a photo import ended, when it did not end with nothing.
sealed class PhotoImportOutcome {
  const PhotoImportOutcome();
}

/// The cards were saved into [deck].
final class PhotoImportSaved extends PhotoImportOutcome {
  const PhotoImportSaved(this.deck);

  final Deck deck;
}

/// Photo import was unavailable, and the user chose to add [deck]'s cards
/// by hand instead.
final class AddByHandInstead extends PhotoImportOutcome {
  const AddByHandInstead(this.deck);

  final DeckId deck;
}

/// Photo import was unavailable, and the user chose to add [deck]'s cards
/// from a spreadsheet instead.
final class AddFromSpreadsheetInstead extends PhotoImportOutcome {
  const AddFromSpreadsheetInstead(this.deck);

  final DeckId deck;
}

/// Adds cards from a photo to [deck], or creates a deck from one when [deck]
/// is null, starting from the camera or the library, as [origin] names, over
/// [context]. Resolves to how it ended, or to null when the user cancelled
/// or left without saving.
typedef PhotoImport = Future<PhotoImportOutcome?> Function(
  BuildContext context,
  DeckId? deck,
  PhotoOrigin origin,
);

/// The photo import; null while the app has no extraction client, which
/// hides the buttons that start it. The composition site overrides it when
/// it has a client.
final photoImportProvider = Provider<PhotoImport?>((ref) => null);

/// The app's photo import jobs, for the bar over the tab bar and the offer
/// to resume a job a closed app left; null while the app has no extraction
/// client. The composition site overrides it with the one [photoImportProvider]
/// starts imports in.
final photoImportsProvider = Provider<PhotoImports?>((ref) => null);

/// Opens the offer of a plan with a higher limit over a context, or null where
/// none is to be made: an admin, a 무제한 holder and a plan that has no
/// higher one are never offered it. The composition site overrides it.
final photoLimitOfferProvider = Provider<Future<void> Function(BuildContext)?>(
  (ref) => null,
);
