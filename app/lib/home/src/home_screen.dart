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
import 'record_tab.dart';

/// The tabs, in the order the bar shows them.
enum _Tab { record, home, settings }

/// The signed-in app: the 기록, 홈 and 설정 tabs, opening on 홈. 홈 keeps a
/// navigator of its own, so a note opens above the menu. Back on another tab
/// returns to 홈; on 홈 it closes what 홈 opened, then is left to the platform.
class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  var _tab = _Tab.home;

  /// Whether the 기록 tab was shown: it reads every review, so not before.
  var _recordShown = false;

  final _homeNavigator = GlobalKey<NavigatorState>();

  /// Whether 홈's navigator holds a screen over its first.
  var _homeOpened = false;

  late final _homeObserver = _DepthObserver(() {
    // A navigator reports during its own update, so the state changes after.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final opened = _homeNavigator.currentState?.canPop() ?? false;
      if (mounted && opened != _homeOpened) {
        setState(() => _homeOpened = opened);
      }
    });
  });

  @override
  void initState() {
    super.initState();
    unawaited(_offerResume());
  }

  /// Offers to resume a photo import a closed app left with photos to read.
  Future<void> _offerResume() async {
    final imports = ref.read(photoImportsProvider);
    if (imports == null) return;
    await imports.restored;
    if (!mounted) return;
    if (imports.job case final job? when job.paused) {
      await offerPhotoImportResume(context, imports, job);
    }
  }

  /// Opens the photo import under way, then, on 홈, the deck it saved into.
  Future<void> _openImport(PhotoImports imports) async {
    final deck = await openPhotoImport(context, imports);
    if (deck == null || !mounted) return;
    _select(_Tab.home);
    await _homeNavigator.currentState?.push(
      MaterialPageRoute<void>(builder: (_) => DeckScreen(deck: deck)),
    );
  }

  /// Shows [tab]; 홈 again, while it shows a screen it opened, returns to its
  /// first.
  void _select(_Tab tab) {
    if (tab == _Tab.home && _tab == _Tab.home) {
      _homeNavigator.currentState?.popUntil((route) => route.isFirst);
    }
    setState(() {
      _tab = tab;
      _recordShown |= tab == _Tab.record;
    });
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    final imports = ref.watch(photoImportsProvider);
    final importBar = imports == null
        ? null
        : PhotoImportBar(imports: imports, onOpen: () => _openImport(imports));
    return switch (ref.watch(decksProvider)) {
      AsyncData(value: final decks) => PopScope(
        canPop: _tab == _Tab.home && !_homeOpened,
        onPopInvokedWithResult: (popped, _) {
          if (popped) return;
          if (_tab != _Tab.home) {
            setState(() => _tab = _Tab.home);
          } else {
            unawaited(_homeNavigator.currentState?.maybePop());
          }
        },
        child: Scaffold(
          body: IndexedStack(
            index: _tab.index,
            children: [
              if (_recordShown)
                RecordTab(decks: decks)
              else
                const SizedBox.shrink(),
              HeroControllerScope.none(
                child: Navigator(
                  key: _homeNavigator,
                  observers: [_homeObserver],
                  onGenerateRoute: (_) =>
                      MaterialPageRoute<void>(builder: (_) => const HomeTab()),
                ),
              ),
              const AccountScreen(
                syncStatus: SyncStatusView(),
                studySettings: [
                  DailyMinutesRow(),
                  AutoplayAudioRow(),
                  PartOfSpeechPresetsRow(),
                ],
              ),
            ],
          ),
          bottomNavigationBar: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              ?importBar,
              _TabBar(selected: _tab, onSelect: _select),
            ],
          ),
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
      _Tab.settings => l10n.tabSettings,
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
                          child: Center(
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
