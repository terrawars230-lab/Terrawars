import {Platform} from 'react-native';

import {
  PERMISSIONS,
  RESULTS,
  check,
  checkLocationAccuracy,
  request,
  requestLocationAccuracy,
  requestMultiple,
  requestNotifications,
} from 'react-native-permissions';

import {storage} from '@core/storage/storage';
import {StorageKeys} from '@core/storage/storageKeys';

import {
  checkLocationPermission,
  requestLocationPermission,
  requestWalkNotificationsOnce,
} from '../permissions';

/**
 * The location grant, as the walk actually needs it.
 *
 * A grant is not enough on its own: Android 12+ and iOS 14+ both let the user
 * hand over an approximate location instead, and a fix kilometres wide cannot
 * trace a walk. These tests pin that "approximate" is reported as its own
 * state rather than silently counted as a grant — the bug that would put a
 * user on a walk that can never close a loop.
 */

jest.mock('react-native-permissions', () => {
  const actual = jest.requireActual('react-native-permissions/mock');
  return {
    ...actual,
    check: jest.fn(),
    request: jest.fn(),
    requestMultiple: jest.fn(),
    checkLocationAccuracy: jest.fn(),
    requestLocationAccuracy: jest.fn(),
    requestNotifications: jest.fn(),
  };
});

const mockCheck = check as jest.Mock;
const mockRequest = request as jest.Mock;
const mockRequestMultiple = requestMultiple as jest.Mock;
const mockCheckAccuracy = checkLocationAccuracy as jest.Mock;
const mockRequestAccuracy = requestLocationAccuracy as jest.Mock;
const mockRequestNotifications = requestNotifications as jest.Mock;

const FINE = PERMISSIONS.ANDROID.ACCESS_FINE_LOCATION;
const COARSE = PERMISSIONS.ANDROID.ACCESS_COARSE_LOCATION;

const originalOS = Platform.OS;
const versionDescriptor = Object.getOwnPropertyDescriptor(Platform, 'Version');

function onAndroid(apiLevel = 34): void {
  Object.defineProperty(Platform, 'OS', {value: 'android', configurable: true, writable: true});
  Object.defineProperty(Platform, 'Version', {get: () => apiLevel, configurable: true});
}

beforeEach(() => {
  jest.resetAllMocks();
  mockCheckAccuracy.mockResolvedValue('full');
  mockRequestAccuracy.mockResolvedValue('full');
  mockRequestNotifications.mockResolvedValue({status: RESULTS.GRANTED, settings: {}});
});

afterEach(() => {
  Object.defineProperty(Platform, 'OS', {value: originalOS, configurable: true, writable: true});
  if (versionDescriptor) {
    Object.defineProperty(Platform, 'Version', versionDescriptor);
  }
});

describe('Android location', () => {
  beforeEach(() => onAndroid());

  it('asks for fine and coarse together, as Android 12+ requires', async () => {
    mockRequestMultiple.mockResolvedValue({[FINE]: RESULTS.GRANTED, [COARSE]: RESULTS.GRANTED});

    await expect(requestLocationPermission()).resolves.toBe('granted');
    expect(mockRequestMultiple).toHaveBeenCalledWith([FINE, COARSE]);
  });

  it('reports "approximate" when only coarse was granted', async () => {
    mockRequestMultiple.mockResolvedValue({[FINE]: RESULTS.DENIED, [COARSE]: RESULTS.GRANTED});

    await expect(requestLocationPermission()).resolves.toBe('approximate');
  });

  it('reports a permanent refusal as blocked', async () => {
    mockRequestMultiple.mockResolvedValue({[FINE]: RESULTS.BLOCKED, [COARSE]: RESULTS.BLOCKED});

    await expect(requestLocationPermission()).resolves.toBe('blocked');
  });

  it('reads an existing approximate grant without prompting', async () => {
    mockCheck.mockImplementation(async (permission: string) =>
      permission === FINE ? RESULTS.DENIED : RESULTS.GRANTED,
    );

    await expect(checkLocationPermission()).resolves.toBe('approximate');
    expect(mockRequestMultiple).not.toHaveBeenCalled();
  });
});

describe('iOS location', () => {
  it('asks for temporary full accuracy when Precise Location is off', async () => {
    mockRequest.mockResolvedValue(RESULTS.GRANTED);
    mockCheckAccuracy.mockResolvedValue('reduced');
    mockRequestAccuracy.mockResolvedValue('full');

    await expect(requestLocationPermission()).resolves.toBe('granted');
    expect(mockRequestAccuracy).toHaveBeenCalledWith({purposeKey: 'WalkTracking'});
  });

  it('reports "approximate" when full accuracy is refused', async () => {
    mockRequest.mockResolvedValue(RESULTS.GRANTED);
    mockCheckAccuracy.mockResolvedValue('reduced');
    mockRequestAccuracy.mockResolvedValue('reduced');

    await expect(requestLocationPermission()).resolves.toBe('approximate');
  });

  it('never lets a failed accuracy read block a grant', async () => {
    mockCheck.mockResolvedValue(RESULTS.GRANTED);
    mockCheckAccuracy.mockRejectedValue(new Error('no handler'));

    await expect(checkLocationPermission()).resolves.toBe('granted');
  });

  it('turns a failed request into "unavailable" rather than throwing', async () => {
    mockRequest.mockRejectedValue(new Error('No permission handler detected'));

    await expect(requestLocationPermission()).resolves.toBe('unavailable');
  });
});

describe('requestWalkNotificationsOnce', () => {
  beforeEach(() => {
    storage.remove(StorageKeys.notificationPermissionAsked);
  });

  it('asks once on Android 13+, and never again', async () => {
    onAndroid(33);

    await requestWalkNotificationsOnce();
    await requestWalkNotificationsOnce();

    expect(mockRequestNotifications).toHaveBeenCalledTimes(1);
    expect(storage.getBoolean(StorageKeys.notificationPermissionAsked)).toBe(true);
  });

  it('does not ask below Android 13, where no runtime permission exists', async () => {
    onAndroid(32);

    await requestWalkNotificationsOnce();

    expect(mockRequestNotifications).not.toHaveBeenCalled();
  });

  it('does not ask on iOS, where nothing posts a notification yet', async () => {
    await requestWalkNotificationsOnce();

    expect(mockRequestNotifications).not.toHaveBeenCalled();
  });
});
