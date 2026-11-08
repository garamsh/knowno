// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint, type=warning, deprecated_member_use, deprecated_member_use_from_same_package
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'markup.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// dart format off
T _$identity<T>(T value) => value;
/// @nodoc
mixin _$MarkupBlock {





@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is MarkupBlock);
}


@override
int get hashCode => runtimeType.hashCode;

@override
String toString() {
    return 'MarkupBlock()';
}


}

/// @nodoc
class $MarkupBlockCopyWith<$Res>  {
$MarkupBlockCopyWith(MarkupBlock _, $Res Function(MarkupBlock) __);
}


/// Adds pattern-matching-related methods to [MarkupBlock].
extension MarkupBlockPatterns on MarkupBlock {
/// A variant of `map` that fallback to returning `orElse`.
///
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case final Subclass value:
///     return ...;
///   case _:
///     return orElse();
/// }
/// ```

@optionalTypeArgs TResult maybeMap<TResult extends Object?>({TResult Function( MarkupBlock_Paragraph value)?  paragraph,TResult Function( MarkupBlock_List value)?  list,required TResult orElse(),}){
final _that = this;
switch (_that) {
case MarkupBlock_Paragraph() when paragraph != null:
return paragraph(_that);case MarkupBlock_List() when list != null:
return list(_that);case _:
  return orElse();

}
}
/// A `switch`-like method, using callbacks.
///
/// Callbacks receives the raw object, upcasted.
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case final Subclass value:
///     return ...;
///   case final Subclass2 value:
///     return ...;
/// }
/// ```

@optionalTypeArgs TResult map<TResult extends Object?>({required TResult Function( MarkupBlock_Paragraph value)  paragraph,required TResult Function( MarkupBlock_List value)  list,}){
final _that = this;
switch (_that) {
case MarkupBlock_Paragraph():
return paragraph(_that);case MarkupBlock_List():
return list(_that);}
}
/// A variant of `map` that fallback to returning `null`.
///
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case final Subclass value:
///     return ...;
///   case _:
///     return null;
/// }
/// ```

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>({TResult? Function( MarkupBlock_Paragraph value)?  paragraph,TResult? Function( MarkupBlock_List value)?  list,}){
final _that = this;
switch (_that) {
case MarkupBlock_Paragraph() when paragraph != null:
return paragraph(_that);case MarkupBlock_List() when list != null:
return list(_that);case _:
  return null;

}
}
/// A variant of `when` that fallback to an `orElse` callback.
///
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case Subclass(:final field):
///     return ...;
///   case _:
///     return orElse();
/// }
/// ```

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>({TResult Function( List<MarkupInline> content)?  paragraph,TResult Function( bool ordered,  List<MarkupListItem> items)?  list,required TResult orElse(),}) {final _that = this;
switch (_that) {
case MarkupBlock_Paragraph() when paragraph != null:
return paragraph(_that.content);case MarkupBlock_List() when list != null:
return list(_that.ordered,_that.items);case _:
  return orElse();

}
}
/// A `switch`-like method, using callbacks.
///
/// As opposed to `map`, this offers destructuring.
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case Subclass(:final field):
///     return ...;
///   case Subclass2(:final field2):
///     return ...;
/// }
/// ```

@optionalTypeArgs TResult when<TResult extends Object?>({required TResult Function( List<MarkupInline> content)  paragraph,required TResult Function( bool ordered,  List<MarkupListItem> items)  list,}) {final _that = this;
switch (_that) {
case MarkupBlock_Paragraph():
return paragraph(_that.content);case MarkupBlock_List():
return list(_that.ordered,_that.items);}
}
/// A variant of `when` that fallback to returning `null`
///
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case Subclass(:final field):
///     return ...;
///   case _:
///     return null;
/// }
/// ```

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>({TResult? Function( List<MarkupInline> content)?  paragraph,TResult? Function( bool ordered,  List<MarkupListItem> items)?  list,}) {final _that = this;
switch (_that) {
case MarkupBlock_Paragraph() when paragraph != null:
return paragraph(_that.content);case MarkupBlock_List() when list != null:
return list(_that.ordered,_that.items);case _:
  return null;

}
}

}

/// @nodoc


class MarkupBlock_Paragraph extends MarkupBlock {
  const MarkupBlock_Paragraph({required  List<MarkupInline> content}): _content = content,super._();
  

/// The paragraph's text and marks.
 final  List<MarkupInline> _content;
/// The paragraph's text and marks.
 List<MarkupInline> get content {
  if (_content is EqualUnmodifiableListView) return _content;
  // ignore: implicit_dynamic_type
  return EqualUnmodifiableListView(_content);
}


/// Create a copy of MarkupBlock
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$MarkupBlock_ParagraphCopyWith<MarkupBlock_Paragraph> get copyWith => _$MarkupBlock_ParagraphCopyWithImpl<MarkupBlock_Paragraph>(this, _$identity);



@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is MarkupBlock_Paragraph&&const DeepCollectionEquality().equals(other.content, _content));
}


@override
int get hashCode {
    return Object.hash(runtimeType,const DeepCollectionEquality().hash(_content));
}

@override
String toString() {
    return 'MarkupBlock.paragraph(content: $content)';
}


}

/// @nodoc
abstract mixin class $MarkupBlock_ParagraphCopyWith<$Res> implements $MarkupBlockCopyWith<$Res> {
  factory $MarkupBlock_ParagraphCopyWith(MarkupBlock_Paragraph value, $Res Function(MarkupBlock_Paragraph) _then) = _$MarkupBlock_ParagraphCopyWithImpl;
@useResult
$Res call({
 List<MarkupInline> content
});




}
/// @nodoc
class _$MarkupBlock_ParagraphCopyWithImpl<$Res>
    implements $MarkupBlock_ParagraphCopyWith<$Res> {
  _$MarkupBlock_ParagraphCopyWithImpl(this._self, this._then);

  final MarkupBlock_Paragraph _self;
  final $Res Function(MarkupBlock_Paragraph) _then;

/// Create a copy of MarkupBlock
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') $Res call({Object? content = null,}) {
  return _then(MarkupBlock_Paragraph(
content: null == content ? _self._content : content // ignore: cast_nullable_to_non_nullable
as List<MarkupInline>,
  ));
}


}

/// @nodoc


class MarkupBlock_List extends MarkupBlock {
  const MarkupBlock_List({required this.ordered, required  List<MarkupListItem> items}): _items = items,super._();
  

/// Numbered, counted from 1, rather than bulleted.
 final  bool ordered;
/// The items, at least one.
 final  List<MarkupListItem> _items;
/// The items, at least one.
 List<MarkupListItem> get items {
  if (_items is EqualUnmodifiableListView) return _items;
  // ignore: implicit_dynamic_type
  return EqualUnmodifiableListView(_items);
}


/// Create a copy of MarkupBlock
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$MarkupBlock_ListCopyWith<MarkupBlock_List> get copyWith => _$MarkupBlock_ListCopyWithImpl<MarkupBlock_List>(this, _$identity);



@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is MarkupBlock_List&&(identical(other.ordered, ordered) || other.ordered == ordered)&&const DeepCollectionEquality().equals(other.items, _items));
}


@override
int get hashCode {
    return Object.hash(runtimeType,ordered,const DeepCollectionEquality().hash(_items));
}

@override
String toString() {
    return 'MarkupBlock.list(ordered: $ordered, items: $items)';
}


}

/// @nodoc
abstract mixin class $MarkupBlock_ListCopyWith<$Res> implements $MarkupBlockCopyWith<$Res> {
  factory $MarkupBlock_ListCopyWith(MarkupBlock_List value, $Res Function(MarkupBlock_List) _then) = _$MarkupBlock_ListCopyWithImpl;
@useResult
$Res call({
 bool ordered, List<MarkupListItem> items
});




}
/// @nodoc
class _$MarkupBlock_ListCopyWithImpl<$Res>
    implements $MarkupBlock_ListCopyWith<$Res> {
  _$MarkupBlock_ListCopyWithImpl(this._self, this._then);

  final MarkupBlock_List _self;
  final $Res Function(MarkupBlock_List) _then;

/// Create a copy of MarkupBlock
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') $Res call({Object? ordered = null,Object? items = null,}) {
  return _then(MarkupBlock_List(
ordered: null == ordered ? _self.ordered : ordered // ignore: cast_nullable_to_non_nullable
as bool,items: null == items ? _self._items : items // ignore: cast_nullable_to_non_nullable
as List<MarkupListItem>,
  ));
}


}

/// @nodoc
mixin _$MarkupInline {





@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is MarkupInline);
}


@override
int get hashCode => runtimeType.hashCode;

@override
String toString() {
    return 'MarkupInline()';
}


}

/// @nodoc
class $MarkupInlineCopyWith<$Res>  {
$MarkupInlineCopyWith(MarkupInline _, $Res Function(MarkupInline) __);
}


/// Adds pattern-matching-related methods to [MarkupInline].
extension MarkupInlinePatterns on MarkupInline {
/// A variant of `map` that fallback to returning `orElse`.
///
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case final Subclass value:
///     return ...;
///   case _:
///     return orElse();
/// }
/// ```

@optionalTypeArgs TResult maybeMap<TResult extends Object?>({TResult Function( MarkupInline_Text value)?  text,TResult Function( MarkupInline_LineBreak value)?  lineBreak,TResult Function( MarkupInline_Bold value)?  bold,TResult Function( MarkupInline_Italic value)?  italic,TResult Function( MarkupInline_Code value)?  code,TResult Function( MarkupInline_Cloze value)?  cloze,TResult Function( MarkupInline_Blank value)?  blank,required TResult orElse(),}){
final _that = this;
switch (_that) {
case MarkupInline_Text() when text != null:
return text(_that);case MarkupInline_LineBreak() when lineBreak != null:
return lineBreak(_that);case MarkupInline_Bold() when bold != null:
return bold(_that);case MarkupInline_Italic() when italic != null:
return italic(_that);case MarkupInline_Code() when code != null:
return code(_that);case MarkupInline_Cloze() when cloze != null:
return cloze(_that);case MarkupInline_Blank() when blank != null:
return blank(_that);case _:
  return orElse();

}
}
/// A `switch`-like method, using callbacks.
///
/// Callbacks receives the raw object, upcasted.
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case final Subclass value:
///     return ...;
///   case final Subclass2 value:
///     return ...;
/// }
/// ```

@optionalTypeArgs TResult map<TResult extends Object?>({required TResult Function( MarkupInline_Text value)  text,required TResult Function( MarkupInline_LineBreak value)  lineBreak,required TResult Function( MarkupInline_Bold value)  bold,required TResult Function( MarkupInline_Italic value)  italic,required TResult Function( MarkupInline_Code value)  code,required TResult Function( MarkupInline_Cloze value)  cloze,required TResult Function( MarkupInline_Blank value)  blank,}){
final _that = this;
switch (_that) {
case MarkupInline_Text():
return text(_that);case MarkupInline_LineBreak():
return lineBreak(_that);case MarkupInline_Bold():
return bold(_that);case MarkupInline_Italic():
return italic(_that);case MarkupInline_Code():
return code(_that);case MarkupInline_Cloze():
return cloze(_that);case MarkupInline_Blank():
return blank(_that);}
}
/// A variant of `map` that fallback to returning `null`.
///
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case final Subclass value:
///     return ...;
///   case _:
///     return null;
/// }
/// ```

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>({TResult? Function( MarkupInline_Text value)?  text,TResult? Function( MarkupInline_LineBreak value)?  lineBreak,TResult? Function( MarkupInline_Bold value)?  bold,TResult? Function( MarkupInline_Italic value)?  italic,TResult? Function( MarkupInline_Code value)?  code,TResult? Function( MarkupInline_Cloze value)?  cloze,TResult? Function( MarkupInline_Blank value)?  blank,}){
final _that = this;
switch (_that) {
case MarkupInline_Text() when text != null:
return text(_that);case MarkupInline_LineBreak() when lineBreak != null:
return lineBreak(_that);case MarkupInline_Bold() when bold != null:
return bold(_that);case MarkupInline_Italic() when italic != null:
return italic(_that);case MarkupInline_Code() when code != null:
return code(_that);case MarkupInline_Cloze() when cloze != null:
return cloze(_that);case MarkupInline_Blank() when blank != null:
return blank(_that);case _:
  return null;

}
}
/// A variant of `when` that fallback to an `orElse` callback.
///
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case Subclass(:final field):
///     return ...;
///   case _:
///     return orElse();
/// }
/// ```

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>({TResult Function( String text)?  text,TResult Function()?  lineBreak,TResult Function( List<MarkupInline> content)?  bold,TResult Function( List<MarkupInline> content)?  italic,TResult Function( String text)?  code,TResult Function( int number,  List<MarkupInline> answer,  String? hint)?  cloze,TResult Function( String? hint)?  blank,required TResult orElse(),}) {final _that = this;
switch (_that) {
case MarkupInline_Text() when text != null:
return text(_that.text);case MarkupInline_LineBreak() when lineBreak != null:
return lineBreak();case MarkupInline_Bold() when bold != null:
return bold(_that.content);case MarkupInline_Italic() when italic != null:
return italic(_that.content);case MarkupInline_Code() when code != null:
return code(_that.text);case MarkupInline_Cloze() when cloze != null:
return cloze(_that.number,_that.answer,_that.hint);case MarkupInline_Blank() when blank != null:
return blank(_that.hint);case _:
  return orElse();

}
}
/// A `switch`-like method, using callbacks.
///
/// As opposed to `map`, this offers destructuring.
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case Subclass(:final field):
///     return ...;
///   case Subclass2(:final field2):
///     return ...;
/// }
/// ```

@optionalTypeArgs TResult when<TResult extends Object?>({required TResult Function( String text)  text,required TResult Function()  lineBreak,required TResult Function( List<MarkupInline> content)  bold,required TResult Function( List<MarkupInline> content)  italic,required TResult Function( String text)  code,required TResult Function( int number,  List<MarkupInline> answer,  String? hint)  cloze,required TResult Function( String? hint)  blank,}) {final _that = this;
switch (_that) {
case MarkupInline_Text():
return text(_that.text);case MarkupInline_LineBreak():
return lineBreak();case MarkupInline_Bold():
return bold(_that.content);case MarkupInline_Italic():
return italic(_that.content);case MarkupInline_Code():
return code(_that.text);case MarkupInline_Cloze():
return cloze(_that.number,_that.answer,_that.hint);case MarkupInline_Blank():
return blank(_that.hint);}
}
/// A variant of `when` that fallback to returning `null`
///
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case Subclass(:final field):
///     return ...;
///   case _:
///     return null;
/// }
/// ```

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>({TResult? Function( String text)?  text,TResult? Function()?  lineBreak,TResult? Function( List<MarkupInline> content)?  bold,TResult? Function( List<MarkupInline> content)?  italic,TResult? Function( String text)?  code,TResult? Function( int number,  List<MarkupInline> answer,  String? hint)?  cloze,TResult? Function( String? hint)?  blank,}) {final _that = this;
switch (_that) {
case MarkupInline_Text() when text != null:
return text(_that.text);case MarkupInline_LineBreak() when lineBreak != null:
return lineBreak();case MarkupInline_Bold() when bold != null:
return bold(_that.content);case MarkupInline_Italic() when italic != null:
return italic(_that.content);case MarkupInline_Code() when code != null:
return code(_that.text);case MarkupInline_Cloze() when cloze != null:
return cloze(_that.number,_that.answer,_that.hint);case MarkupInline_Blank() when blank != null:
return blank(_that.hint);case _:
  return null;

}
}

}

/// @nodoc


class MarkupInline_Text extends MarkupInline {
  const MarkupInline_Text({required this.text}): super._();
  

/// The text.
 final  String text;

/// Create a copy of MarkupInline
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$MarkupInline_TextCopyWith<MarkupInline_Text> get copyWith => _$MarkupInline_TextCopyWithImpl<MarkupInline_Text>(this, _$identity);



@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is MarkupInline_Text&&(identical(other.text, text) || other.text == text));
}


@override
int get hashCode {
    return Object.hash(runtimeType,text);
}

@override
String toString() {
    return 'MarkupInline.text(text: $text)';
}


}

/// @nodoc
abstract mixin class $MarkupInline_TextCopyWith<$Res> implements $MarkupInlineCopyWith<$Res> {
  factory $MarkupInline_TextCopyWith(MarkupInline_Text value, $Res Function(MarkupInline_Text) _then) = _$MarkupInline_TextCopyWithImpl;
@useResult
$Res call({
 String text
});




}
/// @nodoc
class _$MarkupInline_TextCopyWithImpl<$Res>
    implements $MarkupInline_TextCopyWith<$Res> {
  _$MarkupInline_TextCopyWithImpl(this._self, this._then);

  final MarkupInline_Text _self;
  final $Res Function(MarkupInline_Text) _then;

/// Create a copy of MarkupInline
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') $Res call({Object? text = null,}) {
  return _then(MarkupInline_Text(
text: null == text ? _self.text : text // ignore: cast_nullable_to_non_nullable
as String,
  ));
}


}

/// @nodoc


class MarkupInline_LineBreak extends MarkupInline {
  const MarkupInline_LineBreak(): super._();
  






@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is MarkupInline_LineBreak);
}


@override
int get hashCode => runtimeType.hashCode;

@override
String toString() {
    return 'MarkupInline.lineBreak()';
}


}




/// @nodoc


class MarkupInline_Bold extends MarkupInline {
  const MarkupInline_Bold({required  List<MarkupInline> content}): _content = content,super._();
  

/// What is bold.
 final  List<MarkupInline> _content;
/// What is bold.
 List<MarkupInline> get content {
  if (_content is EqualUnmodifiableListView) return _content;
  // ignore: implicit_dynamic_type
  return EqualUnmodifiableListView(_content);
}


/// Create a copy of MarkupInline
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$MarkupInline_BoldCopyWith<MarkupInline_Bold> get copyWith => _$MarkupInline_BoldCopyWithImpl<MarkupInline_Bold>(this, _$identity);



@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is MarkupInline_Bold&&const DeepCollectionEquality().equals(other.content, _content));
}


@override
int get hashCode {
    return Object.hash(runtimeType,const DeepCollectionEquality().hash(_content));
}

@override
String toString() {
    return 'MarkupInline.bold(content: $content)';
}


}

/// @nodoc
abstract mixin class $MarkupInline_BoldCopyWith<$Res> implements $MarkupInlineCopyWith<$Res> {
  factory $MarkupInline_BoldCopyWith(MarkupInline_Bold value, $Res Function(MarkupInline_Bold) _then) = _$MarkupInline_BoldCopyWithImpl;
@useResult
$Res call({
 List<MarkupInline> content
});




}
/// @nodoc
class _$MarkupInline_BoldCopyWithImpl<$Res>
    implements $MarkupInline_BoldCopyWith<$Res> {
  _$MarkupInline_BoldCopyWithImpl(this._self, this._then);

  final MarkupInline_Bold _self;
  final $Res Function(MarkupInline_Bold) _then;

/// Create a copy of MarkupInline
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') $Res call({Object? content = null,}) {
  return _then(MarkupInline_Bold(
content: null == content ? _self._content : content // ignore: cast_nullable_to_non_nullable
as List<MarkupInline>,
  ));
}


}

/// @nodoc


class MarkupInline_Italic extends MarkupInline {
  const MarkupInline_Italic({required  List<MarkupInline> content}): _content = content,super._();
  

/// What is italic.
 final  List<MarkupInline> _content;
/// What is italic.
 List<MarkupInline> get content {
  if (_content is EqualUnmodifiableListView) return _content;
  // ignore: implicit_dynamic_type
  return EqualUnmodifiableListView(_content);
}


/// Create a copy of MarkupInline
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$MarkupInline_ItalicCopyWith<MarkupInline_Italic> get copyWith => _$MarkupInline_ItalicCopyWithImpl<MarkupInline_Italic>(this, _$identity);



@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is MarkupInline_Italic&&const DeepCollectionEquality().equals(other.content, _content));
}


@override
int get hashCode {
    return Object.hash(runtimeType,const DeepCollectionEquality().hash(_content));
}

@override
String toString() {
    return 'MarkupInline.italic(content: $content)';
}


}

/// @nodoc
abstract mixin class $MarkupInline_ItalicCopyWith<$Res> implements $MarkupInlineCopyWith<$Res> {
  factory $MarkupInline_ItalicCopyWith(MarkupInline_Italic value, $Res Function(MarkupInline_Italic) _then) = _$MarkupInline_ItalicCopyWithImpl;
@useResult
$Res call({
 List<MarkupInline> content
});




}
/// @nodoc
class _$MarkupInline_ItalicCopyWithImpl<$Res>
    implements $MarkupInline_ItalicCopyWith<$Res> {
  _$MarkupInline_ItalicCopyWithImpl(this._self, this._then);

  final MarkupInline_Italic _self;
  final $Res Function(MarkupInline_Italic) _then;

/// Create a copy of MarkupInline
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') $Res call({Object? content = null,}) {
  return _then(MarkupInline_Italic(
content: null == content ? _self._content : content // ignore: cast_nullable_to_non_nullable
as List<MarkupInline>,
  ));
}


}

/// @nodoc


class MarkupInline_Code extends MarkupInline {
  const MarkupInline_Code({required this.text}): super._();
  

/// The code's literal text.
 final  String text;

/// Create a copy of MarkupInline
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$MarkupInline_CodeCopyWith<MarkupInline_Code> get copyWith => _$MarkupInline_CodeCopyWithImpl<MarkupInline_Code>(this, _$identity);



@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is MarkupInline_Code&&(identical(other.text, text) || other.text == text));
}


@override
int get hashCode {
    return Object.hash(runtimeType,text);
}

@override
String toString() {
    return 'MarkupInline.code(text: $text)';
}


}

/// @nodoc
abstract mixin class $MarkupInline_CodeCopyWith<$Res> implements $MarkupInlineCopyWith<$Res> {
  factory $MarkupInline_CodeCopyWith(MarkupInline_Code value, $Res Function(MarkupInline_Code) _then) = _$MarkupInline_CodeCopyWithImpl;
@useResult
$Res call({
 String text
});




}
/// @nodoc
class _$MarkupInline_CodeCopyWithImpl<$Res>
    implements $MarkupInline_CodeCopyWith<$Res> {
  _$MarkupInline_CodeCopyWithImpl(this._self, this._then);

  final MarkupInline_Code _self;
  final $Res Function(MarkupInline_Code) _then;

/// Create a copy of MarkupInline
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') $Res call({Object? text = null,}) {
  return _then(MarkupInline_Code(
text: null == text ? _self.text : text // ignore: cast_nullable_to_non_nullable
as String,
  ));
}


}

/// @nodoc


class MarkupInline_Cloze extends MarkupInline {
  const MarkupInline_Cloze({required this.number, required  List<MarkupInline> answer, this.hint}): _answer = answer,super._();
  

/// The cloze number, from 1.
 final  int number;
/// The answer.
 final  List<MarkupInline> _answer;
/// The answer.
 List<MarkupInline> get answer {
  if (_answer is EqualUnmodifiableListView) return _answer;
  // ignore: implicit_dynamic_type
  return EqualUnmodifiableListView(_answer);
}

/// The hint, absent when none.
 final  String? hint;

/// Create a copy of MarkupInline
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$MarkupInline_ClozeCopyWith<MarkupInline_Cloze> get copyWith => _$MarkupInline_ClozeCopyWithImpl<MarkupInline_Cloze>(this, _$identity);



@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is MarkupInline_Cloze&&(identical(other.number, number) || other.number == number)&&const DeepCollectionEquality().equals(other.answer, _answer)&&(identical(other.hint, hint) || other.hint == hint));
}


@override
int get hashCode {
    return Object.hash(runtimeType,number,const DeepCollectionEquality().hash(_answer),hint);
}

@override
String toString() {
    return 'MarkupInline.cloze(number: $number, answer: $answer, hint: $hint)';
}


}

/// @nodoc
abstract mixin class $MarkupInline_ClozeCopyWith<$Res> implements $MarkupInlineCopyWith<$Res> {
  factory $MarkupInline_ClozeCopyWith(MarkupInline_Cloze value, $Res Function(MarkupInline_Cloze) _then) = _$MarkupInline_ClozeCopyWithImpl;
@useResult
$Res call({
 int number, List<MarkupInline> answer, String? hint
});




}
/// @nodoc
class _$MarkupInline_ClozeCopyWithImpl<$Res>
    implements $MarkupInline_ClozeCopyWith<$Res> {
  _$MarkupInline_ClozeCopyWithImpl(this._self, this._then);

  final MarkupInline_Cloze _self;
  final $Res Function(MarkupInline_Cloze) _then;

/// Create a copy of MarkupInline
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') $Res call({Object? number = null,Object? answer = null,Object? hint = freezed,}) {
  return _then(MarkupInline_Cloze(
number: null == number ? _self.number : number // ignore: cast_nullable_to_non_nullable
as int,answer: null == answer ? _self._answer : answer // ignore: cast_nullable_to_non_nullable
as List<MarkupInline>,hint: freezed == hint ? _self.hint : hint // ignore: cast_nullable_to_non_nullable
as String?,
  ));
}


}

/// @nodoc


class MarkupInline_Blank extends MarkupInline {
  const MarkupInline_Blank({this.hint}): super._();
  

/// The hidden cloze's hint.
 final  String? hint;

/// Create a copy of MarkupInline
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$MarkupInline_BlankCopyWith<MarkupInline_Blank> get copyWith => _$MarkupInline_BlankCopyWithImpl<MarkupInline_Blank>(this, _$identity);



@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is MarkupInline_Blank&&(identical(other.hint, hint) || other.hint == hint));
}


@override
int get hashCode {
    return Object.hash(runtimeType,hint);
}

@override
String toString() {
    return 'MarkupInline.blank(hint: $hint)';
}


}

/// @nodoc
abstract mixin class $MarkupInline_BlankCopyWith<$Res> implements $MarkupInlineCopyWith<$Res> {
  factory $MarkupInline_BlankCopyWith(MarkupInline_Blank value, $Res Function(MarkupInline_Blank) _then) = _$MarkupInline_BlankCopyWithImpl;
@useResult
$Res call({
 String? hint
});




}
/// @nodoc
class _$MarkupInline_BlankCopyWithImpl<$Res>
    implements $MarkupInline_BlankCopyWith<$Res> {
  _$MarkupInline_BlankCopyWithImpl(this._self, this._then);

  final MarkupInline_Blank _self;
  final $Res Function(MarkupInline_Blank) _then;

/// Create a copy of MarkupInline
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') $Res call({Object? hint = freezed,}) {
  return _then(MarkupInline_Blank(
hint: freezed == hint ? _self.hint : hint // ignore: cast_nullable_to_non_nullable
as String?,
  ));
}


}

// dart format on
