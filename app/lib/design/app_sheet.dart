import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../l10n/app_localizations.dart';
import 'app_button.dart';
import 'theme.dart';
import 'word_break.dart';

/// Opens the sheet [builder] makes over the current screen, with the
/// platform's sheet motion, or none under reduce motion. Resolves to what the
/// sheet pops with, or null when it is dismissed.
Future<T?> showAppSheet<T>(
  BuildContext context, {
  required WidgetBuilder builder,
}) => showModalBottomSheet<T>(
  context: context,
  isScrollControlled: true,
  useSafeArea: true,
  sheetAnimationStyle: MediaQuery.disableAnimationsOf(context)
      ? AnimationStyle.noAnimation
      : null,
  builder: builder,
);

/// The app's sheet: a drag handle, a [title], an optional [body] in one or
/// two sentences, optional [content], and [actions] pinned at the bottom
/// above the keyboard, full width, with the primary one last.
///
/// A drag or a tap on the scrim dismisses every sheet, so [actions] hold no
/// cancel; only [showAppConfirm] adds one, above its destructive button.
class AppSheet extends StatelessWidget {
  const AppSheet({
    super.key,
    required this.title,
    this.titleWritten = false,
    this.body,
    this.content,
    this.actions = const [],
  });

  final String title;

  /// Whether [title] carries a name a user wrote, which is never drawn in
  /// Jua.
  final bool titleWritten;

  final String? body;
  final Widget? content;
  final List<Widget> actions;

  @override
  Widget build(BuildContext context) {
    final colors = AppColors.of(context);
    final body = this.body;
    final content = this.content;
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(
            AppSpace.gutter,
            AppSpace.s12,
            AppSpace.gutter,
            AppSpace.s16,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Center(
                child: Container(
                  width: AppSize.handle.width,
                  height: AppSize.handle.height,
                  decoration: ShapeDecoration(
                    color: colors.edge,
                    shape: const StadiumBorder(),
                  ),
                ),
              ),
              const SizedBox(height: AppSpace.s20),
              Flexible(
                child: SingleChildScrollView(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    spacing: AppSpace.s8,
                    children: [
                      Semantics(
                        header: true,
                        child: Text(
                          keepWords(title),
                          semanticsLabel: title,
                          style: titleWritten
                              ? AppType.deckName
                              : AppType.title,
                        ),
                      ),
                      if (body != null)
                        Text(
                          keepWords(body),
                          semanticsLabel: body,
                          style: AppType.secondary.copyWith(
                            color: colors.muted,
                          ),
                        ),
                      if (content != null) ...[
                        const SizedBox(height: AppSpace.s8),
                        content,
                      ],
                    ],
                  ),
                ),
              ),
              if (actions.isNotEmpty) ...[
                const SizedBox(height: AppSpace.s24),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  spacing: AppSpace.s8,
                  children: actions,
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// Asks before an action that cannot be undone: a sheet titled [title] that
/// states its [consequence], with [extra]'s quiet button first when given
/// (it does not close the sheet), a cancel, named
/// [cancelLabel] or "취소", and, last at the bottom, a red [confirmLabel]
/// button, which gives a light haptic. Resolves to whether the user
/// confirmed.
Future<bool> showAppConfirm(
  BuildContext context, {
  required String title,
  bool titleWritten = false,
  required String consequence,
  required String confirmLabel,
  String? cancelLabel,
  ({String label, VoidCallback onPressed})? extra,
}) async =>
    await showAppSheet<bool>(
      context,
      builder: (context) => AppSheet(
        title: title,
        titleWritten: titleWritten,
        body: consequence,
        actions: [
          if (extra != null)
            AppButton(
              label: extra.label,
              variant: AppButtonVariant.text,
              size: AppButtonSize.cta,
              onPressed: extra.onPressed,
            ),
          AppButton(
            label: cancelLabel ?? AppLocalizations.of(context).cancel,
            variant: AppButtonVariant.secondary,
            size: AppButtonSize.cta,
            onPressed: () => Navigator.of(context).pop(false),
          ),
          AppButton(
            label: confirmLabel,
            variant: AppButtonVariant.destructiveFinal,
            size: AppButtonSize.cta,
            onPressed: () {
              HapticFeedback.lightImpact();
              Navigator.of(context).pop(true);
            },
          ),
        ],
      ),
    ) ??
    false;
