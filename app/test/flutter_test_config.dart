import 'dart:async';

import 'package:knowno/design/mascot.dart';
import 'package:knowno/design/streak_flame.dart';
import 'package:knowno/study/study.dart';

/// Loads the engine library once before every test file, as the composition
/// site does before `runApp`: a study session places its cards through the
/// engine's today's list, a synchronous call.
///
/// Streak flames and mascots hold still, so a screen with one settles; their
/// own tests let them move.
Future<void> testExecutable(FutureOr<void> Function() testMain) async {
  await Scheduler.load();
  streakFlamesMove = false;
  mascotsMove = false;
  await testMain();
}
