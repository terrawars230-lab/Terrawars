import {NativeModules, Platform} from 'react-native';

import i18next from 'i18next';
import {initReactI18next} from 'react-i18next';

import {createLogger} from '@core/logger/logger';
import {storage} from '@core/storage/storage';
import {StorageKeys} from '@core/storage/storageKeys';

import en from './locales/en.json';

/**
 * Localisation (NFR-11).
 *
 * v1 ships English; Urdu is the fast follow, which is why the resource map and
 * the locale resolver already exist. The rule that matters is the one in
 * CLAUDE.md: no hardcoded user-facing strings in UI code, from day one. Adding
 * a language later is then a JSON file, not an audit of every screen.
 */

const logger = createLogger('i18n');

export const SUPPORTED_LOCALES = ['en'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const FALLBACK_LOCALE: SupportedLocale = 'en';

const resources = {
  en: {translation: en},
} as const;

/**
 * Reads the device locale without pulling in a native dependency.
 *
 * `react-native-localize` would be the usual answer, but it is one more native
 * module to build and configure for a value we only need at startup. These two
 * platform constants are stable public API.
 */
function deviceLocale(): string {
  try {
    if (Platform.OS === 'ios') {
      const settings = NativeModules.SettingsManager?.settings;
      const locale: string | undefined = settings?.AppleLocale ?? settings?.AppleLanguages?.[0];
      return locale ?? FALLBACK_LOCALE;
    }
    return NativeModules.I18nManager?.localeIdentifier ?? FALLBACK_LOCALE;
  } catch {
    logger.warn('Could not read the device locale; falling back to English');
    return FALLBACK_LOCALE;
  }
}

function resolveLocale(): SupportedLocale {
  const stored = storage.getString(StorageKeys.preferredLocale);
  if (stored && isSupported(stored)) {
    return stored;
  }

  // `en_GB`, `en-GB` and `en` all resolve to `en`.
  const language = deviceLocale().replace('_', '-').split('-')[0]?.toLowerCase();
  return language && isSupported(language) ? language : FALLBACK_LOCALE;
}

function isSupported(value: string): value is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function initI18n(): typeof i18next {
  if (i18next.isInitialized) {
    return i18next;
  }

  void i18next.use(initReactI18next).init({
    resources,
    lng: resolveLocale(),
    fallbackLng: FALLBACK_LOCALE,
    // React already escapes rendered text; escaping again mangles apostrophes.
    interpolation: {escapeValue: false},
    returnNull: false,
    // Surfaces a missing key loudly in development instead of rendering the
    // raw key path to a user in production.
    saveMissing: false,
    missingKeyHandler: (_lngs, _ns, key) => {
      logger.warn('Missing translation key', {key});
    },
    compatibilityJSON: 'v4',
  });

  return i18next;
}

export function setLocale(locale: SupportedLocale): void {
  storage.setString(StorageKeys.preferredLocale, locale);
  void i18next.changeLanguage(locale);
}

// Re-exported under the name the React provider expects.
export {i18next as i18n};
