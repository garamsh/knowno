import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../design/app_chip.dart';
import '../../design/app_list_row.dart';
import '../../design/theme.dart';
import '../../l10n/app_localizations.dart';
import '../../media/media.dart';
import 'model.dart';

/// A deck on a row: its tile, its name with "공개" when it is published and
/// [today] beside them, and [progress] under them, or its card count while
/// [progress] is null. A tap calls [onOpen].
class DeckRow extends StatelessWidget {
  const DeckRow({
    super.key,
    required this.deck,
    required this.cardCount,
    required this.onOpen,
    this.today,
    this.progress,
  });

  final Deck deck;
  final int cardCount;

  /// Opens the deck.
  final VoidCallback onOpen;

  /// What the deck holds for today, as its caller draws it.
  final Widget? today;

  /// How far the deck's cards have come, as its caller draws it.
  final Widget? progress;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    return MergeSemantics(
      child: AppRowSurface(
        onTap: onOpen,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(
            AppSpace.s16,
            AppSpace.s12,
            AppSpace.s12,
            AppSpace.s12,
          ),
          child: Row(
            spacing: AppSpace.s12,
            children: [
              DeckTile(deck: deck),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  mainAxisSize: MainAxisSize.min,
                  spacing: AppSpace.s4,
                  children: [
                    Row(
                      spacing: AppSpace.s8,
                      children: [
                        Expanded(
                          child: Text(deck.name, style: AppType.bodyStrong),
                        ),
                        if (deck.visibility is PublicDeck)
                          AppChip(label: l10n.publicChip),
                        ?today,
                      ],
                    ),
                    progress ??
                        Text(
                          l10n.cardCount(cardCount),
                          style: AppType.caption.copyWith(color: colors.muted),
                        ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// The deck's image, or else its icon on its colour, on a rounded tile;
/// decorative, beside the name. A deck that holds no icon or colour this
/// build knows shows [DeckIcon.fallback] on the brand tint, a colour of the
/// palette being only what the user chose (ADR 0145); an image not yet on the
/// device shows the icon until it is.
///
/// [icon], [color] and [image] are drawn in place of the deck's own, as the
/// 노트 꾸미기 sheet previews a choice; [size] is the tile's side.
class DeckTile extends StatelessWidget {
  const DeckTile({
    super.key,
    required this.deck,
    this.icon,
    this.color,
    this.image,
    this.size = AppSize.deckTile,
  });

  final Deck deck;
  final DeckIcon? icon;
  final DeckColor? color;
  final TileImage? image;
  final double size;

  @override
  Widget build(BuildContext context) {
    final colors = AppColors.of(context);
    final shown = color ?? deck.color;
    final radius = BorderRadius.circular(AppRadius.field);
    final iconTile = Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: shown == null ? colors.brandTint : deckTileColor(colors, shown),
        borderRadius: radius,
      ),
      child: Icon(
        deckIconData(icon ?? deck.icon ?? DeckIcon.fallback),
        size: size / 2,
        color: colors.ink,
      ),
    );
    final picture = switch (image ?? TileImage.of(deck)) {
      StoredTileImage(:final id) => MediaImage(id, fallback: iconTile),
      PickedTileImage(:final image) => Image.memory(
        image.bytes,
        fit: BoxFit.cover,
      ),
      NoTileImage() => null,
    };
    return ExcludeSemantics(
      child: picture == null
          ? iconTile
          : ClipRRect(
              borderRadius: radius,
              child: SizedBox.square(dimension: size, child: picture),
            ),
    );
  }
}

/// What a [DeckTile] draws in place of its icon.
sealed class TileImage {
  const TileImage();

  /// The image [deck] stores, or none.
  static TileImage of(Deck deck) => switch (deck.image) {
    final id? => StoredTileImage(id),
    null => const NoTileImage(),
  };
}

/// An image stored under [id].
final class StoredTileImage extends TileImage {
  const StoredTileImage(this.id);

  final MediaId id;
}

/// An image picked and not yet stored.
final class PickedTileImage extends TileImage {
  const PickedTileImage(this.image);

  final PreparedImage image;
}

/// No image: the tile draws its icon.
final class NoTileImage extends TileImage {
  const NoTileImage();
}

/// The line icon drawn for [icon].
IconData deckIconData(DeckIcon icon) => switch (icon) {
  DeckIcon.layers => LucideIcons.layers,
  DeckIcon.book => LucideIcons.bookOpen,
  DeckIcon.languages => LucideIcons.languages,
  DeckIcon.pencil => LucideIcons.pencil,
  DeckIcon.flask => LucideIcons.flaskConical,
  DeckIcon.calculator => LucideIcons.calculator,
  DeckIcon.globe => LucideIcons.globe,
  DeckIcon.music => LucideIcons.music,
  DeckIcon.palette => LucideIcons.palette,
  DeckIcon.brain => LucideIcons.brain,
  DeckIcon.code => LucideIcons.code,
  DeckIcon.landmark => LucideIcons.landmark,
  DeckIcon.briefcase => LucideIcons.briefcase,
  DeckIcon.star => LucideIcons.star,
};

/// The tile's fill for [color], from the theme's deck palette.
Color deckTileColor(AppColors colors, DeckColor color) => switch (color) {
  DeckColor.blue => colors.deckBlue,
  DeckColor.sky => colors.deckSky,
  DeckColor.violet => colors.deckPeach,
  DeckColor.amber => colors.deckAmber,
  DeckColor.slate => colors.deckSlate,
  DeckColor.sand => colors.deckSand,
};
