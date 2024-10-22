// ignore_for_file: avoid-passing-self-as-argument

import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_list_view/flutter_list_view.dart';

/// Build the Scroll Thumb and label using the current configuration
typedef ScrollThumbBuilder = Widget Function(
  Color backgroundColor,
  Color foregroundColor,
  Animation<double> thumbAnimation,
  Animation<double> labelAnimation,
  double height, {
  Text? labelText,
  BoxConstraints? labelConstraints,
});

/// Build a Text widget using the current scroll offset
typedef LabelTextBuilder = Text? Function(int item);

/// A widget that will display a BoxScrollView with a ScrollThumb that can be dragged
/// for quick navigation of the BoxScrollView.
class DraggableScrollbar extends StatefulWidget {
  /// The view that will be scrolled with the scroll thumb
  final CustomScrollView child;

  /// Total number of children in the list
  final int maxItemCount;

  final FlutterListViewController controller;

  /// A function that builds a thumb using the current configuration
  final ScrollThumbBuilder scrollThumbBuilder;

  /// The height of the scroll thumb
  final double heightScrollThumb;

  /// The background color of the label and thumb
  final Color backgroundColor;

  /// The background color of the arrows
  final Color foregroundColor;

  /// The amount of padding that should surround the thumb
  final EdgeInsetsGeometry? padding;

  /// Determines how quickly the scrollbar will animate in and out
  final Duration scrollbarAnimationDuration;

  /// How long should the thumb be visible before fading out
  final Duration scrollbarTimeToFade;

  /// Build a Text widget from the current offset in the BoxScrollView
  final LabelTextBuilder? labelTextBuilder;

  /// Determines box constraints for Container displaying label
  final BoxConstraints? labelConstraints;

  /// Determines scrollThumb displaying. If you draw own ScrollThumb and it is true you just don't need to use animation parameters in [scrollThumbBuilder]
  final bool alwaysVisibleScrollThumb;

  final Function(bool scrolling) scrollStateListener;

  DraggableScrollbar({
    super.key,
    Key? scrollThumbKey,
    this.alwaysVisibleScrollThumb = false,
    required this.child,
    required this.controller,
    required this.maxItemCount,
    required this.scrollStateListener,
    this.heightScrollThumb = 48.0,
    this.backgroundColor = Colors.white,
    this.foregroundColor = Colors.black,
    this.padding,
    this.scrollbarAnimationDuration = Durations.medium2,
    this.scrollbarTimeToFade = Durations.long4,
    this.labelTextBuilder,
    this.labelConstraints,
  })  : assert(child.scrollDirection == Axis.vertical),
        scrollThumbBuilder = _thumbSemicircleBuilder(
          heightScrollThumb * 0.6,
          scrollThumbKey,
          alwaysVisibleScrollThumb,
        );

  @override
  State createState() => _DraggableScrollbarState();

  static buildScrollThumbAndLabel({
    required Widget scrollThumb,
    required Color backgroundColor,
    required Animation<double>? thumbAnimation,
    required Animation<double>? labelAnimation,
    required Text? labelText,
    required BoxConstraints? labelConstraints,
    required bool alwaysVisibleScrollThumb,
  }) {
    Widget scrollThumbAndLabel = labelText == null
        ? scrollThumb
        : Row(
            mainAxisAlignment: MainAxisAlignment.end,
            mainAxisSize: MainAxisSize.min,
            children: [
              _ScrollLabel(
                animation: labelAnimation,
                backgroundColor: backgroundColor,
                constraints: labelConstraints,
                child: labelText,
              ),
              scrollThumb,
            ],
          );

    if (alwaysVisibleScrollThumb) {
      return scrollThumbAndLabel;
    }
    return _SlideFadeTransition(
      animation: thumbAnimation!,
      child: scrollThumbAndLabel,
    );
  }

  static ScrollThumbBuilder _thumbSemicircleBuilder(
    double width,
    Key? scrollThumbKey,
    bool alwaysVisibleScrollThumb,
  ) {
    return (
      Color backgroundColor,
      Color foregroundColor,
      Animation<double> thumbAnimation,
      Animation<double> labelAnimation,
      double height, {
      Text? labelText,
      BoxConstraints? labelConstraints,
    }) {
      final scrollThumb = CustomPaint(
        key: scrollThumbKey,
        foregroundPainter: _ArrowCustomPainter(foregroundColor),
        child: Material(
          elevation: 4.0,
          color: backgroundColor,
          borderRadius: BorderRadius.only(
            topLeft: Radius.circular(height),
            topRight: const Radius.circular(4.0),
            bottomLeft: Radius.circular(height),
            bottomRight: const Radius.circular(4.0),
          ),
          child: Container(
            constraints: BoxConstraints.tight(Size(width, height)),
          ),
        ),
      );

      return buildScrollThumbAndLabel(
        scrollThumb: scrollThumb,
        backgroundColor: backgroundColor,
        thumbAnimation: thumbAnimation,
        labelAnimation: labelAnimation,
        labelText: labelText,
        labelConstraints: labelConstraints,
        alwaysVisibleScrollThumb: alwaysVisibleScrollThumb,
      );
    };
  }
}

class _ScrollLabel extends StatelessWidget {
  final Animation<double>? animation;
  final Color backgroundColor;
  final Text child;

  final BoxConstraints? constraints;
  static const BoxConstraints _defaultConstraints =
      BoxConstraints.tightFor(width: 72.0, height: 28.0);

  const _ScrollLabel({
    required this.child,
    required this.animation,
    required this.backgroundColor,
    this.constraints = _defaultConstraints,
  });

  @override
  Widget build(BuildContext context) {
    return FadeTransition(
      opacity: animation!,
      child: Container(
        margin: const EdgeInsets.only(right: 12.0),
        child: Material(
          elevation: 4.0,
          color: backgroundColor,
          borderRadius: const BorderRadius.all(Radius.circular(16.0)),
          child: Container(
            alignment: Alignment.center,
            padding: const EdgeInsets.symmetric(horizontal: 15),
            constraints: constraints ?? _defaultConstraints,
            child: child,
          ),
        ),
      ),
    );
  }
}

class _DraggableScrollbarState extends State<DraggableScrollbar>
    with TickerProviderStateMixin {
  late double _barOffset;
  late bool _isDragInProcess;
  late int _currentItem;

  late AnimationController _thumbAnimationController;
  late Animation<double> _thumbAnimation;
  late AnimationController _labelAnimationController;
  late Animation<double> _labelAnimation;
  Timer? _fadeoutTimer;
  List<FlutterListViewItemPosition> _positions = [];

  /// The controller can have only one active callback
  /// cache the old one, invoke it in the new callback and restore it on dispose
  FlutterSliverListControllerOnPaintItemPositionCallback? _oldCallback;

  @override
  void initState() {
    super.initState();
    _barOffset = 0.0;
    _isDragInProcess = false;
    _currentItem = 0;

    _thumbAnimationController = AnimationController(
      duration: widget.scrollbarAnimationDuration,
      vsync: this,
    );

    _thumbAnimation = CurvedAnimation(
      parent: _thumbAnimationController,
      curve: Curves.fastOutSlowIn,
    );

    _labelAnimationController = AnimationController(
      duration: widget.scrollbarAnimationDuration,
      vsync: this,
    );

    _labelAnimation = CurvedAnimation(
      parent: _labelAnimationController,
      curve: Curves.fastOutSlowIn,
    );

    _oldCallback =
        widget.controller.sliverController.onPaintItemPositionsCallback;
    widget.controller.sliverController.onPaintItemPositionsCallback =
        (height, pos) {
      _positions = pos;
      _oldCallback?.call(height, pos);
    };
  }

  @override
  void dispose() {
    widget.controller.sliverController.onPaintItemPositionsCallback =
        _oldCallback;
    _thumbAnimationController.dispose();
    _labelAnimationController.dispose();
    _fadeoutTimer?.cancel();
    _dragHaltTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    Text? labelText;
    if (widget.labelTextBuilder != null && _isDragInProcess) {
      labelText = widget.labelTextBuilder!(_currentItem);
    }

    return LayoutBuilder(
      builder: (BuildContext _, BoxConstraints constraints) {
        return NotificationListener<ScrollNotification>(
          onNotification: _onScrollNotification,
          child: Stack(
            children: [
              RepaintBoundary(child: widget.child),
              RepaintBoundary(
                child: GestureDetector(
                  onVerticalDragStart: _onVerticalDragStart,
                  onVerticalDragUpdate: _onVerticalDragUpdate,
                  onVerticalDragEnd: _onVerticalDragEnd,
                  child: Container(
                    alignment: Alignment.topRight,
                    padding: widget.padding,
                    margin: EdgeInsets.only(top: _barOffset),
                    child: widget.scrollThumbBuilder(
                      widget.backgroundColor,
                      widget.foregroundColor,
                      _thumbAnimation,
                      _labelAnimation,
                      widget.heightScrollThumb,
                      labelConstraints: widget.labelConstraints,
                      labelText: labelText,
                    ),
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  double get _barMaxScrollExtent =>
      (context.size?.height ?? 0) -
      widget.heightScrollThumb -
      (widget.padding?.vertical ?? 0);

  double get _maxScrollRatio =>
      _barMaxScrollExtent / widget.controller.position.maxScrollExtent;

  double get _barMinScrollExtent => 0;

  bool _onScrollNotification(ScrollNotification notification) {
    _changePosition(notification);
    return false;
  }

  void _onScrollFade() {
    _thumbAnimationController.reverse();
    _labelAnimationController.reverse();
    _fadeoutTimer = null;
  }

  // scroll bar has received notification that it's view was scrolled
  // so it should also changes his position
  // but only if it isn't dragged
  void _changePosition(ScrollNotification notification) {
    if (_isDragInProcess) {
      return;
    }

    setState(() {
      try {
        if (notification is ScrollUpdateNotification) {
          _barOffset = widget.controller.offset * _maxScrollRatio;

          _barOffset =
              clampDouble(_barOffset, _barMinScrollExtent, _barMaxScrollExtent);
        }

        if (notification is ScrollUpdateNotification ||
            notification is OverscrollNotification) {
          if (_thumbAnimationController.status != AnimationStatus.forward) {
            _thumbAnimationController.forward();
          }

          final lastItemPos = _itemPos;
          if (lastItemPos < widget.maxItemCount) {
            _currentItem = lastItemPos;
          }

          _fadeoutTimer?.cancel();
          _fadeoutTimer = Timer(widget.scrollbarTimeToFade, _onScrollFade);
        }
      } catch (_) {}
    });
  }

  void _onVerticalDragStart(DragStartDetails details) {
    setState(() {
      _isDragInProcess = true;
      _labelAnimationController.forward();
      _fadeoutTimer?.cancel();
    });

    widget.scrollStateListener(true);
  }

  int get _itemIndex {
    int index = 0;
    double minDiff = 1000;
    for (final pos in _positions) {
      final diff = (_barOffset - pos.offset).abs();
      if (diff < minDiff) {
        minDiff = diff;
        index = pos.index;
      }
    }
    return index;
  }

  int get _itemPos =>
      ((_barOffset / (_barMaxScrollExtent)) * widget.maxItemCount).toInt();

  void _jumpToBarPos() {
    final lastItemPos = _itemPos;
    if (lastItemPos > widget.maxItemCount - 1) {
      return;
    }

    _currentItem = _itemIndex;
    widget.controller.sliverController.jumpToIndex(lastItemPos);
  }

  Timer? _dragHaltTimer;
  int _lastTimerPos = 0;

  void _onVerticalDragUpdate(DragUpdateDetails details) {
    setState(() {
      if (_thumbAnimationController.status != AnimationStatus.forward) {
        _thumbAnimationController.forward();
      }
      if (_isDragInProcess) {
        _barOffset += details.delta.dy;

        _barOffset =
            clampDouble(_barOffset, _barMinScrollExtent, _barMaxScrollExtent);

        final lastItemPos = _itemPos;
        if (lastItemPos != _lastTimerPos) {
          _lastTimerPos = lastItemPos;
          _dragHaltTimer?.cancel();
          widget.scrollStateListener(true);

          _dragHaltTimer = Timer(
            Durations.long2,
            () => widget.scrollStateListener(false),
          );
        }

        _jumpToBarPos();
      }
    });
  }

  void _onVerticalDragEnd(DragEndDetails details) {
    _fadeoutTimer = Timer(widget.scrollbarTimeToFade, _onScrollFade);

    setState(() {
      _jumpToBarPos();
      _isDragInProcess = false;
    });

    widget.scrollStateListener(false);
  }
}

/// Draws 2 triangles like arrow up and arrow down
class _ArrowCustomPainter extends CustomPainter {
  Color color;

  _ArrowCustomPainter(this.color);

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()..color = color;
    const width = 12.0;
    const height = 8.0;
    final baseX = size.width / 2;
    final baseY = size.height / 2;

    canvas.drawPath(
      _trianglePath(Offset(baseX, baseY - 2.0), width, height, true),
      paint,
    );
    canvas.drawPath(
      _trianglePath(Offset(baseX, baseY + 2.0), width, height, false),
      paint,
    );
  }

  static Path _trianglePath(Offset o, double width, double height, bool isUp) {
    return Path()
      ..moveTo(o.dx, o.dy)
      ..lineTo(o.dx + width, o.dy)
      ..lineTo(o.dx + (width / 2), isUp ? o.dy - height : o.dy + height)
      ..close();
  }
}

class _SlideFadeTransition extends StatelessWidget {
  final Animation<double> animation;
  final Widget child;

  const _SlideFadeTransition({required this.animation, required this.child});

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: animation,
      builder: (_, c) => animation.value == 0.0 ? const SizedBox() : c!,
      child: SlideTransition(
        position: Tween(
          begin: const Offset(0.3, 0.0),
          end: const Offset(0.0, 0.0),
        ).animate(animation),
        child: FadeTransition(opacity: animation, child: child),
      ),
    );
  }
}
