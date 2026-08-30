/**
 * Runs before the test framework is installed. Native module mocks live here.
 */

jest.mock('react-native-config', () => ({
  __esModule: true,
  default: {
    APP_ENV: 'test',
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_ANON_KEY: 'test-anon-key',
    GOOGLE_MAPS_API_KEY_ANDROID: 'test-android-key',
    GOOGLE_MAPS_API_KEY_IOS: 'test-ios-key',
    SENTRY_DSN: '',
    // Off in tests: the logger is verified by its own suite, and letting it
    // write to the console buries the actual assertions.
    DEBUG_LOGGING: 'false',
    API_TIMEOUT_MS: '15000',
  },
}));

jest.mock('react-native-mmkv', () => {
  class MMKV {
    private store = new Map<string, string | number | boolean>();
    getString(k: string) {
      const v = this.store.get(k);
      return typeof v === 'string' ? v : undefined;
    }
    set(k: string, v: string | number | boolean) {
      this.store.set(k, v);
    }
    getBoolean(k: string) {
      const v = this.store.get(k);
      return typeof v === 'boolean' ? v : undefined;
    }
    getNumber(k: string) {
      const v = this.store.get(k);
      return typeof v === 'number' ? v : undefined;
    }
    delete(k: string) {
      this.store.delete(k);
    }
    getAllKeys() {
      return [...this.store.keys()];
    }
    clearAll() {
      this.store.clear();
    }
  }
  return {MMKV};
});

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: jest.fn(() => jest.fn()),
    fetch: jest.fn(() => Promise.resolve({isConnected: true, isInternetReachable: true})),
  },
}));

jest.mock('react-native-permissions', () => require('react-native-permissions/mock'));

jest.mock('react-native-maps', () => {
  const React = require('react');
  const {View} = require('react-native');
  const Mock = (props: Record<string, unknown>) => React.createElement(View, props);
  return {
    __esModule: true,
    default: Mock,
    Marker: Mock,
    Polygon: Mock,
    Polyline: Mock,
    Callout: Mock,
    PROVIDER_GOOGLE: 'google',
  };
});
