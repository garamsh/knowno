import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../design/mascot.dart';
import '../../design/theme.dart';
import '../../design/word_break.dart';
import '../../l10n/app_localizations.dart';
import 'providers.dart';

/// How big the character is at the screen's edge.
const edgeSize = 72.0;

/// The room a list under [EdgeAssistant] keeps at its foot, so its last row is
/// never under the character.
const edgeReserve = edgeSize + AppSpace.s24;

/// How long after a scroll ends the character comes back out of the edge.
const edgeReturnDelay = Duration(milliseconds: 400);

/// 말랑이 as a character at the bottom edge of [child]'s screen, for the
/// screens that draw it: a button named "말랑이와 대화하기" that opens the
/// chat through [onOpen]. It breathes and blinks, tucks half into its edge
/// while [child] scrolls and comes back when it stops, and can be dragged to
/// the other edge, where it stays on this device. A short bubble says how many
/// cards are ready; with [hint], once, until it is tapped or dismissed, a
/// bubble says that tapping it opens the chat. Without an assistant, [child]
/// alone.
class EdgeAssistant extends ConsumerStatefulWidget {
  const EdgeAssistant({
    super.key,
    required this.onOpen,
    required this.child,
    this.hint = false,
  });

  final VoidCallback onOpen;
  final Widget child;

  /// Whether the one-time hint may show: a first note exists.
  final bool hint;

  @override
  ConsumerState<EdgeAssistant> createState() => _EdgeAssistantState();
}

class _EdgeAssistantState extends ConsumerState<EdgeAssistant> {
  var _tucked = false;
  var _drag = 0.0;
  Timer? _returning;

  @override
  void dispose() {
    _returning?.cancel();
    super.dispose();
  }

  bool _scrolled(ScrollNotification notification) {
    if (notification.metrics.axis != Axis.vertical) return false;
    if (notification is ScrollStartNotification ||
        notification is ScrollUpdateNotification) {
      _returning?.cancel();
      if (!_tucked) setState(() => _tucked = true);
    } else if (notification is ScrollEndNotification) {
      _returning?.cancel();
      _returning = Timer(edgeReturnDelay, () {
        if (mounted) setState(() => _tucked = false);
      });
    }
    return false;
  }

  void _open() {
    ref.read(assistantHintShownProvider.notifier).dismiss();
    widget.onOpen();
  }

  void _dropped(double width, EdgeSide side) {
    const margin = AppSpace.s12;
    final centre = side == EdgeSide.right
        ? width - margin - edgeSize / 2 + _drag
        : margin + edgeSize / 2 + _drag;
    ref
        .read(assistantEdgeSideProvider.notifier)
        .rest(centre > width / 2 ? EdgeSide.right : EdgeSide.left);
    setState(() => _drag = 0);
  }

  @override
  Widget build(BuildContext context) {
    if (ref.watch(assistantClientProvider) == null) return widget.child;
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    final side = ref.watch(assistantEdgeSideProvider);
    final ready = ref.watch(assistantReadyCardsProvider);
    final hint = widget.hint && !ref.watch(assistantHintShownProvider);
    final still = MediaQuery.disableAnimationsOf(context);
    final slide = still ? Duration.zero : const Duration(milliseconds: 200);
    final right = side == EdgeSide.right;
    final name = ready > 0
        ? '${l10n.assistantOpen}, ${l10n.assistantReadyShort(ready)}'
        : l10n.assistantOpen;
    final character = Semantics(
      button: true,
      label: name,
      excludeSemantics: true,
      onTap: _open,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: _open,
        onHorizontalDragUpdate: (details) =>
            setState(() => _drag += details.delta.dx),
        onHorizontalDragEnd: (_) =>
            _dropped((context.size ?? Size.zero).width, side),
        child: SizedBox.square(
          dimension: edgeSize,
          child: const Mascot(
            expression: MascotExpression.thinking,
            size: edgeSize,
            breathes: true,
          ),
        ),
      ),
    );
    Widget bubble(Widget child) => Flexible(
      child: AnimatedOpacity(
        opacity: _tucked ? 0 : 1,
        duration: slide,
        child: IgnorePointer(
          ignoring: _tucked,
          child: DecoratedBox(
            decoration: BoxDecoration(
              color: colors.surface,
              borderRadius: BorderRadius.circular(AppRadius.row),
              boxShadow: AppShadow.card(colors),
            ),
            child: child,
          ),
        ),
      ),
    );
    final row = Row(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.end,
      textDirection: right ? TextDirection.ltr : TextDirection.rtl,
      spacing: AppSpace.s8,
      children: [
        if (ready > 0)
          bubble(
            ExcludeSemantics(
              child: GestureDetector(
                onTap: _open,
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: AppSpace.s16,
                    vertical: AppSpace.s8,
                  ),
                  child: Text(
                    keepWords(l10n.assistantReadyShort(ready)),
                    style: AppType.label.copyWith(color: colors.ink),
                  ),
                ),
              ),
            ),
          )
        else if (hint)
          bubble(
            Padding(
              padding: const EdgeInsetsDirectional.only(start: AppSpace.s16),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Flexible(
                    child: Text(
                      keepWords(l10n.assistantHint),
                      semanticsLabel: l10n.assistantHint,
                      style: AppType.label.copyWith(color: colors.ink),
                    ),
                  ),
                  IconButton(
                    tooltip: l10n.assistantHintClose,
                    icon: const Icon(LucideIcons.x, size: AppSize.smallIcon),
                    onPressed: ref
                        .read(assistantHintShownProvider.notifier)
                        .dismiss,
                    style: IconButton.styleFrom(
                      minimumSize: const Size.square(AppSize.tapTarget),
                      foregroundColor: colors.ink2,
                    ),
                  ),
                ],
              ),
            ),
          ),
        AnimatedSlide(
          offset: Offset(_tucked ? (right ? 0.5 : -0.5) : 0, 0),
          duration: slide,
          child: Transform.translate(
            offset: Offset(_drag, 0),
            child: character,
          ),
        ),
      ],
    );
    return NotificationListener<ScrollNotification>(
      onNotification: _scrolled,
      child: Stack(
        children: [
          widget.child,
          Positioned.fill(
            child: AnimatedAlign(
              alignment: right
                  ? AlignmentDirectional.bottomEnd
                  : AlignmentDirectional.bottomStart,
              duration: slide,
              child: Padding(
                padding: const EdgeInsets.all(AppSpace.s12),
                child: row,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
