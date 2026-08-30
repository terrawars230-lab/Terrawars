import type {GpsSample} from '@core/types/geo';

/**
 * The contract between the app and whatever is actually reading the GPS.
 *
 * Deliberately narrow. The native side owns the hard parts — Android's
 * foreground service, iOS's background location mode, the OEM battery
 * behaviour in doc 06 §8.2 — and exposes only this. Everything above the
 * boundary (buffering, persistence, upload, geometry) is TypeScript, testable
 * without a device.
 */

export interface TrackingOptions {
  /** FR-12: distance filter in metres. */
  distanceFilterM: number;
  /** FR-12: emit at least this often even standing still, milliseconds. */
  maxIntervalMs: number;
  /**
   * Text for the Android foreground-service notification (FR-11). Passed in
   * rather than hardcoded natively so it goes through the localisation layer
   * (NFR-11).
   */
  notificationTitle: string;
  notificationBody: string;
}

/** Why tracking stopped without the app asking it to. */
export type TrackingStopReason =
  | 'user'
  | 'permission-revoked'
  | 'location-services-disabled'
  /** doc 06 §8.2: Xiaomi/Oppo/Vivo/Samsung killing the service despite policy. */
  | 'killed-by-system'
  | 'error';

export interface TrackingStatus {
  isTracking: boolean;
  isPaused: boolean;
  /** Samples emitted since `start`. Useful for a "no fix yet" state. */
  sampleCount: number;
}

export interface LocationTrackerEvents {
  /** A cleaned-enough sample. Ordering and `seq` are assigned by the recorder. */
  sample: (sample: Omit<GpsSample, 'seq'>) => void;
  /** The platform reports a degraded fix. Drives the "weak GPS" HUD hint. */
  accuracyDegraded: (accuracyM: number) => void;
  stopped: (reason: TrackingStopReason) => void;
  error: (message: string) => void;
}

export interface LocationTracker {
  start(options: TrackingOptions): Promise<void>;
  /** FR-16: paused time does not count and no points are recorded. */
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;
  /**
   * Updates the Android foreground-service notification text (FR-11).
   *
   * Separate from `start` on purpose: re-calling `start` to refresh the text
   * would tear down and re-register the location request, resetting the
   * sampling cadence every time the HUD ticks. No-op on iOS, where the blue
   * status-bar indicator plays this role and carries no text of ours.
   */
  updateNotification(title: string, body: string): Promise<void>;
  getStatus(): Promise<TrackingStatus>;
  /** One-shot fix, used to centre the map before a walk starts (FR-53). */
  getCurrentPosition(): Promise<Omit<GpsSample, 'seq'>>;

  on<E extends keyof LocationTrackerEvents>(
    event: E,
    listener: LocationTrackerEvents[E],
  ): () => void;
}
