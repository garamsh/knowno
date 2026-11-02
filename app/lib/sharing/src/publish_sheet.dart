import 'package:flutter/material.dart';

import '../../deck/deck.dart';
import '../../design/app_button.dart';
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
/// copyrighted content, which "공개" requires. Says in a snack bar once
/// published.
Future<void> showPublishSheet(
  BuildContext context, {
  required SharingService sharing,
  required Deck deck,
}) async {
  final messenger = ScaffoldMessenger.of(context);
  final message = await showAppSheet<String>(
    context,
    builder: (_) => _PublishSheet(sharing: sharing, deck: deck),
  );
  if (message != null) {
    messenger.showSnackBar(SnackBar(content: Text(message)));
  }
}

class _PublishSheet extends StatefulWidget {
  const _PublishSheet({required this.sharing, required this.deck});

  final SharingService sharing;
  final Deck deck;

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
    });
    String? done;
    final message = await describing(l10n, () async {
      await widget.sharing.makePublic(
        widget.deck.id,
        name: name,
        description: _description.isEmpty ? null : _description,
      );
      return done = l10n.published;
    });
    if (!mounted) return;
    if (done != null) {
      navigator.pop(done);
    } else {
      setState(() {
        _saving = false;
        _error = message;
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
          _form(l10n, title, askName: data == null),
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
}
