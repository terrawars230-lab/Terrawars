#!/usr/bin/env node
/**
 * Pre-flight for a store build: checks the .env that is about to be compiled
 * into the app.
 *
 *   node scripts/check-release-env.mjs            # checks ./.env
 *   node scripts/check-release-env.mjs .env.production
 *
 * react-native-config bakes .env into the binary at build time, so a mistake
 * here ships to every phone and cannot be fixed without a new release. This
 * refuses the most expensive ones:
 *
 *   - a development build going to the store (APP_ENV, DEBUG_LOGGING);
 *   - a Supabase SERVICE-ROLE or secret key — it bypasses every RLS policy,
 *     and anyone can pull it out of the APK (CLAUDE.md rule 8);
 *   - missing Supabase / Maps configuration, or store links that are not
 *     public https URLs.
 *
 * Exits non-zero on any failure, so it can gate CI and `npm run release:*`.
 */
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

const file = resolve(process.argv[2] ?? '.env');

let text;
try {
  text = readFileSync(file, 'utf8');
} catch {
  console.error(`✖ Cannot read ${file}. Copy .env.example and fill it in.`);
  process.exit(1);
}

const env = {};
for (const line of text.split(/\r?\n/)) {
  const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
  if (match && !line.trim().startsWith('#')) {
    env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}

const failures = [];
const warnings = [];
const fail = message => failures.push(message);
const warn = message => warnings.push(message);

// ── Build mode ──────────────────────────────────────────────────────────────
if (env.APP_ENV !== 'production') {
  fail(`APP_ENV must be "production" for a store build (got "${env.APP_ENV ?? ''}").`);
}
if (/^(true|1|yes)$/i.test(env.DEBUG_LOGGING ?? '')) {
  warn('DEBUG_LOGGING is on. It is forced off when APP_ENV=production, but set it to false.');
}

// ── Supabase ────────────────────────────────────────────────────────────────
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(env.SUPABASE_URL ?? '')) {
  if (!/^https:\/\//i.test(env.SUPABASE_URL ?? '')) {
    fail('SUPABASE_URL must be an https URL.');
  } else {
    warn('SUPABASE_URL is not a *.supabase.co URL — fine for a custom domain, check it is right.');
  }
}

const key = env.SUPABASE_ANON_KEY ?? '';
if (!key) {
  fail('SUPABASE_ANON_KEY is empty.');
} else if (key.startsWith('sb_secret_')) {
  fail('SUPABASE_ANON_KEY is a SECRET key (sb_secret_…). Use the publishable key — a secret key bypasses RLS and ships inside the app.');
} else if (key.split('.').length === 3) {
  try {
    const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString('utf8'));
    if (payload.role === 'service_role') {
      fail('SUPABASE_ANON_KEY is the SERVICE-ROLE key. It bypasses every RLS policy and anyone can extract it from the APK. Use the anon key.');
    } else if (payload.role !== 'anon') {
      warn(`SUPABASE_ANON_KEY has role "${payload.role}", expected "anon".`);
    }
  } catch {
    warn('SUPABASE_ANON_KEY looks like a JWT but could not be decoded.');
  }
}

for (const name of Object.keys(env)) {
  if (/SERVICE_ROLE|SECRET/i.test(name) && env[name]) {
    fail(`${name} is set. Nothing secret belongs in .env — it is compiled into the app.`);
  }
}

// ── Maps ────────────────────────────────────────────────────────────────────
for (const name of ['GOOGLE_MAPS_API_KEY_ANDROID', 'GOOGLE_MAPS_API_KEY_IOS']) {
  if (!env[name]) {
    fail(`${name} is empty — the map renders as blank grey tiles.`);
  }
}

// ── Store-required public pages ─────────────────────────────────────────────
for (const name of ['PRIVACY_POLICY_URL', 'TERMS_URL', 'ACCOUNT_DELETION_URL']) {
  const value = env[name];
  if (!value) {
    warn(`${name} is not set; the app falls back to the terrawars.app default. Make sure that page is live.`);
  } else if (!/^https:\/\//i.test(value)) {
    fail(`${name} must be a public https URL (got "${value}").`);
  }
}
if (env.SUPPORT_EMAIL !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.SUPPORT_EMAIL)) {
  fail(`SUPPORT_EMAIL is not an email address (got "${env.SUPPORT_EMAIL}").`);
}

// ── Report ──────────────────────────────────────────────────────────────────
for (const message of warnings) {
  console.warn(`⚠ ${message}`);
}
for (const message of failures) {
  console.error(`✖ ${message}`);
}

if (failures.length > 0) {
  console.error(`\n${failures.length} problem(s) in ${file}. Fix them before building for a store.`);
  process.exit(1);
}
console.log(`✔ ${file} is ready for a store build.`);
