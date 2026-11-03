import 'package:flutter/gestures.dart';
import 'package:flutter/widgets.dart';

/// Closes the keyboard, by taking the focus from the focused field, when a tap
/// lands on nothing that handles it or a drag scrolls a scrollable that holds
/// that field. A tap that a button or another field handles does what it did.
/// A tap on a field's selection handles or toolbar, and a drag that starts on
/// the focused field's text, keep it, so a selection survives being adjusted;
/// so does any drag while the field holds a selection of characters, so the
/// selection survives scrolling.
///
/// The app root wraps every route in it, so the rule holds on every screen.
class KeyboardDismissal extends StatefulWidget {
  const KeyboardDismissal({super.key, required this.child});

  /// The app's navigator, which `MaterialApp.builder` passes.
  final Widget? child;

  @override
  State<KeyboardDismissal> createState() => _KeyboardDismissalState();
}

/// What a pointer went down on.
enum _Start {
  /// The focused field's text.
  focusedField,

  /// A text field or what it draws over the screen, its selection handles
  /// and its toolbar, which share its tap region group.
  textControls,
  elsewhere,
}

class _KeyboardDismissalState extends State<KeyboardDismissal> {
  /// What the last pointer went down on.
  var _start = _Start.elsewhere;

  void _pointerDown(PointerDownEvent event) {
    final result = HitTestResult();
    WidgetsBinding.instance.hitTestInView(result, event.position, event.viewId);
    final field = _focused()?.context?.findRenderObject();
    final targets = [for (final entry in result.path) entry.target];
    bool inTextGroup(HitTestTarget target) =>
        target is RenderTapRegion && target.groupId == EditableText;
    _start = field != null && targets.contains(field)
        ? _Start.focusedField
        : targets.any(inTextGroup)
        ? _Start.textControls
        : _Start.elsewhere;
  }

  @override
  Widget build(BuildContext context) {
    return Listener(
      onPointerDown: _pointerDown,
      child: NotificationListener<ScrollStartNotification>(
        onNotification: (notification) {
          final focused = _focused();
          if (notification.dragDetails != null &&
              _start != _Start.focusedField &&
              focused != null &&
              !_holdsSelection(focused) &&
              _holds(notification.context, focused.context)) {
            focused.unfocus();
          }
          return false;
        },
        // A tap any widget under the pointer handles wins the gesture arena
        // over this one, which sits above them all. A selection handle
        // claims no tap, so it is told apart by where the pointer went down.
        child: GestureDetector(
          behavior: HitTestBehavior.translucent,
          excludeFromSemantics: true,
          onTap: () {
            if (_start == _Start.elsewhere) _focused()?.unfocus();
          },
          child: widget.child,
        ),
      ),
    );
  }

  /// The focused field, or null while only a scope, a route's, holds the
  /// focus.
  static FocusNode? _focused() => switch (FocusManager.instance.primaryFocus) {
    final FocusScopeNode _ => null,
    final node => node,
  };

  /// Whether [field] is a text field holding a selection of characters,
  /// which a scrolling drag keeps so the selection can still be acted on.
  static bool _holdsSelection(FocusNode field) {
    final selection = field.context
        ?.findAncestorStateOfType<EditableTextState>()
        ?.textEditingValue
        .selection;
    return selection != null && selection.isValid && !selection.isCollapsed;
  }

  /// Whether [scrollable] is an ancestor of [field], so a drag on a strip
  /// beside the field, or inside the field's own scrolling text, keeps the
  /// keyboard.
  static bool _holds(BuildContext? scrollable, BuildContext? field) {
    if (scrollable == null || field == null) return false;
    var found = false;
    field.visitAncestorElements((element) {
      found = identical(element, scrollable);
      return !found;
    });
    return found;
  }
}
