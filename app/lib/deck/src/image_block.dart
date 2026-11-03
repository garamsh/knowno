import 'dart:math';

import 'package:flutter/gestures.dart'
    show DeviceGestureSettings, DragStartBehavior, kTouchSlop;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../design/app_button.dart';
import '../../design/app_text_field.dart';
import '../../design/theme.dart';
import '../../design/undo_snack_bar.dart';
import '../../l10n/app_localizations.dart';
import '../../media/media.dart';
import 'content.dart';
import 'editor_group.dart';

/// The size [image] is drawn at inside [bound]: whole, at its own aspect
/// ratio, as large as fits (`contain`), never cropped (ADR 0109).
Size imageFrame(ImageContent image, Size bound) {
  final scale = min(bound.width / image.width, bound.height / image.height);
  return Size(image.width * scale, image.height * scale);
}

/// An image block's photo, drawn whole as large as fits [width] and
/// [maxHeight], or else the space its parent gives, with each box over the
/// part of the photo it covers: hidden, or revealed with its answer once
/// [revealed] (ADR 0109). The photo and the boxes share one frame, so a
/// change of size moves and scales them together; a box's border, corners
/// and answer stay in logical pixels.
class ImageBlockView extends StatelessWidget {
  const ImageBlockView(
    this.image, {
    super.key,
    required this.revealed,
    this.width,
    this.maxHeight,
  });

  final ImageContent image;
  final bool revealed;
  final double? width;
  final double? maxHeight;

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, constraints) {
      final size = imageFrame(
        image,
        Size(
          width ??
              (constraints.hasBoundedWidth
                  ? constraints.maxWidth
                  : image.width.toDouble()),
          maxHeight ?? constraints.maxHeight,
        ),
      );
      return Center(
        child: SizedBox.fromSize(
          size: size,
          child: Stack(
            clipBehavior: Clip.none,
            children: [
              Positioned.fill(child: ImagePhoto(image)),
              for (final box in image.boxes)
                Positioned.fromRect(
                  key: ValueKey(('image box', box.id)),
                  rect: box.rectIn(size),
                  child: _BoxMark(box: box, revealed: revealed),
                ),
            ],
          ),
        ),
      );
    },
  );
}

/// [image]'s photo filling its frame, which has its aspect ratio, or the
/// ground while the photo is read and when it cannot be.
class ImagePhoto extends StatelessWidget {
  const ImagePhoto(this.image, {super.key});

  final ImageContent image;

  @override
  Widget build(BuildContext context) => MediaImage(
    image.media,
    fallback: ColoredBox(color: AppColors.of(context).ground),
  );
}

/// The thickness of a box's border, in logical pixels at every size.
const _boxBorder = 2.0;

/// A box's corner radius, in logical pixels at every size.
const _boxRadius = AppSpace.s4;

/// A box over a photo: an opaque fill hiding what it covers, or, revealed,
/// a border around it with its answer, when it has one, at its top left.
class _BoxMark extends StatelessWidget {
  const _BoxMark({required this.box, required this.revealed});

  final ImageBox box;
  final bool revealed;

  @override
  Widget build(BuildContext context) {
    final colors = AppColors.of(context);
    final answer = box.answer;
    if (!revealed) {
      return DecoratedBox(
        decoration: BoxDecoration(
          color: colors.hero,
          borderRadius: BorderRadius.circular(_boxRadius),
        ),
      );
    }
    return Stack(
      clipBehavior: Clip.none,
      children: [
        Positioned.fill(
          child: DecoratedBox(
            decoration: BoxDecoration(
              border: Border.all(color: colors.brand, width: _boxBorder),
              borderRadius: BorderRadius.circular(_boxRadius),
            ),
          ),
        ),
        if (answer != null && answer.trim().isNotEmpty)
          Positioned(
            left: 0,
            top: 0,
            child: DecoratedBox(
              decoration: BoxDecoration(
                color: colors.brandTint,
                borderRadius: BorderRadius.circular(_boxRadius),
              ),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: AppSpace.s4),
                child: Text(
                  answer,
                  style: AppType.caption.copyWith(color: colors.ink),
                ),
              ),
            ),
          ),
      ],
    );
  }
}

/// How far a box moves, or grows or shrinks, by one press of a tool, as a
/// fraction of the photo.
const _step = 0.05;

/// The smallest side a box may have, as a fraction of the photo; a drag
/// drawing less draws nothing.
const _minSide = 0.02;

/// The box "빈칸 추가" adds, in the photo's middle.
const _newBox = (x: 0.35, y: 0.4, w: 0.3, h: 0.2);

/// The editor's photo is at most this tall, so the tools under it stay near.
const _editorMaxHeight = 480.0;

/// The least side of a box's target and of its resize handle in the editor,
/// however small the box is drawn: Android's 48, above iOS's 44 pt.
const _target = kMinInteractiveDimension;

/// An image block as the editor edits it: its photo, once one is chosen, and
/// its boxes, each with its answer's field.
class ImageDraft {
  ImageDraft([ImageContent? image]) : _image = image {
    for (final box in image?.boxes ?? const <ImageBox>[]) {
      _answers[box.id] = TextEditingController(text: box.answer ?? '');
    }
  }

  ImageContent? _image;
  final _answers = <String, TextEditingController>{};

  /// The box selected for the tools, by its index; null while none is.
  int? selected;

  /// The selected box's answer field's focus, which a box just added takes.
  final answerFocus = FocusNode();

  /// The photo and its boxes as typed so far, each answer trimmed and left
  /// out while empty; null until a photo is chosen.
  ImageContent? get image => switch (_image) {
    final image? => image.withBoxes([
      for (final box in image.boxes)
        box.copyWith(
          answer: () => switch (_answers[box.id]?.text.trim()) {
            final answer? when answer.isNotEmpty => answer,
            _ => null,
          },
        ),
    ]),
    null => null,
  };

  List<ImageBox> get boxes => _image?.boxes ?? const [];

  /// The field of [box]'s answer.
  TextEditingController answerOf(ImageBox box) =>
      _answers[box.id] ??= TextEditingController();

  /// Takes the photo [picked] stored as [media], keeping the boxes of the
  /// one it replaces, which are fractions of the photo.
  void choose(MediaId media, PreparedImage picked) => _image = ImageContent(
    media: media,
    width: picked.width,
    height: picked.height,
  ).withBoxes(boxes);

  /// Takes out the photo and its boxes, and returns what puts them back.
  Removal clear() {
    final (image, answers) = (_image, {..._answers});
    _image = null;
    _answers.clear();
    selected = null;
    return (
      undo: () {
        _image = image;
        _answers.addAll(answers);
      },
      forget: () {
        for (final answer in answers.values) {
          answer.dispose();
        }
      },
    );
  }

  /// Adds a box at [x], [y] of [w] by [h] and selects it. Its id is one more
  /// than the highest number among the block's box ids, so it is unique in
  /// the block.
  void add({
    required double x,
    required double y,
    required double w,
    required double h,
  }) {
    final image = _image;
    if (image == null) return;
    final next =
        image.boxes.map((box) => int.tryParse(box.id) ?? 0).fold(0, max) + 1;
    _image = image.withBoxes([
      ...image.boxes,
      _clamped(ImageBox(id: '$next', x: x, y: y, w: w, h: h)),
    ]);
    selected = image.boxes.length;
  }

  /// Moves the box at [index] by [dx], [dy], kept inside the photo.
  void move(int index, double dx, double dy) => _replace(
    index,
    (box) => box.copyWith(
      x: (box.x + dx).clamp(0, 1 - box.w),
      y: (box.y + dy).clamp(0, 1 - box.h),
    ),
  );

  /// Grows the box at [index] by [dw], [dh] from its top left, kept inside
  /// the photo and no smaller than its least side.
  void resize(int index, double dw, double dh) => _replace(
    index,
    (box) => box.copyWith(
      w: (box.w + dw).clamp(_minSide, 1 - box.x),
      h: (box.h + dh).clamp(_minSide, 1 - box.y),
    ),
  );

  /// Removes the box at [index] and its answer, and returns what puts them
  /// back.
  Removal remove(int index) {
    final image = _image!;
    final box = image.boxes[index];
    final answer = _answers.remove(box.id);
    _image = image.withBoxes([...image.boxes]..removeAt(index));
    selected = null;
    return (
      undo: () {
        final now = _image;
        if (now == null) return;
        if (answer != null) _answers[box.id] = answer;
        _image = now.withBoxes([...now.boxes]..insert(index, box));
      },
      forget: () => answer?.dispose(),
    );
  }

  void _replace(int index, ImageBox Function(ImageBox box) change) {
    final image = _image;
    if (image == null) return;
    _image = image.withBoxes([
      for (final (at, box) in image.boxes.indexed)
        // Clamped first too: a box another writer stored can sit a rounding
        // past the photo, or be narrower than the least side.
        at == index ? _clamped(change(_clamped(box))) : box,
    ]);
  }

  /// [box] with its sides at least the least side and its far edges inside
  /// the photo.
  static ImageBox _clamped(ImageBox box) {
    final w = box.w.clamp(_minSide, 1.0);
    final h = box.h.clamp(_minSide, 1.0);
    return box.copyWith(
      x: box.x.clamp(0, 1 - w),
      y: box.y.clamp(0, 1 - h),
      w: w,
      h: h,
    );
  }

  void dispose() {
    answerFocus.dispose();
    for (final answer in _answers.values) {
      answer.dispose();
    }
  }
}

/// An image block's fields: "앨범에서 고르기" and "사진 찍기" until a photo is
/// chosen, kept whole at its aspect ratio; then the photo, over which a drag
/// draws a box, a box is selected by a tap, moved by a drag and resized by
/// its corner, each box a target at least [_target] and named
/// "빈칸 n"; "빈칸 추가"; and, while a box is selected, its answer and tools
/// that move, resize and delete it without a drag (WCAG 2.2 dragging).
class ImageBlockFields extends ConsumerStatefulWidget {
  const ImageBlockFields({
    super.key,
    required this.draft,
    required this.showErrors,
    required this.onChanged,
    required this.onPicked,
  });

  final ImageDraft draft;
  final bool showErrors;
  final VoidCallback onChanged;

  /// Called with each photo stored for the block, so the editor can let go
  /// of one it does not save.
  final ValueChanged<MediaId> onPicked;

  @override
  ConsumerState<ImageBlockFields> createState() => _ImageBlockFieldsState();
}

class _ImageBlockFieldsState extends ConsumerState<ImageBlockFields> {
  /// Where the photo being picked and stored comes from; null while none is.
  ImageOrigin? _picking;
  bool get _busy => _picking != null;
  var _unreadable = false;

  /// The box a drag over the photo is drawing, from where it started to
  /// where the finger is, in fractions of the photo.
  ({Offset start, Offset end})? _drawing;

  ImageDraft get _draft => widget.draft;

  void _change(VoidCallback change) {
    setState(change);
    widget.onChanged();
  }

  Future<void> _pick(ImageOrigin origin) async {
    setState(() {
      _picking = origin;
      _unreadable = false;
    });
    // Read before the waits: a pick can end after the editor is left.
    final store = ref.read(mediaStoreProvider);
    try {
      final picked = await ref
          .read(imagePickProvider)
          .pick(origin, shape: ImageShape.whole);
      if (picked == null) return;
      final media = await store.addImage(picked);
      // Stored once the fields are gone, it has no block to hold it.
      if (!mounted) {
        await store.release(media);
        return;
      }
      widget.onPicked(media);
      _change(() => _draft.choose(media, picked));
    } on MediaUnreadable {
      if (mounted) setState(() => _unreadable = true);
    } finally {
      if (mounted) setState(() => _picking = null);
    }
  }

  /// Adds a box as [add] does, then puts the focus in its answer, which
  /// scrolls it into view, as typing it is the next step.
  void _addBox(VoidCallback add) {
    _change(add);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _draft.answerFocus.requestFocus();
    });
  }

  /// Takes out what [remove] does at once, saying [message] with an undo.
  void _removeNow(Removal Function() remove, String message) {
    late final Removal removal;
    _change(() => removal = remove());
    showUndoSnackBar(
      context,
      message: message,
      onUndo: () {
        if (mounted) _change(removal.undo);
      },
      onGone: removal.forget,
    );
  }

  /// A button that picks a photo from [origin], showing progress while that
  /// pick is stored.
  Widget _pickButton(String label, ImageOrigin origin) => AppButton(
    label: label,
    variant: AppButtonVariant.secondary,
    loading: _picking == origin,
    onPressed: _busy ? null : () => _pick(origin),
  );

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    final image = _draft.image;
    final error = AppType.caption.copyWith(color: colors.dontKnowText);
    if (image == null) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        spacing: AppSpace.s8,
        children: [
          Row(
            spacing: AppSpace.s8,
            children: [
              Expanded(
                child: _pickButton(l10n.imageFromAlbum, ImageOrigin.album),
              ),
              Expanded(
                child: _pickButton(l10n.imageFromCamera, ImageOrigin.camera),
              ),
            ],
          ),
          Semantics(
            liveRegion: true,
            child: _unreadable
                ? Text(l10n.imageUnreadable, style: error)
                : widget.showErrors
                ? Text(l10n.imageRequired, style: error)
                : const SizedBox.shrink(),
          ),
        ],
      );
    }
    final selected = _draft.selected;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      spacing: AppSpace.s8,
      children: [
        LayoutBuilder(
          builder: (context, constraints) => _frame(
            context,
            image,
            imageFrame(
              image,
              Size(constraints.maxWidth - _target, _editorMaxHeight),
            ),
          ),
        ),
        Text(
          l10n.imageHint,
          style: AppType.caption.copyWith(color: colors.muted),
        ),
        AppButton(
          label: l10n.imageAddBox,
          variant: AppButtonVariant.secondary,
          onPressed: () => _addBox(
            () => _draft.add(
              x: _newBox.x,
              y: _newBox.y,
              w: _newBox.w,
              h: _newBox.h,
            ),
          ),
        ),
        if (selected != null && selected < _draft.boxes.length)
          _tools(context, selected),
        Row(
          spacing: AppSpace.s8,
          children: [
            Expanded(
              child: _pickButton(l10n.imagePickAnother, ImageOrigin.album),
            ),
            Expanded(child: _pickButton(l10n.imageRetake, ImageOrigin.camera)),
          ],
        ),
        AppButton(
          label: l10n.imageRemove,
          variant: AppButtonVariant.secondary,
          onPressed: _busy
              ? null
              : () => _removeNow(_draft.clear, l10n.deletedImage),
        ),
        Semantics(
          liveRegion: true,
          child: _unreadable
              ? Text(l10n.imageUnreadable, style: error)
              : const SizedBox.shrink(),
        ),
      ],
    );
  }

  /// The photo at [size], inside a margin of half a tap target so the
  /// targets of boxes at its edges are whole.
  Widget _frame(BuildContext context, ImageContent image, Size size) {
    const inset = _target / 2;
    Offset fraction(Offset local) => Offset(
      ((local.dx - inset) / size.width).clamp(0, 1),
      ((local.dy - inset) / size.height).clamp(0, 1),
    );
    final drawing = _drawing;
    final media = MediaQuery.of(context);
    // A pan claims a drag at twice the touch slop and the page's scroll at
    // once it, so under half the slop a drag over the photo draws, moves or
    // resizes a box rather than scrolling the page.
    return MediaQuery(
      data: media.copyWith(
        gestureSettings: DeviceGestureSettings(
          touchSlop: (media.gestureSettings.touchSlop ?? kTouchSlop) / 2,
        ),
      ),
      child: _frameGestures(context, image, size, fraction, drawing),
    );
  }

  Widget _frameGestures(
    BuildContext context,
    ImageContent image,
    Size size,
    Offset Function(Offset local) fraction,
    ({Offset start, Offset end})? drawing,
  ) {
    const inset = _target / 2;
    final colors = AppColors.of(context);
    final l10n = AppLocalizations.of(context);
    final selected = _draft.selected;
    return Center(
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        // A box starts where the finger went down, not past the slop.
        dragStartBehavior: DragStartBehavior.down,
        // A screen reader draws with "빈칸 추가" and reaches each box's own
        // button, so the photo's drag and tap are not offered to it.
        excludeFromSemantics: true,
        onTap: () => setState(() => _draft.selected = null),
        onPanStart: (details) => setState(() {
          final at = fraction(details.localPosition);
          _drawing = (start: at, end: at);
        }),
        onPanUpdate: (details) => setState(() {
          if (_drawing case (:final start, end: _)) {
            _drawing = (start: start, end: fraction(details.localPosition));
          }
        }),
        onPanEnd: (_) {
          final drawn = _drawing;
          setState(() => _drawing = null);
          if (drawn == null) return;
          final rect = Rect.fromPoints(drawn.start, drawn.end);
          if (rect.width < _minSide || rect.height < _minSide) return;
          _addBox(
            () => _draft.add(
              x: rect.left,
              y: rect.top,
              w: rect.width,
              h: rect.height,
            ),
          );
        },
        child: SizedBox(
          width: size.width + 2 * inset,
          height: size.height + 2 * inset,
          child: Stack(
            children: [
              Positioned(
                left: inset,
                top: inset,
                width: size.width,
                height: size.height,
                child: ImagePhoto(image),
              ),
              if (drawing != null)
                Positioned.fromRect(
                  rect: Rect.fromPoints(
                    drawing.start.scale(size.width, size.height),
                    drawing.end.scale(size.width, size.height),
                  ).shift(const Offset(inset, inset)),
                  child: _outline(colors.brand),
                ),
              for (final (index, box) in _draft.boxes.indexed)
                _box(
                  index,
                  box,
                  box.rectIn(size).shift(const Offset(inset, inset)),
                  size,
                  l10n,
                  colors,
                ),
              if (selected != null && selected < _draft.boxes.length)
                _handle(
                  selected,
                  _draft.boxes[selected].rectIn(size).bottomRight +
                      const Offset(inset, inset),
                  size,
                  colors,
                ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _outline(Color color, {double width = _boxBorder, Color? fill}) =>
      DecoratedBox(
        decoration: BoxDecoration(
          color: fill,
          border: Border.all(color: color, width: width),
          borderRadius: BorderRadius.circular(_boxRadius),
        ),
      );

  /// Box [index] at [rect], its target [rect] grown to at least a tap target
  /// on each side about its centre: a tap selects it, a drag moves it.
  Widget _box(
    int index,
    ImageBox box,
    Rect rect,
    Size size,
    AppLocalizations l10n,
    AppColors colors,
  ) {
    final isSelected = _draft.selected == index;
    final target = Rect.fromCenter(
      center: rect.center,
      width: max(rect.width, _target),
      height: max(rect.height, _target),
    );
    return Positioned.fromRect(
      rect: target,
      child: Semantics(
        container: true,
        label: l10n.imageBox(index + 1),
        button: true,
        selected: isSelected,
        onTap: () => setState(() => _draft.selected = index),
        excludeSemantics: true,
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          dragStartBehavior: DragStartBehavior.down,
          onTap: () => setState(() => _draft.selected = index),
          onPanStart: (_) => setState(() => _draft.selected = index),
          onPanUpdate: (details) => _change(
            () => _draft.move(
              index,
              details.delta.dx / size.width,
              details.delta.dy / size.height,
            ),
          ),
          child: Center(
            child: SizedBox.fromSize(
              size: rect.size,
              child: _outline(
                isSelected ? colors.ink : colors.brand,
                width: isSelected ? _boxBorder * 1.5 : _boxBorder,
                fill: colors.brand.withValues(alpha: 0.25),
              ),
            ),
          ),
        ),
      ),
    );
  }

  /// The selected box's resize handle, a tap target centred on its bottom
  /// right corner at [corner]; a drag resizes the box. A screen reader skips
  /// it, as the tools resize the box without a drag.
  Widget _handle(int index, Offset corner, Size size, AppColors colors) =>
      Positioned.fromRect(
        key: const ValueKey('image box handle'),
        rect: Rect.fromCenter(center: corner, width: _target, height: _target),
        child: ExcludeSemantics(
          child: GestureDetector(
            behavior: HitTestBehavior.opaque,
            dragStartBehavior: DragStartBehavior.down,
            onPanUpdate: (details) => _change(
              () => _draft.resize(
                index,
                details.delta.dx / size.width,
                details.delta.dy / size.height,
              ),
            ),
            child: Center(
              child: Container(
                width: AppSpace.s12,
                height: AppSpace.s12,
                decoration: BoxDecoration(
                  color: colors.ink,
                  shape: BoxShape.circle,
                  border: Border.all(color: colors.surface, width: _boxBorder),
                ),
              ),
            ),
          ),
        ),
      );

  /// The selected box's answer, and the tools that move, resize and delete
  /// it without a drag.
  Widget _tools(BuildContext context, int index) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    final box = _draft.boxes[index];
    Widget tool(String tooltip, IconData icon, VoidCallback action) =>
        IconButton(
          tooltip: tooltip,
          icon: Icon(icon, color: colors.ink2),
          onPressed: () => _change(action),
        );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      spacing: AppSpace.s8,
      children: [
        Text(
          l10n.imageBox(index + 1),
          style: AppType.secondary.copyWith(color: colors.muted),
        ),
        AppTextField(
          key: ObjectKey(box.id),
          label: l10n.imageBoxAnswer,
          controller: _draft.answerOf(box),
          focusNode: _draft.answerFocus,
          onChanged: (_) => widget.onChanged(),
        ),
        Wrap(
          children: [
            tool(l10n.imageBoxLeft, LucideIcons.arrowLeft, () {
              _draft.move(index, -_step, 0);
            }),
            tool(l10n.imageBoxUp, LucideIcons.arrowUp, () {
              _draft.move(index, 0, -_step);
            }),
            tool(l10n.imageBoxDown, LucideIcons.arrowDown, () {
              _draft.move(index, 0, _step);
            }),
            tool(l10n.imageBoxRight, LucideIcons.arrowRight, () {
              _draft.move(index, _step, 0);
            }),
            tool(l10n.imageBoxWider, LucideIcons.chevronsLeftRight, () {
              _draft.resize(index, _step, 0);
            }),
            tool(l10n.imageBoxNarrower, LucideIcons.chevronsRightLeft, () {
              _draft.resize(index, -_step, 0);
            }),
            tool(l10n.imageBoxTaller, LucideIcons.chevronsUpDown, () {
              _draft.resize(index, 0, _step);
            }),
            tool(l10n.imageBoxShorter, LucideIcons.chevronsDownUp, () {
              _draft.resize(index, 0, -_step);
            }),
          ],
        ),
        AppButton(
          label: l10n.imageBoxDelete,
          variant: AppButtonVariant.secondary,
          onPressed: () =>
              _removeNow(() => _draft.remove(index), l10n.deletedBox),
        ),
      ],
    );
  }
}
