import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../design/app_button.dart';
import '../../design/app_sheet.dart';
import '../../design/theme.dart';
import '../../l10n/app_localizations.dart';
import '../../media/media.dart';
import 'deck_appearance.dart';
import 'deck_row.dart';
import 'failure.dart';
import 'failure_message.dart';
import 'model.dart';
import 'providers.dart';

/// Asks for [deck]'s icon, colour and photo in the 노트 꾸미기 sheet, previewed
/// on its tile. On "저장" it stores the photo chosen, or its removal, and
/// returns the icon and colour for the caller to store; null when the sheet
/// is dismissed, which stores nothing.
Future<(DeckIcon, DeckColor?)?> showDeckAppearanceSheet(
  BuildContext context, {
  required Deck deck,
}) => showAppSheet<(DeckIcon, DeckColor?)>(
  context,
  builder: (_) => _AppearanceSheet(deck: deck),
);

class _AppearanceSheet extends ConsumerStatefulWidget {
  const _AppearanceSheet({required this.deck});

  final Deck deck;

  @override
  ConsumerState<_AppearanceSheet> createState() => _AppearanceSheetState();
}

class _AppearanceSheetState extends ConsumerState<_AppearanceSheet> {
  late var _look = DeckLook.of(widget.deck);

  /// While the choice is stored.
  var _busy = false;

  /// Why storing the choice failed, shown under the photo's buttons; null
  /// while it did not.
  String? _problem;

  Future<void> _save() async {
    final l10n = AppLocalizations.of(context);
    final deck = widget.deck;
    final decks = ref.read(deckRepositoryProvider);
    setState(() {
      _busy = true;
      _problem = null;
    });
    try {
      switch (_look.image) {
        case PickedTileImage(:final image):
          final id = await ref.read(mediaStoreProvider).addImage(image);
          await decks.setImage(deck.id, id);
        case NoTileImage() when deck.image != null:
          await decks.setImage(deck.id, null);
        case _:
      }
    } on DeckFailure catch (failure) {
      if (mounted) {
        setState(() {
          _busy = false;
          _problem = describeFailure(l10n, failure);
        });
      }
      return;
    }
    if (mounted) Navigator.of(context).pop((_look.icon, _look.color));
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return AppSheet(
      title: l10n.deckAppearance,
      content: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        spacing: AppSpace.s12,
        children: [
          Center(
            child: DeckTile(look: _look, size: AppSize.deckTile * 2),
          ),
          DeckAppearanceFields(
            look: _look,
            enabled: !_busy,
            problem: _problem,
            onChanged: (look) => setState(() => _look = look),
          ),
        ],
      ),
      actions: [
        AppButton(
          label: l10n.save,
          size: AppButtonSize.cta,
          onPressed: _busy ? null : _save,
        ),
      ],
    );
  }
}
