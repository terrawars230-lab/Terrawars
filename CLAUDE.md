# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**TerraWars** — a GPS walking game. You walk a closed loop; the enclosed polygon
becomes territory you own on a shared world map, and rival players can walk into
your land and take the overlap. Android first (package `com.terrawars`), iOS
later.

The repo is currently a **fresh React Native 0.87.1 + TypeScript scaffold**
(`@react-native-community/cli`). Only the template screen exists so far
([App.tsx](App.tsx) renders `NewAppScreen`). None of the game is built yet —
this is Phase 0.

## ⚠️ Tech-stack discrepancy — resolve before building features

`Doc_Files/` is a complete product/design spec written under the codename
**"TerraClaim"**. Those docs specify a **Flutter + Supabase/PostGIS** stack and
[explicitly reject React Native](Doc_Files/02-tech-stack.md) (decision D-01).
The actual scaffold is React Native.

So the docs are the source of truth for **what to build and the game rules**, but
**not** for the client tech, repo layout (`app/lib/...`, `supabase/...`), or
Flutter-specific package/architecture rules. Confirm with the project owner which
stack wins before implementing anything from the phased plan. Do not assume.

## Commands

```sh
npm start              # Metro bundler
npm run android        # build + run on Android device/emulator
npm run ios            # build + run on iOS simulator (needs `bundle exec pod install` in ios/ first)
npm test               # Jest (@react-native/jest-preset)
npm run lint           # ESLint (@react-native config)
npx tsc --noEmit       # typecheck (no npm script for it yet)
```

Run a single test: `npm test -- __tests__/App.test.tsx` or `-t "renders correctly"`.

Node >= 22.11 required.

## Layout

- [App.tsx](App.tsx) — root component. [index.js](index.js) registers it via `AppRegistry`.
- [__tests__/](__tests__/) — Jest tests.
- `android/`, `ios/` — native projects.
- [Doc_Files/](Doc_Files/) — the product spec. Read in order; start with
  [Doc_Files/README.md](Doc_Files/README.md).

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
