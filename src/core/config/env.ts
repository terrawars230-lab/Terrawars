// Aliased: the package exports both a default and a named `Config`, and the
// default is the one carrying the values read from .env.
import ReactNativeConfig from 'react-native-config';

/**
 * Typed, validated access to the build-time environment.
 *
 * `react-native-config` hands us a `Record<string, string | undefined>` read
 * from the `.env` file that was present when the app was compiled. Everything
 * downstream reads from `env` below, never from `Config` directly, so that a
 * missing key fails loudly here at startup instead of silently producing
 * `undefined` inside a network call three screens later.
 */

export type AppEnvironment = 'development' | 'staging' | 'production' | 'test';

type RawConfig = Record<string, string | undefined>;

const raw = ReactNativeConfig as unknown as RawConfig;

class MissingEnvError extends Error {
  constructor(key: string) {
    super(
      `Missing required environment variable "${key}".\n` +
        'Copy .env.example to .env, fill it in, then rebuild the app ' +
        '(a Metro reload is not enough — react-native-config is read at build time).',
    );
    this.name = 'MissingEnvError';
  }
}

function requireString(key: string): string {
  const value = raw[key]?.trim();
  if (!value) {
    throw new MissingEnvError(key);
  }
  return value;
}

function optionalString(key: string, fallback = ''): string {
  return raw[key]?.trim() || fallback;
}

function optionalNumber(key: string, fallback: number): number {
  const parsed = Number(raw[key]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function optionalBoolean(key: string, fallback: boolean): boolean {
  const value = raw[key]?.trim().toLowerCase();
  if (value === undefined || value === '') {
    return fallback;
  }
  return value === 'true' || value === '1' || value === 'yes';
}

function parseEnvironment(): AppEnvironment {
  const value = optionalString('APP_ENV', 'development');
  switch (value) {
    case 'development':
    case 'staging':
    case 'production':
    case 'test':
      return value;
    default:
      throw new Error(`APP_ENV must be development | staging | production | test, got "${value}"`);
  }
}

const appEnvironment = parseEnvironment();
const isProduction = appEnvironment === 'production';

export const env = {
  appEnvironment,
  isProduction,
  isDevelopment: appEnvironment === 'development',

  displayName: optionalString('APP_DISPLAY_NAME', 'TerraWars'),

  supabase: {
    url: requireString('SUPABASE_URL'),
    anonKey: requireString('SUPABASE_ANON_KEY'),
  },

  googleMaps: {
    androidApiKey: optionalString('GOOGLE_MAPS_API_KEY_ANDROID'),
    iosApiKey: optionalString('GOOGLE_MAPS_API_KEY_IOS'),
  },

  googleAuth: {
    webClientId: optionalString('GOOGLE_OAUTH_WEB_CLIENT_ID'),
    iosClientId: optionalString('GOOGLE_OAUTH_IOS_CLIENT_ID'),
  },

  /**
   * Public pages the stores require the app to link to (Play User Data policy,
   * App Store guideline 5.1.1). They must be live at these URLs before
   * submission — see docs/store/README.md.
   */
  links: {
    privacyPolicy: optionalString('PRIVACY_POLICY_URL', 'https://terrawars.app/privacy'),
    terms: optionalString('TERMS_URL', 'https://terrawars.app/terms'),
    accountDeletion: optionalString('ACCOUNT_DELETION_URL', 'https://terrawars.app/delete-account'),
    supportEmail: optionalString('SUPPORT_EMAIL', 'support@terrawars.app'),
  },

  /**
   * Where the sign-up confirmation link sends the browser once the address is
   * verified. Must be in Supabase Auth → URL Configuration → Redirect URLs.
   * Blank falls back to the project's Site URL.
   */
  authEmailRedirectUrl: optionalString('AUTH_EMAIL_REDIRECT_URL'),

  sentryDsn: optionalString('SENTRY_DSN'),

  apiTimeoutMs: optionalNumber('API_TIMEOUT_MS', 15_000),
  // Never in a production build, whatever the .env says: a release that chats
  // on the console leaks data and costs battery, and a .env copied from the
  // template ships DEBUG_LOGGING=true.
  debugLogging: !isProduction && optionalBoolean('DEBUG_LOGGING', true),
} as const;

export type Env = typeof env;
