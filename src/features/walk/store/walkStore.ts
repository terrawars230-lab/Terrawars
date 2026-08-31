import {create} from 'zustand';

import {DEFAULT_GAME_CONFIG, WALK_LIMITS, type GameConfig} from '@core/constants/gameConfig';
import {createLogger} from '@core/logger/logger';
import {storage} from '@core/storage/storage';
import {StorageKeys} from '@core/storage/storageKeys';
import type {GpsSample, LatLng} from '@core/types/geo';
import {
  buildClaimPreview,
  haversineDistanceM,
  JITTER_THRESHOLD_M,
  type ClaimPreview,
} from '@geo/index';

/**
 * The in-progress walk.
 *
 * FR-15 is the constraint that shapes this whole file: *points are persisted to
 * local storage immediately, so an app crash or kill does not lose the walk*.
 * Every accepted sample is written to MMKV synchronously in the same tick it
 * arrives. That is why storage is MMKV rather than AsyncStorage — an async
 * bridge hop every five metres for four hours is both jank and battery
 * (NFR-01).
 *
 * The claim preview here is ADVISORY. It drives the live HUD (FR-14) and the
 * "claim now" prompt (FR-18); the server decides the outcome (D-05).
 */

const logger = createLogger('walk-store');

export type WalkPhase = 'idle' | 'recording' | 'paused' | 'finishing';

/** The shape persisted to disk. Versioned via its storage key. */
export interface PersistedWalk {
  walkId: string;
  clientWalkId: string;
  startedAt: number;
  /** Accumulated paused milliseconds, excluded from duration (FR-16). */
  pausedMs: number;
  samples: GpsSample[];
  /** Highest seq uploaded to the server; everything after it is pending. */
  uploadedThroughSeq: number;
}

interface WalkState {
  phase: WalkPhase;
  walkId: string | null;
  clientWalkId: string | null;
  startedAt: number | null;
  pausedMs: number;
  pausedAt: number | null;

  samples: GpsSample[];
  distanceM: number;
  uploadedThroughSeq: number;

  /**
   * Last sample that actually moved `distanceM`.
   *
   * The HUD distance is measured against this, not against the previous raw
   * sample, so a fix rejected as jitter or as a teleport does not become
   * distance the user never walked (GR-01 steps 1, 4 and 5).
   */
  distanceAnchor: GpsSample | null;

  /**
   * `(timestamp, cumulative distance)` marks inside the rolling pace window.
   *
   * One is pushed for every sample that passes the accuracy gate, moved or
   * not — a standing-still sample pushes a mark with an unchanged distance,
   * which is what makes the pace decay to zero instead of freezing at whatever
   * it read when the user stopped.
   */
  paceMarks: {t: number; d: number}[];

  /** Advisory preview, recomputed as the path grows (FR-14). */
  preview: ClaimPreview | null;
  config: GameConfig;

  /** Set when GR-02 reports a closed loop, so the UI can prompt (FR-18). */
  canClaim: boolean;

  begin: (walkId: string, clientWalkId: string) => void;
  addSample: (sample: Omit<GpsSample, 'seq'>) => void;
  pause: () => void;
  resume: () => void;
  reset: () => void;

  setConfig: (config: GameConfig) => void;
  markUploaded: (throughSeq: number) => void;

  /** Points not yet accepted by the server. */
  pendingSamples: () => GpsSample[];
  /** Elapsed walk time in seconds, excluding paused time (FR-16). */
  elapsedSeconds: () => number;
  /**
   * Live speed over the last PACE_WINDOW_MS, in m/s.
   *
   * A whole-walk average is not a pace: it is dragged down for minutes by the
   * dead time before the first fix, and it barely moves when the user actually
   * speeds up or stops. The HUD wants the recent window.
   */
  recentSpeedMps: () => number;
  /** The path as plain coordinates, for the map polyline (FR-13). */
  pathCoordinates: () => LatLng[];

  /** FR-15: restores an interrupted walk on relaunch. */
  restoreFromDisk: () => PersistedWalk | null;
}

/**
 * How often the advisory preview is recomputed.
 *
 * Loop detection is O(n) per new point when run incrementally, but the full
 * preview also cleans and simplifies the whole path. At 5 m sampling that is
 * cheap for the first thousand points and not free at five thousand, so it
 * runs every few samples rather than on every one. The user cannot perceive
 * the difference; the battery can.
 */
const PREVIEW_EVERY_N_SAMPLES = 4;

/**
 * The window the live pace is measured over.
 *
 * Thirty seconds is long enough that a single noisy fix cannot swing the
 * readout and short enough that stopping at a crossing shows up within a few
 * seconds rather than at the end of the walk.
 */
const PACE_WINDOW_MS = 30_000;

/**
 * The pace readout stays blank until the window holds this much time. Dividing
 * a couple of metres by a couple of seconds produces a sprint, which is exactly
 * the "random speed" a user notices in the first moments of a walk.
 */
const PACE_MIN_SPAN_MS = 8_000;

export const useWalkStore = create<WalkState>((set, get) => ({
  phase: 'idle',
  walkId: null,
  clientWalkId: null,
  startedAt: null,
  pausedMs: 0,
  pausedAt: null,

  samples: [],
  distanceM: 0,
  uploadedThroughSeq: -1,
  distanceAnchor: null,
  paceMarks: [],

  preview: null,
  config: DEFAULT_GAME_CONFIG,
  canClaim: false,

  begin: (walkId, clientWalkId) => {
    set({
      phase: 'recording',
      walkId,
      clientWalkId,
      startedAt: Date.now(),
      pausedMs: 0,
      pausedAt: null,
      samples: [],
      distanceM: 0,
      uploadedThroughSeq: -1,
      distanceAnchor: null,
      paceMarks: [],
      preview: null,
      canClaim: false,
    });
    persist(get);
  },

  addSample: incoming => {
    const state = get();

    // FR-16: nothing is recorded while paused. The native side already gates
    // this, but a sample in flight when pause() lands would otherwise slip
    // through and add distance the user did not walk.
    if (state.phase !== 'recording' || state.walkId === null) {
      return;
    }

    const sample: GpsSample = {...incoming, seq: state.samples.length};

    // EVERY sample is kept and uploaded, however poor — the server re-cleans
    // the raw path and its verdict is the only one that counts (D-05). What
    // follows decides only what the HUD is allowed to *show*.
    const samples = [...state.samples, sample];

    const {distanceM, distanceAnchor, paceMarks} = measure(state, sample);

    const shouldRecompute = samples.length % PREVIEW_EVERY_N_SAMPLES === 0;
    const preview = shouldRecompute ? buildClaimPreview(samples, state.config) : state.preview;

    set({
      samples,
      distanceM,
      distanceAnchor,
      paceMarks,
      preview,
      canClaim: preview?.valid ?? false,
    });

    // FR-15: written on every single sample. An app kill on the next line must
    // not cost the user their walk.
    persist(get);
  },

  pause: () => {
    if (get().phase !== 'recording') {
      return;
    }
    set({phase: 'paused', pausedAt: Date.now()});
  },

  resume: () => {
    const {phase, pausedAt, pausedMs} = get();
    if (phase !== 'paused') {
      return;
    }
    set({
      phase: 'recording',
      pausedMs: pausedMs + (pausedAt ? Date.now() - pausedAt : 0),
      pausedAt: null,
    });
    persist(get);
  },

  reset: () => {
    storage.remove(StorageKeys.activeWalk);
    set({
      phase: 'idle',
      walkId: null,
      clientWalkId: null,
      startedAt: null,
      pausedMs: 0,
      pausedAt: null,
      samples: [],
      distanceM: 0,
      uploadedThroughSeq: -1,
      distanceAnchor: null,
      paceMarks: [],
      preview: null,
      canClaim: false,
    });
  },

  setConfig: config => {
    set({config});
  },

  markUploaded: throughSeq => {
    set({uploadedThroughSeq: Math.max(get().uploadedThroughSeq, throughSeq)});
    persist(get);
  },

  pendingSamples: () => {
    const {samples, uploadedThroughSeq} = get();
    return samples.filter(sample => sample.seq > uploadedThroughSeq);
  },

  elapsedSeconds: () => {
    const {startedAt, pausedMs, pausedAt, phase} = get();
    if (startedAt === null) {
      return 0;
    }
    const pausedSoFar = pausedMs + (phase === 'paused' && pausedAt ? Date.now() - pausedAt : 0);
    return Math.max(0, Math.floor((Date.now() - startedAt - pausedSoFar) / 1000));
  },

  recentSpeedMps: () => {
    const {paceMarks, phase} = get();

    // A paused walk has no speed; showing the last one would be a lie.
    if (phase !== 'recording' || paceMarks.length < 2) {
      return 0;
    }

    const first = paceMarks[0]!;
    const last = paceMarks[paceMarks.length - 1]!;
    const spanMs = last.t - first.t;

    if (spanMs < PACE_MIN_SPAN_MS) {
      return 0;
    }

    // Measured to the newest mark rather than to `Date.now()`: a gap in the
    // fixes (a tunnel, a dropped service) must not be read as standing still.
    // Samples arrive at least every WALK_LIMITS.samplingMaxIntervalMs, so the
    // window is never more than one interval stale.
    return Math.max(0, (last.d - first.d) / (spanMs / 1000));
  },

  pathCoordinates: () => get().samples.map(({lat, lng}) => ({lat, lng})),

  restoreFromDisk: () => {
    const stored = storage.getObject<PersistedWalk>(StorageKeys.activeWalk);
    if (!stored || !Array.isArray(stored.samples)) {
      return null;
    }

    // A walk older than the FR-19 four-hour cap cannot be resumed sensibly —
    // its duration would already exceed the limit. Drop it rather than offering
    // the user a resume that will be auto-ended a second later.
    const age = Date.now() - stored.startedAt;
    if (age > WALK_LIMITS.maxDurationMs) {
      logger.info('Discarding an expired interrupted walk', {ageHours: age / 3_600_000});
      storage.remove(StorageKeys.activeWalk);
      return null;
    }

    return stored;
  },
}));

/** What one sample does to the HUD readouts. */
interface Measurement {
  distanceM: number;
  distanceAnchor: GpsSample | null;
  paceMarks: {t: number; d: number}[];
}

/**
 * Decides whether a sample is allowed to move the distance readout.
 *
 * This mirrors GR-01 steps 1, 3, 4 and 5 — the same gates the server's cleaning
 * pass applies — rather than summing the raw path. Summing raw was the bug
 * behind two symptoms users actually report: distance that climbs while the
 * phone sits still on a table, and a pace derived from it that reads as random.
 * A consumer GPS wanders several metres between fixes even at a standstill, and
 * at one fix every five seconds that is a few hundred metres of imaginary walk
 * per hour.
 *
 * It stays deliberately cheaper than `cleanSamples`: one comparison against the
 * anchor, no re-sort and no re-scan of the whole path, because it runs on every
 * sample for up to four hours (FR-19).
 */
function measure(state: WalkState, sample: GpsSample): Measurement {
  const {config} = state;
  let {distanceM, distanceAnchor} = state;

  // GR-01(1) and (2): a fix worse than the accuracy gate, or one from a mock
  // provider, tells us nothing about where the user is. It is still recorded
  // and uploaded — it just does not get to move the number on screen.
  const trustworthy =
    !sample.isMock && (sample.accuracyM === null || sample.accuracyM <= config.maxAccuracyM);

  if (!trustworthy) {
    return {distanceM, distanceAnchor, paceMarks: state.paceMarks};
  }

  if (!distanceAnchor) {
    distanceAnchor = sample;
  } else {
    const stepM = haversineDistanceM(distanceAnchor, sample);
    const elapsedS = (sample.timestamp - distanceAnchor.timestamp) / 1000;
    // GR-01(3): a duplicate timestamp yields an infinite speed and is dropped
    // by the burst check below, which is the behaviour we want.
    const stepSpeedMps = elapsedS > 0 ? stepM / elapsedS : Number.POSITIVE_INFINITY;

    if (stepSpeedMps > config.maxBurstSpeedMps) {
      // GR-01(5): a teleport. Drop it and keep the anchor where it was, so the
      // next good fix re-links from the last place we believed.
      logger.debug('Dropped a teleport from the HUD readout', {stepM, stepSpeedMps});
    } else if (stepM >= JITTER_THRESHOLD_M) {
      // GR-01(4): below the jitter floor this is noise, not walking.
      distanceM += stepM;
      distanceAnchor = sample;
    }
  }

  // A mark for every trustworthy sample, moved or not — see `paceMarks`.
  const marks = [...state.paceMarks, {t: sample.timestamp, d: distanceM}];
  const cutoff = sample.timestamp - PACE_WINDOW_MS;
  // Keep one mark at or before the cutoff so the window always spans it.
  const firstInWindow = marks.findIndex(mark => mark.t >= cutoff);
  const paceMarks = firstInWindow > 0 ? marks.slice(firstInWindow - 1) : marks;

  return {distanceM, distanceAnchor, paceMarks};
}

/**
 * Adopts a walk recovered from disk (FR-15's "resume" branch).
 *
 * Distance is recomputed from the restored samples rather than persisted: a
 * kill between appending a sample and writing the distance would otherwise
 * leave the two permanently out of step.
 */
export function adoptRestoredWalk(restored: PersistedWalk, config: GameConfig): void {
  // Replayed through `measure` rather than summed raw, so a resumed walk shows
  // the same distance it would have shown had it never been interrupted.
  let running: Measurement = {distanceM: 0, distanceAnchor: null, paceMarks: []};
  for (const sample of restored.samples) {
    running = measure({...useWalkStore.getState(), ...running, config}, sample);
  }

  const preview = buildClaimPreview(restored.samples, config);

  useWalkStore.setState({
    phase: 'paused',
    walkId: restored.walkId,
    clientWalkId: restored.clientWalkId,
    startedAt: restored.startedAt,
    pausedMs: restored.pausedMs,
    pausedAt: Date.now(),
    samples: restored.samples,
    distanceM: running.distanceM,
    distanceAnchor: running.distanceAnchor,
    paceMarks: running.paceMarks,
    uploadedThroughSeq: restored.uploadedThroughSeq,
    preview,
    canClaim: preview.valid,
    config,
  });

  logger.info('Restored an interrupted walk', {sampleCount: restored.samples.length});
}

function persist(get: () => WalkState): void {
  const {walkId, clientWalkId, startedAt, pausedMs, samples, uploadedThroughSeq} = get();
  if (!walkId || !clientWalkId || startedAt === null) {
    return;
  }

  storage.setObject(StorageKeys.activeWalk, {
    walkId,
    clientWalkId,
    startedAt,
    pausedMs,
    samples,
    uploadedThroughSeq,
  } satisfies PersistedWalk);
}
