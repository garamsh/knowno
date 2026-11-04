import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'spreadsheet.dart';

/// How the user picks a spreadsheet: the device's file picker, which a test
/// replaces. Resolves to null when the picker is cancelled.
abstract interface class SpreadsheetPick {
  Future<OpenedFile?> pick();
}

/// The device's file picker through `file_picker`.
final class DeviceSpreadsheetPick implements SpreadsheetPick {
  const DeviceSpreadsheetPick();

  @override
  Future<OpenedFile?> pick() async {
    try {
      final file = await FilePicker.pickFile(
        type: FileType.custom,
        allowedExtensions: const ['xlsx', 'csv'],
      );
      if (file == null) return null;
      return await openSpreadsheet(
        file.name,
        await file.length() ?? 0,
        file.readAsBytes,
      );
    } on PlatformException {
      return const RefusedFile(SpreadsheetRefusal.notRead);
    } on FileSystemException {
      return const RefusedFile(SpreadsheetRefusal.notRead);
    }
  }
}

/// How the user picks a spreadsheet.
final spreadsheetPickProvider = Provider<SpreadsheetPick>(
  (ref) => const DeviceSpreadsheetPick(),
);
