import NetInfo from '@react-native-community/netinfo';

import {ApiError} from '@core/api/ApiError';
import {WALK_LIMITS} from '@core/constants/gameConfig';
import {storage} from '@core/storage/storage';
import {StorageKeys} from '@core/storage/storageKeys';
import type {GpsSample} from '@core/types/geo';
import {enqueueClaim, flushQueue, queuedClaimCount} from '@features/walk/services/claimQueue';

jest.mock('@features/walk/api/walkApi', () => ({
  uploadPoints: jest.fn(),
  finishWalk: jest.fn(),
}));

const walkApi = jest.requireMock('@features/walk/api/walkApi') as {
  uploadPoints: jest.Mock;
  finishWalk: jest.Mock;
};

const netInfo = NetInfo as unknown as {fetch: jest.Mock};

function sample(seq: number): GpsSample {
  return {
    seq,
    lat: 31.5204,
    lng: 74.3587,
    timestamp: 1_772_000_000_000 + seq * 5000,
    accuracyM: 8,
    speedMps: 1.4,
    altitudeM: 217,
    headingDeg: null,
    isMock: false,
  };
}

function acceptedResult() {
  return {status: 'accepted', claimId: 'claim-1', netAreaGainM2: 41_000};
}

beforeEach(() => {
  storage.clearAll();
  walkApi.uploadPoints.mockReset().mockResolvedValue(1);
  walkApi.finishWalk.mockReset().mockResolvedValue(acceptedResult());
  netInfo.fetch.mockReset().mockResolvedValue({isConnected: true, isInternetReachable: true});
});

/**
 * FR-20: "If the device is offline at the end of a walk, the claim is queued and
 * submitted automatically when connectivity returns (queue survives app
 * restart, max age 24 h)."
 *
 * NFR-08 makes this load-bearing rather than a nicety — the app must record a
 * full walk with zero connectivity and sync later. Every case below is one a
 * real walker hits: a tunnel, a dead battery on the router at home, a phone
 * that was killed between the walk and the sync.
 */
describe('claimQueue', () => {
  it('queues a claim and reports it', () => {
    enqueueClaim({walkId: 'walk-1', idempotencyKey: 'key-1', samples: [sample(0)]});
    expect(queuedClaimCount()).toBe(1);
  });

  it('persists the queue so it survives an app restart', () => {
    enqueueClaim({walkId: 'walk-1', idempotencyKey: 'key-1', samples: [sample(0)]});

    // Reading straight from storage is what a cold start does.
    const persisted = storage.getObject<unknown[]>(StorageKeys.pendingClaims);
    expect(persisted).toHaveLength(1);
  });

  it('replaces rather than duplicates when the same walk is queued twice', () => {
    enqueueClaim({walkId: 'walk-1', idempotencyKey: 'key-1', samples: [sample(0)]});
    enqueueClaim({walkId: 'walk-1', idempotencyKey: 'key-2', samples: [sample(0), sample(1)]});

    // Two entries for one walk would show the user the result screen twice.
    expect(queuedClaimCount()).toBe(1);
  });

  it('drops entries past the 24 h ceiling', () => {
    const stale = [
      {
        walkId: 'old',
        idempotencyKey: 'key-old',
        samples: [],
        attempts: 0,
        queuedAt: Date.now() - WALK_LIMITS.offlineQueueMaxAgeMs - 1000,
      },
    ];
    storage.setObject(StorageKeys.pendingClaims, stale);

    expect(queuedClaimCount()).toBe(0);
  });

  it('keeps an entry that is just inside the ceiling', () => {
    storage.setObject(StorageKeys.pendingClaims, [
      {
        walkId: 'recent',
        idempotencyKey: 'key',
        samples: [],
        attempts: 0,
        queuedAt: Date.now() - WALK_LIMITS.offlineQueueMaxAgeMs + 60_000,
      },
    ]);

    expect(queuedClaimCount()).toBe(1);
  });

  describe('flushQueue', () => {
    it('does nothing when the queue is empty', async () => {
      await expect(flushQueue()).resolves.toEqual([]);
      expect(walkApi.finishWalk).not.toHaveBeenCalled();
    });

    it('does not attempt a submission while offline', async () => {
      netInfo.fetch.mockResolvedValue({isConnected: false, isInternetReachable: false});
      enqueueClaim({walkId: 'walk-1', idempotencyKey: 'key-1', samples: [sample(0)]});

      await flushQueue();

      expect(walkApi.finishWalk).not.toHaveBeenCalled();
      // Critically, the entry is still there — an offline flush must not consume it.
      expect(queuedClaimCount()).toBe(1);
    });

    it('treats connected-but-unreachable as offline', async () => {
      // A captive portal reports connected. Submitting into it would burn the
      // retry and lose nothing but time — but the entry must survive.
      netInfo.fetch.mockResolvedValue({isConnected: true, isInternetReachable: false});
      enqueueClaim({walkId: 'walk-1', idempotencyKey: 'key-1', samples: [sample(0)]});

      await flushQueue();

      expect(walkApi.finishWalk).not.toHaveBeenCalled();
      expect(queuedClaimCount()).toBe(1);
    });

    it('uploads points before finishing the walk', async () => {
      const order: string[] = [];
      walkApi.uploadPoints.mockImplementation(async () => {
        order.push('upload');
      });
      walkApi.finishWalk.mockImplementation(async () => {
        order.push('finish');
        return acceptedResult();
      });

      enqueueClaim({
        walkId: 'walk-1',
        idempotencyKey: 'key-1',
        samples: [sample(0), sample(1)],
      });
      await flushQueue();

      // A walk recorded entirely offline has uploaded nothing yet, so
      // finish_walk would find no points to build a polygon from.
      expect(order).toEqual(['upload', 'finish']);
    });

    it('reuses the stored idempotency key so a retry cannot double-apply', async () => {
      enqueueClaim({walkId: 'walk-1', idempotencyKey: 'stable-key', samples: []});
      await flushQueue();

      expect(walkApi.finishWalk).toHaveBeenCalledWith('walk-1', 'stable-key');
    });

    it('clears an entry once it resolves', async () => {
      enqueueClaim({walkId: 'walk-1', idempotencyKey: 'key-1', samples: [sample(0)]});

      const results = await flushQueue();

      expect(results).toHaveLength(1);
      expect(queuedClaimCount()).toBe(0);
    });

    it('keeps an entry when the failure is retryable', async () => {
      walkApi.finishWalk.mockRejectedValue(new ApiError('NETWORK_UNAVAILABLE', 'No connection'));
      enqueueClaim({walkId: 'walk-1', idempotencyKey: 'key-1', samples: []});

      await flushQueue();

      expect(queuedClaimCount()).toBe(1);
    });

    it('drops an entry the server refused on a rule', async () => {
      // doc 05 §7: a 422 is a final answer. Retrying it forever would spin
      // against a verdict that cannot change.
      walkApi.finishWalk.mockRejectedValue(
        new ApiError('ERR_LOOP_NOT_CLOSED', 'Not a loop', {httpStatus: 422}),
      );
      enqueueClaim({walkId: 'walk-1', idempotencyKey: 'key-1', samples: []});

      await flushQueue();

      expect(queuedClaimCount()).toBe(0);
    });

    it('keeps an entry when the session expired, so it survives re-auth', async () => {
      walkApi.finishWalk.mockRejectedValue(
        new ApiError('UNAUTHENTICATED', 'Sign in again', {httpStatus: 401}),
      );
      enqueueClaim({walkId: 'walk-1', idempotencyKey: 'key-1', samples: []});

      await flushQueue();

      expect(queuedClaimCount()).toBe(1);
    });

    it('does not let one failing entry block the others', async () => {
      walkApi.finishWalk
        .mockRejectedValueOnce(new ApiError('INTERNAL', 'boom', {httpStatus: 500}))
        .mockResolvedValueOnce(acceptedResult());

      enqueueClaim({walkId: 'walk-1', idempotencyKey: 'key-1', samples: []});
      enqueueClaim({walkId: 'walk-2', idempotencyKey: 'key-2', samples: []});

      const results = await flushQueue();

      expect(results).toHaveLength(1);
      expect(queuedClaimCount()).toBe(1);
    });

    it('batches a long walk rather than sending one huge insert', async () => {
      const many = Array.from({length: 450}, (_, i) => sample(i));
      enqueueClaim({walkId: 'walk-1', idempotencyKey: 'key-1', samples: many});

      await flushQueue();

      // 450 points at a 200-row batch size is three calls.
      expect(walkApi.uploadPoints).toHaveBeenCalledTimes(3);
      expect(walkApi.uploadPoints.mock.calls[0]![1]).toHaveLength(WALK_LIMITS.pointUploadBatchSize);
    });
  });
});
