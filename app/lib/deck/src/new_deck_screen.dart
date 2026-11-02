import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../design/app_button.dart';
import '../../design/app_section_label.dart';
import '../../design/app_text_field.dart';
import '../../design/bottom_actions.dart';
import '../../design/theme.dart';
import '../../l10n/app_localizations.dart';
import 'appearance_sheet.dart';
import 'editor_group.dart';
import 'failure_message.dart';
import 'model.dart';
import 'providers.dart';

/// A deck made on 새 노트, and whether cards are to be added to it next.
typedef NewDeck = ({Deck deck, bool addCards});

/// 새 노트, shaped as 새 카드: the name and the cover colour in their groups,
/// and "저장" beside "저장하고 카드 추가" at the foot. Makes the deck with the
/// colour chosen, if any, and pops with it.
class NewDeckScreen extends ConsumerStatefulWidget {
  const NewDeckScreen({super.key});

  @override
  ConsumerState<NewDeckScreen> createState() => _NewDeckScreenState();
}

class _NewDeckScreenState extends ConsumerState<NewDeckScreen> {
  final _name = TextEditingController();
  DeckColor? _color;
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
      final deck = await repository.createDeck(name);
      if (_color case final color?) {
        await repository.setAppearance(deck.id, DeckIcon.fallback, color);
      }
      made = deck;
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
    return Scaffold(
      appBar: AppBar(
        title: Semantics(
          header: true,
          child: Text(l10n.newDeck, style: AppType.title),
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(
          AppSpace.gutter,
          AppSpace.s8,
          AppSpace.gutter,
          AppSpace.s24,
        ),
        children: [
          EditorGroup(
            children: [
              Padding(
                padding: const EdgeInsets.all(groupInset),
                child: AppTextField(
                  label: l10n.deckName,
                  controller: _name,
                  autofocus: true,
                  textInputAction: TextInputAction.done,
                  errorText: _showRequired ? l10n.deckNameRequired : null,
                  onSubmitted: (_) => _save(addCards: false),
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpace.s16),
          EditorGroup(
            children: [
              Padding(
                padding: const EdgeInsets.all(AppSpace.s16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  spacing: AppSpace.s12,
                  children: [
                    AppSectionLabel(l10n.newDeckColor),
                    DeckColorPicker(
                      selected: _color,
                      onPick: (color) => setState(() => _color = color),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ],
      ),
      bottomNavigationBar: BottomActions(
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
