import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'content.dart';
import 'failure.dart';

/// A label the card editor offers above the keyboard while a sense's label
/// is typed: the [label] it fills in, and an optional [name] the "라벨"
/// screen shows beside it (ADR 0100).
final class LabelPreset {
  const LabelPreset(this.label, [this.name = '']);

  final String label;
  final String name;

  @override
  bool operator ==(Object other) =>
      other is LabelPreset && other.label == label && other.name == name;

  @override
  int get hashCode => Object.hash(label, name);
}

const labelPresetsKey = 'labelPresets';

/// The keys [deckStorageProvider] must be opened to cache.
const deckStorageKeys = {labelPresetsKey};

/// The device storage the card editor keeps the label presets in. The
/// composition site overrides it with the storage it opens, which caches
/// [deckStorageKeys].
final deckStorageProvider = Provider<SharedPreferencesWithCache>(
  (ref) => throw UnimplementedError(
    'deckStorageProvider is overridden at the composition site',
  ),
);

/// The presets in the user's order: those stored, or none when none are
/// stored or the stored value cannot be read (ADR 0184).
List<LabelPreset> labelPresets(SharedPreferencesWithCache storage) {
  final stored = storage.getString(labelPresetsKey);
  if (stored == null) return const [];
  try {
    final decoded = jsonDecode(stored);
    if (decoded is! List<Object?>) return const [];
    return [
      for (final preset in decoded)
        if (preset case {
          'label': final String label,
          'name': final String name,
        })
          LabelPreset(label, name),
    ];
  } on FormatException {
    return const [];
  }
}

/// Stores [presets] as the user's, in their order; a write the device
/// refuses is a [StorageFailure].
Future<void> saveLabelPresets(
  SharedPreferencesWithCache storage,
  List<LabelPreset> presets,
) async {
  try {
    await storage.setString(
      labelPresetsKey,
      jsonEncode([
        for (final preset in presets)
          {'label': preset.label, 'name': preset.name},
      ]),
    );
  } on Exception catch (cause) {
    throw StorageFailure(cause);
  }
}

/// The labels [text] names, one per word, each without the brackets a card
/// shows it in: a part of speech where a word is one of the short forms,
/// another label otherwise.
List<SenseLabel> labelsOf(String text) => [
  for (final word in text.split(RegExp(r'\s+')))
    if (word.replaceAll(RegExp(r'^\[|\]$'), '') case final label
        when label.isNotEmpty)
      switch (PartOfSpeech.values.where((p) => p.short == label).firstOrNull) {
        final category? => PartOfSpeechLabel(category, label),
        null => OtherLabel(label),
      },
];
