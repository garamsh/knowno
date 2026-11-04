import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../account/account.dart';
import '../../deck/deck.dart';
import '../../design/theme.dart';
import '../../l10n/app_localizations.dart';
import '../../photo_import/photo_import.dart';
import '../../study/study.dart';
import '../../sync/sync.dart';
import 'deck_screen.dart';
import 'home_tab.dart';
import 'notes_tab.dart';
import 'record_tab.dart';

/// The tabs, in the order the bar shows them.
enum _Tab { record, home, notes }

/// The signed-in app: the 기록, 홈 and 노트 tabs, opening on 홈, with 설정 over
/// the menu from 홈's profile button. 노트 keeps a navigator of its own, so a
/// note opens above the menu. Back on 노트 first closes what 노트 opened; on
/// another tab it returns to 홈, and on 홈 it is left to the platform.
class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  var _tab = _Tab.home;

  /// The tabs shown so far: 기록 is built the first time, since it reads
  /// every review.
  final _shown = {_Tab.home};

  final _notesNavigator = GlobalKey<NavigatorState>();

  /// Whether 노트's navigator holds a screen over its first.
  var _notesOpened = false;

  late final _notesObserver = _DepthObserver(() {
    // A navigator reports during its own update, so the state changes after.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final opened = _notesNavigator.currentState?.canPop() ?? false;
      if (mounted && opened != _notesOpened) {
        setState(() => _notesOpened = opened);
      }
    });
  });

  /// The app's photo import, whose bar opens it this screen's way.
  late final _imports = ref.read(photoImportsProvider);

  @override
  void initState() {
    super.initState();
    if (_imports case final imports?) {
      imports.opener = () => _openImport(imports);
    }
    unawaited(_offerResume());
  }

  @override
  void dispose() {
    _imports?.opener = null;
    super.dispose();
  }

  /// Offers to resume a photo import a closed app left with photos to read.
  Future<void> _offerResume() async {
    final imports = _imports;
    if (imports == null) return;
    await imports.restored;
    if (!mounted) return;
    if (imports.job case final job? when job.paused) {
      await offerPhotoImportResume(context, imports, job);
    }
  }

  /// Opens the photo import under way, then, on 노트, the deck it saved into,
  /// or its deck under the way the user chose to add the cards instead.
  Future<void> _openImport(PhotoImports imports) async {
    final outcome = await openPhotoImport(context, imports);
    if (outcome == null || !mounted) return;
    final navigator = Navigator.of(context);
    switch (outcome) {
      case PhotoImportSaved(:final deck):
        _openDeck(deck);
      case AddByHandInstead(deck: final id):
        final deck = _deckOf(id);
        if (deck == null) return;
        _openDeck(deck);
        await navigator.push(
          MaterialPageRoute<void>(
            builder: (_) => CardEditorScreen(
              deck: deck,
              preview: (cells) => CardPreviewScreen(cells: cells),
            ),
          ),
        );
      case AddFromSpreadsheetInstead(deck: final id):
        final deck = _deckOf(id);
        if (deck == null) return;
        _openDeck(deck);
        await importFromSpreadsheet(context, id);
    }
  }

  /// The deck stored under [id], or null once it is gone.
  Deck? _deckOf(DeckId id) => switch (ref.read(decksProvider)) {
    AsyncData(value: final decks) =>
      decks.where((deck) => deck.id == id).firstOrNull,
    _ => null,
  };

  /// Shows 노트 and opens [deck]'s screen on its navigator.
  void _openDeck(Deck deck, {bool addingCard = false}) {
    setState(() => _tab = _Tab.notes);
    unawaited(
      _notesNavigator.currentState?.push(
        MaterialPageRoute<void>(
          builder: (_) => DeckScreen(deck: deck, addingCard: addingCard),
        ),
      ),
    );
  }

  /// Opens 설정 over the menu.
  void _openSettings() => unawaited(
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => const AccountScreen(
          syncStatus: SyncStatusView(),
          studySettings: [
            DailyMinutesRow(),
            AutoplayAudioRow(),
            PartOfSpeechPresetsRow(),
          ],
        ),
      ),
    ),
  );

  /// Shows [tab]; 노트 again, while it shows a screen it opened, returns to
  /// its first.
  void _select(_Tab tab) {
    if (tab == _Tab.notes && _tab == _Tab.notes) {
      _notesNavigator.currentState?.popUntil((route) => route.isFirst);
    }
    setState(() {
      _tab = tab;
      _shown.add(tab);
    });
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    return switch (ref.watch(decksProvider)) {
      AsyncData(value: final decks) => PopScope(
        canPop: _tab == _Tab.home,
        onPopInvokedWithResult: (popped, _) {
          if (popped) return;
          if (_tab == _Tab.notes && _notesOpened) {
            unawaited(_notesNavigator.currentState?.maybePop());
          } else {
            setState(() => _tab = _Tab.home);
          }
        },
        child: Scaffold(
          body: IndexedStack(
            index: _tab.index,
            children: [
              if (_shown.contains(_Tab.record))
                RecordTab(decks: decks)
              else
                const SizedBox.shrink(),
              HomeTab(
                onOpenDeck: _openDeck,
                onNotes: () => _select(_Tab.notes),
                onSettings: _openSettings,
              ),
              // Built from the first, so a deck 홈 or an import opens has
              // its navigator to open on.
              HeroControllerScope.none(
                child: Navigator(
                  key: _notesNavigator,
                  observers: [_notesObserver],
                  onGenerateRoute: (_) =>
                      MaterialPageRoute<void>(builder: (_) => const NotesTab()),
                ),
              ),
            ],
          ),
          bottomNavigationBar: _TabBar(selected: _tab, onSelect: _select),
        ),
      ),
      AsyncError(:final error, :final stackTrace) => Scaffold(
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(AppSpace.gutter),
            child: Text(
              describeProviderError(l10n, error, stackTrace),
              style: AppType.body.copyWith(color: colors.ink),
            ),
          ),
        ),
      ),
      _ => const Scaffold(body: Center(child: CircularProgressIndicator())),
    };
  }
}

/// Calls [onChange] whenever its navigator's stack changes.
final class _DepthObserver extends NavigatorObserver {
  _DepthObserver(this.onChange);

  final VoidCallback onChange;

  @override
  void didPush(Route<dynamic> route, Route<dynamic>? previousRoute) =>
      onChange();

  @override
  void didPop(Route<dynamic> route, Route<dynamic>? previousRoute) =>
      onChange();

  @override
  void didRemove(Route<dynamic> route, Route<dynamic>? previousRoute) =>
      onChange();

  @override
  void didReplace({Route<dynamic>? newRoute, Route<dynamic>? oldRoute}) =>
      onChange();
}

/// The three tabs at the foot of the screen, on one surface floating on its
/// edge: each its name alone, the current one in the accent.
class _TabBar extends StatelessWidget {
  const _TabBar({required this.selected, required this.onSelect});

  final _Tab selected;
  final ValueChanged<_Tab> onSelect;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    String name(_Tab tab) => switch (tab) {
      _Tab.record => l10n.tabRecord,
      _Tab.home => l10n.tabHome,
      _Tab.notes => l10n.tabNotes,
    };
    return Semantics(
      container: true,
      label: l10n.tabsLabel,
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(
            AppSpace.s16,
            AppSpace.s12,
            AppSpace.s16,
            AppSpace.s16,
          ),
          child: DecoratedBox(
            decoration: BoxDecoration(
              color: colors.bar,
              borderRadius: BorderRadius.circular(AppRadius.button),
              boxShadow: AppShadow.edge(colors.edge, AppSize.edgeRow),
            ),
            child: Row(
              children: [
                for (final tab in _Tab.values)
                  Expanded(
                    child: Semantics(
                      selected: tab == selected,
                      button: true,
                      child: InkWell(
                        borderRadius: BorderRadius.circular(AppRadius.button),
                        onTap: () => onSelect(tab),
                        // At least its height; taller where a larger text
                        // size needs it, so the label is never cut.
                        child: ConstrainedBox(
                          constraints: const BoxConstraints(
                            minHeight: AppSize.tabBar,
                          ),
                          // As tall as its label, so the bar keeps to its
                          // height at the foot of the scaffold.
                          child: Center(
                            heightFactor: 1,
                            // One line, shrunk to the tab only where a large
                            // text size is wider than it.
                            child: FittedBox(
                              fit: BoxFit.scaleDown,
                              child: Text(
                                name(tab),
                                style: AppType.label.copyWith(
                                  color: tab == selected
                                      ? colors.accent
                                      : colors.ink2,
                                ),
                              ),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
