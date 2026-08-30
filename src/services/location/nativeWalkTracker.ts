import {NativeEventEmitter, NativeModules, Platform} from 'react-native';

import {createLogger} from '@core/logger/logger';
import type {GpsSample} from '@core/types/geo';

import type {
  LocationTracker,
  LocationTrackerEvents,
  TrackingOptions,
  TrackingStatus,
  TrackingStopReason,
} from './types';

/**
 * Bridge to the native `WalkTracker` module.
 *
 * Android: a foreground service (`foregroundServiceType="location"`) driving
 * FusedLocationProviderClient, with the persistent notification FR-11 requires.
 * iOS: CLLocationManager with `allowsBackgroundLocationUpdates`.
 *
 * Both platforms emit the same event names and the same payload shape, so
 * nothing above this file branches on `Platform.OS`.
 *
 * The module is intentionally NOT a TurboModule yet. Under the new
 * architecture's interop layer a legacy native module still works, and keeping
 * the surface this small means the eventual codegen migration is one file. The
 * risk of getting the foreground-service lifecycle wrong is much larger than
 * the cost of that migration.
 */

const logger = createLogger('location');

interface NativeWalkTrackerModule {
  start(options: TrackingOptions): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;
  getStatus(): Promise<TrackingStatus>;
  getCurrentPosition(timeoutMs: number): Promise<NativeSample>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

/** What the native side sends. Deliberately primitive — no dates, no nulls-as-NaN. */
interface NativeSample {
  latitude: number;
  longitude: number;
  timestamp: number;
  accuracy: number;
  speed: number;
  altitude: number;
  heading: number;
  isMock: boolean;
}

const NATIVE_EVENT = {
  sample: 'WalkTracker:sample',
  stopped: 'WalkTracker:stopped',
  error: 'WalkTracker:error',
} as const;

const nativeModule = NativeModules.WalkTracker as NativeWalkTrackerModule | undefined;

/**
 * A negative accuracy or speed is how both platforms say "unknown". Passing
 * that straight through would let a `-1` reach the cleaning pass and be
 * compared against MAX_ACCURACY_M as if it were an excellent fix.
 */
function optionalNumber(value: number): number | null {
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function toGpsSample(native: NativeSample): Omit<GpsSample, 'seq'> {
  return {
    lat: native.latitude,
    lng: native.longitude,
    timestamp: native.timestamp,
    accuracyM: optionalNumber(native.accuracy),
    speedMps: optionalNumber(native.speed),
    altitudeM: Number.isFinite(native.altitude) ? native.altitude : null,
    headingDeg: optionalNumber(native.heading),
    isMock: Boolean(native.isMock),
  };
}

class NativeWalkTracker implements LocationTracker {
  private readonly emitter: NativeEventEmitter | null;
  private readonly listeners = new Map<
    keyof LocationTrackerEvents,
    Set<(...args: never[]) => void>
  >();
  private subscriptions: {remove(): void}[] = [];
  private lastDegradedWarningAt = 0;

  constructor() {
    this.emitter = nativeModule ? new NativeEventEmitter(NativeModules.WalkTracker) : null;
    this.bindNativeEvents();
  }

  private bindNativeEvents(): void {
    if (!this.emitter) {
      return;
    }

    this.subscriptions.push(
      this.emitter.addListener(NATIVE_EVENT.sample, (payload: unknown) => {
        const sample = toGpsSample(payload as NativeSample);
        this.emit('sample', sample);

        // FR-12's accuracy filter drops these downstream; the HUD still wants
        // to say "weak GPS" (doc 06 §8.3 — dense urban areas drift 20–40 m).
        // Throttled so a bad patch of street does not spam the UI.
        if (sample.accuracyM !== null && sample.accuracyM > 30) {
          const now = Date.now();
          if (now - this.lastDegradedWarningAt > 15_000) {
            this.lastDegradedWarningAt = now;
            this.emit('accuracyDegraded', sample.accuracyM);
          }
        }
      }),
    );

    this.subscriptions.push(
      this.emitter.addListener(NATIVE_EVENT.stopped, (raw: unknown) => {
        const payload = raw as {reason?: string} | undefined;
        const reason = (payload?.reason ?? 'error') as TrackingStopReason;
        logger.info('Tracking stopped', {reason});
        this.emit('stopped', reason);
      }),
    );

    this.subscriptions.push(
      this.emitter.addListener(NATIVE_EVENT.error, (raw: unknown) => {
        const payload = raw as {message?: string} | undefined;
        const message = payload?.message ?? 'Unknown location error';
        logger.error('Native location error', new Error(message));
        this.emit('error', message);
      }),
    );
  }

  private requireModule(): NativeWalkTrackerModule {
    if (!nativeModule) {
      throw new Error(
        'The native WalkTracker module is not linked. Rebuild the app ' +
          `(npm run ${Platform.OS}) — a Metro reload does not install native code.`,
      );
    }
    return nativeModule;
  }

  private emit<E extends keyof LocationTrackerEvents>(
    event: E,
    ...args: Parameters<LocationTrackerEvents[E]>
  ): void {
    const set = this.listeners.get(event);
    if (!set) {
      return;
    }
    for (const listener of set) {
      try {
        (listener as (...a: unknown[]) => void)(...args);
      } catch (error) {
        // One bad subscriber must not stop the others from seeing the sample —
        // losing a GPS point loses part of someone's walk.
        logger.error('Location listener threw', error, {event});
      }
    }
  }

  on<E extends keyof LocationTrackerEvents>(
    event: E,
    listener: LocationTrackerEvents[E],
  ): () => void {
    const set = this.listeners.get(event) ?? new Set();
    set.add(listener as (...args: never[]) => void);
    this.listeners.set(event, set);

    return () => {
      set.delete(listener as (...args: never[]) => void);
    };
  }

  async start(options: TrackingOptions): Promise<void> {
    logger.info('Starting tracking', {
      distanceFilterM: options.distanceFilterM,
      maxIntervalMs: options.maxIntervalMs,
    });
    await this.requireModule().start(options);
  }

  async pause(): Promise<void> {
    await this.requireModule().pause();
  }

  async resume(): Promise<void> {
    await this.requireModule().resume();
  }

  async stop(): Promise<void> {
    await this.requireModule().stop();
  }

  async getStatus(): Promise<TrackingStatus> {
    if (!nativeModule) {
      return {isTracking: false, isPaused: false, sampleCount: 0};
    }
    return nativeModule.getStatus();
  }

  async getCurrentPosition(): Promise<Omit<GpsSample, 'seq'>> {
    const native = await this.requireModule().getCurrentPosition(10_000);
    return toGpsSample(native);
  }

  /** Tears down every native subscription. Called only when the app shuts down. */
  destroy(): void {
    for (const subscription of this.subscriptions) {
      subscription.remove();
    }
    this.subscriptions = [];
    this.listeners.clear();
  }
}

export const locationTracker: LocationTracker = new NativeWalkTracker();

/** True when the native module is present — false in Jest and in Metro-only runs. */
export const isNativeTrackerAvailable = nativeModule !== undefined;
