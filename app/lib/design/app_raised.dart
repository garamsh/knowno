import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';

import 'theme.dart';

/// A solid object on its edge: [child], in [radius], over an edge of [edge]
/// [height] tall, with no blur. Pressed, it moves down onto its edge; under
/// reduce motion it stays and only its own press dim shows (ADR 0147). The
/// press is read from the [WidgetStatesController] [builder] hands to the
/// button or ink response it builds, so a scroll that cancels a press lifts
/// the object again. A null [edge] draws none and never moves.
class AppRaised extends StatefulWidget {
  const AppRaised({
    super.key,
    required this.edge,
    required this.height,
    required this.radius,
    required this.builder,
  });

  final Color? edge;
  final double height;
  final double radius;
  final Widget Function(BuildContext context, WidgetStatesController states)
  builder;

  @override
  State<AppRaised> createState() => _AppRaisedState();
}

class _AppRaisedState extends State<AppRaised> {
  final _states = WidgetStatesController();
  bool _pressed = false;

  @override
  void initState() {
    super.initState();
    _states.addListener(_changed);
  }

  @override
  void dispose() {
    _states.dispose();
    super.dispose();
  }

  /// A button updates its controller while it builds, when it is disabled
  /// mid-press, so a change then waits for the frame's end.
  void _changed() {
    if (_states.value.contains(WidgetState.pressed) == _pressed) return;
    if (SchedulerBinding.instance.schedulerPhase ==
        SchedulerPhase.persistentCallbacks) {
      SchedulerBinding.instance.addPostFrameCallback((_) {
        if (mounted) _changed();
      });
      return;
    }
    setState(() => _pressed = !_pressed);
  }

  @override
  Widget build(BuildContext context) {
    final child = widget.builder(context, _states);
    final edge = widget.edge;
    if (edge == null) return child;
    final moved = _pressed && !MediaQuery.disableAnimationsOf(context);
    final height = moved ? AppSize.edgePressed : widget.height;
    return Transform.translate(
      offset: Offset(0, widget.height - height),
      child: DecoratedBox(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(widget.radius),
          boxShadow: AppShadow.edge(edge, height),
        ),
        child: child,
      ),
    );
  }
}
