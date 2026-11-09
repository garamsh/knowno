import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../design/app_chip.dart';
import '../../design/app_list_row.dart';
import '../../design/theme.dart';
import '../../design/word_break.dart';
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
              DeckTile(look: DeckLook.of(deck)),
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
                          child: Text(
                            keepWords(deck.name),
                            semanticsLabel: deck.name,
                            style: AppType.bodyStrong,
                          ),
                        ),
                        if (publicationLabel(l10n, deck.publication)
                            case final label?)
                          AppChip(label: label),
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

/// A deck's look, [image] or else [icon] on [color], on a rounded tile;
/// decorative, beside the name. No [color] draws the brand tint, a colour of
/// the palette being only what the user chose (ADR 0145); an image not yet
/// on the device shows the icon until it is. [size] is the tile's side.
class DeckTile extends StatelessWidget {
  const DeckTile({super.key, required this.look, this.size = AppSize.deckTile});

  final DeckLook look;
  final double size;

  @override
  Widget build(BuildContext context) {
    final colors = AppColors.of(context);
    final color = look.color;
    final radius = BorderRadius.circular(AppRadius.field);
    final iconTile = Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: color == null ? colors.brandTint : deckTileColor(colors, color),
        borderRadius: radius,
      ),
      child: Icon(deckIconData(look.icon), size: size / 2, color: colors.ink),
    );
    final picture = switch (look.image) {
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

/// What a deck's tile draws: its [image], or else its [icon] on its [color],
/// none being the brand tint. A deck's own, or a choice being made for one.
final class DeckLook {
  const DeckLook({
    this.icon = DeckIcon.fallback,
    this.color,
    this.image = const NoTileImage(),
  });

  /// [deck]'s look: an icon or colour this build does not know reads as
  /// none.
  DeckLook.of(Deck deck)
    : icon = deck.icon ?? DeckIcon.fallback,
      color = deck.color,
      image = TileImage.of(deck);

  final DeckIcon icon;
  final DeckColor? color;
  final TileImage image;

  DeckLook withIcon(DeckIcon icon) =>
      DeckLook(icon: icon, color: color, image: image);
  DeckLook withColor(DeckColor color) =>
      DeckLook(icon: icon, color: color, image: image);
  DeckLook withImage(TileImage image) =>
      DeckLook(icon: icon, color: color, image: image);
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

/// The chip for where the server has a note; null for a private one.
String? publicationLabel(AppLocalizations l10n, DeckPublication publication) =>
    switch (publication) {
      DeckPublication.public => l10n.publicChip,
      DeckPublication.checking => l10n.publicationChecking,
      DeckPublication.held => l10n.publicationHeld,
      DeckPublication.refused => l10n.publicationRefused,
      DeckPublication.private => null,
    };

/// The one sentence of why a note is not public; null while it is, or
/// private by its owner's choice.
String? publicationWhy(AppLocalizations l10n, DeckPublication publication) =>
    switch (publication) {
      DeckPublication.checking => l10n.publicationCheckingWhy,
      DeckPublication.held => l10n.publicationHeldWhy,
      DeckPublication.refused => l10n.publicationRefusedWhy,
      DeckPublication.public || DeckPublication.private => null,
    };
