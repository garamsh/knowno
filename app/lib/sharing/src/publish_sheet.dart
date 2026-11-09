import 'package:flutter/material.dart' hide Card;
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../deck/deck.dart';
import '../../design/app_button.dart';
import '../../design/app_list_row.dart';
import '../../design/app_sheet.dart';
import '../../design/app_text_field.dart';
import '../../design/theme.dart';
import '../../design/word_break.dart';
import '../../l10n/app_localizations.dart';
import 'failure.dart';
import 'failure_message.dart';
import 'model.dart';
import 'sharing_service.dart';

/// Publishes [deck]: asks for the user's display name the first time, an
/// optional description, and the agreement not to publish inappropriate or
/// copyrighted content, which "공개" requires. Waits for the server's check
/// and says in a snack bar once published; a note held or refused says why in
/// the sheet, and a finding opens its card through [openCard].
Future<void> showPublishSheet(
  BuildContext context, {
  required SharingService sharing,
  required Deck deck,
  required void Function(CardId card) openCard,
}) async {
  final messenger = ScaffoldMessenger.of(context);
  final message = await showAppSheet<String>(
    context,
    builder: (_) =>
        _PublishSheet(sharing: sharing, deck: deck, openCard: openCard),
  );
  if (message != null) {
    messenger.showSnackBar(SnackBar(content: Text(message)));
  }
}

class _PublishSheet extends StatefulWidget {
  const _PublishSheet({
    required this.sharing,
    required this.deck,
    required this.openCard,
  });

  final SharingService sharing;
  final Deck deck;
  final void Function(CardId card) openCard;

  @override
  State<_PublishSheet> createState() => _PublishSheetState();
}

class _PublishSheetState extends State<_PublishSheet> {
  late Future<DisplayName?> _name = widget.sharing.displayName();
  final _nameField = TextEditingController();
  late final _descriptionField = TextEditingController(
    text: widget.deck.description,
  );
  bool _agreed = false;
  bool _saving = false;
  bool _showErrors = false;
  String? _error;

  /// What the server answered when it did not publish the note.
  Screening? _screening;

  /// The deck's cards, read once a finding needs them.
  Future<List<Card>>? _cards;

  @override
  void dispose() {
    _nameField.dispose();
    _descriptionField.dispose();
    super.dispose();
  }

  String get _description => _descriptionField.text.trim();

  bool get _descriptionTooLong =>
      _description.runes.length > maxDescriptionLength;

  Future<void> _publish(AppLocalizations l10n, {required bool askName}) async {
    final name = askName ? DisplayName.tryParse(_nameField.text) : null;
    if ((askName && name == null) || _descriptionTooLong) {
      setState(() => _showErrors = true);
      return;
    }
    final navigator = Navigator.of(context);
    setState(() {
      _saving = true;
      _error = null;
      _screening = null;
    });
    String? done;
    Screening? screening;
    final message = await describing(l10n, () async {
      screening = await widget.sharing.makePublic(
        widget.deck.id,
        name: name,
        description: _description.isEmpty ? null : _description,
      );
      if (screening?.state == DeckPublication.public) done = l10n.published;
      return '';
    });
    if (!mounted) return;
    if (done != null) {
      navigator.pop(done);
    } else {
      setState(() {
        _saving = false;
        _error = screening == null ? message : null;
        _screening = screening;
        if (screening?.findings.isNotEmpty ?? false) {
          _cards = widget.sharing.cardsOf(widget.deck.id);
        }
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final title = l10n.publishTitle(widget.deck.name);
    return FutureBuilder(
      future: _name,
      builder: (context, snapshot) => switch (snapshot) {
        AsyncSnapshot(
          connectionState: ConnectionState.done,
          :final error?,
          :final stackTrace,
        ) =>
          AppSheet(
            title: title,
            titleWritten: true,
            body: switch (error) {
              SharingFailure() => describeSharingFailure(l10n, error),
              _ => Error.throwWithStackTrace(
                error,
                stackTrace ?? StackTrace.current,
              ),
            },
            actions: [
              AppButton(
                label: l10n.retry,
                variant: AppButtonVariant.secondary,
                size: AppButtonSize.cta,
                onPressed: () => setState(() {
                  // Shown by the builder, which subscribes a frame later.
                  _name = widget.sharing.displayName()..ignore();
                }),
              ),
            ],
          ),
        AsyncSnapshot(connectionState: ConnectionState.done, :final data) =>
          switch (_screening?.state) {
            final state? when state != DeckPublication.refused => AppSheet(
              title: title,
              titleWritten: true,
              body: _why(l10n, state),
              actions: [
                AppButton(
                  label: l10n.close,
                  size: AppButtonSize.cta,
                  onPressed: () => Navigator.of(context).pop(),
                ),
              ],
            ),
            _ => _form(l10n, title, askName: data == null),
          },
        _ => AppSheet(
          title: title,
          titleWritten: true,
          content: Padding(
            padding: const EdgeInsets.symmetric(vertical: AppSpace.s32),
            child: Center(
              child: CircularProgressIndicator(semanticsLabel: l10n.loading),
            ),
          ),
        ),
      },
    );
  }

  Widget _form(AppLocalizations l10n, String title, {required bool askName}) {
    final colors = AppColors.of(context);
    final error = _error;
    final nameInvalid =
        _showErrors && DisplayName.tryParse(_nameField.text) == null;
    return AppSheet(
      title: title,
      titleWritten: true,
      body: askName ? l10n.displayNameHelp : null,
      content: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        spacing: AppSpace.s16,
        children: [
          if (askName)
            AppTextField(
              label: l10n.displayName,
              controller: _nameField,
              textInputAction: TextInputAction.next,
              onChanged: (_) => setState(() {}),
              errorText: nameInvalid ? l10n.displayNameLength : null,
            ),
          AppTextField(
            label: l10n.deckDescription,
            controller: _descriptionField,
            minLines: 2,
            maxLines: 5,
            maxLength: maxDescriptionLength,
            onChanged: (_) => setState(() {}),
            errorText: _descriptionTooLong
                ? l10n.deckDescriptionTooLong(maxDescriptionLength)
                : null,
          ),
          CheckboxListTile(
            value: _agreed,
            contentPadding: EdgeInsets.zero,
            controlAffinity: ListTileControlAffinity.leading,
            onChanged: _saving
                ? null
                : (agreed) => setState(() => _agreed = agreed ?? false),
            title: Text(
              keepWords(l10n.publishAgreement),
              semanticsLabel: l10n.publishAgreement,
              style: AppType.body,
            ),
          ),
          if (_saving)
            Semantics(
              liveRegion: true,
              child: Text(
                l10n.publicationCheckingWhy,
                style: AppType.caption.copyWith(color: colors.muted),
              ),
            )
          else if (_screening?.state == DeckPublication.refused ||
              widget.deck.publication == DeckPublication.refused)
            _refused(l10n, colors),
          if (error != null)
            Semantics(
              liveRegion: true,
              child: Text(
                error,
                style: AppType.caption.copyWith(color: colors.dontKnowText),
              ),
            ),
        ],
      ),
      actions: [
        AppButton(
          label: l10n.publishConfirm,
          size: AppButtonSize.cta,
          loading: _saving,
          onPressed: _agreed ? () => _publish(l10n, askName: askName) : null,
        ),
      ],
    );
  }

  /// The one sentence of why a note is not public yet.
  String _why(AppLocalizations l10n, DeckPublication state) => switch (state) {
    DeckPublication.refused => l10n.publicationRefusedWhy,
    DeckPublication.held => l10n.publicationHeldWhy,
    DeckPublication.checking => l10n.publicationCheckingWhy,
    DeckPublication.private || DeckPublication.public => '',
  };

  /// Why the note was refused and, once the server has said, where.
  Widget _refused(AppLocalizations l10n, AppColors colors) {
    final cards = _cards;
    return Semantics(
      liveRegion: true,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        spacing: AppSpace.s8,
        children: [
          Text(
            l10n.publicationRefusedWhy,
            style: AppType.caption.copyWith(color: colors.dontKnowText),
          ),
          if (cards != null)
            FutureBuilder(
              future: cards,
              builder: (context, snapshot) => AppGroup(
                children: [
                  for (final finding
                      in _screening?.findings ?? const <ScreeningFinding>[])
                    _findingRow(l10n, finding, snapshot.data ?? const []),
                ],
              ),
            ),
        ],
      ),
    );
  }

  Widget _findingRow(
    AppLocalizations l10n,
    ScreeningFinding finding,
    List<Card> cards,
  ) {
    final place = l10n.findingPlace(finding.place.name);
    final category = l10n.findingCategory(finding.category.key);
    final card = cards.where((card) => card.id == finding.card).firstOrNull;
    final passage = card == null ? null : _passage(card, finding);
    return AppListRow(
      title: card == null
          ? place
          : describeContent(l10n, card.front.isEmpty ? card.back : card.front),
      subtitle: passage == null
          ? l10n.findingLine(category, place)
          : l10n.findingLinePassage(category, passage, place),
      trailing: card == null
          ? null
          : Icon(LucideIcons.chevronRight, color: AppColors.of(context).muted),
      onTap: card == null
          ? null
          : () {
              Navigator.of(context).pop();
              widget.openCard(card.id);
            },
    );
  }
}

/// The text a finding points at, when its block holds one string it can be
/// read from; null where the block holds several (a 글's two sides) or none.
String? _passage(Card card, ScreeningFinding finding) {
  final (block, start, end) = (finding.block, finding.start, finding.end);
  if (block == null || start == null || end == null) return null;
  final cells = card.cells;
  final text = switch ((cells, finding.place)) {
    (final cells?, _) when block < cells.length => switch (cells[block]) {
      TextCell(:final front, back: '') => front,
      TextCell(front: '', :final back) => back,
      _ => null,
    },
    (null, FindingPlace.front) when block < card.front.length =>
      switch (card.front[block]) {
        TextContent(:final text) => text,
        _ => null,
      },
    (null, FindingPlace.back) when block < card.back.length =>
      switch (card.back[block]) {
        TextContent(:final text) => text,
        _ => null,
      },
    _ => null,
  };
  if (text == null || start < 0 || start >= end || end > text.length) {
    return null;
  }
  return text.substring(start, end);
}
