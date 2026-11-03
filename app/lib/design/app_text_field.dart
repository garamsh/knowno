import 'package:flutter/material.dart';

import 'theme.dart';

/// The app's text field: its [label] above it, a [hint] inside, an
/// [errorText] below, and a counter below when [maxLength] limits it. The
/// label, the field and the error are read as one.
class AppTextField extends StatelessWidget {
  const AppTextField({
    super.key,
    this.label,
    this.hint,
    this.errorText,
    this.maxLength,
    this.controller,
    this.focusNode,
    this.autofocus = false,
    this.minLines,
    this.maxLines = 1,
    this.textInputAction,
    this.prefixIcon,
    this.style,
    this.textAlign = TextAlign.start,
    this.height = AppSize.field,
    this.onChanged,
    this.onSubmitted,
  });

  final String? label;
  final String? hint;
  final String? errorText;
  final int? maxLength;
  final TextEditingController? controller;
  final FocusNode? focusNode;
  final bool autofocus;
  final int? minLines;

  /// Null lets the field grow with its text.
  final int? maxLines;

  final TextInputAction? textInputAction;
  final Widget? prefixIcon;

  /// The text's style; [AppType.body] when null.
  final TextStyle? style;

  /// How the text lines up in the field.
  final TextAlign textAlign;

  /// The field's least height: [AppSize.field], or [AppSize.search] for a
  /// search over a list.
  final double height;

  final ValueChanged<String>? onChanged;
  final ValueChanged<String>? onSubmitted;

  /// The height of a line of [AppType.body], which [style] keeps.
  static const _line = 24.0;

  @override
  Widget build(BuildContext context) {
    final label = this.label;
    final field = ConstrainedBox(
      constraints: BoxConstraints(minHeight: height),
      child: TextField(
        controller: controller,
        focusNode: focusNode,
        autofocus: autofocus,
        minLines: minLines,
        maxLines: maxLines,
        maxLength: maxLength,
        textInputAction: textInputAction,
        style: style ?? AppType.body,
        textAlign: textAlign,
        onChanged: onChanged,
        onSubmitted: onSubmitted,
        decoration: InputDecoration(
          // One line of body text, centred in the field's height.
          contentPadding: EdgeInsets.symmetric(
            horizontal: AppSpace.s16,
            vertical: (height - _line) / 2,
          ),
          hintText: hint,
          errorText: errorText,
          prefixIcon: prefixIcon,
        ),
      ),
    );
    if (label == null) return field;
    return MergeSemantics(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        spacing: AppSpace.s8,
        children: [
          Text(
            label,
            style: AppType.section.copyWith(color: AppColors.of(context).ink2),
          ),
          field,
        ],
      ),
    );
  }
}
