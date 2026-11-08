import 'dart:typed_data';

import 'package:supabase_flutter/supabase_flutter.dart';

/// The private `assistant-photos` bucket, through Supabase Storage, with the
/// session the `account` domain signed in. A photo lives at
/// `{user id}/{photo id}` as a JPEG (`assistant.md` §Photo jobs).
final class SupabasePhotoStore {
  SupabasePhotoStore(this._client);

  final SupabaseClient _client;

  static const _bucket = 'assistant-photos';

  /// Stores the JPEG [bytes] of the photo [photoId]. Throws an
  /// [AuthException] when nobody is signed in, and a [StorageException]
  /// where the bucket refuses.
  Future<void> store(String photoId, Uint8List bytes) async {
    final user = _client.auth.currentUser;
    if (user == null) throw const AuthException('not signed in');
    await _client.storage
        .from(_bucket)
        .uploadBinary(
          '${user.id}/$photoId',
          bytes,
          fileOptions: const FileOptions(contentType: 'image/jpeg'),
        );
  }
}
