# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**TerraWars** — a GPS walking game. You walk a closed loop; the enclosed polygon
becomes territory you own on a shared world map, and rival players can walk into
your land and take the overlap. Android first (package `com.terrawars`), iOS
later.

Phase 0 is complete: project structure, the client geometry engine, the full
database schema with claim resolution, native location tracking on both
platforms, and the primary screens are in place.

## Stack — decided, do not re-litigate

The project owner has resolved the discrepancy between `Doc_Files/` and this
repo. The stack is:

| Layer | Choice | Overrides |
|---|---|---|
| Client | **React Native 0.87 + TypeScript** (`@react-native-community/cli`) | doc 02 decision **D-01**, which chose Flutter and rejected React Native |
| Backend | **Supabase** — PostgreSQL + PostGIS, RLS, RPC | unchanged from doc 02 (D-02, D-05) |
| Maps | **Google Maps** on both Android and iOS | resolves open question **OQ-2**, which had defaulted to MapLibre |
| Platforms | **Android and iOS together** | doc 01 scoped iOS out of v1; both are now in scope |
| Package id | `com.terrawars`, app name TerraWars | resolves **OQ-1** |

`Doc_Files/` remains the source of truth for **what to build and the game
rules** — every `FR-xx`, `NFR-xx` and `GR-xx`. It is **not** the source of truth
for client technology, repo layout (`app/lib/...`), or any Flutter-specific
package or architecture guidance. Where a doc names a Flutter package or a Dart
API, translate the intent; do not follow it literally.

Scale target: 10 000+ users. Every design decision assumes that, which is why
ownership is stored as per-parcel rows (GR-10), the viewport query simplifies by
zoom (doc 04 §4), and `user_stats` is denormalised rather than computed on read.

## Commands

```sh
npm start              # Metro bundler
npm run android        # build + run on Android device/emulator
npm run ios            # build + run on iOS simulator (needs `bundle exec pod install` in ios/ first)

npm run verify         # typecheck + lint + test — run this before every commit
npm run typecheck      # tsc --noEmit
npm run lint           # ESLint, --max-warnings 0
npm test               # Jest
npm run test:coverage  # enforces the src/geo/ coverage gate
```

Run a single test: `npm test -- src/geo/__tests__/loopDetection.test.ts` or
`npm test -- -t "figure-eight"`.

Node >= 22.11 required.

**Environment is read at build time.** `react-native-config` injects `.env` into
JS, the Android manifest and the iOS Info.plist when the app is compiled. A
changed `.env` needs `npm run android` / `npm run ios`, not a Metro reload.

## Layout

```
src/
  app/          Root component + providers (query client, theme, i18n, navigation)
  navigation/   Navigators, typed param lists, deep links
  core/         Cross-cutting: config, api, storage, theme, i18n, logger, utils
  geo/          Client geometry engine — ADVISORY ONLY, see below
  services/     Native-facing: location tracking, permissions
  components/   Shared UI kit — import from `@components/index`, never a deep path
  features/     auth · onboarding · map · walk · profile · leaderboard · settings
                each with api/ · screens/ · hooks/ · store/ · components/
supabase/
  migrations/   Schema, RLS, and the claim-resolution functions, in order
  seed.sql      game_config values + the deleted-account tombstone owner
```

- [index.js](index.js) registers [src/app/App.tsx](src/app/App.tsx) via `AppRegistry`.
- Native: [android/app/src/main/java/com/terrawars/location/](android/app/src/main/java/com/terrawars/location/)
  (Kotlin foreground service) and [ios/TerraWars/WalkTracker.swift](ios/TerraWars/WalkTracker.swift).
- Tests live next to what they test, in `__tests__/`.
- [Doc_Files/](Doc_Files/) — the product spec. Read in order; start with
  [Doc_Files/README.md](Doc_Files/README.md).

**Path aliases** (`@core/…`, `@features/…`, `@geo/…`, `@components/…`,
`@services/…`, `@navigation/…`, `@app/…`) are declared in THREE places that must
change together: [tsconfig.json](tsconfig.json), [babel.config.js](babel.config.js)
and [jest.config.js](jest.config.js). TypeScript resolves the types, Babel
resolves the runtime require, Jest resolves the test import — miss one and you
get a green typecheck with a red runtime.

## `src/geo/` is advisory, always

The client mirrors GR-01…GR-05 so the walk HUD can show a live area estimate
(FR-14) and prompt "claim this area?" the instant a loop closes (FR-18). It is a
preview, never a result. `finish_walk` decides ownership, and a `valid: true`
preview can still be rejected — the client cannot see a rival's parcel, a
protection window, or the real PostGIS area.

When you change a rule, change it in **both** places and say so in the commit:
`src/geo/` and the matching `supabase/migrations/` function. A client that
disagrees with the server produces a user who was promised land and did not get
it, which reads as a scoring bug.

## The design docs (read the relevant one before coding that area)

| Doc | Covers |
|---|---|
| [01-product-requirements.md](Doc_Files/01-product-requirements.md) | `FR-xx` / `NFR-xx` requirements, v1 scope |
| [03-game-mechanics-spec.md](Doc_Files/03-game-mechanics-spec.md) | `GR-xx` geometry rules — **read before touching claims/parcels/area** |
| [04-data-model.md](Doc_Files/04-data-model.md) | DB schema, PostGIS types, RLS |
| [05-api-spec.md](Doc_Files/05-api-spec.md) | endpoints, payloads, error codes |
| [06-anti-cheat-and-compliance.md](Doc_Files/06-anti-cheat-and-compliance.md) | GPS spoofing defence, Play policy, privacy — read before permissions/location work |
| [07-implementation-plan.md](Doc_Files/07-implementation-plan.md) | phased build order + acceptance criteria |
| [CLAUDE.md](Doc_Files/CLAUDE.md) | original working agreement (Flutter-framed; rules below are the portable core) |

## Non-negotiable rules (from the spec, stack-independent)

1. **Never trust the client.** Ownership, area, and claim validation are decided
   only server-side. The app may compute an advisory preview polygon; it may
   never compute a result or write a parcel.
2. **Claim resolution is one atomic transaction** — all contested area transfers
   or none does (FR-33).
3. **Cite the rule ID.** Code implementing a rule from doc 03 carries a `GR-xx`
   comment; commits reference the requirement IDs they implement.
4. **No geometry function without a test**, including pathological fixtures
   (self-intersecting, figure-eight, sliver remainder, enclave).
5. **Never add `ACCESS_BACKGROUND_LOCATION`** without an explicit decision from
   the project owner (ADR D-04). v1 uses a foreground service only.
6. **Never expose another user's path, walk points, or live position** — only
   simplified parcel polygons are public.
7. **Tunables come from a config table** (`game_config`), never hardcoded literals.
8. **Secrets are never committed** — no service-role keys, tile API keys, or FCM
   credentials.
9. **Areas are in metres**, computed geodesically — never stored or shown in degrees.
10. **Idempotency:** every mutating endpoint honours a client-supplied idempotency
    key; a walk is claimable exactly once.

## Conventions

- Commit messages: `type(scope): GR-xx short description`
  (e.g. `feat(claim): GR-20 rival parcel difference and multipolygon split`).
- A PR states which requirement IDs it implements and how it was verified; if it
  changes a doc-03 rule, it updates doc 03 in the same PR.
- No hardcoded user-facing strings — localisation layer from day one (NFR-11).
- If a requirement is ambiguous, ask rather than guess, and propose the answer
  you'd pick. Silent guesses about game rules become bugs that look like design.
