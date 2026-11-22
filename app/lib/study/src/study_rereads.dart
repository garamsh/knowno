import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../deck/deck.dart' show DeckId, DeckSelection;
import 'providers.dart';
import 'study_changes.dart';

/// Has a widget that shows a read over [decks] read it again when [decks]
/// changes, whenever the route that shows it comes back on top and, while it
/// is on top, once the cards, their states or the reviews have stopped
/// changing ([StudyChanges]).
///
/// The widget's state starts its first read as it builds and [read]s again by
/// replacing the future it shows.
mixin StudyRereads<T extends ConsumerStatefulWidget> on ConsumerState<T> {
  /// The selection the widget reads.
  DeckSelection get decks;

  /// Starts the read again, keeping its future for the build.
  void read();

  late final _changes = StudyChanges(ref.read(studyRepositoryProvider), () {
    if (_onTop) {
      setState(() {
        read();
      });
    }
  });
  late Set<DeckId> _ids;
  bool _onTop = true;

  @override
  void initState() {
    super.initState();
    _ids = decks.ids;
    _changes.start();
  }

  @override
  void dispose() {
    _changes.cancel();
    super.dispose();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final onTop = ModalRoute.isCurrentOf(context) ?? true;
    if (onTop && !_onTop) read();
    _onTop = onTop;
  }

  @override
  void didUpdateWidget(T oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!setEquals(_ids, decks.ids)) read();
    _ids = decks.ids;
  }
}
