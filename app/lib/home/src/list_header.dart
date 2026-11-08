import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../design/app_button.dart';
import '../../design/app_menu.dart';
import '../../design/theme.dart';
import 'above_menu.dart';

/// A ⋯ menu named [tooltip] for a screen reader, holding [items].
typedef HeaderMenu = ({String tooltip, List<Widget> items});

/// The actions at the right of a list screen's title, the 노트 tab's and a
/// deck screen's: the screen's own action, "+" and [label] in the tonal
/// fill, and, with a [menu], its ⋯ holding the screen's other actions. With
/// no [label] there is no own action, and the ⋯ stands alone.
class ListHeaderActions extends StatelessWidget {
  const ListHeaderActions({super.key, this.label, this.onPressed, this.menu});

  final String? label;
  final VoidCallback? onPressed;
  final HeaderMenu? menu;

  @override
  Widget build(BuildContext context) {
    final menu = this.menu;
    final label = this.label;
    return Row(
      mainAxisSize: MainAxisSize.min,
      spacing: AppSpace.s8,
      children: [
        if (label != null)
          AppButton(
            label: label,
            icon: LucideIcons.plus,
            variant: AppButtonVariant.tonal,
            size: AppButtonSize.header,
            onPressed: onPressed,
          ),
        if (menu != null)
          AppMenu(
            items: menu.items,
            builder: (context, controller, _) => RaisedIconButton(
              tooltip: menu.tooltip,
              icon: LucideIcons.ellipsis,
              onPressed: () =>
                  controller.isOpen ? controller.close() : controller.open(),
            ),
          ),
      ],
    );
  }
}
