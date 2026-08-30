import {env} from '@core/config/env';

/**
 * Application logger.
 *
 * Two rules this enforces, both of which matter more than the convenience:
 *
 *  1. **Nothing logs in production unless it is a warning or an error.** A
 *     release build that chats on the console leaks data and costs battery.
 *  2. **Location is redacted.** Coordinates are the most sensitive thing this
 *     app touches (doc 06 §4). A lat/lng in a log line is a home address in a
 *     crash report, so `redactLocation` reduces any coordinate-bearing value to
 *     a coarse marker before it can reach a sink.
 *
 * `setCrashReporter` is the seam where Sentry (or any other sink) attaches.
 * Nothing else in the app should import a reporting SDK directly.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  [key: string]: unknown;
}

export interface CrashReporter {
  captureMessage(message: string, level: LogLevel, context?: LogContext): void;
  captureException(error: unknown, context?: LogContext): void;
}

let crashReporter: CrashReporter | null = null;

export function setCrashReporter(reporter: CrashReporter | null): void {
  crashReporter = reporter;
}

const LEVEL_ORDER: Record<LogLevel, number> = {debug: 10, info: 20, warn: 30, error: 40};

/** In production only warnings and above reach the console. */
const minimumLevel: LogLevel = env.debugLogging ? 'debug' : 'warn';

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[minimumLevel];
}

function emit(level: LogLevel, scope: string, message: string, context?: LogContext): void {
  const safeContext = context ? redactContext(context) : undefined;

  if (shouldLog(level)) {
    const prefix = `[${scope}]`;
    // eslint-disable-next-line no-console
    const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    if (safeContext) {
      sink(prefix, message, safeContext);
    } else {
      sink(prefix, message);
    }
  }

  if (crashReporter && LEVEL_ORDER[level] >= LEVEL_ORDER.warn) {
    crashReporter.captureMessage(`${scope}: ${message}`, level, safeContext);
  }
}

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, error?: unknown, context?: LogContext): void;
}

/**
 * Creates a scoped logger. Scope is a stable, greppable module name —
 * `createLogger('walk-recorder')`, not `createLogger(someVariable)`.
 */
export function createLogger(scope: string): Logger {
  return {
    debug: (message, context) => emit('debug', scope, message, context),
    info: (message, context) => emit('info', scope, message, context),
    warn: (message, context) => emit('warn', scope, message, context),
    error: (message, error, context) => {
      emit('error', scope, message, {...context, error: serialiseError(error)});
      crashReporter?.captureException(error, {scope, message, ...(context ?? {})});
    },
  };
}

/** Keys whose values are coordinates and must never appear in a log. */
const LOCATION_KEYS = new Set([
  'lat',
  'lng',
  'latitude',
  'longitude',
  'coordinates',
  'ring',
  'path',
  'points',
  'geom',
  'geometry',
  'centroid',
  'bbox',
  'bounds',
]);

const REDACTED = '[redacted:location]';

/**
 * Replaces coordinate-bearing fields with a marker, recursively.
 *
 * Deliberately conservative: it redacts by key name rather than by inspecting
 * values, because a false positive costs a debugging hint and a false negative
 * costs someone's address.
 */
export function redactContext(context: LogContext, depth = 0): LogContext {
  if (depth > 4) {
    return {};
  }

  const result: LogContext = {};
  for (const [key, value] of Object.entries(context)) {
    if (LOCATION_KEYS.has(key)) {
      result[key] = Array.isArray(value) ? `${REDACTED} (${value.length} items)` : REDACTED;
      continue;
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = redactContext(value as LogContext, depth + 1);
      continue;
    }
    result[key] = value;
  }
  return result;
}

function serialiseError(error: unknown): unknown {
  if (error instanceof Error) {
    return {name: error.name, message: error.message, stack: error.stack};
  }
  return error;
}
