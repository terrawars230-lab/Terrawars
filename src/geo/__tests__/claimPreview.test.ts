import {DEFAULT_GAME_CONFIG} from '@core/constants/gameConfig';
import {buildClaimPreview, isPointInRing, maxEnclosableAreaM2} from '@geo/claimPreview';

import {
  ORIGIN,
  approachThenLoopPath,
  impossibleAreaSamples,
  offsetMetres,
  openPath,
  squareRing,
  thinLoopPath,
  tinyLoopPath,
  toSamples,
  tooFastSamples,
  validLoopSamples,
} from './fixtures';

const config = DEFAULT_GAME_CONFIG;

describe('maxEnclosableAreaM2 — GR-05', () => {
  it('matches the worked example A from doc 03 §5', () => {
    // A 900 m loop: 900² / 4π × 1.15 ≈ 74 100 m².
    expect(maxEnclosableAreaM2(900, 1.15)).toBeCloseTo(74_100, -2);
  });

  it('rejects the example E cheat: 5 km² claimed from a 600 m path', () => {
    expect(maxEnclosableAreaM2(600, 1.15)).toBeLessThan(5_000_000);
    expect(maxEnclosableAreaM2(600, 1.15)).toBeCloseTo(32_900, -2);
  });

  it('is the area of a circle of that perimeter, times the tolerance', () => {
    const radius = 100;
    const circumference = 2 * Math.PI * radius;
    expect(maxEnclosableAreaM2(circumference, 1)).toBeCloseTo(Math.PI * radius * radius, 5);
  });
});

describe('buildClaimPreview — GR-03/04/05', () => {
  it('accepts a clean loop', () => {
    const preview = buildClaimPreview(validLoopSamples(), config);

    expect(preview.errorCode).toBeNull();
    expect(preview.valid).toBe(true);
    expect(preview.loopKind).not.toBeNull();
    expect(preview.ring.length).toBeGreaterThanOrEqual(3);
    expect(preview.areaM2).toBeGreaterThan(config.minClaimAreaM2);
  });

  it('returns an empty preview for no samples without throwing', () => {
    const preview = buildClaimPreview([], config);
    expect(preview.valid).toBe(false);
    expect(preview.ring).toEqual([]);
    expect(preview.areaM2).toBe(0);
  });

  it('reports ERR_LOOP_NOT_CLOSED for an open path', () => {
    const preview = buildClaimPreview(toSamples(openPath(), {intervalS: 10}), config);
    expect(preview.errorCode).toBe('ERR_LOOP_NOT_CLOSED');
    expect(preview.valid).toBe(false);
  });

  it('reports ERR_TOO_FEW_POINTS before anything else', () => {
    const preview = buildClaimPreview(toSamples(tinyLoopPath(), {intervalS: 10}), config);
    expect(preview.errorCode).toBe('ERR_TOO_FEW_POINTS');
  });

  it('reports ERR_AREA_TOO_SMALL for a loop under MIN_CLAIM_AREA_M2', () => {
    const preview = buildClaimPreview(toSamples(thinLoopPath(), {intervalS: 8}), config);

    expect(preview.valid).toBe(false);
    expect(preview.errorCode).toBe('ERR_AREA_TOO_SMALL');
    // The earlier checks must have passed, or this fixture proves nothing.
    expect(preview.loopKind).not.toBeNull();
    expect(preview.areaM2).toBeGreaterThan(0);
    expect(preview.areaM2).toBeLessThan(config.minClaimAreaM2);
  });

  it('cannot report ERR_IMPOSSIBLE_AREA for a genuinely walked path', () => {
    // For any real closed path the walked length is at least the ring
    // perimeter, so area <= L²/4π holds by construction. GR-05 exists to catch
    // FORGED point sets, which never reach this function — they arrive as a
    // direct API call and are caught server-side (doc 06 §3, threat T3).
    const preview = buildClaimPreview(impossibleAreaSamples(), config);

    expect(preview.areaM2).toBeLessThanOrEqual(preview.maxPossibleAreaM2);
    expect(preview.errorCode).not.toBe('ERR_IMPOSSIBLE_AREA');
  });

  it('reports ERR_TOO_FAST for a route covered at vehicle speed', () => {
    const preview = buildClaimPreview(tooFastSamples(), config);

    expect(preview.valid).toBe(false);
    expect(preview.errorCode).toBe('ERR_TOO_FAST');
    expect(preview.averageSpeedMps).toBeGreaterThan(config.maxSpeedMps);
    // Under the burst ceiling throughout, so GR-01(5) did not fire first.
    expect(preview.averageSpeedMps).toBeLessThan(config.maxBurstSpeedMps);
  });

  it('reports ERR_TELEPORT when two fixes jump impossibly', () => {
    const samples = validLoopSamples();
    samples[10] = {...samples[10]!, ...offsetMetres(ORIGIN, 9000, 0)};
    samples[30] = {...samples[30]!, ...offsetMetres(ORIGIN, -9000, 0)};

    expect(buildClaimPreview(samples, config).errorCode).toBe('ERR_TELEPORT');
  });

  it('never reports valid without a ring', () => {
    const cases = [
      buildClaimPreview([], config),
      buildClaimPreview(toSamples(openPath(), {intervalS: 10}), config),
      buildClaimPreview(toSamples(tinyLoopPath()), config),
    ];
    for (const preview of cases) {
      expect(preview.valid).toBe(false);
      expect(preview.ring).toHaveLength(0);
    }
  });

  it('always reports a duration, even for a rejected walk (doc 03 §6)', () => {
    // The user did the exercise; the preview must not throw that away.
    const preview = buildClaimPreview(toSamples(openPath(), {intervalS: 10}), config);
    expect(preview.durationS).toBeGreaterThan(0);
  });

  it('honours a config override rather than the launch defaults', () => {
    const strict = {...config, minClaimAreaM2: 10_000_000};
    const preview = buildClaimPreview(validLoopSamples(), strict);
    expect(preview.errorCode).toBe('ERR_AREA_TOO_SMALL');
  });
});

describe('isPointInRing', () => {
  const ring = squareRing(200);

  it('finds a point inside', () => {
    expect(isPointInRing(offsetMetres(ORIGIN, 100, 100), ring)).toBe(true);
  });

  it('rejects a point outside', () => {
    expect(isPointInRing(offsetMetres(ORIGIN, 400, 400), ring)).toBe(false);
    expect(isPointInRing(offsetMetres(ORIGIN, -50, 100), ring)).toBe(false);
  });

  it('rejects everything for an empty ring', () => {
    expect(isPointInRing(ORIGIN, [])).toBe(false);
  });
});

describe('buildClaimPreview — GR-04 rule ordering', () => {
  // Each override isolates one rule by making it the first to fail, which is
  // also how the server evaluates them (doc 03 §2, GR-04 table order).
  it('reports ERR_AREA_TOO_LARGE above MAX_CLAIM_AREA_M2', () => {
    const preview = buildClaimPreview(validLoopSamples(), {...config, maxClaimAreaM2: 1_000});
    expect(preview.errorCode).toBe('ERR_AREA_TOO_LARGE');
  });

  it('reports ERR_DISTANCE_TOO_SHORT below MIN_WALK_DISTANCE_M', () => {
    // Only reachable through GR-02(b): the return-to-start branch already
    // requires MIN_WALK_DISTANCE_M before it will close a loop at all, so
    // raising the bound there yields ERR_LOOP_NOT_CLOSED instead. A
    // self-intersecting path closes regardless of distance, which is exactly
    // the case GR-04's distance check exists to catch.
    const samples = toSamples(approachThenLoopPath(), {intervalS: 20});
    const preview = buildClaimPreview(samples, {...config, minWalkDistanceM: 100_000});

    expect(preview.loopKind).toBe('self-intersection');
    expect(preview.errorCode).toBe('ERR_DISTANCE_TOO_SHORT');
  });

  it('reports ERR_LOOP_NOT_CLOSED when the distance bound blocks GR-02(a)', () => {
    const preview = buildClaimPreview(validLoopSamples(), {...config, minWalkDistanceM: 100_000});
    expect(preview.errorCode).toBe('ERR_LOOP_NOT_CLOSED');
  });

  it('reports ERR_DURATION_TOO_SHORT below MIN_WALK_DURATION_S', () => {
    const preview = buildClaimPreview(validLoopSamples(), {...config, minWalkDurationS: 86_400});
    expect(preview.errorCode).toBe('ERR_DURATION_TOO_SHORT');
  });

  it('checks area before distance, matching the server', () => {
    // Both rules would fail; the area code is the one the user must see.
    const preview = buildClaimPreview(validLoopSamples(), {
      ...config,
      maxClaimAreaM2: 1_000,
      minWalkDurationS: 86_400,
    });
    expect(preview.errorCode).toBe('ERR_AREA_TOO_LARGE');
  });
});
