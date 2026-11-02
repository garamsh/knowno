import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../deck/deck.dart';
import '../../design/app_button.dart';
import '../../design/mascot.dart';
import '../../design/theme.dart';
import '../../l10n/app_localizations.dart';
import '../../photo_import/photo_import.dart';
import '../../sharing/sharing.dart';
import 'deck_screen.dart';
import 'decks_tab.dart';
import 'first_run.dart';
import 'new_deck_sheet.dart';
import 'record_tab.dart';
import 'today_tab.dart';

/// The signed-in app: the 오늘, 덱 and 기록 tabs over the user's decks, or the
/// first-run home before the first deck. Back on another tab returns to 오늘.
class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  int _tab = 0;

  /// Whether the 기록 tab was shown: it reads every review, so not before.
  bool _recordShown = false;

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

  /// Opens the photo import under way, then the deck it saved into.
  Future<void> _openImport(PhotoImports imports) async {
    final navigator = Navigator.of(context);
    final deck = await openPhotoImport(context, imports);
    if (deck == null || !mounted) return;
    await navigator.push(
      MaterialPageRoute<void>(builder: (_) => DeckScreen(deck: deck)),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    final sharing = ref.watch(sharingServiceProvider);
    final imports = ref.watch(photoImportsProvider);
    final importBar = imports == null
        ? null
        : PhotoImportBar(imports: imports, onOpen: () => _openImport(imports));
    return switch ((ref.watch(decksProvider), ref.watch(cardCountsProvider))) {
      (AsyncData(value: final decks), AsyncData(value: final counts)) =>
        decks.isEmpty
            ? Scaffold(
                appBar: AppBar(
                  titleSpacing: AppSpace.gutter,
                  title: const BrandTitle(),
                  actions: const [AccountButton()],
                ),
                bottomNavigationBar: importBar == null
                    ? null
                    : SafeArea(child: importBar),
                body: _EmptyHome(
                  onCreate: () => showNewDeckSheet(context, ref),
                  onBrowse: sharing == null
                      ? null
                      : () => Navigator.of(context).push(
                          MaterialPageRoute<void>(
                            builder: (_) => sharing.browseScreen(),
                          ),
                        ),
                ),
              )
            : PopScope(
                canPop: _tab == 0,
                onPopInvokedWithResult: (popped, _) {
                  if (!popped) setState(() => _tab = 0);
                },
                child: Scaffold(
                  body: IndexedStack(
                    index: _tab,
                    children: [
                      TodayTab(
                        decks: decks,
                        counts: counts,
                        onShowDecks: () => setState(() => _tab = 1),
                        onShowRecord: () => setState(() {
                          _tab = 2;
                          _recordShown = true;
                        }),
                      ),
                      DecksTab(decks: decks, counts: counts),
                      if (_recordShown)
                        RecordTab(decks: decks)
                      else
                        const SizedBox.shrink(),
                    ],
                  ),
                  bottomNavigationBar: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      ?importBar,
                      _TabBar(
                        selected: _tab,
                        onSelect: (tab) => setState(() {
                          _tab = tab;
                          _recordShown |= tab == 2;
                        }),
                      ),
                    ],
                  ),
                ),
              ),
      (AsyncError(:final error, :final stackTrace), _) ||
      (_, AsyncError(:final error, :final stackTrace)) => Scaffold(
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

/// The three tabs at the foot of the screen, on one surface floating on its
/// edge: each its name alone, the current one in the primary colour.
class _TabBar extends StatelessWidget {
  const _TabBar({required this.selected, required this.onSelect});

  final int selected;
  final ValueChanged<int> onSelect;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    final tabs = [l10n.tabToday, l10n.tabDecks, l10n.tabRecord];
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
                for (final (index, tab) in tabs.indexed)
                  Expanded(
                    child: Semantics(
                      selected: index == selected,
                      button: true,
                      child: InkWell(
                        borderRadius: BorderRadius.circular(AppRadius.button),
                        onTap: () => onSelect(index),
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
                                tab,
                                style: AppType.label.copyWith(
                                  color: index == selected
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

/// The first-run home: the mascot, what to do first, "덱 만들기", which opens
/// the new-deck sheet with every way to start one, and, with sharing, the
/// public decks.
class _EmptyHome extends StatelessWidget {
  const _EmptyHome({required this.onCreate, required this.onBrowse});

  final VoidCallback onCreate;
  final VoidCallback? onBrowse;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final onBrowse = this.onBrowse;
    return FirstRun(
      mascot: MascotExpression.thinking,
      title: l10n.emptyHomeTitle,
      actions: [
        AppButton(
          label: l10n.newDeckTitle,
          icon: LucideIcons.plus,
          size: AppButtonSize.cta,
          onPressed: onCreate,
        ),
        if (onBrowse != null)
          AppButton(
            label: l10n.browsePublicDecks,
            variant: AppButtonVariant.text,
            onPressed: onBrowse,
          ),
      ],
    );
  }
}
