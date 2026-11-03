import 'dart:io';

import 'package:drift/drift.dart' show driftRuntimeOptions;
import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:knowno/database/database.dart';
import 'package:knowno/deck/deck.dart';
import 'package:knowno/deck/src/deck_row.dart';
import 'package:knowno/design/theme.dart';
import 'package:knowno/media/media.dart';
import 'package:uuid/uuid.dart';

import '../media/fakes.dart';

const _id = DeckId('00000000-0000-4000-8000-000000000001');

Deck _deck({DeckIcon? icon, DeckColor? color, MediaId? image}) => Deck(
  id: _id,
  name: 'French',
  createdAt: DateTime.utc(2026, 10, 26),
  updatedAt: DateTime.utc(2026, 10, 26),
  icon: icon,
  color: color,
  image: image,
);

Future<void> _pump(WidgetTester tester, Widget tile) => tester.pumpWidget(
  MaterialApp(
    theme: lightTheme,
    home: Scaffold(body: Center(child: tile)),
  ),
);

/// The fill of the one tile on screen.
Color? _fill(WidgetTester tester) {
  final box = tester.widget<Container>(
    find.descendant(
      of: find.byType(DeckTile),
      matching: find.byType(Container),
    ),
  );
  return (box.decoration! as BoxDecoration).color;
}

void main() {
  testWidgets(
    'a deck nobody customised shows the default icon on the brand tint, and no initial',
    (tester) async {
      await _pump(tester, DeckTile(look: DeckLook.of(_deck())));

      expect(find.byIcon(LucideIcons.layers), findsOneWidget);
      expect(find.text('F'), findsNothing);
      expect(_fill(tester), AppColors.light.brandTint);
    },
  );

  testWidgets('a customised deck shows its icon on its colour', (tester) async {
    await _pump(
      tester,
      DeckTile(
        look: DeckLook.of(_deck(icon: DeckIcon.book, color: DeckColor.amber)),
      ),
    );

    expect(find.byIcon(LucideIcons.bookOpen), findsOneWidget);
    expect(find.byIcon(LucideIcons.layers), findsNothing);
    expect(_fill(tester), deckTileColor(AppColors.light, DeckColor.amber));
  });

  testWidgets("a preview's icon and colour are drawn in place of the deck's", (
    tester,
  ) async {
    await _pump(
      tester,
      DeckTile(
        look: DeckLook.of(_deck(icon: DeckIcon.book, color: DeckColor.amber))
            .withIcon(DeckIcon.star)
            .withColor(DeckColor.blue),
      ),
    );

    expect(find.byIcon(LucideIcons.star), findsOneWidget);
    expect(find.byIcon(LucideIcons.bookOpen), findsNothing);
    expect(_fill(tester), deckTileColor(AppColors.light, DeckColor.blue));
  });

  group('with an image', () {
    late AppDatabase db;
    late FakeMediaServer server;
    late MediaStore store;
    late Directory directory;

    setUp(() {
      driftRuntimeOptions.dontWarnAboutMultipleDatabases = true;
      db = AppDatabase(NativeDatabase.memory());
      server = FakeMediaServer();
      directory = newMediaDirectory();
      store = MediaStore(
        db,
        server,
        directory: directory,
        clock: () => DateTime.utc(2026, 10, 26),
        newId: const Uuid().v4,
      );
    });

    tearDown(() async {
      await db.close();
      await deleteMediaDirectory(directory);
    });

    /// Pumps [tile] reading through [store], and lets the store's file read
    /// finish, which needs real time.
    Future<void> pumpWithStore(WidgetTester tester, Widget tile) async {
      await tester.runAsync(
        () => tester.pumpWidget(
          ProviderScope(
            overrides: [mediaStoreProvider.overrideWithValue(store)],
            child: MaterialApp(
              theme: lightTheme,
              home: Scaffold(body: Center(child: tile)),
            ),
          ),
        ),
      );
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 200)),
      );
      await tester.pump();
    }

    testWidgets(
      'a deck whose image the device holds shows it in place of its icon',
      (tester) async {
        final id = (await tester.runAsync(
          () => store.addImage(preparedImage(1)),
        ))!;

        await pumpWithStore(
          tester,
          DeckTile(look: DeckLook.of(_deck(image: id))),
        );

        final image = tester.widget<Image>(find.byType(Image));
        expect((image.image as MemoryImage).bytes, preparedImage(1).bytes);
        expect(find.byIcon(LucideIcons.layers), findsNothing);
      },
    );

    testWidgets(
      'a deck whose image neither the device nor the server holds shows its icon',
      (tester) async {
        server.offline = true;
        const id = MediaId('00000000-0000-4000-8000-0000000000aa');

        await pumpWithStore(
          tester,
          DeckTile(look: DeckLook.of(_deck(image: id))),
        );

        expect(find.byType(Image), findsNothing);
        expect(find.byIcon(LucideIcons.layers), findsOneWidget);
      },
    );

    testWidgets(
      "a preview's removal shows the icon of a deck that has an image",
      (tester) async {
        final id = (await tester.runAsync(
          () => store.addImage(preparedImage(1)),
        ))!;

        await pumpWithStore(
          tester,
          DeckTile(
            look: DeckLook.of(_deck(image: id)).withImage(const NoTileImage()),
          ),
        );

        expect(find.byType(Image), findsNothing);
        expect(find.byIcon(LucideIcons.layers), findsOneWidget);
      },
    );
  });

  test('a stored key reads as its icon or colour, and a key this build does not know as none', () {
    expect(DeckIcon.fromKey('book'), DeckIcon.book);
    expect(DeckColor.fromKey('violet'), DeckColor.violet);
    expect(DeckIcon.fromKey('rocket'), isNull);
    expect(DeckColor.fromKey('teal'), isNull);
    expect(DeckIcon.fromKey(null), isNull);
    // Every key is distinct, so each reads back as the value that wrote it.
    for (final icon in DeckIcon.values) {
      expect(DeckIcon.fromKey(icon.key), icon);
    }
    for (final color in DeckColor.values) {
      expect(DeckColor.fromKey(color.key), color);
    }
  });
}
