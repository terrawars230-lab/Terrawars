import {RESULTS, check, request} from 'react-native-permissions';

import {storage} from '@core/storage/storage';
import {StorageKeys} from '@core/storage/storageKeys';

import {requestMotionPermissionOnce} from '../permissions';

/**
 * The ask-once rule for motion.
 *
 * Worth a test because the failure is invisible in code review and loud in
 * use: the walk flow runs before every walk, so a permission asked "once per
 * call site" is a system dialog every single time the user goes out.
 */

jest.mock('react-native-permissions', () => {
  const actual = jest.requireActual('react-native-permissions/mock');
  return {
    ...actual,
    check: jest.fn(),
    request: jest.fn(),
  };
});

const mockCheck = check as jest.MockedFunction<typeof check>;
const mockRequest = request as jest.MockedFunction<typeof request>;

describe('requestMotionPermissionOnce', () => {
  beforeEach(() => {
    storage.remove(StorageKeys.motionPermissionAsked);
    mockCheck.mockReset();
    mockRequest.mockReset();
  });

  it('asks the system the first time', async () => {
    mockRequest.mockResolvedValue(RESULTS.GRANTED);

    await expect(requestMotionPermissionOnce()).resolves.toBe('granted');
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('never asks again, even after a denial', async () => {
    mockRequest.mockResolvedValue(RESULTS.DENIED);
    await requestMotionPermissionOnce();

    mockCheck.mockResolvedValue(RESULTS.DENIED);
    // doc 06 §2: a denial is a soft anti-cheat flag, never a blocked walk. The
    // same dialog on Tuesday will not change their mind — it will just be the
    // thing they remember about the app.
    await expect(requestMotionPermissionOnce()).resolves.toBe('denied');

    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(mockCheck).toHaveBeenCalledTimes(1);
  });

  it('records that it asked even when the answer was no', async () => {
    mockRequest.mockResolvedValue(RESULTS.BLOCKED);
    await requestMotionPermissionOnce();

    expect(storage.getBoolean(StorageKeys.motionPermissionAsked)).toBe(true);
  });

  it('treats a device with no motion sensor as unavailable, not an error', async () => {
    mockRequest.mockRejectedValue(new Error('no such permission'));

    await expect(requestMotionPermissionOnce()).resolves.toBe('unavailable');
  });
});
