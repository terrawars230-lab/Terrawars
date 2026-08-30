import {MMKV} from 'react-native-mmkv';

import {createLogger} from '@core/logger/logger';

import type {StorageKey} from './storageKeys';

/**
 * Synchronous key-value storage, backed by MMKV.
 *
 * MMKV rather than AsyncStorage because the walk recorder writes on every GPS
 * sample (FR-15: an app kill must not lose the walk). An async, bridge-crossing
 * write every five metres for four hours is exactly the kind of thing that
 * shows up as jank and battery drain, and NFR-01 gives us an 8%/hour budget.
 *
 * The Supabase session is the one thing NOT stored here — see
 * `supabaseAuthStorage.ts` for why.
 */

const logger = createLogger('storage');

const mmkv = new MMKV({id: 'terrawars.default'});

export const storage = {
  getString(key: StorageKey): string | undefined {
    return mmkv.getString(key);
  },

  setString(key: StorageKey, value: string): void {
    mmkv.set(key, value);
  },

  getBoolean(key: StorageKey, fallback = false): boolean {
    return mmkv.getBoolean(key) ?? fallback;
  },

  setBoolean(key: StorageKey, value: boolean): void {
    mmkv.set(key, value);
  },

  getNumber(key: StorageKey, fallback: number): number {
    return mmkv.getNumber(key) ?? fallback;
  },

  setNumber(key: StorageKey, value: number): void {
    mmkv.set(key, value);
  },

  /**
   * Reads and parses JSON.
   *
   * A corrupt or schema-drifted value returns `null` rather than throwing —
   * a half-written record from a kill mid-write must not brick the app on its
   * next launch, which is precisely the scenario FR-15 puts us in.
   */
  getObject<T>(key: StorageKey): T | null {
    const raw = mmkv.getString(key);
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw) as T;
    } catch {
      logger.warn('Discarding unparseable stored value', {key});
      mmkv.delete(key);
      return null;
    }
  },

  setObject(key: StorageKey, value: unknown): void {
    mmkv.set(key, JSON.stringify(value));
  },

  remove(key: StorageKey): void {
    mmkv.delete(key);
  },

  /**
   * Wipes everything. Used on sign-out and on account deletion (FR-06) so no
   * trace of the previous user's walk survives into the next session.
   */
  clearAll(): void {
    mmkv.clearAll();
  },
};
