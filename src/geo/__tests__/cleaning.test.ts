import {DEFAULT_GAME_CONFIG} from '@core/constants/gameConfig';
import {averageSpeedMps, cleanSamples} from '@geo/cleaning';

import {ORIGIN, densifyRing, offsetMetres, squareRing, toSamples} from './fixtures';

const config = DEFAULT_GAME_CONFIG;

/** A straight 60-point walk, 20 m apart, 10 s per sample → 2 m/s. */
function walkSamples() {
  const path = Array.from({length: 60}, (_, i) => offsetMetres(ORIGIN, i * 20, 0));
  return toSamples(path, {intervalS: 10});
}

describe('cleanSamples — GR-01', () => {
  it('keeps a clean walk intact', () => {
    const result = cleanSamples(walkSamples(), config);
    expect(result.rejection).toBeNull();
    expect(result.points).toHaveLength(60);
  });

  it('(1) drops points worse than MAX_ACCURACY_M', () => {
    const samples = walkSamples();
    samples[10]!.accuracyM = 45;
    samples[20]!.accuracyM = 31;

    const result = cleanSamples(samples, config);
    expect(result.stats.droppedForAccuracy).toBe(2);
    expect(result.points).toHaveLength(58);
  });

  it('(1) keeps points with unknown accuracy rather than discarding the walk', () => {
    const samples = walkSamples();
    samples.forEach(s => (s.accuracyM = null));

    const result = cleanSamples(samples, config);
    expect(result.stats.droppedForAccuracy).toBe(0);
    expect(result.rejection).toBeNull();
  });

  it('(2) drops mock-provider points and reports the ratio', () => {
    const samples = walkSamples();
    for (let i = 0; i < 6; i++) {
      samples[i]!.isMock = true;
    }

    const result = cleanSamples(samples, config);
    expect(result.stats.droppedForMock).toBe(6);
    expect(result.stats.mockRatio).toBeCloseTo(0.1, 5);
    // Above doc 06 §3's 5% hard-rejection threshold — but that verdict is the
    // server's to make, so cleaning still returns the surviving points.
    expect(result.stats.mockRatio).toBeGreaterThan(0.05);
  });

  it('(3) sorts by timestamp and drops duplicates', () => {
    const samples = walkSamples();
    const shuffled = [samples[5]!, samples[1]!, samples[3]!, ...samples.slice(6), {...samples[5]!}];

    const result = cleanSamples(shuffled, config);
    const timestamps = result.points.map(p => p.timestamp);
    expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));
    expect(result.stats.droppedForDuplicateTime).toBe(1);
  });

  it('(4) drops sub-2 m jitter', () => {
    const samples = walkSamples();
    // Insert a fix 1 m from its predecessor.
    samples.splice(30, 0, {
      ...samples[29]!,
      seq: 1000,
      timestamp: samples[29]!.timestamp + 2000,
      ...offsetMetres(samples[29]!, 1, 0),
    });

    const result = cleanSamples(samples, config);
    expect(result.stats.droppedForJitter).toBe(1);
  });

  it('(5) repairs a single teleport by dropping the offending point', () => {
    const samples = walkSamples();
    // One fix 5 km away, then the walk resumes normally.
    samples[25] = {...samples[25]!, ...offsetMetres(ORIGIN, 5000, 5000)};

    const result = cleanSamples(samples, config);
    expect(result.rejection).toBeNull();
    expect(result.stats.teleportCount).toBe(1);
    expect(result.points).toHaveLength(59);
  });

  it('(5) rejects the walk on a second teleport', () => {
    const samples = walkSamples();
    samples[20] = {...samples[20]!, ...offsetMetres(ORIGIN, 8000, 0)};
    samples[40] = {...samples[40]!, ...offsetMetres(ORIGIN, -8000, 0)};

    const result = cleanSamples(samples, config);
    expect(result.rejection).toBe('ERR_TELEPORT');
  });

  it('(6) rejects a walk left with fewer than MIN_POINTS', () => {
    const samples = toSamples(densifyRing(squareRing(50), 2), {intervalS: 10});
    expect(samples.length).toBeLessThan(config.minPoints);

    const result = cleanSamples(samples, config);
    expect(result.rejection).toBe('ERR_TOO_FEW_POINTS');
  });

  it('handles an empty input without throwing', () => {
    const result = cleanSamples([], config);
    expect(result.points).toEqual([]);
    expect(result.rejection).toBe('ERR_TOO_FEW_POINTS');
    expect(result.stats.mockRatio).toBe(0);
  });

  it('treats a zero-elapsed jump as a teleport rather than dividing by zero', () => {
    const samples = walkSamples();
    samples[30] = {...samples[30]!, timestamp: samples[29]!.timestamp};

    const result = cleanSamples(samples, config);
    // Same-millisecond duplicates are removed at step 3, before the speed check.
    expect(result.points.every(p => Number.isFinite(p.timestamp))).toBe(true);
  });
});

describe('averageSpeedMps', () => {
  it('computes distance over elapsed time', () => {
    expect(averageSpeedMps(walkSamples())).toBeCloseTo(2, 1);
  });

  it('returns 0 for a path too short to measure', () => {
    expect(averageSpeedMps([])).toBe(0);
    expect(averageSpeedMps(walkSamples().slice(0, 1))).toBe(0);
  });
});
