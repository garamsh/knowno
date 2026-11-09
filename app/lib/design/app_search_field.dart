import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import 'app_text_field.dart';
import 'theme.dart';

/// The search field over a list, [AppSize.search] high: a magnifier and
/// [hint] in it, each change handed to [onChanged] and the keyboard's search
/// key to [onSubmitted].
class AppSearchField extends StatelessWidget {
  const AppSearchField({
    super.key,
    required this.hint,
    required this.onChanged,
    this.onSubmitted,
  });

  final String hint;
  final ValueChanged<String> onChanged;
  final ValueChanged<String>? onSubmitted;

  /// The magnifier's size and its distance from the field's edge, the 1 px
  /// outline and the 16 padding of the web's `SearchField`; the hint follows
  /// it 8 on, as there.
  static const _iconSize = 20.0;
  static const _iconStart = 17.0;

  /// 8 to the hint less the 4 Material keeps before an input after its prefix.
  static const _iconEnd = 4.0;

  @override
  Widget build(BuildContext context) => AppTextField(
    hint: hint,
    prefixIcon: const Padding(
      padding: EdgeInsetsDirectional.only(start: _iconStart, end: _iconEnd),
      child: Icon(LucideIcons.search, size: _iconSize),
    ),
    height: AppSize.search,
    textInputAction: TextInputAction.search,
    onChanged: onChanged,
    onSubmitted: onSubmitted,
  );
}
