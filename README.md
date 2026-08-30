# TerraWars

A GPS walking game. You walk a closed loop; the enclosed polygon becomes
territory you own on a shared world map, and rival players can walk into your
land and take the overlap.

**Stack:** React Native 0.87 (CLI, TypeScript) · Supabase (PostgreSQL + PostGIS)
· Google Maps · Android and iOS.

> The design docs in [`Doc_Files/`](Doc_Files/) are the source of truth for
> **what** to build and for the game rules. They were written against a Flutter
> stack; the rules carry over unchanged, the client tech does not. See
> [CLAUDE.md](CLAUDE.md).

---

## Quick start

```sh
# 1. Install
npm install
cd ios && bundle install && bundle exec pod install && cd ..   # iOS only

# 2. Configure — see "Environment" below. The app will not start without this.
cp .env.example .env    # then fill it in

# 3. Set up the database — see "Backend" below.

# 4. Run
npm start               # Metro
npm run android         # or: npm run ios
```

Node >= 22.11 is required.

### Commands

| Command | What it does |
|---|---|
| `npm start` | Metro bundler |
| `npm run android` / `npm run ios` | Build and run on a device or emulator |
| `npm test` | Jest. `npm test -- --coverage` for the coverage gate |
| `npm run lint` | ESLint (0 warnings tolerated in CI) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run format` | Prettier over `src/` |

Run one test: `npm test -- src/geo/__tests__/loopDetection.test.ts` or
`npm test -- -t "figure-eight"`.

---

## Environment

Configuration is read at **build time** by `react-native-config` and injected
into JS, the Android manifest and the iOS `Info.plist`. **Changing `.env`
requires a rebuild, not just a Metro reload.**

Copy [`.env.example`](.env.example) to `.env` and fill in:

| Key | Where to get it |
|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Supabase → Project Settings → API |
| `GOOGLE_MAPS_API_KEY_ANDROID` | Google Cloud → Credentials, restricted to SHA-1 + `com.terrawars` |
| `GOOGLE_MAPS_API_KEY_IOS` | Google Cloud → Credentials, restricted to bundle id `com.terrawars` |
| `GOOGLE_OAUTH_WEB_CLIENT_ID` | Google Cloud OAuth client; the same id goes into Supabase → Auth → Providers → Google |

`.env` is gitignored. **Only `.env.example`, which is entirely blank, is
tracked.** The Supabase *service-role* key must never appear in this repo — RLS
is the security boundary and the anon key is meant to ship inside the app.

#### iOS one-time setup

`react-native-config` needs a build phase to generate its config. In Xcode, add
a **Run Script** phase to the `TerraWars` target, ordered *before* "Compile
Sources":

```sh
"${SRCROOT}/../node_modules/react-native-config/ios/ReactNativeConfig/BuildDotenvConfig.rb"
```

For a per-scheme file, set `ENVFILE=.env.staging` in the scheme's build
pre-action.

---

## Backend

The whole backend lives in [`supabase/`](supabase/) as ordered migrations.

```sh
npx supabase link --project-ref <your-ref>
npx supabase db push                       # applies supabase/migrations/
psql "$DATABASE_URL" -f supabase/seed.sql  # game_config + tombstone owner
```

`seed.sql` is **not optional**: every rule function reads `game_config` at call
time and raises on a missing key, so a claim against an unseeded database fails
loudly rather than silently using a default.

After any migration, regenerate the client types:

```sh
npx supabase gen types typescript --project-id <ref> --schema public \
  > src/core/api/supabase/database.types.ts
```

Schedule the nightly retention job once per project (needs `pg_cron` enabled):

```sql
select public.schedule_maintenance();
```

### The one rule that matters

**A client can never write a parcel.** `parcels`, `claims`, `steal_events` and
`user_stats` have no client write policy at all; `finish_walk` is
`SECURITY DEFINER` and is the sole write path. If that ever stops being true,
the game is over on day one.

---

## Layout

```
src/
  app/          App root and providers (query client, theme, i18n, navigation)
  navigation/   Navigators, typed param lists, deep links
  core/         Cross-cutting: config, api, storage, theme, i18n, logger, utils
  geo/          Client-side geometry engine — ADVISORY ONLY (see below)
  services/     Native-facing: location tracking, permissions
  components/   Shared UI kit
  features/     auth · onboarding · map · walk · profile · leaderboard · settings
                each: api/ · screens/ · hooks/ · store/ · components/

supabase/
  migrations/   Schema, RLS, and the claim-resolution functions, in order
  seed.sql      game_config values and the deleted-account tombstone owner

android/app/src/main/java/com/terrawars/location/   Kotlin foreground service
ios/TerraWars/WalkTracker.swift                     CLLocationManager equivalent
```

Imports use path aliases (`@core/…`, `@features/…`, `@geo/…`). The alias map is
duplicated in `tsconfig.json`, `babel.config.js` and `jest.config.js` — change
all three together.

### `src/geo/` is advisory, always

The client computes a preview polygon so the walk HUD can show an area estimate
and prompt "claim this area?" the moment a loop closes. It is a mirror of the
server's rules, never a substitute for them. Ownership, area and validation are
decided only by `finish_walk`. A `valid: true` preview can still be rejected —
the client cannot see a rival's parcel, a protection window, or the real PostGIS
area.

The engine is the one part with a coverage gate (85% statements, 90% functions)
because it is the part that must not silently regress.

---

## Conventions

- **Cite the rule.** Code implementing a rule from
  [doc 03](Doc_Files/03-game-mechanics-spec.md) carries a `GR-xx` comment.
  Commits reference the requirement IDs they implement:
  `feat(claim): GR-20 rival parcel difference and multipolygon split`.
- **No geometry function without a test**, including the pathological fixtures —
  self-intersecting, figure-eight, sliver remainder, enclave.
- **No hardcoded user-facing strings.** Everything goes through
  `src/core/i18n/locales/` (NFR-11).
- **Tunables live in `game_config`**, never as literals in code. The constants in
  `src/core/constants/gameConfig.ts` are a cold-start and offline fallback only.
- **Areas are metres, computed geodesically** — never degrees, never a raw float
  shown to a user.
- **Never add `ACCESS_BACKGROUND_LOCATION`** without an explicit decision from
  the project owner (ADR D-04). v1 uses a foreground service only.
- **Never expose another user's path, walk points, or live position.** Only
  simplified parcel polygons are public — a route polyline is a home address.

---

## Status

Phase 0 complete: project structure, geometry engine, database schema and claim
resolution, native location tracking, and the primary screens are in place.

See [Doc_Files/07-implementation-plan.md](Doc_Files/07-implementation-plan.md)
for the phased plan and the acceptance criteria for each phase.
