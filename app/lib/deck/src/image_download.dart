import 'dart:async';
import 'dart:typed_data';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;

/// Fetches the picture at an https [Uri], or null where it cannot: another
/// scheme, no answer, a status that is not a success, a type that is not an
/// image or a size past [maxPastedImageBytes].
typedef ImageDownload = Future<Uint8List?> Function(Uri url);

/// The most bytes a pasted photo may be.
const maxPastedImageBytes = 10 * 1024 * 1024;

/// How a pasted image link's picture is fetched. The tests substitute it.
final imageDownloadProvider = Provider<ImageDownload>((ref) => _fetch);

Future<Uint8List?> _fetch(Uri url) async {
  if (url.scheme != 'https') return null;
  try {
    final response = await http.get(url).timeout(const Duration(seconds: 15));
    final isImage =
        response.headers['content-type']?.startsWith('image/') ?? false;
    if (response.statusCode != 200 ||
        !isImage ||
        response.bodyBytes.length > maxPastedImageBytes) {
      return null;
    }
    return response.bodyBytes;
  } on http.ClientException {
    return null;
  } on TimeoutException {
    return null;
  }
}
