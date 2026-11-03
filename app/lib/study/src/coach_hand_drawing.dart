// Written by tools/brand/generate.mjs from tools/brand/coach-hand.svg; run
// make brand after changing it.
import 'dart:ui';

/// The study coach's pointing hand on a 120 square: its outline, its
/// creases, both in lines [line] wide, the edge under it [edge] off, and the
/// [tip] it presses with.
abstract final class CoachHandDrawing {
  static const box = 120.0;
  static const line = 5.0;
  static const edge = Offset(6, 6);
  static const tip = Offset(30, 16);

  static Path outline() => Path()
    ..moveTo(24, 22)
    ..quadraticBezierTo(22, 14, 30, 12)
    ..quadraticBezierTo(37, 11, 39, 18)
    ..lineTo(49, 44)
    ..quadraticBezierTo(50, 36, 57, 35)
    ..quadraticBezierTo(63, 35, 64, 42)
    ..quadraticBezierTo(66, 36, 72, 37)
    ..quadraticBezierTo(78, 39, 77, 46)
    ..quadraticBezierTo(80, 41, 86, 43)
    ..quadraticBezierTo(92, 46, 91, 54)
    ..lineTo(91, 80)
    ..quadraticBezierTo(90, 95, 72, 98)
    ..lineTo(54, 98)
    ..quadraticBezierTo(42, 97, 33, 88)
    ..lineTo(19, 72)
    ..quadraticBezierTo(14, 66, 19, 62)
    ..quadraticBezierTo(24, 58, 30, 63)
    ..lineTo(40, 70)
    ..close();

  static Path creases() => Path()
    ..moveTo(49, 44)
    ..lineTo(51, 53)
    ..moveTo(64, 42)
    ..lineTo(64, 51)
    ..moveTo(77, 46)
    ..lineTo(77, 53);
}
