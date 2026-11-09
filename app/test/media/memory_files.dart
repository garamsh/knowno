import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

/// Files and directories under [memoryRoot] that live in memory: what
/// `File` and `Directory` build for a path there while [MemoryFiles] is
/// installed, so a test that stores media waits on no real file I/O.
const memoryRoot = '/knowno_memory';

/// An in-memory stand-in for `dart:io`'s files, installed as
/// `IOOverrides.global` for the test: [reset] removes every file, and paths
/// outside [memoryRoot] reach the real file system as before.
base class MemoryFiles extends IOOverrides {
  MemoryFiles._();

  /// Installs the stand-in; [uninstall] puts the real file system back.
  static MemoryFiles install() {
    final files = MemoryFiles._();
    IOOverrides.global = files;
    return files;
  }

  final contents = <String, Uint8List>{};

  /// While set, a write waits for it, as one on a slow disk does.
  Future<void>? holdWrites;

  void uninstall() {
    IOOverrides.global = null;
    contents.clear();
  }

  /// The directory a [MediaStore] keeps its files in.
  Directory get directory => createDirectory('$memoryRoot/media');

  @override
  File createFile(String path) => path.startsWith(memoryRoot)
      ? _MemoryFile(this, path)
      : super.createFile(path);

  @override
  Directory createDirectory(String path) => path.startsWith(memoryRoot)
      ? _MemoryDirectory(this, path)
      : super.createDirectory(path);
}

final class _MemoryFile implements File {
  _MemoryFile(this._files, this.path);

  final MemoryFiles _files;

  @override
  final String path;

  @override
  Future<bool> exists() async => _files.contents.containsKey(path);

  @override
  Future<Uint8List> readAsBytes() async =>
      _files.contents[path] ??
      (throw PathNotFoundException(path, const OSError('No such file', 2)));

  @override
  Future<int> length() async => (await readAsBytes()).length;

  @override
  Future<File> writeAsBytes(
    List<int> bytes, {
    FileMode mode = FileMode.write,
    bool flush = false,
  }) async {
    await _files.holdWrites;
    _files.contents[path] = Uint8List.fromList(bytes);
    return this;
  }

  @override
  Future<File> rename(String newPath) async {
    final bytes = _files.contents.remove(path);
    if (bytes == null) {
      throw PathNotFoundException(path, const OSError('No such file', 2));
    }
    _files.contents[newPath] = bytes;
    return _MemoryFile(_files, newPath);
  }

  @override
  Future<FileSystemEntity> delete({bool recursive = false}) async {
    _files.contents.remove(path);
    return this;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw UnsupportedError('MemoryFile.${invocation.memberName}');
}

final class _MemoryDirectory implements Directory {
  _MemoryDirectory(this._files, this.path);

  final MemoryFiles _files;

  @override
  final String path;

  @override
  Future<Directory> create({bool recursive = false}) async => this;

  @override
  Future<bool> exists() async => true;

  @override
  Future<FileSystemEntity> delete({bool recursive = false}) async {
    _files.contents.removeWhere((key, _) => key.startsWith('$path/'));
    return this;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw UnsupportedError('MemoryDirectory.${invocation.memberName}');
}
