import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'theme.dart';
import 'word_break.dart';

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
    this.inputFormatters,
    this.keyboardType,
    this.autofillHints,
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

  /// Drawn before the text at its own size, with the room around it its own:
  /// Material's 48 square box is not kept.
  final Widget? prefixIcon;

  /// Limits or reshapes what is typed.
  final List<TextInputFormatter>? inputFormatters;

  /// The keyboard the field asks for.
  final TextInputType? keyboardType;

  /// What the platform may fill the field with, such as a one-time code its
  /// keyboard or password manager offers.
  final Iterable<String>? autofillHints;

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
        inputFormatters: inputFormatters,
        keyboardType: keyboardType,
        autofillHints: autofillHints,
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
          // A message is a sentence, which wraps rather than being cut.
          errorMaxLines: 5,
          prefixIcon: prefixIcon,
          prefixIconConstraints: const BoxConstraints(),
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
            keepWords(label),
            semanticsLabel: label,
            style: AppType.section.copyWith(color: AppColors.of(context).ink2),
          ),
          field,
        ],
      ),
    );
  }
}
