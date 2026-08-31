import {DEFAULT_GAME_CONFIG} from '@core/constants/gameConfig';
import type {GpsSample} from '@core/types/geo';

import {useWalkStore} from '../store/walkStore';

/**
 * The HUD readouts.
 *
 * These exist because the raw-path version of this code shipped two symptoms
 * users actually reported: a distance that climbed while the phone sat still,
 * and a pace derived from it that read as random. Both are cheap to assert and
 * neither is visible in a typecheck.
 */

const START = 1_700_000_000_000;
/** ~1.11 m per 1e-5 degrees of latitude, close enough for fixture arithmetic. */
const METRE_IN_DEG = 1 / 111_320;

function sample(overrides: Partial<Omit<GpsSample, 'seq'>> = {}): Omit<GpsSample, 'seq'> {
  return {
    lat: 31.5204,
    lng: 74.3587,
    timestamp: START,
    accuracyM: 8,
    speedMps: 1.4,
    altitudeM: 210,
    headingDeg: 90,
    isMock: false,
    ...overrides,
  };
}

/** A point `northM` metres north of the origin, `afterMs` after the start. */
function walkedTo(northM: number, afterMs: number, overrides = {}) {
  return sample({
    lat: 31.5204 + northM * METRE_IN_DEG,
    timestamp: START + afterMs,
    ...overrides,
  });
}

function beginWalk() {
  useWalkStore.getState().reset();
  useWalkStore.getState().setConfig(DEFAULT_GAME_CONFIG);
  useWalkStore.getState().begin('walk-1', 'client-1');
}

describe('walk store — HUD distance', () => {
  beforeEach(beginWalk);
  afterEach(() => useWalkStore.getState().reset());

  it('does not accumulate distance from a phone standing still', () => {
    const {addSample} = useWalkStore.getState();

    // Twelve fixes over a minute, wandering ±0.8 m — so every step is 1.6 m,
    // inside GR-01(4)'s 2 m floor. This is the case that made a phone on a
    // table report hundreds of metres per hour before the floor was applied.
    for (let i = 0; i < 12; i++) {
      addSample(walkedTo(i % 2 === 0 ? 0.8 : -0.8, i * 5000));
    }

    expect(useWalkStore.getState().distanceM).toBe(0);
    expect(useWalkStore.getState().samples).toHaveLength(12);
  });

  it('accepts movement at the GR-01(4) jitter boundary', () => {
    const {addSample} = useWalkStore.getState();

    // 2.4 m per step clears the 2 m floor and counts. Worth pinning: the floor
    // is fixed by the spec rather than tunable, and the server applies the
    // identical one, so a client that filtered harder would under-report a
    // walk the server is about to credit in full.
    addSample(walkedTo(0, 0));
    addSample(walkedTo(2.4, 8000));

    expect(useWalkStore.getState().distanceM).toBeCloseTo(2.4, 1);
  });

  it('still records and uploads every sample it refuses to measure', () => {
    const {addSample} = useWalkStore.getState();

    // GR-01(1): far worse than the 30 m accuracy gate.
    addSample(sample({accuracyM: 120}));
    addSample(walkedTo(50, 20_000, {accuracyM: 150}));

    // The server re-cleans the raw path and its verdict is the only one that
    // counts (D-05), so a point we will not display is still a point we keep.
    expect(useWalkStore.getState().samples).toHaveLength(2);
    expect(useWalkStore.getState().pendingSamples()).toHaveLength(2);
    expect(useWalkStore.getState().distanceM).toBe(0);
  });

  it('measures a real walk', () => {
    const {addSample} = useWalkStore.getState();

    // 10 m every 8 s — 1.25 m/s, an ordinary walking pace.
    for (let i = 0; i <= 10; i++) {
      addSample(walkedTo(i * 10, i * 8000));
    }

    expect(useWalkStore.getState().distanceM).toBeCloseTo(100, 0);
  });

  it('drops a teleport without moving the anchor (GR-01(5))', () => {
    const {addSample} = useWalkStore.getState();

    addSample(walkedTo(0, 0));
    addSample(walkedTo(10, 8000));
    // 5 km in two seconds: a spoof or a bad fix, not a walk.
    addSample(walkedTo(5010, 10_000));
    // The next honest fix must re-link from 10 m, not from 5010 m.
    addSample(walkedTo(20, 18_000));

    expect(useWalkStore.getState().distanceM).toBeCloseTo(20, 0);
  });

  it('ignores a mock-provider fix (GR-01(2))', () => {
    const {addSample} = useWalkStore.getState();

    addSample(walkedTo(0, 0));
    addSample(walkedTo(40, 40_000, {isMock: true}));

    expect(useWalkStore.getState().distanceM).toBe(0);
  });
});

describe('walk store — live pace', () => {
  beforeEach(beginWalk);
  afterEach(() => useWalkStore.getState().reset());

  it('reports nothing until the window holds enough time', () => {
    const {addSample} = useWalkStore.getState();

    addSample(walkedTo(0, 0));
    addSample(walkedTo(6, 4000));

    // Four seconds is not a pace, it is a rounding error with an opinion.
    expect(useWalkStore.getState().recentSpeedMps()).toBe(0);
  });

  it('reports the speed of the recent window, not the whole-walk average', () => {
    const {addSample} = useWalkStore.getState();

    // A slow first minute: 30 m in 60 s = 0.5 m/s.
    for (let i = 0; i <= 12; i++) {
      addSample(walkedTo(i * 2.5, i * 5000));
    }
    // Then a brisk half-minute: 45 m in 30 s = 1.5 m/s.
    for (let i = 1; i <= 6; i++) {
      addSample(walkedTo(30 + i * 7.5, 60_000 + i * 5000));
    }

    const speed = useWalkStore.getState().recentSpeedMps();

    // The whole-walk average would be ~0.83 m/s. The window must see the 1.5.
    expect(speed).toBeGreaterThan(1.2);
    expect(speed).toBeLessThan(1.8);
  });

  it('decays towards zero when the user stops walking', () => {
    const {addSample} = useWalkStore.getState();

    for (let i = 0; i <= 8; i++) {
      addSample(walkedTo(i * 7.5, i * 5000));
    }
    expect(useWalkStore.getState().recentSpeedMps()).toBeGreaterThan(1);

    // Standing still: fixes keep arriving, all inside the jitter floor.
    for (let i = 1; i <= 8; i++) {
      addSample(walkedTo(60 + (i % 2 === 0 ? 1 : -1), 40_000 + i * 5000));
    }

    expect(useWalkStore.getState().recentSpeedMps()).toBe(0);
  });

  it('reports no speed while the walk is paused', () => {
    const {addSample} = useWalkStore.getState();

    for (let i = 0; i <= 8; i++) {
      addSample(walkedTo(i * 7.5, i * 5000));
    }

    useWalkStore.getState().pause();

    // A paused walk has no speed, and showing the last one would be a lie.
    expect(useWalkStore.getState().recentSpeedMps()).toBe(0);
  });
});
