import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/assistant/assistant.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = MethodChannel('flutter_timezone');

  void answer(Future<Object?> Function(MethodCall) handler) {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, handler);
    addTearDown(
      () => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, null),
    );
  }

  test('is the IANA name the platform gives', () async {
    final calls = <String>[];
    answer((call) async {
      calls.add(call.method);
      return {'identifier': 'Asia/Seoul'};
    });

    expect(await deviceTimeZone(), 'Asia/Seoul');
    expect(calls, ['getLocalTimezone']);
  });

  test('is null where the platform fails or gives none', () async {
    answer((_) async => throw PlatformException(code: 'unavailable'));
    expect(await deviceTimeZone(), isNull);

    answer((_) async => {'identifier': ''});
    expect(await deviceTimeZone(), isNull);

    // Control: the same call with a name answered returns it.
    answer((_) async => {'identifier': 'Europe/Paris'});
    expect(await deviceTimeZone(), 'Europe/Paris');
  });
}
