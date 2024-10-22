// ignore_for_file: avoid-dynamic, avoid-unsafe-collection-methods

import 'package:openapi/api.dart';

dynamic upgradeDto(dynamic value, String targetType) {
  switch (targetType) {
    case 'UserPreferencesResponseDto':
      if (value is Map) {
        addDefault(value, 'download.includeEmbeddedVideos', false);
        addDefault(value, 'folders', FoldersResponse().toJson());
        addDefault(value, 'memories', MemoriesResponse().toJson());
        addDefault(value, 'ratings', RatingsResponse().toJson());
        addDefault(value, 'people', PeopleResponse().toJson());
        addDefault(value, 'tags', TagsResponse().toJson());
      }
      break;
    case 'ServerConfigDto':
      if (value is Map) {
        addDefault(
          value,
          'mapLightStyleUrl',
          'https://tiles.immich.cloud/v1/style/light.json',
        );
        addDefault(
          value,
          'mapDarkStyleUrl',
          'https://tiles.immich.cloud/v1/style/dark.json',
        );
      }
    case 'UserResponseDto' || 'UserAdminResponseDto':
      if (value is Map) {
        addDefault(value, 'profileChangedAt', DateTime.now().toIso8601String());
      }
      break;
  }
}

addDefault(Map value, String keys, dynamic defaultValue) {
  // Loop through the keys and assign the default value if the key is not present
  List<String> keyList = keys.split('.');
  Map current = value;

  for (int i = 0; i < keyList.length - 1; i++) {
    if (current[keyList[i]] == null) {
      current[keyList[i]] = {};
    }
    current = current[keyList[i]];
  }

  if (current[keyList.last] == null) {
    current[keyList.last] = defaultValue;
  }
}
