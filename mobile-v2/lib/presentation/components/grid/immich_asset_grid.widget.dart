import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_list_view/flutter_list_view.dart';
import 'package:immich_mobile/domain/models/render_list.model.dart';
import 'package:immich_mobile/domain/models/render_list_element.model.dart';
import 'package:immich_mobile/presentation/components/grid/draggable_scrollbar.dart';
import 'package:immich_mobile/presentation/components/grid/immich_asset_grid.state.dart';
import 'package:immich_mobile/presentation/components/image/immich_image.widget.dart';
import 'package:immich_mobile/presentation/components/image/immich_thumbnail.widget.dart';
import 'package:immich_mobile/utils/extensions/async_snapshot.extension.dart';
import 'package:immich_mobile/utils/extensions/build_context.extension.dart';
import 'package:intl/intl.dart';
import 'package:material_symbols_icons/symbols.dart';

part 'immich_asset_grid_header.widget.dart';

class ImAssetGrid extends StatefulWidget {
  const ImAssetGrid({super.key});

  @override
  State createState() => _ImAssetGridState();
}

class _ImAssetGridState extends State<ImAssetGrid> {
  bool _isDragScrolling = false;
  final FlutterListViewController _controller = FlutterListViewController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _onDragScrolling(bool isScrolling) {
    if (_isDragScrolling != isScrolling) {
      setState(() {
        _isDragScrolling = isScrolling;
      });
    }
  }

  Text? _labelBuilder(List<RenderListElement> elements, int currentPosition) {
    final element = elements.elementAtOrNull(currentPosition);
    if (element == null) {
      return null;
    }

    return Text(
      DateFormat.yMMMM().format(element.date),
      style: TextStyle(
        color: context.colorScheme.onSurface,
        fontWeight: FontWeight.bold,
      ),
    );
  }

  @override
  Widget build(BuildContext context) => BlocBuilder<AssetGridCubit, RenderList>(
        builder: (_, renderList) {
          final elements = renderList.elements;
          final grid = FlutterListView(
            controller: _controller,
            delegate: FlutterListViewDelegate(
              (_, sectionIndex) {
                // ignore: avoid-unsafe-collection-methods
                final section = elements[sectionIndex];

                return switch (section) {
                  RenderListMonthHeaderElement() =>
                    _MonthHeader(text: section.header),
                  RenderListDayHeaderElement() => Text(section.header),
                  RenderListAssetElement() => FutureBuilder(
                      future: context.read<AssetGridCubit>().loadAssets(
                            section.assetOffset,
                            section.assetCount,
                          ),
                      builder: (_, assetsSnap) {
                        final assets = assetsSnap.data;
                        return GridView.builder(
                          physics: const NeverScrollableScrollPhysics(),
                          shrinkWrap: true,
                          addAutomaticKeepAlives: false,
                          cacheExtent: 100,
                          padding: const EdgeInsets.all(0),
                          gridDelegate:
                              const SliverGridDelegateWithFixedCrossAxisCount(
                            crossAxisCount: 4,
                            mainAxisSpacing: 3,
                            crossAxisSpacing: 3,
                          ),
                          itemBuilder: (_, i) {
                            final asset = assetsSnap.isWaiting || assets == null
                                ? null
                                : assets.elementAtOrNull(i);
                            return SizedBox.square(
                              dimension: 200,
                              // Show Placeholder when drag scrolled
                              child: asset == null || _isDragScrolling
                                  ? const ImImagePlaceholder()
                                  : ImThumbnail(asset),
                            );
                          },
                          itemCount: section.assetCount,
                        );
                      },
                    ),
                };
              },
              childCount: elements.length,
              addAutomaticKeepAlives: false,
            ),
          );

          return DraggableScrollbar(
            foregroundColor: context.colorScheme.onSurface,
            backgroundColor: context.colorScheme.surfaceContainerHighest,
            scrollStateListener: _onDragScrolling,
            controller: _controller,
            maxItemCount: elements.length,
            labelTextBuilder: (int position) =>
                _labelBuilder(elements, position),
            labelConstraints: const BoxConstraints(maxHeight: 36),
            scrollbarAnimationDuration: const Duration(milliseconds: 300),
            scrollbarTimeToFade: const Duration(milliseconds: 1000),
            child: grid,
          );
        },
      );
}
