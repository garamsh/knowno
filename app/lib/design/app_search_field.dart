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

  @override
  Widget build(BuildContext context) => AppTextField(
    hint: hint,
    prefixIcon: const Icon(LucideIcons.search),
    height: AppSize.search,
    textInputAction: TextInputAction.search,
    onChanged: onChanged,
    onSubmitted: onSubmitted,
  );
}
