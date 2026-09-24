import {ApiError} from '@core/api/ApiError';
import {DEFAULT_GAME_CONFIG, WALK_LIMITS} from '@core/constants/gameConfig';
import {initI18n} from '@core/i18n/index';
import {runSignedOutCleanups, setSessionUserId} from '@core/session/session';
import {storage} from '@core/storage/storage';
import {StorageKeys} from '@core/storage/storageKeys';
import type {GpsSample} from '@core/types/geo';
import type {LocationTrackerEvents} from '@services/location/types';

import {
  discardCurrentWalk,
  finishCurrentWalk,
  onWalkRecorderEvent,
  resumeWalk,
  startNewWalk,
  startWalkRecorderService,
  type WalkRecorderEvent,
} from '../services/walkRecorder';
import {useWalkStore} from '../store/walkStore';

/**
 * The walk recorder: the part of the app that turns GPS fixes into a claim.
 *
 * Every case below is a way a real walk used to be lost or misjudged:
 * points dropped while the walk screen was not mounted, `finish_walk` run on a
 * route missing its last batches, an interrupted walk that "resumed" into a
 * tracker that no longer existed, a double tap submitting twice.
 */

type Listener = (...args: never[]) => void;

jest.mock('@services/location/nativeWalkTracker', () => {
  const listeners = new Map<string, Set<Listener>>();
  return {
    locationTracker: {
      on: jest.fn((event: string, listener: Listener) => {
        const set = listeners.get(event) ?? new Set<Listener>();
        set.add(listener);
        listeners.set(event, set);
        return () => set.delete(listener);
      }),
      start: jest.fn(),
      stop: jest.fn(),
      pause: jest.fn(),
      resume: jest.fn(),
      getStatus: jest.fn(),
      updateNotification: jest.fn(),
      getCurrentPosition: jest.fn(),
      __emit: (event: string, ...args: unknown[]) => {
        for (const listener of listeners.get(event) ?? []) {
          (listener as (...a: unknown[]) => void)(...args);
        }
      },
    },
    isNativeTrackerAvailable: true,
  };
});

jest.mock('@features/walk/api/walkApi', () => ({
  startWalk: jest.fn(),
  finishWalk: jest.fn(),
  uploadPoints: jest.fn(),
  abandonWalk: jest.fn(),
}));

jest.mock('@core/api/queryClient', () => ({
  queryClient: {invalidateQueries: jest.fn()},
}));

const tracker = jest.requireMock('@services/location/nativeWalkTracker').locationTracker as {
  start: jest.Mock;
  stop: jest.Mock;
  pause: jest.Mock;
  resume: jest.Mock;
  getStatus: jest.Mock;
  updateNotification: jest.Mock;
  __emit: <E extends keyof LocationTrackerEvents>(
    event: E,
    ...args: Parameters<LocationTrackerEvents[E]>
  ) => void;
};

const walkApi = jest.requireMock('@features/walk/api/walkApi') as {
  startWalk: jest.Mock;
  finishWalk: jest.Mock;
  uploadPoints: jest.Mock;
  abandonWalk: jest.Mock;
};

const {queryClient} = jest.requireMock('@core/api/queryClient') as {
  queryClient: {invalidateQueries: jest.Mock};
};

const START = 1_772_000_000_000;
const METRE_IN_DEG = 1 / 111_320;

function fix(northM: number, afterMs: number): Omit<GpsSample, 'seq'> {
  return {
    lat: 31.5204 + northM * METRE_IN_DEG,
    lng: 74.3587,
    timestamp: START + afterMs,
    accuracyM: 6,
    speedMps: 1.4,
    altitudeM: 210,
    headingDeg: 0,
    isMock: false,
  };
}

function acceptedResult() {
  return {
    status: 'accepted' as const,
    claimId: 'claim-1',
    walk: {id: 'walk-1', distanceM: 800, durationS: 600, avgSpeedMps: 1.3, pointCount: 250},
    rawAreaM2: 40_000,
    netAreaGainM2: 40_000,
    stolenAreaM2: 0,
    geometry: null,
    steals: [],
    blocked: [],
    stats: null,
  };
}

/** Puts a live walk with `count` recorded samples in the store. */
function recordWalk(count: number): void {
  useWalkStore.getState().reset();
  useWalkStore.getState().setConfig(DEFAULT_GAME_CONFIG);
  useWalkStore.getState().begin('walk-1', 'client-1');
  for (let i = 0; i < count; i++) {
    tracker.__emit('sample', fix(i * 4, i * 3000));
  }
}

let stopService: () => void;

beforeAll(() => {
  initI18n();
  stopService = startWalkRecorderService();
});

afterAll(() => {
  stopService();
});

beforeEach(() => {
  jest.resetAllMocks();
  storage.clearAll();
  setSessionUserId('user-1');
  useWalkStore.getState().reset();
  tracker.start.mockResolvedValue(undefined);
  tracker.stop.mockResolvedValue(undefined);
  tracker.pause.mockResolvedValue(undefined);
  tracker.resume.mockResolvedValue(undefined);
  tracker.getStatus.mockResolvedValue({isTracking: true, isPaused: false, sampleCount: 0});
  tracker.updateNotification.mockResolvedValue(undefined);
  walkApi.startWalk.mockResolvedValue({walkId: 'walk-1', resumed: false});
  walkApi.finishWalk.mockResolvedValue(acceptedResult());
  walkApi.uploadPoints.mockResolvedValue(1);
  walkApi.abandonWalk.mockResolvedValue(undefined);
});

describe('recording', () => {
  it('records every fix with no walk screen mounted', () => {
    // The service is the only subscriber here — exactly the state the app is
    // in while the player looks at the map mid-walk.
    recordWalk(5);
    expect(useWalkStore.getState().samples).toHaveLength(5);
    // FR-15: each one is on disk, not only in memory.
    expect(storage.has(StorageKeys.activeWalk)).toBe(true);
  });

  it('records nothing while paused (FR-16)', () => {
    recordWalk(2);
    useWalkStore.getState().pause();

    tracker.__emit('sample', fix(100, 60_000));

    expect(useWalkStore.getState().samples).toHaveLength(2);
  });

  it('pauses the walk when the OS kills tracking, and says so', () => {
    const events: WalkRecorderEvent[] = [];
    const unsubscribe = onWalkRecorderEvent(event => events.push(event));
    recordWalk(3);

    tracker.__emit('stopped', 'killed-by-system');

    expect(useWalkStore.getState().phase).toBe('paused');
    expect(events).toContainEqual({type: 'trackerStopped', reason: 'killed-by-system'});
    unsubscribe();
  });

  it('auto-ends once at the FR-19 distance cap, however many fixes follow', () => {
    const events: WalkRecorderEvent[] = [];
    const unsubscribe = onWalkRecorderEvent(event => events.push(event));
    recordWalk(1);
    useWalkStore.setState({distanceM: WALK_LIMITS.maxDistanceM + 1});

    tracker.__emit('sample', fix(4, 3000));
    tracker.__emit('sample', fix(8, 6000));
    tracker.__emit('sample', fix(12, 9000));

    expect(events.filter(event => event.type === 'autoEnded')).toEqual([
      {type: 'autoEnded', reason: 'distance'},
    ]);
    expect(useWalkStore.getState().autoEndReason).toBe('distance');
    expect(tracker.stop).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});

describe('startNewWalk', () => {
  it('rolls the walk back when the tracker refuses to start', async () => {
    tracker.start.mockRejectedValue(new Error('E_PERMISSION'));

    await expect(startNewWalk()).rejects.toThrow('E_PERMISSION');

    // Not left "recording" with nothing feeding it.
    expect(useWalkStore.getState().phase).toBe('idle');
    expect(walkApi.abandonWalk).toHaveBeenCalledWith('walk-1');
  });
});

describe('resumeWalk', () => {
  it('restarts the native tracker when it is no longer running (FR-15)', async () => {
    recordWalk(3);
    useWalkStore.getState().pause();
    tracker.getStatus.mockResolvedValue({isTracking: false, isPaused: false, sampleCount: 0});

    await resumeWalk();

    // A bare resume() would un-pause a tracker that does not exist.
    expect(tracker.start).toHaveBeenCalledTimes(1);
    expect(tracker.resume).not.toHaveBeenCalled();
    expect(useWalkStore.getState().phase).toBe('recording');
  });

  it('resumes a tracker that is still running', async () => {
    recordWalk(3);
    useWalkStore.getState().pause();

    await resumeWalk();

    expect(tracker.resume).toHaveBeenCalledTimes(1);
    expect(tracker.start).not.toHaveBeenCalled();
  });

  it('stays paused when the tracker cannot restart', async () => {
    recordWalk(3);
    useWalkStore.getState().pause();
    tracker.getStatus.mockResolvedValue({isTracking: false, isPaused: false, sampleCount: 0});
    tracker.start.mockRejectedValue(new Error('E_PERMISSION'));

    await expect(resumeWalk()).rejects.toThrow('E_PERMISSION');
    expect(useWalkStore.getState().phase).toBe('paused');
  });

  it('will not resume a walk that an FR-19 cap ended', async () => {
    recordWalk(3);
    useWalkStore.getState().markAutoEnded('duration');

    await resumeWalk();

    expect(tracker.start).not.toHaveBeenCalled();
    expect(tracker.resume).not.toHaveBeenCalled();
  });
});

describe('finishCurrentWalk', () => {
  it('uploads EVERY pending point before asking for a verdict', async () => {
    recordWalk(450);
    const order: string[] = [];
    walkApi.uploadPoints.mockImplementation(async (_walkId: string, batch: GpsSample[]) => {
      order.push(`upload:${batch.length}`);
      return batch.length;
    });
    walkApi.finishWalk.mockImplementation(async () => {
      order.push('finish');
      return acceptedResult();
    });

    const outcome = await finishCurrentWalk();

    // 450 points in 200-row batches, all of them, THEN finish_walk.
    expect(order).toEqual(['upload:200', 'upload:200', 'upload:50', 'finish']);
    expect(outcome).toEqual({kind: 'resolved', result: acceptedResult()});
    expect(useWalkStore.getState().phase).toBe('idle');
    expect(storage.has(StorageKeys.activeWalk)).toBe(false);
    expect(queryClient.invalidateQueries).toHaveBeenCalled();
  });

  it('queues the claim, with only the unsent points, when the network drops', async () => {
    recordWalk(450);
    walkApi.uploadPoints
      .mockResolvedValueOnce(200)
      .mockRejectedValueOnce(new ApiError('NETWORK_UNAVAILABLE', 'No connection'));

    const outcome = await finishCurrentWalk();

    expect(outcome).toEqual({kind: 'queued'});
    expect(walkApi.finishWalk).not.toHaveBeenCalled();

    const queue = storage.getObject<{samples: GpsSample[]; userId: string}[]>(
      StorageKeys.pendingClaims,
    );
    expect(queue).toHaveLength(1);
    // The first batch reached the server; the queue carries the other 250.
    expect(queue![0]!.samples).toHaveLength(250);
    expect(queue![0]!.samples[0]!.seq).toBe(200);
    expect(queue![0]!.userId).toBe('user-1');
    expect(useWalkStore.getState().phase).toBe('idle');
  });

  it('queues the claim when the session has expired', async () => {
    recordWalk(10);
    walkApi.finishWalk.mockRejectedValue(
      new ApiError('UNAUTHENTICATED', 'Sign in again', {httpStatus: 401}),
    );

    await expect(finishCurrentWalk()).resolves.toEqual({kind: 'queued'});
  });

  it('reports a walk that can no longer be claimed, and clears it', async () => {
    recordWalk(10);
    walkApi.finishWalk.mockRejectedValue(
      new ApiError('WALK_ALREADY_FINISHED', 'Walk already finished'),
    );

    await expect(finishCurrentWalk()).rejects.toMatchObject({code: 'WALK_ALREADY_FINISHED'});
    expect(useWalkStore.getState().phase).toBe('idle');
    expect(storage.getObject(StorageKeys.pendingClaims)).toBeNull();
  });

  it('submits once, however many times it is asked', async () => {
    recordWalk(10);

    const first = finishCurrentWalk();
    await expect(finishCurrentWalk()).rejects.toThrow('no walk in progress');
    await first;

    expect(walkApi.finishWalk).toHaveBeenCalledTimes(1);
  });

  it('stops tracking before it submits', async () => {
    recordWalk(10);

    await finishCurrentWalk();

    expect(tracker.stop).toHaveBeenCalled();
  });
});

describe('discard and sign-out', () => {
  it('discards locally even when the server cannot be told (FR-17)', async () => {
    recordWalk(5);
    walkApi.abandonWalk.mockRejectedValue(new ApiError('NETWORK_UNAVAILABLE', 'offline'));

    await discardCurrentWalk();

    expect(tracker.stop).toHaveBeenCalled();
    expect(useWalkStore.getState().phase).toBe('idle');
    expect(storage.has(StorageKeys.activeWalk)).toBe(false);
  });

  it('ends a walk in progress when the session ends', async () => {
    recordWalk(5);

    await runSignedOutCleanups();

    expect(tracker.stop).toHaveBeenCalled();
    expect(useWalkStore.getState().phase).toBe('idle');
    expect(storage.has(StorageKeys.activeWalk)).toBe(false);
  });
});
