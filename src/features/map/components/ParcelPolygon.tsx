import React, {memo, useCallback} from 'react';

import {Polygon as MapPolygon, type LatLng as MapLatLng} from 'react-native-maps';

/**
 * One parcel on the world map.
 *
 * Memoised, with every prop precomputed by the screen, because NFR-03 asks for
 * 45 fps with 500 parcels on screen. Rebuilding each polygon's coordinate
 * arrays and colours on every render of the map screen — a location fix, a
 * filter toggle, the weekly card updating — re-sent all 500 geometries to the
 * native map each time, whether or not anything about them had changed.
 */
export interface ParcelPolygonProps {
  id: string;
  coordinates: MapLatLng[];
  holes?: MapLatLng[][];
  fillColor: string;
  strokeColor: string;
  strokeWidth: number;
  onPressParcel: (parcelId: string) => void;
}

function ParcelPolygonView({
  id,
  coordinates,
  holes,
  fillColor,
  strokeColor,
  strokeWidth,
  onPressParcel,
}: ParcelPolygonProps): React.JSX.Element {
  const handlePress = useCallback(() => onPressParcel(id), [id, onPressParcel]);

  return (
    <MapPolygon
      coordinates={coordinates}
      holes={holes}
      fillColor={fillColor}
      strokeColor={strokeColor}
      strokeWidth={strokeWidth}
      tappable
      onPress={handlePress}
    />
  );
}

export const ParcelPolygon = memo(ParcelPolygonView);
