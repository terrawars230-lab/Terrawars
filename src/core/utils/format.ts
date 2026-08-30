/**
 * User-facing value formatting.
 *
 * doc 03 §4 is explicit: never show a user a raw float. Areas are km² above
 * 10 000 m² and m² below, always to three significant figures. The server
 * applies the identical rule in `format_area()`, so a number formatted here
 * and a number formatted there agree — a mismatch between the two is the kind
 * of thing users read as a bug in the scoring.
 */

/** Rounds to `digits` significant figures. Mirrors `public.round_sig`. */
export function roundToSignificantFigures(value: number, digits = 3): number {
  if (!Number.isFinite(value) || value === 0) {
    return 0;
  }
  const magnitude = Math.floor(Math.log10(Math.abs(value)));
  const factor = Math.pow(10, digits - 1 - magnitude);
  return Math.round(value * factor) / factor;
}

export interface FormattedArea {
  value: number;
  unit: 'm2' | 'km2';
  /** i18n key to render it with — the unit symbol itself is localisable. */
  i18nKey: 'units.areaSquareMetres' | 'units.areaSquareKilometres';
}

/** doc 03 §4: km² above 10 000 m², otherwise m², three significant figures. */
export function formatArea(areaM2: number): FormattedArea {
  if (!Number.isFinite(areaM2) || areaM2 < 0) {
    return {value: 0, unit: 'm2', i18nKey: 'units.areaSquareMetres'};
  }

  if (areaM2 >= 10_000) {
    return {
      value: roundToSignificantFigures(areaM2 / 1_000_000, 3),
      unit: 'km2',
      i18nKey: 'units.areaSquareKilometres',
    };
  }

  return {
    value: roundToSignificantFigures(areaM2, 3),
    unit: 'm2',
    i18nKey: 'units.areaSquareMetres',
  };
}

export interface FormattedDistance {
  value: number;
  unit: 'm' | 'km';
  i18nKey: 'units.distanceMetres' | 'units.distanceKilometres';
}

/** Metres below 1 km, kilometres to one decimal above it. */
export function formatDistance(distanceM: number): FormattedDistance {
  if (!Number.isFinite(distanceM) || distanceM < 0) {
    return {value: 0, unit: 'm', i18nKey: 'units.distanceMetres'};
  }

  if (distanceM >= 1000) {
    return {
      value: Math.round(distanceM / 100) / 10,
      unit: 'km',
      i18nKey: 'units.distanceKilometres',
    };
  }

  return {value: Math.round(distanceM), unit: 'm', i18nKey: 'units.distanceMetres'};
}

/**
 * Elapsed time for the live HUD.
 *
 * `mm:ss` under an hour, `Hh Mm` above it. Minutes and seconds are zero-padded
 * so the digit count never changes mid-walk and the readout stops jittering.
 */
export function formatDuration(totalSeconds: number): {
  i18nKey: 'units.durationMinutesSeconds' | 'units.durationHoursMinutes';
  params: Record<string, string>;
} {
  const safeSeconds =
    Number.isFinite(totalSeconds) && totalSeconds > 0 ? Math.floor(totalSeconds) : 0;

  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  if (hours > 0) {
    return {
      i18nKey: 'units.durationHoursMinutes',
      params: {hours: String(hours), minutes: String(minutes)},
    };
  }

  return {
    i18nKey: 'units.durationMinutesSeconds',
    params: {minutes: pad(minutes), seconds: pad(seconds)},
  };
}

/**
 * Pace in minutes per kilometre — what walkers actually read, unlike m/s.
 *
 * Returns `null` below 0.1 m/s: at a standstill the value diverges, and
 * "999:59 /km" is worse than showing nothing.
 */
export function formatPace(speedMps: number): string | null {
  if (!Number.isFinite(speedMps) || speedMps < 0.1) {
    return null;
  }

  const secondsPerKm = 1000 / speedMps;
  const minutes = Math.floor(secondsPerKm / 60);
  const seconds = Math.round(secondsPerKm % 60);

  // Guard the 59.6 → "60" rounding case, which would render as "5:60".
  if (seconds === 60) {
    return `${minutes + 1}:00`;
  }
  return `${minutes}:${pad(seconds)}`;
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/**
 * Compact relative time for lists ("2h ago").
 *
 * Deliberately not `date-fns/formatDistanceToNow`: that pulls its own English
 * strings in, which would sidestep the localisation layer NFR-11 requires.
 */
export function relativeTimeParts(
  from: Date,
  now: Date = new Date(),
): {value: number; unit: Intl.RelativeTimeFormatUnit} {
  const seconds = Math.round((from.getTime() - now.getTime()) / 1000);
  const absolute = Math.abs(seconds);

  if (absolute < 60) {
    return {value: seconds, unit: 'second'};
  }
  if (absolute < 3600) {
    return {value: Math.round(seconds / 60), unit: 'minute'};
  }
  if (absolute < 86_400) {
    return {value: Math.round(seconds / 3600), unit: 'hour'};
  }
  return {value: Math.round(seconds / 86_400), unit: 'day'};
}
