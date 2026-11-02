import 'package:flutter/material.dart';

import '../../design/app_button.dart';
import '../../design/app_list_row.dart';
import '../../design/mascot.dart';
import '../../design/theme.dart';
import '../../l10n/app_localizations.dart';
import 'import_job.dart';

/// The photo, "카드를 찾고 있어요" beside the thinking mascot, an indeterminate
/// bar and skeleton rows while the cards are extracted, with the privacy note
/// and a cancel.
class ExtractingView extends StatelessWidget {
  const ExtractingView({
    super.key,
    required this.photo,
    required this.onCancel,
  });

  /// The photo being read; null until it is prepared.
  final ImageProvider? photo;
  final VoidCallback onCancel;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(
            AppSpace.gutter,
            AppSpace.s24,
            AppSpace.gutter,
            AppSpace.s16,
          ),
          children: [
            Row(
              spacing: AppSpace.s16,
              children: [
                ClipRRect(
                  borderRadius: BorderRadius.circular(AppRadius.button),
                  child: SizedBox(
                    width: 72,
                    height: 96,
                    child: switch (photo) {
                      final photo? => Image(
                        image: ResizeImage.resizeIfNeeded(
                          thumbnailDecodeWidth,
                          null,
                          photo,
                        ),
                        fit: BoxFit.cover,
                        semanticLabel: l10n.photoThumbnail,
                      ),
                      null => ColoredBox(color: colors.hairline),
                    },
                  ),
                ),
                Expanded(
                  child: Semantics(
                    header: true,
                    liveRegion: true,
                    child: Text(l10n.extractingTitle, style: AppType.title),
                  ),
                ),
                const Mascot(
                  expression: MascotExpression.thinking,
                  size: AppSize.mascotGuide,
                ),
              ],
            ),
            const SizedBox(height: AppSpace.s20),
            LinearProgressIndicator(
              semanticsLabel: l10n.extractingTitle,
              color: colors.accent,
              backgroundColor: colors.edge,
              borderRadius: BorderRadius.circular(AppSpace.s4),
            ),
            const SizedBox(height: AppSpace.s20),
            for (var row = 0; row < 4; row++) const _SkeletonRow(),
            const SizedBox(height: AppSpace.s12),
            Text(
              l10n.extractingNote,
              textAlign: TextAlign.center,
              style: AppType.caption.copyWith(color: colors.muted),
            ),
          ],
        ),
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(
            AppSpace.gutter,
            AppSpace.s8,
            AppSpace.gutter,
            AppSpace.s16,
          ),
          child: AppButton(
            label: l10n.cancel,
            variant: AppButtonVariant.secondary,
            size: AppButtonSize.cta,
            onPressed: onCancel,
          ),
        ),
      ),
    );
  }
}

/// A placeholder row, front and back, that shimmers unless reduce motion is
/// on.
class _SkeletonRow extends StatefulWidget {
  const _SkeletonRow();

  @override
  State<_SkeletonRow> createState() => _SkeletonRowState();
}

class _SkeletonRowState extends State<_SkeletonRow>
    with SingleTickerProviderStateMixin {
  late final _shimmer = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1200),
  );

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (MediaQuery.disableAnimationsOf(context)) {
      _shimmer.stop();
      _shimmer.value = 0;
    } else if (!_shimmer.isAnimating) {
      _shimmer.repeat(reverse: true);
    }
  }

  @override
  void dispose() {
    _shimmer.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final colors = AppColors.of(context);
    Widget bar(double widthFactor) => FractionallySizedBox(
      alignment: Alignment.centerLeft,
      widthFactor: widthFactor,
      child: Container(
        height: AppSpace.s12,
        decoration: ShapeDecoration(
          color: colors.hairline,
          shape: const StadiumBorder(),
        ),
      ),
    );
    return ExcludeSemantics(
      child: FadeTransition(
        opacity: Tween<double>(begin: 1, end: 0.4).animate(_shimmer),
        child: AppRowSurface(
          child: Padding(
            padding: const EdgeInsets.all(AppSpace.s20),
            child: Row(
              spacing: AppSpace.s16,
              children: [
                Expanded(child: bar(0.7)),
                Expanded(child: bar(0.5)),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
