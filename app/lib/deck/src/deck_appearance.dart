import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../design/app_button.dart';
import '../../design/app_section_label.dart';
import '../../design/theme.dart';
import '../../l10n/app_localizations.dart';
import '../../media/media.dart';
import 'deck_row.dart';
import 'editor_group.dart';
import 'model.dart';

/// The choices of a deck's look, as 노트 꾸미기 and 새 노트 offer them, each
/// a group: "아이콘", the fourteen icons, "색", the offered colours, and
/// "사진", "앨범에서 고르기" and "사진 찍기"; while [look] holds a photo, the
/// icon and colour fold and "사진" offers "다른 사진" and "사진 삭제". Each
/// choice hands the new look to [onChanged]. A photo that cannot be read
/// says so under the photo's buttons, where [problem], the caller's own
/// failure, shows too.
class DeckAppearanceFields extends ConsumerStatefulWidget {
  const DeckAppearanceFields({
    super.key,
    required this.look,
    required this.onChanged,
    this.enabled = true,
    this.problem,
  });

  final DeckLook look;
  final ValueChanged<DeckLook> onChanged;

  /// False while the caller stores the choice.
  final bool enabled;

  final String? problem;

  @override
  ConsumerState<DeckAppearanceFields> createState() =>
      _DeckAppearanceFieldsState();
}

class _DeckAppearanceFieldsState extends ConsumerState<DeckAppearanceFields> {
  /// While a photo is being picked.
  var _picking = false;

  /// Why the last pick failed; null while it did not.
  String? _unreadable;

  Future<void> _pick(ImageOrigin origin) async {
    final l10n = AppLocalizations.of(context);
    setState(() {
      _picking = true;
      _unreadable = null;
    });
    try {
      final picked = await ref.read(imagePickProvider).pick(origin);
      if (picked != null && mounted) {
        widget.onChanged(widget.look.withImage(PickedTileImage(picked)));
      }
    } on MediaUnreadable {
      if (mounted) setState(() => _unreadable = l10n.deckImageUnreadable);
    } finally {
      if (mounted) setState(() => _picking = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    final look = widget.look;
    final enabled = widget.enabled && !_picking;
    final problem = widget.problem ?? _unreadable;
    final photo = look.image is! NoTileImage;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      spacing: AppSpace.s12,
      children: [
        // A photo covers the icon and the colour, so they fold while one
        // is shown.
        if (!photo) ...[
          _Group(
            label: l10n.deckAppearanceIcon,
            child: Wrap(
              spacing: AppSpace.s8,
              runSpacing: AppSpace.s8,
              children: [
                for (final icon in DeckIcon.values)
                  _Option(
                    label: l10n.deckIconName(icon.key),
                    selected: icon == look.icon,
                    onTap: () => widget.onChanged(look.withIcon(icon)),
                    fill: icon == look.icon ? colors.brandTint : colors.ground,
                    child: Icon(deckIconData(icon), color: colors.ink),
                  ),
              ],
            ),
          ),
          _Group(
            label: l10n.deckAppearanceColor,
            child: Wrap(
              spacing: AppSpace.s8,
              runSpacing: AppSpace.s8,
              children: [
                for (final color in DeckColor.offered)
                  _Option(
                    label: l10n.deckColorName(color.key),
                    selected: color == look.color,
                    onTap: () => widget.onChanged(look.withColor(color)),
                    fill: deckTileColor(colors, color),
                  ),
              ],
            ),
          ),
        ],
        _Group(
          label: l10n.deckAppearanceImage,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            spacing: AppSpace.s8,
            children: [
              AppButton(
                label: photo ? l10n.deckImageAnother : l10n.deckImageFromAlbum,
                icon: LucideIcons.image,
                variant: AppButtonVariant.secondary,
                onPressed: enabled ? () => _pick(ImageOrigin.album) : null,
              ),
              if (photo)
                AppButton(
                  label: l10n.deckImageRemove,
                  variant: AppButtonVariant.secondary,
                  onPressed: enabled
                      ? () => widget.onChanged(
                          look.withImage(const NoTileImage()),
                        )
                      : null,
                )
              else
                AppButton(
                  label: l10n.deckImageFromCamera,
                  icon: LucideIcons.camera,
                  variant: AppButtonVariant.secondary,
                  onPressed: enabled ? () => _pick(ImageOrigin.camera) : null,
                ),
              if (problem != null)
                Semantics(
                  liveRegion: true,
                  child: Text(
                    problem,
                    style: AppType.caption.copyWith(color: colors.dontKnowText),
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }
}

/// One white group of the choices, headed by [label].
class _Group extends StatelessWidget {
  const _Group({required this.label, required this.child});

  final String label;
  final Widget child;

  @override
  Widget build(BuildContext context) => EditorGroup(
    children: [
      Padding(
        padding: const EdgeInsets.all(AppSpace.s16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          spacing: AppSpace.s12,
          children: [AppSectionLabel(label), child],
        ),
      ),
    ],
  );
}

/// One choice: a rounded target at least 48 square, named by [label] and
/// read as selected or not, ringed while [selected].
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
