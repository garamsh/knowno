import 'package:flutter/services.dart';
import 'package:flutter_timezone/flutter_timezone.dart';

/// The device's IANA time zone name, such as `Asia/Seoul`, or null where the
/// platform gives none.
Future<String?> deviceTimeZone() async {
  try {
    final identifier = (await FlutterTimezone.getLocalTimezone()).identifier;
    return identifier.isEmpty ? null : identifier;
  } on PlatformException {
    return null;
  } on MissingPluginException {
    return null;
  } on ArgumentError {
    return null;
  }
}
