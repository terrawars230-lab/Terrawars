import {
  fromGeoJsonMultiPolygon,
  fromGeoJsonPolygon,
  fromGeoJsonPosition,
  toGeoJsonLineString,
  toGeoJsonPolygon,
  toGeoJsonPosition,
} from '@geo/coordinates';

import {ORIGIN, offsetMetres, squareRing} from './fixtures';

describe('position ordering', () => {
  it('writes GeoJSON as [lng, lat], not [lat, lng]', () => {
    expect(toGeoJsonPosition({lat: 31.5204, lng: 74.3587})).toEqual([74.3587, 31.5204]);
  });

  it('reads GeoJSON back into {lat, lng}', () => {
    expect(fromGeoJsonPosition([74.3587, 31.5204])).toEqual({lat: 31.5204, lng: 74.3587});
  });

  it('round-trips without swapping the axes', () => {
    const point = {lat: 31.5204, lng: 74.3587};
    expect(fromGeoJsonPosition(toGeoJsonPosition(point))).toEqual(point);
  });

  it('throws on a malformed position instead of producing undefined coordinates', () => {
    expect(() => fromGeoJsonPosition([74.3587])).toThrow(/Malformed GeoJSON/);
  });
});

describe('toGeoJsonPolygon', () => {
  it('closes the ring by repeating the first vertex', () => {
    const ring = squareRing(100);
    const [outer] = toGeoJsonPolygon({outer: ring}).coordinates;

    expect(outer).toHaveLength(ring.length + 1);
    expect(outer![0]).toEqual(outer![outer!.length - 1]);
  });

  it('does not double-close an already closed ring', () => {
    const ring = squareRing(100);
    const closed = [...ring, ring[0]!];
    const [outer] = toGeoJsonPolygon({outer: closed}).coordinates;

    expect(outer).toHaveLength(closed.length);
  });

  it('emits holes after the outer ring (GR-22 enclaves)', () => {
    const polygon = {
      outer: squareRing(400),
      holes: [squareRing(50, offsetMetres(ORIGIN, 100, 100))],
    };
    const geoJson = toGeoJsonPolygon(polygon);

    expect(geoJson.type).toBe('Polygon');
    expect(geoJson.coordinates).toHaveLength(2);
  });

  it('handles an empty ring without emitting a malformed coordinate array', () => {
    expect(toGeoJsonPolygon({outer: []}).coordinates).toEqual([[]]);
  });
});

describe('fromGeoJsonPolygon', () => {
  it('drops the repeated closing vertex so the map draws no seam', () => {
    const ring = squareRing(100);
    const restored = fromGeoJsonPolygon(toGeoJsonPolygon({outer: ring}));

    expect(restored.outer).toHaveLength(ring.length);
    expect(restored.outer[0]!.lat).toBeCloseTo(ring[0]!.lat, 10);
  });

  it('round-trips a polygon with holes', () => {
    const polygon = {
      outer: squareRing(400),
      holes: [squareRing(50, offsetMetres(ORIGIN, 100, 100))],
    };
    const restored = fromGeoJsonPolygon(toGeoJsonPolygon(polygon));

    expect(restored.outer).toHaveLength(polygon.outer.length);
    expect(restored.holes).toHaveLength(1);
    expect(restored.holes![0]).toHaveLength(4);
  });

  it('reports no holes rather than an empty array when there are none', () => {
    expect(fromGeoJsonPolygon(toGeoJsonPolygon({outer: squareRing(100)})).holes).toBeUndefined();
  });
});

describe('fromGeoJsonMultiPolygon', () => {
  it('splits a MULTIPOLYGON into one polygon per part (GR-20 corridor split)', () => {
    const left = toGeoJsonPolygon({outer: squareRing(100)});
    const right = toGeoJsonPolygon({outer: squareRing(100, offsetMetres(ORIGIN, 300, 0))});

    const parts = fromGeoJsonMultiPolygon([left.coordinates, right.coordinates]);

    expect(parts).toHaveLength(2);
    expect(parts[0]!.outer).toHaveLength(4);
    expect(parts[1]!.outer[0]!.lng).toBeGreaterThan(parts[0]!.outer[0]!.lng);
  });

  it('returns an empty list for an empty MULTIPOLYGON', () => {
    expect(fromGeoJsonMultiPolygon([])).toEqual([]);
  });
});

describe('toGeoJsonLineString', () => {
  it('preserves order and does not close the path', () => {
    const path = [ORIGIN, offsetMetres(ORIGIN, 100, 0), offsetMetres(ORIGIN, 100, 100)];
    const line = toGeoJsonLineString(path);

    expect(line.type).toBe('LineString');
    expect(line.coordinates).toHaveLength(3);
    expect(line.coordinates[0]).not.toEqual(line.coordinates[2]);
  });
});
