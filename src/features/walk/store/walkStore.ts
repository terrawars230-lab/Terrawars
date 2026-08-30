import {create} from 'zustand';

import {DEFAULT_GAME_CONFIG, WALK_LIMITS, type GameConfig} from '@core/constants/gameConfig';
import {createLogger} from '@core/logger/logger';
import {storage} from '@core/storage/storage';
import {StorageKeys} from '@core/storage/storageKeys';
import type {GpsSample, LatLng} from '@core/types/geo';
import {buildClaimPreview, haversineDistanceM, type ClaimPreview} from '@geo/index';

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
interface PersistedWalk {
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

    const previous = state.samples[state.samples.length - 1];
    const sample: GpsSample = {...incoming, seq: state.samples.length};

    // Running distance uses the RAW path so the HUD keeps ticking while the
    // user walks. GR-01's cleaning runs inside the preview, and the server
    // recomputes both from scratch.
    const stepM = previous ? haversineDistanceM(previous, sample) : 0;
    const samples = [...state.samples, sample];
    const distanceM = state.distanceM + stepM;

    const shouldRecompute = samples.length % PREVIEW_EVERY_N_SAMPLES === 0;
    const preview = shouldRecompute ? buildClaimPreview(samples, state.config) : state.preview;

    set({
      samples,
      distanceM,
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

/**
 * Adopts a walk recovered from disk (FR-15's "resume" branch).
 *
 * Distance is recomputed from the restored samples rather than persisted: a
 * kill between appending a sample and writing the distance would otherwise
 * leave the two permanently out of step.
 */
export function adoptRestoredWalk(restored: PersistedWalk, config: GameConfig): void {
  let distanceM = 0;
  for (let i = 1; i < restored.samples.length; i++) {
    distanceM += haversineDistanceM(restored.samples[i - 1]!, restored.samples[i]!);
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
    distanceM,
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
