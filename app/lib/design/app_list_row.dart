import 'package:flutter/material.dart';

import 'app_raised.dart';
import 'theme.dart';
import 'word_break.dart';

/// A row of a list: a rounded surface on its edge, tappable when [onTap] or
/// [onLongPress] is given, with the row gap below it. [child] fills it.
class AppRowSurface extends StatelessWidget {
  const AppRowSurface({
    super.key,
    required this.child,
    this.onTap,
    this.onLongPress,
  });

  final Widget child;
  final VoidCallback? onTap;
  final VoidCallback? onLongPress;

  @override
  Widget build(BuildContext context) {
    // Inside a group, the group draws the surface and splits the rows.
    if (context.dependOnInheritedWidgetOfExactType<_InGroup>() != null) {
      return Material(
        type: MaterialType.transparency,
        child: onTap == null && onLongPress == null
            ? child
            : InkWell(onTap: onTap, onLongPress: onLongPress, child: child),
      );
    }
    final radius = BorderRadius.circular(AppRadius.row);
    final colors = AppColors.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpace.rowGap),
      child: AppRaised(
        edge: colors.edge,
        height: AppSize.edgeRow,
        radius: AppRadius.row,
        builder: (context, states) => Material(
          color: colors.surface,
          borderRadius: radius,
          child: onTap == null && onLongPress == null
              ? child
              : InkWell(
                  statesController: states,
                  borderRadius: radius,
                  onTap: onTap,
                  onLongPress: onLongPress,
                  child: child,
                ),
        ),
      ),
    );
  }
}

/// Rows drawn as one group: one surface on its edge, split by hairlines.
/// A row inside it, an [AppRowSurface] or an [AppListRow], draws no surface
/// and no gap of its own. [SliverAppGroup] draws the same over a long list.
class AppGroup extends StatelessWidget {
  const AppGroup({super.key, required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      for (final (index, child) in children.indexed)
        _GroupItem(index: index, count: children.length, child: child),
    ],
  );
}

/// [AppGroup] as a sliver, building its rows as they scroll into view.
class SliverAppGroup extends StatelessWidget {
  const SliverAppGroup({super.key, required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) => SliverList.builder(
    itemCount: children.length,
    itemBuilder: (context, index) => _GroupItem(
      index: index,
      count: children.length,
      child: children[index],
    ),
  );
}

/// One row of a group: its share of the surface, rounded at the group's
/// ends, under a hairline but for the first, the last drawing the group's
/// edge. A row pressed inside a group dims and does not move.
class _GroupItem extends StatelessWidget {
  const _GroupItem({
    required this.index,
    required this.count,
    required this.child,
  });

  final int index;
  final int count;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final colors = AppColors.of(context);
    const corner = Radius.circular(AppRadius.group);
    final radius = BorderRadius.vertical(
      top: index == 0 ? corner : Radius.zero,
      bottom: index == count - 1 ? corner : Radius.zero,
    );
    return DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: radius,
        boxShadow: index == count - 1 ? AppShadow.card(colors) : null,
      ),
      child: Material(
        color: colors.surface,
        clipBehavior: Clip.antiAlias,
        borderRadius: radius,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (index > 0)
              Divider(
                height: 1,
                thickness: 1,
                indent: AppSpace.s16,
                color: colors.hairline,
              ),
            _InGroup(child: child),
          ],
        ),
      ),
    );
  }
}

/// Marks the rows under it as a group's, which draws their surface.
class _InGroup extends InheritedWidget {
  const _InGroup({required super.child});

  @override
  bool updateShouldNotify(_InGroup oldWidget) => false;
}

/// A row with a [title], an optional [subtitle] under it, and optional
/// [leading] and [trailing] widgets, read as one node. A [destructive] row
/// draws its title and leading icon in red.
class AppListRow extends StatelessWidget {
  const AppListRow({
    super.key,
    required this.title,
    this.subtitle,
    this.leading,
    this.trailing,
    this.selected,
    this.onTap,
    this.onLongPress,
    this.destructive = false,
  });

  final String title;
  final String? subtitle;
  final Widget? leading;
  final Widget? trailing;

  /// Whether the row is selected, or null where rows are not selectable.
  final bool? selected;

  final VoidCallback? onTap;
  final VoidCallback? onLongPress;

  /// Whether the row starts an action that deletes something.
  final bool destructive;

  /// The space between a row's edges and what it holds.
  static const inset = EdgeInsets.fromLTRB(
    AppSpace.s16,
    AppSpace.s12,
    AppSpace.s12,
    AppSpace.s12,
  );

  @override
  Widget build(BuildContext context) {
    final subtitle = this.subtitle;
    final colors = AppColors.of(context);
    final leading = this.leading;
    return MergeSemantics(
      child: Semantics(
        selected: selected,
        child: AppRowSurface(
          onTap: onTap,
          onLongPress: onLongPress,
          child: Padding(
            padding: inset,
            child: Row(
              spacing: AppSpace.s12,
              children: [
                if (leading != null)
                  destructive
                      ? IconTheme.merge(
                          data: IconThemeData(color: colors.dontKnowText),
                          child: leading,
                        )
                      : leading,
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        title,
                        style: destructive
                            ? AppType.bodyStrong.copyWith(
                                color: colors.dontKnowText,
                              )
                            : AppType.bodyStrong,
                      ),
                      if (subtitle != null)
                        Text(
                          keepWords(subtitle),
                          semanticsLabel: subtitle,
                          style: AppType.caption.copyWith(
                            color: AppColors.of(context).muted,
                          ),
                        ),
                    ],
                  ),
                ),
                ?trailing,
              ],
            ),
          ),
        ),
      ),
    );
  }
}
