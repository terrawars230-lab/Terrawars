import {WALK_LIMITS} from '@core/constants/gameConfig';
import type {GpsSample} from '@core/types/geo';

import {uploadPoints} from '../api/walkApi';

/**
 * Uploads a walk's points in batches, oldest first.
 *
 * A four-hour walk is thousands of rows; one insert that size is slow, likely
 * to time out on mobile data, and all-or-nothing. Batching means a dropped
 * connection costs one batch, and the (walk_id, seq) upsert makes re-sending
 * it free.
 *
 * Throws on the first failed batch. The caller decides what that means — the
 * periodic flush shrugs and tries again later, `finish` queues the claim —
 * but neither may call `finish_walk` on a partial route: the server would
 * judge the loop on points it never received.
 *
 * `onBatchUploaded` fires after each successful batch with the highest `seq`
 * it contained, so progress survives a failure part-way through.
 */
export async function uploadInBatches(
  walkId: string,
  samples: readonly GpsSample[],
  onBatchUploaded?: (throughSeq: number) => void,
): Promise<void> {
  const size = WALK_LIMITS.pointUploadBatchSize;
  for (let start = 0; start < samples.length; start += size) {
    const batch = samples.slice(start, start + size);
    await uploadPoints(walkId, batch);
    const last = batch[batch.length - 1];
    if (last && onBatchUploaded) {
      onBatchUploaded(last.seq);
    }
  }
}
