import {
  formatArea,
  formatDistance,
  formatDuration,
  formatPace,
  relativeTimeParts,
  roundToSignificantFigures,
} from '@core/utils/format';

describe('roundToSignificantFigures', () => {
  it.each([
    [41_237, 41_200],
    [0.041237, 0.0412],
    [1234, 1230],
    [9, 9],
    [0, 0],
  ])('rounds %p to %p at 3 sig figs', (input, expected) => {
    expect(roundToSignificantFigures(input)).toBeCloseTo(expected, 6);
  });

  it('handles non-finite input without producing NaN', () => {
    expect(roundToSignificantFigures(Number.NaN)).toBe(0);
    expect(roundToSignificantFigures(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('formatArea — doc 03 §4', () => {
  it('uses m² at and below 10 000', () => {
    expect(formatArea(9999)).toEqual({
      value: 10_000,
      unit: 'm2',
      i18nKey: 'units.areaSquareMetres',
    });
    expect(formatArea(500).unit).toBe('m2');
  });

  it('switches to km² above 10 000 m²', () => {
    const result = formatArea(41_000);
    expect(result.unit).toBe('km2');
    expect(result.value).toBeCloseTo(0.041, 5);
  });

  it('formats the doc 03 example B areas', () => {
    expect(formatArea(24_600).value).toBeCloseTo(0.0246, 6);
    expect(formatArea(55_000).value).toBeCloseTo(0.055, 6);
  });

  it('never renders a raw float', () => {
    const {value} = formatArea(1_234_567.891);
    expect(String(value).replace('.', '').replace(/0+$/, '').length).toBeLessThanOrEqual(3);
  });

  it('returns zero rather than NaN for invalid input', () => {
    expect(formatArea(Number.NaN).value).toBe(0);
    expect(formatArea(-5).value).toBe(0);
  });
});

describe('formatDistance', () => {
  it('uses metres below a kilometre', () => {
    expect(formatDistance(840)).toEqual({
      value: 840,
      unit: 'm',
      i18nKey: 'units.distanceMetres',
    });
  });

  it('uses kilometres to one decimal above', () => {
    expect(formatDistance(3120).value).toBeCloseTo(3.1, 5);
    expect(formatDistance(3120).unit).toBe('km');
  });

  it('handles the boundary exactly', () => {
    expect(formatDistance(1000).unit).toBe('km');
    expect(formatDistance(999).unit).toBe('m');
  });
});

describe('formatDuration', () => {
  it('zero-pads minutes and seconds under an hour', () => {
    expect(formatDuration(65).params).toEqual({minutes: '01', seconds: '05'});
    expect(formatDuration(0).params).toEqual({minutes: '00', seconds: '00'});
  });

  it('switches to hours and minutes past an hour', () => {
    const result = formatDuration(2651); // doc 05 §2 example walk
    expect(result.i18nKey).toBe('units.durationMinutesSeconds');
    expect(result.params).toEqual({minutes: '44', seconds: '11'});
  });

  it('reports hours for a long walk', () => {
    const result = formatDuration(3 * 3600 + 25 * 60);
    expect(result.i18nKey).toBe('units.durationHoursMinutes');
    expect(result.params).toEqual({hours: '3', minutes: '25'});
  });

  it('clamps negative and non-finite input to zero', () => {
    expect(formatDuration(-10).params).toEqual({minutes: '00', seconds: '00'});
    expect(formatDuration(Number.NaN).params).toEqual({minutes: '00', seconds: '00'});
  });
});

describe('formatPace', () => {
  it('converts m/s to minutes per kilometre', () => {
    // 1.18 m/s is the doc 05 §2 example walk: ~14:07 /km.
    expect(formatPace(1.18)).toBe('14:07');
  });

  it('returns null at a standstill rather than a divergent number', () => {
    expect(formatPace(0)).toBeNull();
    expect(formatPace(0.05)).toBeNull();
    expect(formatPace(Number.NaN)).toBeNull();
  });

  it('never renders a 60-second remainder', () => {
    // Any speed whose remainder rounds to 60 must roll over to the next minute.
    for (let speed = 0.5; speed < 4; speed += 0.001) {
      const pace = formatPace(speed);
      expect(pace).not.toMatch(/:60$/);
    }
  });
});

describe('relativeTimeParts', () => {
  const now = new Date('2026-08-30T12:00:00Z');

  it.each([
    ['30 seconds ago', new Date('2026-08-30T11:59:30Z'), 'second'],
    ['20 minutes ago', new Date('2026-08-30T11:40:00Z'), 'minute'],
    ['5 hours ago', new Date('2026-08-30T07:00:00Z'), 'hour'],
    ['3 days ago', new Date('2026-08-27T12:00:00Z'), 'day'],
  ])('picks the %s unit', (_label, from, unit) => {
    expect(relativeTimeParts(from, now).unit).toBe(unit);
  });

  it('reports past times as negative', () => {
    expect(relativeTimeParts(new Date('2026-08-30T11:40:00Z'), now).value).toBe(-20);
  });
});
