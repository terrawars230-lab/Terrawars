import {useEffect, useState} from 'react';

import NetInfo from '@react-native-community/netinfo';

export interface NetworkStatus {
  isConnected: boolean;
  /**
   * `null` while unknown. Distinct from `false`: a captive portal or a dead
   * upstream reports connected-but-unreachable, and showing "you're offline"
   * for an unknown state flickers a banner at every app resume.
   */
  isInternetReachable: boolean | null;
}

/** Drives the offline banner (doc 07 Phase 7) and the FR-20 queue prompt. */
export function useNetworkStatus(): NetworkStatus {
  const [status, setStatus] = useState<NetworkStatus>({
    isConnected: true,
    isInternetReachable: null,
  });

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(state => {
      setStatus({
        isConnected: Boolean(state.isConnected),
        isInternetReachable: state.isInternetReachable,
      });
    });
    return unsubscribe;
  }, []);

  return status;
}

/** True only when we are confident the device is offline. */
export function isDefinitelyOffline(status: NetworkStatus): boolean {
  return !status.isConnected || status.isInternetReachable === false;
}
