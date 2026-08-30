import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Session storage adapter for the Supabase auth client.
 *
 * AsyncStorage rather than the MMKV instance the rest of the app uses,
 * deliberately:
 *
 *  - `supabase-js` expects an async, Promise-returning storage interface and
 *    calls it during token refresh on a background timer;
 *  - AsyncStorage is the adapter Supabase tests against on React Native, so
 *    refresh-token rotation edge cases stay on the well-trodden path;
 *  - it keeps the session out of `storage.clearAll()`, so wiping cached game
 *    state can never accidentally sign the user out (FR-07: the session must
 *    survive restarts silently).
 *
 * Sign-out goes through `supabase.auth.signOut()`, which clears this itself.
 */
export const supabaseAuthStorage = {
  getItem: (key: string): Promise<string | null> => AsyncStorage.getItem(key),
  setItem: (key: string, value: string): Promise<void> => AsyncStorage.setItem(key, value),
  removeItem: (key: string): Promise<void> => AsyncStorage.removeItem(key),
};
