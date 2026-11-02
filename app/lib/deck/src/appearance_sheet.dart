import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../design/app_button.dart';
import '../../design/app_section_label.dart';
import '../../design/app_sheet.dart';
import '../../design/theme.dart';
import '../../l10n/app_localizations.dart';
import '../../media/media.dart';
import 'deck_row.dart';
import 'failure.dart';
import 'failure_message.dart';
import 'model.dart';
import 'providers.dart';

/// Asks for [deck]'s icon, colour and photo in the 덱 꾸미기 sheet, previewed
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
  late DeckIcon _icon = widget.deck.icon ?? DeckIcon.fallback;

  /// The colour chosen, or none, which leaves the tile on the brand tint.
  late DeckColor? _color = widget.deck.color;
  late TileImage _image = TileImage.of(widget.deck);

  /// While a photo is being picked or the choice stored.
  var _busy = false;

  /// What went wrong with the last pick or save, shown under the photo's
  /// buttons; null while nothing did.
  String? _problem;

  Future<void> _pick(ImageOrigin origin) async {
    final l10n = AppLocalizations.of(context);
    setState(() {
      _busy = true;
      _problem = null;
    });
    try {
      final picked = await ref.read(imagePickProvider).pick(origin);
      if (picked != null && mounted) {
        setState(() => _image = PickedTileImage(picked));
      }
    } on MediaUnreadable {
      if (mounted) setState(() => _problem = l10n.deckImageUnreadable);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _save() async {
    final l10n = AppLocalizations.of(context);
    final deck = widget.deck;
    final decks = ref.read(deckRepositoryProvider);
    setState(() {
      _busy = true;
      _problem = null;
    });
    try {
      switch (_image) {
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
    if (mounted) Navigator.of(context).pop((_icon, _color));
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    return AppSheet(
      title: l10n.deckAppearance,
      content: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        spacing: AppSpace.s12,
        children: [
          Center(
            child: DeckTile(
              deck: widget.deck,
              icon: _icon,
              color: _color,
              image: _image,
              size: AppSize.deckTile * 2,
            ),
          ),
          AppSectionLabel(l10n.deckAppearanceIcon),
          Wrap(
            spacing: AppSpace.s8,
            runSpacing: AppSpace.s8,
            children: [
              for (final icon in DeckIcon.values)
                _Option(
                  label: l10n.deckIconName(icon.key),
                  selected: icon == _icon,
                  onTap: () => setState(() => _icon = icon),
                  fill: icon == _icon ? colors.brandTint : null,
                  child: Icon(deckIconData(icon), color: colors.ink),
                ),
            ],
          ),
          AppSectionLabel(l10n.deckAppearanceColor),
          Wrap(
            spacing: AppSpace.s8,
            runSpacing: AppSpace.s8,
            children: [
              for (final color in DeckColor.values)
                _Option(
                  label: l10n.deckColorName(color.key),
                  selected: color == _color,
                  onTap: () => setState(() => _color = color),
                  fill: deckTileColor(colors, color),
                ),
            ],
          ),
          AppSectionLabel(l10n.deckAppearanceImage),
          Wrap(
            spacing: AppSpace.s8,
            runSpacing: AppSpace.s8,
            children: [
              AppButton(
                label: l10n.deckImageFromAlbum,
                variant: AppButtonVariant.secondary,
                onPressed: _busy ? null : () => _pick(ImageOrigin.album),
              ),
              AppButton(
                label: l10n.deckImageFromCamera,
                variant: AppButtonVariant.secondary,
                onPressed: _busy ? null : () => _pick(ImageOrigin.camera),
              ),
              if (_image is! NoTileImage)
                AppButton(
                  label: l10n.deckImageRemove,
                  variant: AppButtonVariant.text,
                  onPressed: _busy
                      ? null
                      : () => setState(() => _image = const NoTileImage()),
                ),
            ],
          ),
          if (_problem case final problem?)
            Semantics(
              liveRegion: true,
              child: Text(
                problem,
                style: AppType.caption.copyWith(color: colors.dontKnowText),
              ),
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

/// One choice in the sheet: a rounded target at least 48 square, named by
/// [label] and read as selected or not, ringed in ink while [selected].
class _Option extends StatelessWidget {
  const _Option({
    required this.label,
    required this.selected,
    required this.onTap,
    this.fill,
    this.child,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;
  final Color? fill;
  final Widget? child;

  @override
  Widget build(BuildContext context) {
    final colors = AppColors.of(context);
    final radius = BorderRadius.circular(AppRadius.field);
    return Semantics(
      button: true,
      selected: selected,
      label: label,
      excludeSemantics: true,
      child: Material(
        color: fill ?? colors.surface,
        shape: RoundedRectangleBorder(
          borderRadius: radius,
          side: BorderSide(
            color: selected ? colors.accent : colors.outline,
            width: selected ? 2 : 1,
          ),
        ),
        child: InkWell(
          borderRadius: radius,
          onTap: onTap,
          child: SizedBox.square(
            dimension: AppSize.tapTarget + AppSpace.s4,
            child: Center(child: child),
          ),
        ),
      ),
    );
  }
}
