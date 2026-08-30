import {regionToBounds, regionToZoom} from '@features/map/utils/viewport';

/**
 * The region → bbox → zoom conversions.
 *
 * Small, boring, and worth testing precisely because a factor-of-two error here
 * is invisible on screen but doubles or quarters the rows every map pan asks the
 * database for — the kind of thing that passes review and then shows up as an
 * NFR-04 miss under load.
 */

describe('regionToBounds', () => {
  it('treats the deltas as the FULL span, not the half-span', () => {
    const bounds = regionToBounds({
      latitude: 31.5204,
      longitude: 74.3587,
      latitudeDelta: 0.02,
      longitudeDelta: 0.04,
    });

    // Half of each delta reaches an edge.
    expect(bounds.minLat).toBeCloseTo(31.5104, 6);
    expect(bounds.maxLat).toBeCloseTo(31.5304, 6);
    expect(bounds.minLng).toBeCloseTo(74.3387, 6);
    expect(bounds.maxLng).toBeCloseTo(74.3787, 6);
  });

  it('produces a box whose span equals the deltas exactly', () => {
    const region = {
      latitude: 0,
      longitude: 0,
      latitudeDelta: 0.5,
      longitudeDelta: 1.25,
    };
    const bounds = regionToBounds(region);

    expect(bounds.maxLat - bounds.minLat).toBeCloseTo(region.latitudeDelta, 10);
    expect(bounds.maxLng - bounds.minLng).toBeCloseTo(region.longitudeDelta, 10);
  });

  it('centres the box on the region', () => {
    const bounds = regionToBounds({
      latitude: -33.8688,
      longitude: 151.2093,
      latitudeDelta: 0.1,
      longitudeDelta: 0.1,
    });

    expect((bounds.minLat + bounds.maxLat) / 2).toBeCloseTo(-33.8688, 8);
    expect((bounds.minLng + bounds.maxLng) / 2).toBeCloseTo(151.2093, 8);
  });

  it('always returns min below max, so the server-side bbox check passes', () => {
    const bounds = regionToBounds({
      latitude: 31.5,
      longitude: 74.3,
      latitudeDelta: 0.01,
      longitudeDelta: 0.01,
    });

    expect(bounds.minLat).toBeLessThan(bounds.maxLat);
    expect(bounds.minLng).toBeLessThan(bounds.maxLng);
  });
});

describe('regionToZoom', () => {
  it('maps a full 360° span to zoom 0', () => {
    expect(regionToZoom(360)).toBe(0);
  });

  it('halves the span for each zoom level', () => {
    expect(regionToZoom(180)).toBe(1);
    expect(regionToZoom(90)).toBe(2);
    expect(regionToZoom(45)).toBe(3);
  });

  it('lands in the geometry band for a street-level viewport', () => {
    // A ~0.02° span is roughly a few city blocks. doc 04 §4 wants full or
    // near-full geometry there, which is zoom >= 14.
    expect(regionToZoom(0.02)).toBeGreaterThanOrEqual(14);
  });

  it('lands in the aggregate band for a country-level viewport', () => {
    // Below zoom 12 the server returns counts and centroids, not polygons.
    expect(regionToZoom(10)).toBeLessThan(12);
  });

  it('clamps to the 0–20 range', () => {
    expect(regionToZoom(0.000001)).toBe(20);
    expect(regionToZoom(720)).toBe(0);
  });

  it('returns the maximum zoom rather than Infinity for a degenerate delta', () => {
    // A zero delta happens briefly while the map is initialising. log2(360/0)
    // would be Infinity and would be sent to the server as the zoom.
    expect(regionToZoom(0)).toBe(20);
    expect(regionToZoom(-1)).toBe(20);
  });

  it('is monotonic — zooming in never decreases the zoom level', () => {
    let previous = -1;
    for (const delta of [180, 90, 45, 10, 1, 0.5, 0.1, 0.02, 0.005]) {
      const zoom = regionToZoom(delta);
      expect(zoom).toBeGreaterThanOrEqual(previous);
      previous = zoom;
    }
  });
});
