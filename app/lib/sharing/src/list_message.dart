import 'package:flutter/material.dart';

import '../../design/app_button.dart';
import '../../design/theme.dart';
import '../../design/word_break.dart';
import '../../l10n/app_localizations.dart';

/// A state in place of a list, browse's decks or a public deck's cards: what
/// happened in [AppColors.muted], centred under an optional [icon], and a
/// secondary "다시 시도" when [onRetry] is given.
class ListMessage extends StatelessWidget {
  const ListMessage(this.text, {super.key, this.icon, this.onRetry});

  final String text;
  final IconData? icon;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final colors = AppColors.of(context);
    final icon = this.icon;
    final onRetry = this.onRetry;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpace.s40),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        spacing: AppSpace.s12,
        children: [
          if (icon != null) Icon(icon, color: colors.muted),
          Text(
            keepWords(text),
            semanticsLabel: text,
            textAlign: TextAlign.center,
            style: AppType.body.copyWith(color: colors.muted),
          ),
          if (onRetry != null)
            AppButton(
              label: AppLocalizations.of(context).retry,
              variant: AppButtonVariant.secondary,
              onPressed: onRetry,
            ),
        ],
      ),
    );
  }
}
