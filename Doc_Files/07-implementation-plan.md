# 07 — Implementation Plan

Nine phases. Each has deliverables and **acceptance criteria that must be
demonstrably true before the next phase starts**. Do not run phases in parallel
until Phase 4 is done — the geometry has to be right before anything is built on
top of it.

Estimates assume one focused developer working with an AI coding agent.

---

## Phase 0 — Foundations (2–3 days)

**Deliverables**
- Monorepo per doc 02 § 3, Flutter app running on a device
- Supabase projects for `dev` and `prod`; PostGIS enabled
- Flavors + `--dart-define` config; Sentry wired
- GitHub Actions: analyze, test, build debug APK on PR
- `game_config` table seeded with doc 03 § 1 constants

**Acceptance**
- [ ] `flutter run --flavor dev` shows a themed placeholder screen
- [ ] `select postgis_version();` returns a version on both projects
- [ ] CI is green on a trivial PR

---

## Phase 1 — Auth & profile (3–4 days)

**Deliverables**
- Email/password + Google sign-in
- Username selection with live availability check (FR-02)
- Colour assignment (FR-03)
- `profiles`, `user_stats` tables + RLS + trigger creating both rows on signup
- Profile screen, settings screen, sign-out
- Account deletion flow (FR-06)

**Acceptance**
- [ ] New user completes signup → username → lands on an empty map
- [ ] Session survives app restart
- [ ] Deleting an account signs the user out and removes their profile
- [ ] RLS verified: user A cannot read user B's `walks` row via the anon key

---

## Phase 2 — Map & live tracking (5–7 days)

The riskiest phase. Everything downstream depends on point quality.

**Deliverables**
- MapLibre integrated, tile provider chosen (resolve OQ-2)
- Permission rationale screen → system dialog (doc 06 § 5)
- Kotlin `WalkTrackingService`: foreground service, `foregroundServiceType=location`, persistent notification with live distance/duration
- Platform channel: service → Dart point stream
- Drift schema for local walk + points; write on every sample (FR-15)
- Live trail polyline, live distance/duration/pace HUD
- Pause/resume/stop; crash recovery prompt on relaunch
- Point cleaning on the client for display (accuracy + jitter filters)

**Acceptance**
- [ ] A 30-minute walk with the screen off records a continuous, clean trail
- [ ] Force-killing the app and reopening offers "resume or discard"
- [ ] Battery drain over 60 minutes ≤ 8% on the reference device (NFR-01)
- [ ] Airplane mode for the whole walk loses zero points
- [ ] Verified working on at least one Xiaomi/Oppo/Vivo device (doc 06 § 8.2)

> If this phase slips, let it. A flaky tracker makes every later phase untestable.

---

## Phase 3 — Claiming (5–7 days)

**Deliverables**
- SQL: `build_claim_polygon` implementing GR-01 → GR-05
- SQL: `finish_walk` implementing GR-11 and GR-21 (own-parcel merge) — rival
  stealing comes in Phase 4
- `walks`, `walk_points`, `claims`, `parcels` tables + RLS
- `POST /walks`, `/points`, `/finish` repository methods; offline submit queue (FR-20)
- Client-side incremental loop detection (GR-02) for the live "claim now" prompt
- Claim result screen with all rejection messages from doc 03 § 6
- **pgTAP tests for every rule in doc 03**, including the pathological fixtures

**Acceptance**
- [ ] A real walked loop produces a parcel visible on the map
- [ ] Every `ERR_*` code is reachable by a test fixture and shows correct copy
- [ ] Figure-eight path resolves to the largest ring, not an invalid polygon
- [ ] Re-walking the same loop yields net gain ≈ 0 (GR-21)
- [ ] Two adjacent loops by the same user merge with no hairline gap
- [ ] Submitting the same walk twice creates exactly one claim
- [ ] Rejected claims still save distance and duration

---

## Phase 4 — Stealing (4–5 days)

**Deliverables**
- GR-20 in `finish_walk`: intersection, difference, multipolygon split, sliver
  discard, protection clipping
- `steal_events`, protection window (GR-23), enclave rule (GR-22)
- World map rendering of all owners' parcels, with protection styling
- `parcels_in_bbox` with zoom-based simplification (doc 04 § 4)
- Post-claim screen showing steals and blocked-by-shield outcomes
- Realtime parcel updates (FR-54)

**Acceptance**
- [ ] Player B's overlapping loop transfers exactly the intersection area
- [ ] A corridor through a parcel splits it into two owned parcels
- [ ] Remainders under 100 m² vanish rather than becoming slivers
- [ ] Protected parcels clip the attacker's claim and are not taken
- [ ] Two players finishing overlapping claims simultaneously produce a
      consistent result with no lost or double-counted area (run this as a
      concurrency test, not a manual one)
- [ ] Enclaves survive being surrounded

---

## Phase 5 — Stats, leaderboards, notifications (4–5 days)

**Deliverables**
- `weekly_scores` + rollup job; all three leaderboards (FR-60/61/62)
- Own-rank-always-visible logic (FR-63)
- Personal stats screen (FR-64), public profile (FR-05)
- FCM setup, `push_tokens`, Edge Function fan-out on steal (FR-42)
- Notification settings toggles (FR-72)

**Acceptance**
- [ ] Leaderboards p95 < 300 ms with 10k seeded users
- [ ] Being raided produces a push that deep-links to the lost area
- [ ] Weekly board resets correctly across a Monday 00:00 UTC boundary
- [ ] Notification permission denial degrades gracefully

---

## Phase 6 — Anti-cheat hardening (4–5 days)

**Deliverables**
- Play Integrity API integration + server-side token verification
- Mock-location detection, root signals, step counter, motion score (doc 06 § 2)
- All hard rejections and soft flags (doc 06 § 3); `moderation_flags`
- Escalation: review state, shadow suspension, leaderboard exclusion
- A simple internal admin view over flags (can be a Supabase SQL view + Metabase)

**Acceptance**
- [ ] A mock-location app cannot produce an accepted claim
- [ ] A fabricated direct API call with an impossible polygon is rejected
- [ ] A genuine walk on a genuine device produces zero flags across 10 test walks
- [ ] Flagged users disappear from leaderboards but see no error

---

## Phase 7 — Onboarding & polish (4–6 days)

**Deliverables**
- Onboarding: three screens explaining walk → loop → own it, then the permission
  rationale (target: understood in under 20 seconds)
- Empty states everywhere: no parcels, no walks, empty leaderboard, empty map
- Walk-safety notice (doc 06 § 7); OEM battery-settings guidance screen
- Share image for a completed claim (FR-34)
- Loading/skeleton states, error retry, offline banner
- Accessibility pass (NFR-10); string extraction (NFR-11)
- Analytics events: signup, first walk started, first claim, claim rejected +
  reason, steal made, steal received, D1/D7 return

**Acceptance**
- [ ] Five people who have never seen the app complete a first claim unaided
- [ ] The § 3 goal metric — first-claim rate in session 1 — is instrumented
- [ ] No screen has an unhandled empty or error state

---

## Phase 8 — Release (1–2 weeks, mostly waiting)

**Deliverables**
- Everything in doc 06 § 6
- Privacy policy + ToS published
- Store listing assets
- Internal testing → closed testing (check current required duration and tester
  count for your account type) → production
- Crash-free rate monitoring; alerting on claim endpoint errors

**Acceptance**
- [ ] Release build passes pre-launch report with no policy warnings
- [ ] Crash-free sessions ≥ 99% across the closed test
- [ ] Ten real closed-test users each complete at least one claim

---

## Phase 9 — Post-launch (ongoing)

Only after the § 3 metrics in doc 01 are met:
1. Tune constants from real data — `MAX_ACCURACY_M`, `PROTECTION_HOURS`,
   `MIN_CLAIM_AREA_M2` are all guesses until you have a thousand real walks
2. Shields (first IAP) — the mechanic already exists, only billing is new
3. Cosmetics, then Pro tier
4. Clans, then iOS

---

## Build order rules

1. **Server geometry before client polish.** A pretty map over wrong ownership
   math is a rewrite.
2. **Every doc-03 rule gets a test in the same PR that implements it.**
3. **Test on cheap real Android devices from Phase 2 onward**, not just an
   emulator. Emulator GPS is perfect; real GPS is not, and this entire product
   lives inside that gap.
4. **Reference requirement IDs in commits** — `feat(claim): GR-20 rival parcel
   difference` — so the docs stay connected to the code.
5. **Constants live in `game_config`, never in code.** You will retune them
   weekly after launch.
