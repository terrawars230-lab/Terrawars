# 02 — Tech Stack

## 1. Summary

| Layer | Choice | Version target |
|---|---|---|
| Mobile app | **Flutter** (Dart) | Flutter 3.x stable, Dart 3.x |
| State management | **Riverpod** | 2.x |
| Local storage | **Drift** (SQLite) | latest stable |
| Map rendering | **MapLibre GL** via `maplibre_gl` | latest stable |
| Location | `geolocator` + a platform channel to a **Kotlin foreground service** | — |
| Backend | **Supabase** (managed Postgres + Auth + Realtime + Edge Functions) | — |
| Database | **PostgreSQL 15+ with PostGIS 3.4+** | — |
| Geometry logic | **PL/pgSQL functions inside Postgres** | — |
| Push | **Firebase Cloud Messaging** | — |
| Analytics/crash | **PostHog** (or Firebase Analytics) + **Sentry** | — |
| CI/CD | **GitHub Actions** → Play Console internal track | — |

Total infra cost at launch: **$0–25/month** (Supabase free/Pro, MapLibre tiles,
FCM free).

---

## 2. Decisions with rationale

### D-01: Flutter, not React Native or native Android

**Chosen:** Flutter.

*Why:* The app is map-heavy and animation-heavy, and it must later ship on iOS
without a rewrite. Flutter renders its own UI, which makes the custom map
overlays, live area counter and claim animations predictable across the wide
range of cheap Android devices this app will land on. Dart's strong typing also
makes a spec like doc 03 mechanically implementable.

*Cost accepted:* background location on Flutter needs a native Kotlin bridge.
That is a known, bounded piece of work (see D-04) — not a reason to reject.

*Rejected — Native Kotlin:* best location reliability and battery, but doubles
the timeline the moment iOS is on the table.
*Rejected — React Native:* viable, but its map + background location ecosystem
is more fragmented, and JS-thread hitches show up exactly during map panning.

### D-02: Supabase, not a custom Node/NestJS backend (for v1)

**Chosen:** Supabase.

*Why:* The single hardest part of this product is the geometry, and the
geometry wants to live in PostGIS anyway. Supabase gives a managed Postgres
where PostGIS is one `CREATE EXTENSION` away, plus auth, row-level security,
realtime subscriptions and object storage — all things you would otherwise spend
three weeks building. Claim resolution becomes one atomic `SELECT
finish_walk(...)` RPC call, which is exactly what NFR-06 and FR-33 demand.

*Cost accepted:* vendor coupling. Mitigated because the valuable part (schema
and PL/pgSQL functions) is portable to any Postgres. Only auth and realtime are
Supabase-specific, and both sit behind a thin repository interface in the app.

*Migration trigger:* move to a dedicated API service (NestJS + the same
Postgres) when any of these is true — claim p95 > 2 s, you need background job
queues, or you need server-side logic that cannot be expressed in SQL.

*Rejected — Firebase/Firestore:* no real geospatial support. Polygon overlap and
difference operations are the core of the product; doing them in application
code over a document store would be slow, wrong, and unfixable.

### D-03: MapLibre GL, not Google Maps or Mapbox

**Chosen:** MapLibre GL with a free/self-hostable vector tile source.

*Why:* Open source, no per-load billing, and it takes GeoJSON sources with
data-driven styling — which is exactly how thousands of coloured parcels should
be drawn (one source, one fill layer, colour from a feature property; not
thousands of individual polygon widgets).

*Cost accepted:* you must choose and possibly pay for a tile provider. Options:
MapTiler free tier, Protomaps (self-host a single .pmtiles file cheaply), or
Stadia Maps. Decide this at Phase 2. **Verify current free-tier limits before
committing — pricing changes.**

*Rejected — Google Maps SDK:* familiar, but adds billing risk as MAU grows and
its polygon rendering path is weaker for this many features.
*Rejected — Mapbox:* good product, generous free tier, but MAU-based pricing
becomes the app's largest bill exactly when success arrives.

### D-04: Foreground service, and *no* `ACCESS_BACKGROUND_LOCATION` in v1

**Chosen:** an Android foreground service with `foregroundServiceType="location"`
and a persistent notification. The user must have an active walk running; the
app can be backgrounded but the walk is visibly in progress.

*Why:* Requesting `ACCESS_BACKGROUND_LOCATION` triggers Google Play's sensitive
permission review — a declaration form, a demo video, and a real chance of
rejection or a multi-week delay. A foreground service covers the entire use case
(the user knows they are on a walk) with no review burden.

*Consequence for the product:* if the user force-kills the app, the walk stops.
This is acceptable and must be stated in onboarding.

*Reconsider when:* you want automatic walk detection with no user action. That
feature — and only that feature — justifies the background permission.

### D-05: Geometry in the database, not in Dart

**Chosen:** all claim validation, polygon construction, overlap resolution and
area math run as PL/pgSQL inside Postgres.

*Why:* Three reasons, in order of importance. (1) **Trust** — the client is
hostile by default in a competitive game; nothing a phone computes may decide
who owns land. (2) **Atomicity** — one transaction either transfers all
contested area or none (FR-33). (3) **Correctness** — PostGIS's `ST_Difference`,
`ST_MakeValid` and geodesic area are battle-tested; reimplementing them in Dart
would be a source of permanent bugs.

The client *does* compute a preview polygon for the live UI. It is advisory and
always overwritten by the server's answer.

### D-06: Riverpod for state, Drift for local persistence

Riverpod because the app has genuinely global, long-lived state (an in-progress
walk) that must survive navigation and be observed from several screens.

Drift because walk points must hit durable storage on every sample (FR-15) —
that is a write-heavy, query-light workload that SQLite handles well and that
`shared_preferences` or in-memory lists cannot.

---

## 3. Repository layout

A monorepo. The database is code and belongs next to the app.

```
terraclaim/
├── app/                          # Flutter application
│   ├── lib/
│   │   ├── main.dart
│   │   ├── core/                 # theme, router, config, errors, result types
│   │   ├── data/
│   │   │   ├── local/            # Drift database, DAOs
│   │   │   ├── remote/           # Supabase client wrappers
│   │   │   └── repositories/     # interfaces + implementations
│   │   ├── domain/               # pure Dart models & value objects (no I/O)
│   │   ├── features/
│   │   │   ├── auth/
│   │   │   ├── onboarding/
│   │   │   ├── walk/             # tracking, live map, claim preview
│   │   │   ├── map/              # world map, parcel rendering
│   │   │   ├── territory/        # my parcels, claim results
│   │   │   ├── leaderboard/
│   │   │   ├── profile/
│   │   │   └── settings/
│   │   └── services/             # location, notifications, integrity, connectivity
│   ├── android/
│   │   └── app/src/main/kotlin/.../WalkTrackingService.kt
│   └── test/
├── supabase/
│   ├── migrations/               # numbered, forward-only SQL
│   ├── functions/                # edge functions (push fan-out, scheduled jobs)
│   └── tests/                    # pgTAP tests for the geometry functions
├── docs/                         # these documents
└── .github/workflows/
```

**Architecture rule:** `features/` may depend on `domain/` and on repository
*interfaces*. `features/` may never import Supabase or Drift directly. This is
what keeps D-02's migration trigger cheap.

---

## 4. Key packages (Flutter)

| Purpose | Package |
|---|---|
| Backend client | `supabase_flutter` |
| State | `flutter_riverpod`, `riverpod_annotation` |
| Local DB | `drift`, `sqlite3_flutter_libs` |
| Map | `maplibre_gl` |
| Location | `geolocator`, `permission_handler` |
| Geometry (client preview only) | `dart_jts` or hand-rolled shoelace + segment intersection |
| Routing | `go_router` |
| Models | `freezed`, `json_serializable` |
| Push | `firebase_messaging`, `flutter_local_notifications` |
| Errors | `sentry_flutter` |
| Testing | `flutter_test`, `mocktail`, `integration_test` |

Pin every version in `pubspec.yaml`. No `any` constraints.

---

## 5. Environments

| Env | Supabase project | Flutter flavor | Play track |
|---|---|---|---|
| `dev` | `terraclaim-dev` | `dev` | — (local install) |
| `staging` | `terraclaim-staging` | `staging` | Internal testing |
| `prod` | `terraclaim-prod` | `prod` | Closed → Open → Production |

Secrets are supplied via `--dart-define-from-file` and GitHub Actions secrets.
**No key, URL, or token is ever committed.** The Supabase *anon* key is safe in
the client only because row-level security is enforced (doc 04 § 6); the
*service role* key must never appear in the app under any circumstance.

---

## 6. Testing strategy

| Layer | What | Tool |
|---|---|---|
| Geometry rules | Every rule in doc 03 gets a SQL test with fixed coordinate fixtures — including the deliberately nasty ones (figure-eight, self-touching, sliver remainder) | pgTAP |
| Domain | Loop detection, area preview, speed filtering | `flutter_test` |
| Repositories | Contract tests against a local Supabase | `flutter_test` + Docker |
| UI | Golden tests for map overlays and the claim result screen | `flutter_test` |
| E2E | Simulated GPS trace → walk → claim → steal | `integration_test` with a mock location provider |

**Rule:** no geometry function ships without a pgTAP test. The mechanics in
doc 03 are the product; a regression there is not a bug, it is a lost user.
