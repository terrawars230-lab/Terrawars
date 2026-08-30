# 06 — Anti-Cheat, Privacy & Play Store Compliance

> ⚠️ **Verify before submission.** Google Play policies and target-API
> requirements change roughly annually (the target API bump lands each August,
> and testing requirements for new developer accounts have changed more than
> once). Everything in § 6–8 must be re-checked against the current Play Console
> and Play Policy Center before you build the release. Treat this section as a
> checklist of *what to verify*, not as current-as-of-today fact.

---

## 1. The threat model

The entire value of the app is that territory was *actually walked*. If faking a
walk is easy, the leaderboard is worthless within a week and honest users leave.
Rank cheating in a location game is not a hypothetical — it is the default
outcome without defences.

| Threat | How | Severity |
|---|---|---|
| T1 | Mock location apps (developer options, `SetMockLocation`) | **Critical** |
| T2 | Modified APK bypassing client checks | **Critical** |
| T3 | Direct API calls with fabricated point sets | **Critical** |
| T4 | Walking recorded in a car/bike/train | High |
| T5 | Rooted device with system-level location hooks | High |
| T6 | Replaying a previously recorded genuine walk | Medium |
| T7 | Multiple accounts feeding one player territory | Medium |

**Design principle:** the client is untrusted. Every defence below that lives on
the phone is a *speed bump*; every defence that decides ownership lives on the
server.

---

## 2. Client-side signals (collected, never trusted)

| Signal | Source | Sent as |
|---|---|---|
| Mock location flag | `Location.isMock` (API 31+) / `isFromMockProvider` | per point `is_mock` |
| Mock-location app installed | package query | `integrity.mock_apps_present` |
| Developer options enabled | `Settings.Global.DEVELOPMENT_SETTINGS_ENABLED` | `integrity.dev_options` |
| Root indicators | su binary, common root package check | `integrity.root_signals` |
| Play Integrity verdict | Play Integrity API | `integrity_token` (server-verified) |
| Step count | `TYPE_STEP_COUNTER` sensor delta over the walk | `integrity.steps` |
| Accelerometer activity | variance sampled every 30 s | `integrity.motion_score` |
| Device clock skew | server time vs device time at start/finish | `integrity.clock_skew_s` |

**Step counter cross-check is the single strongest cheap signal.** A genuine
3 km walk produces roughly 3 500–4 500 steps. A mock-location route produces
near zero. Flag any walk where `steps < distance_m / 2` — but *flag*, do not
auto-reject: a phone in a bag or a stroller handle produces odd step counts, and
some devices lack the sensor entirely.

---

## 3. Server-side validation (authoritative)

Runs inside `finish_walk` before any geometry is written.

### Hard rejections
1. Any `ERR_*` rule from doc 03 § GR-04.
2. `is_mock = true` on more than 5% of points ⇒ `ERR_INTEGRITY`.
3. Play Integrity verdict is not `MEETS_DEVICE_INTEGRITY` ⇒ `ERR_INTEGRITY`
   (allow `MEETS_BASIC_INTEGRITY` in v1 with a flag, so you don't lock out
   legitimate custom-ROM users on day one; tighten later with data).
4. Two or more teleport segments (GR-01 step 5).
5. Isoperimetric violation (GR-05).
6. Walk duration inconsistent with server-observed upload timeline — e.g. a
   45-minute walk whose points all arrived in one batch 20 seconds after start.

### Soft flags (write to `moderation_flags`, allow the claim)
| Flag | Threshold |
|---|---|
| `LOW_STEPS` | steps < distance_m / 2 |
| `TOO_SMOOTH` | speed standard deviation < 0.15 m/s — real humans are not metronomes |
| `PERFECT_GEOMETRY` | polygon fits a circle/rectangle within 2 m residual |
| `NO_ALTITUDE_VARIANCE` | altitude identical across a 2 km walk |
| `ROOTED_DEVICE` | root signals present |
| `IMPOSSIBLE_JUMP` | first point > 50 km from last walk's end within 1 h |
| `DUPLICATE_ROUTE` | Hausdorff distance to one of the user's last 20 paths < 15 m *and* timing profile nearly identical (T6) |
| `MULTI_ACCOUNT` | ≥ 3 accounts sharing a device id, all feeding one area (T7) |

### Escalation
- 3 soft flags in 7 days ⇒ account enters **review**: claims still resolve but
  the user is hidden from leaderboards.
- 5 flags or any hard-rejection pattern ⇒ **shadow suspension**: walks record,
  claims silently do not apply. Do not tell cheaters exactly which check caught
  them; it just teaches them what to fix.
- Provide an appeals email in settings. Some flags will be wrong.

**Build the moderation table and the flags in Phase 6, before public launch.**
Retrofitting anti-cheat after a leaderboard is already poisoned means resetting
everyone's score, which costs more users than the cheating did.

---

## 4. Privacy

The app collects continuous precise location. That is among the most sensitive
categories of personal data there is, and the design must reflect it.

### Rules
1. **Routes are never public.** Only finished, simplified parcel polygons are
   visible to others. No live positions, no path lines, no start points (FR-05).
2. **Raw points are deleted after 30 days** (NFR-09). Derived geometry persists.
3. **No location outside an active walk.** Ever. No passive collection, no
   geofencing, no "improve our service" background sampling.
4. **Simplification is a privacy feature.** The 3 m tolerance (GR-03) blurs
   exactly where on a street someone walked.
5. **Home-address risk:** a loop starting and ending at someone's front door
   reveals their home. Mitigate by trimming the first and last 25 m of the
   stored path before it is used for anything visible, and by warning users in
   onboarding that starting from home makes their home the corner of a public
   polygon. Consider making this a settings toggle: *"Hide the start of my walks."*
6. Minors: set the Play content rating honestly, and consider gating signup at
   13+ (16+ in some jurisdictions). A location game with public territory and a
   messaging-free design is lower risk, but it is still location data on kids.
7. Publish a real privacy policy at a stable URL before submission. It must name
   what is collected, why, retention periods, and how to delete.

### Deletion behaviour (FR-06)
On account deletion: remove `profiles`, `walks`, `walk_points`, `push_tokens`,
and auth record. For `parcels` — do **not** cascade-delete the geometry
immediately, or the map develops holes and other players' history breaks.
Instead reassign to a `[deleted]` system owner and let the land be claimable
normally. `steal_events` keep the id but resolve the username to `[deleted]`.
State this in the privacy policy.

---

## 5. Android permissions

| Permission | Needed | Why |
|---|---|---|
| `ACCESS_FINE_LOCATION` | Yes | Core tracking |
| `ACCESS_COARSE_LOCATION` | Yes | Declared alongside fine |
| `FOREGROUND_SERVICE` | Yes | Walk tracking service |
| `FOREGROUND_SERVICE_LOCATION` | Yes | Required from Android 14 |
| `POST_NOTIFICATIONS` | Yes | Android 13+, for raid alerts |
| `ACTIVITY_RECOGNITION` | Yes | Step counter cross-check (§ 2) |
| `INTERNET`, `ACCESS_NETWORK_STATE` | Yes | — |
| `ACCESS_BACKGROUND_LOCATION` | **No** | Deliberately avoided — see D-04 |

Manifest:
```xml
<service
    android:name=".WalkTrackingService"
    android:foregroundServiceType="location"
    android:exported="false" />
```

**Prominent disclosure (required):** before the system permission dialog, show
a full-screen rationale that says, in the user's language, what is collected,
that it happens while a walk is running, and what it is used for. A permission
request that appears with no context is both a policy risk and the main cause of
first-session drop-off.

---

## 6. Play Store submission checklist

Work through this in Phase 8. Re-verify each item against the current console.

- [ ] Target API level meets the current Play requirement (bumps each August)
- [ ] App bundle (`.aab`), signed with Play App Signing
- [ ] **Data safety form** completed — declare precise location, account info,
      app activity; declare encryption in transit; declare deletion mechanism
- [ ] Privacy policy URL live and reachable
- [ ] Account deletion: both in-app (FR-06) **and** a public web URL, as Play
      requires
- [ ] Content rating questionnaire (IARC)
- [ ] Store listing: title, short + full description, feature graphic,
      minimum 4 phone screenshots, 8:9 or 16:9 assets
- [ ] Foreground service type declaration in Play Console (Android 14+ requires
      you to declare and justify each foreground service type)
- [ ] Ads declaration: **No** for v1
- [ ] Government/health/finance declarations: **No**
- [ ] Verify the current testing requirements for your account type — new
      personal developer accounts have had a closed-testing requirement (a
      minimum number of testers over a minimum number of days) before
      production access. **Check this early**, because it can add weeks to
      launch and you cannot compress it.
- [ ] Internal testing track working end-to-end before closed testing starts

---

## 7. Legal & safety copy to write

- Privacy policy (required)
- Terms of service, including: no fraudulent location data, account termination
  rights, no guarantee of territory persistence
- **Walk safely** notice, shown on first walk and in settings: *"Watch the road,
  not your phone. Don't walk into traffic, private property, or unsafe areas to
  claim territory."* This is not boilerplate — a game that rewards routing
  people through unfamiliar places has a real duty here.
- In-app reporting for harassment-style behaviour (e.g. a user repeatedly
  targeting one person) — even without chat, targeted play can become
  harassment.

---

## 8. Things that will surprise you later

Written down now so they aren't discovered at submission:

1. **Play Integrity has a request quota.** Free tier is limited; check the
   current daily limit and request more before launch if needed.
2. **Doze and OEM battery killers.** Xiaomi, Oppo, Vivo and Samsung aggressively
   kill foreground services despite policy. You need a per-OEM "allow background
   activity" guidance screen, or walks will silently die on the most common
   devices in your likely market.
3. **GPS in dense urban areas** drifts 20–40 m between buildings. Your
   `MAX_ACCURACY_M = 30` filter may reject too much downtown. Tune with real data.
4. **Map tile costs** are the sleeper bill. Confirm your provider's free-tier
   terms in writing before launch (see D-03).
5. **Empty-map cold start.** In a new city the map is blank and the game feels
   dead. Plan a launch strategy around one city and seed it — this is why OQ-3
   defaults to a single city.
