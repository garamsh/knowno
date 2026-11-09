import 'package:flutter/material.dart';

import 'app_button.dart';
import 'theme.dart';
import 'word_break.dart';

/// The frame of a screen the user lands on (`docs/architecture/design/
/// frames.md` §Screen skeleton): the [title] with the screen's [actions] at
/// its end, the [search] under it, the [body] slivers, and the [bottom]
/// where the screen has a primary. Every slot sits between
/// [AppSpace.gutter]s, and the bar is [AppButton.barHeight] high.
///
/// A [topLevel] screen, a tab's first, has no back bar: the title and the
/// actions share one line, wrapping the actions under a long title. Any other
/// screen has a bar holding the back arrow and the actions, with the title
/// under it.
class ScreenSkeleton extends StatelessWidget {
  const ScreenSkeleton({
    super.key,
    required this.title,
    required this.body,
    this.topLevel = false,
    this.userTitle = false,
    this.actions,
    this.search,
    this.bottom,
    this.bottomReserve = 0,
    this.wrapBody,
  });

  /// The screen's name, a header to a screen reader.
  final String title;

  /// Whether [title] is a name the user wrote: drawn in `deckName`, at most
  /// two lines, and kept whole at its words. Otherwise `deckTitle`.
  final bool userTitle;

  /// Whether this is a tab's first screen.
  final bool topLevel;

  /// At the title's end: the screen's own action and its ⋯.
  final Widget? actions;

  /// Under the title, `AppSize.search` high.
  final Widget? search;

  /// The content, as slivers, `AppSpace.s16` under what is above it.
  final List<Widget> body;

  /// The screen's primary, in `BottomActions`.
  final Widget? bottom;

  /// Space left under the body for something drawn over it.
  final double bottomReserve;

  /// Draws something over the scrolling body, as the assistant's character.
  final Widget Function(Widget body)? wrapBody;

  @override
  Widget build(BuildContext context) {
    final colors = AppColors.of(context);
    final name = Semantics(
      header: true,
      child: Text(
        userTitle ? keepWords(title) : title,
        semanticsLabel: userTitle ? title : null,
        maxLines: userTitle ? 2 : null,
        overflow: userTitle ? TextOverflow.ellipsis : null,
        style: (userTitle ? AppType.deckName : AppType.deckTitle).copyWith(
          color: colors.ink,
        ),
      ),
    );
    final actions = this.actions;
    final search = this.search;
    Widget scroll = CustomScrollView(
      slivers: [
        SliverPadding(
          padding: EdgeInsets.fromLTRB(
            AppSpace.gutter,
            topLevel ? AppSpace.s16 : 0,
            AppSpace.gutter,
            AppSpace.s24 + bottomReserve,
          ),
          sliver: SliverMainAxisGroup(
            slivers: [
              SliverToBoxAdapter(
                child: topLevel && actions != null
                    ? Wrap(
                        alignment: WrapAlignment.spaceBetween,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        spacing: AppSpace.s8,
                        runSpacing: AppSpace.s8,
                        children: [name, actions],
                      )
                    : name,
              ),
              if (search != null)
                SliverPadding(
                  padding: const EdgeInsets.only(top: AppSpace.s16),
                  sliver: SliverToBoxAdapter(child: search),
                ),
              SliverPadding(
                padding: const EdgeInsets.only(top: AppSpace.s16),
                sliver: SliverMainAxisGroup(slivers: body),
              ),
            ],
          ),
        ),
      ],
    );
    final wrap = wrapBody;
    if (topLevel) scroll = SafeArea(bottom: false, child: scroll);
    if (wrap != null) scroll = wrap(scroll);
    return Scaffold(
      appBar: topLevel
          ? null
          : AppBar(
              toolbarHeight: AppButton.barHeight(context),
              actions: [
                if (actions != null)
                  Padding(
                    padding: const EdgeInsetsDirectional.only(
                      end: AppSpace.gutter,
                    ),
                    child: actions,
                  ),
              ],
            ),
      body: scroll,
      bottomNavigationBar: bottom,
    );
  }
}
