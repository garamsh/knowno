import 'dart:async';

import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../design/app_list_row.dart';
import '../../design/app_search_field.dart';
import '../../design/screen_skeleton.dart';
import '../../design/theme.dart';
import '../../l10n/app_localizations.dart';
import 'failure.dart';
import 'failure_message.dart';
import 'list_message.dart';
import 'model.dart';
import 'public_deck_screen.dart';
import 'sharing_service.dart';

/// Other users' public decks, searchable by name and description and sorted
/// by newest or most copied; opens one for a preview.
class BrowseScreen extends StatefulWidget {
  const BrowseScreen({super.key, required this.sharing});

  final SharingService sharing;

  @override
  State<BrowseScreen> createState() => _BrowseScreenState();
}

class _BrowseScreenState extends State<BrowseScreen> {
  /// How long typing pauses before the search runs.
  static const _searchDelay = Duration(milliseconds: 300);

  late final StreamSubscription<bool> _online;

  /// Whether the device is online; null until the first report.
  bool? _isOnline;
  String _search = '';
  BrowseSort _sort = BrowseSort.newest;
  Future<List<PublicDeckSummary>>? _decks;
  Timer? _typing;

  @override
  void initState() {
    super.initState();
    _online = widget.sharing.watchOnline().listen((online) {
      final cameOnline = online && _isOnline != true;
      setState(() => _isOnline = online);
      if (cameOnline) _load();
    });
  }

  @override
  void dispose() {
    _typing?.cancel();
    _online.cancel();
    super.dispose();
  }

  void _load() => setState(() {
    // The builder shows a failure, but subscribes only at the next frame.
    _decks = widget.sharing.listDecks(_search, _sort)..ignore();
  });

  void _onSearch(String search) {
    _typing?.cancel();
    _typing = Timer(_searchDelay, () {
      _search = search;
      _load();
    });
  }

  Future<void> _open(PublicDeckSummary deck) async {
    final blocked = await Navigator.of(context).push(
      MaterialPageRoute<bool>(
        builder: (_) => PublicDeckScreen(sharing: widget.sharing, deck: deck),
      ),
    );
    if (blocked == true && mounted) _load();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return ScreenSkeleton(
      title: l10n.browse,
      search: AppSearchField(
        hint: l10n.searchPublicDecks,
        onChanged: _onSearch,
        onSubmitted: (search) {
          _typing?.cancel();
          _search = search;
          _load();
        },
      ),
      body: [
        SliverToBoxAdapter(
          child: SegmentedButton<BrowseSort>(
            showSelectedIcon: false,
            segments: [
              ButtonSegment(
                value: BrowseSort.newest,
                label: Text(l10n.sortNewest),
              ),
              ButtonSegment(
                value: BrowseSort.mostCopied,
                label: Text(l10n.sortMostCopied),
              ),
            ],
            selected: {_sort},
            onSelectionChanged: (selected) {
              _sort = selected.single;
              _load();
            },
          ),
        ),
        SliverPadding(
          padding: const EdgeInsets.only(top: AppSpace.s16),
          sliver: SliverList.list(children: _results(l10n)),
        ),
      ],
    );
  }

  List<Widget> _results(AppLocalizations l10n) {
    if (_isOnline == false) {
      return [ListMessage(l10n.browseOffline, icon: LucideIcons.cloudOff)];
    }
    final decks = _decks;
    if (decks == null) return [const _Progress()];
    return [
      FutureBuilder(
        future: decks,
        builder: (context, snapshot) => switch (snapshot) {
          AsyncSnapshot(hasData: true, :final data?) when data.isEmpty =>
            ListMessage(
              _search.trim().isEmpty
                  ? l10n.noPublicDecks
                  : l10n.noPublicMatches,
            ),
          AsyncSnapshot(hasData: true, :final data?) => Column(
            children: [
              for (final deck in data)
                AppListRow(
                  title: deck.name,
                  subtitle: l10n.publicDeckLine(
                    deck.ownerName.value,
                    deck.cardCount,
                    deck.copyCount,
                  ),
                  trailing: Icon(
                    LucideIcons.chevronRight,
                    color: AppColors.of(context).muted,
                  ),
                  onTap: () => _open(deck),
                ),
            ],
          ),
          AsyncSnapshot(:final error?, :final stackTrace) => ListMessage(
            switch (error) {
              SharingFailure() => describeSharingFailure(l10n, error),
              _ => Error.throwWithStackTrace(
                error,
                stackTrace ?? StackTrace.current,
              ),
            },
            icon: error is SharingOffline ? LucideIcons.cloudOff : null,
            onRetry: _load,
          ),
          _ => const _Progress(),
        },
      ),
    ];
  }
}

/// Progress while a list loads.
class _Progress extends StatelessWidget {
  const _Progress();

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: AppSpace.s40),
    child: Center(
      child: CircularProgressIndicator(
        semanticsLabel: AppLocalizations.of(context).loading,
      ),
    ),
  );
}
