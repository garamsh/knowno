import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../design/app_button.dart';
import '../../design/app_text_field.dart';
import '../../design/bottom_actions.dart';
import '../../design/screen_skeleton.dart';
import '../../design/theme.dart';
import '../../l10n/app_localizations.dart';
import '../../media/media.dart';
import 'deck_appearance.dart';
import 'deck_row.dart';
import 'editor_group.dart';
import 'failure_message.dart';
import 'model.dart';
import 'providers.dart';

/// A deck made on 새 노트, and whether cards are to be added to it next.
typedef NewDeck = ({Deck deck, bool addCards});

/// 새 노트, shaped as 새 카드: the tile the deck will get, previewing what is
/// chosen, the name field, focused on opening, and the choices of
/// 노트 꾸미기 in a group, with "저장" beside "저장하고 카드 추가" at the foot.
/// Makes the deck with the look chosen, a photo stored through `media`
/// first, and pops with it.
class NewDeckScreen extends ConsumerStatefulWidget {
  const NewDeckScreen({super.key});

  @override
  ConsumerState<NewDeckScreen> createState() => _NewDeckScreenState();
}

class _NewDeckScreenState extends ConsumerState<NewDeckScreen> {
  final _name = TextEditingController();
  var _look = const DeckLook();
  var _showRequired = false;
  var _busy = false;

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  Future<void> _save({required bool addCards}) async {
    final name = _name.text.trim();
    if (name.isEmpty) {
      setState(() => _showRequired = true);
      return;
    }
    final repository = ref.read(deckRepositoryProvider);
    final navigator = Navigator.of(context);
    setState(() => _busy = true);
    Deck? made;
    await reportingFailure(context, () async {
      final image = switch (_look.image) {
        PickedTileImage(:final image) =>
          await ref.read(mediaStoreProvider).addImage(image),
        _ => null,
      };
      made = await repository.createDeck(
        name,
        icon: _look.icon,
        color: _look.color,
        image: image,
      );
    });
    if (!mounted) return;
    setState(() => _busy = false);
    if (made case final deck?) {
      navigator.pop<NewDeck>((deck: deck, addCards: addCards));
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    return ScreenSkeleton(
      title: l10n.newDeck,
      body: [
        SliverList.list(
          children: [
            // The tile the deck will get, over its name as typed.
            ExcludeSemantics(
              child: Column(
                spacing: AppSpace.s8,
                children: [
                  DeckTile(look: _look, size: AppSize.deckTile * 2),
                  ListenableBuilder(
                    listenable: _name,
                    builder: (context, _) {
                      final typed = _name.text.trim();
                      return Text(
                        typed.isEmpty ? l10n.deckName : typed,
                        textAlign: TextAlign.center,
                        style: AppType.bodyStrong.copyWith(
                          color: typed.isEmpty ? colors.muted : colors.ink,
                        ),
                      );
                    },
                  ),
                ],
              ),
            ),
            const SizedBox(height: AppSpace.s16),
            EditorGroup(
              children: [
                Padding(
                  padding: const EdgeInsets.all(AppSpace.s16),
                  // The field on the ground, so it shows inside the white
                  // group, the label above it at the group's inset.
                  child: Theme(
                    data: Theme.of(context).copyWith(
                      inputDecorationTheme: groupFieldTheme(colors)
                          .copyWith(fillColor: colors.ground),
                    ),
                    child: AppTextField(
                      label: l10n.deckName,
                      hint: l10n.deckNameHint,
                      controller: _name,
                      autofocus: true,
                      textInputAction: TextInputAction.done,
                      errorText: _showRequired ? l10n.deckNameRequired : null,
                      onSubmitted: (_) => _save(addCards: false),
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: AppSpace.s12),
            DeckAppearanceFields(
              look: _look,
              enabled: !_busy,
              onChanged: (look) => setState(() => _look = look),
            ),
          ],
        ),
      ],
      bottom: BottomActions(
        secondary: AppButton(
          label: l10n.save,
          variant: AppButtonVariant.secondary,
          size: AppButtonSize.cta,
          onPressed: _busy ? null : () => _save(addCards: false),
        ),
        primary: AppButton(
          label: l10n.saveAndAddCards,
          size: AppButtonSize.cta,
          onPressed: _busy ? null : () => _save(addCards: true),
        ),
      ),
    );
  }
}
