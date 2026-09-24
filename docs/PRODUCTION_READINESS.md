# Production-readiness audit — September 2026

A full review of the app, native code and database ahead of the first store
release: what was wrong, what was changed, how it was verified, and what is
still open. Requirement IDs refer to `Doc_Files/`.

## How it was verified

- `npm run verify` — typecheck, ESLint (zero warnings), **287 unit tests**, plus
  the `src/geo` coverage gate.
- **Android release build** (`assembleRelease`, R8 + resource shrinking + JS
  bundle) succeeded; the APK was inspected with `apkanalyzer`: final
  permission list, `versionName 1.0.0`, and `com.terrawars.BuildConfig` with
  its `.env` fields intact after R8.
- **Not verified here:** the iOS build (needs macOS/Xcode) and the SQL suite
  (needs PostGIS; CI runs it). Both need a run before release — see "Open".

## Release blockers found and fixed

| # | Problem | Impact | Fix |
|---|---|---|---|
| 1 | `WalkTracker.swift` / `.m` were **not in the Xcode project** | Walk tracking did not exist on iOS | Added to the TerraWars target's Sources |
| 2 | Podfile lacked `setup_permissions` (react-native-permissions v5) | Every iOS location request failed; no walk could start | Registered `LocationWhenInUse`, `LocationAccuracy` |
| 3 | iOS bundle id was the template's `org.reactjs.native.example…` | Not `com.terrawars` (OQ-1) | Set in both configurations |
| 4 | iOS `AppIcon` set had no images | App Store upload rejected | 1024 px icon, generated |
| 5 | `PrivacyInfo.xcprivacy` not in *Copy Bundle Resources*, and declared no collected data | Upload rejected (ITMS-91053); inaccurate manifest | Bundled; six collected data types declared |
| 6 | Android release signed with the **debug key** | Play rejects the bundle | Upload-key signing from `keystore.properties`/env; `bundleRelease` refuses without it |
| 7 | Android 14+: `startForeground(location)` reached **before** the permission check | App crash when starting a walk without permission | Module checks before starting the service; service start guarded |
| 8 | Motion / `ACTIVITY_RECOGNITION` requested for a step counter that doesn't exist | Policy rejection (both stores) | Removed until the feature ships |
| 9 | No privacy-policy / terms link in the app | Play User Data policy, App Store 5.1.1 | Sign-up consent + Settings links; hostable pages in `docs/store/legal` |

## Data loss and correctness bugs fixed

| Problem | Fix |
|---|---|
| Samples were only recorded while the walk **screen** was mounted — going back to the map mid-walk silently dropped every point | `services/walkRecorder.ts`: one app-level subscriber, independent of screens |
| `finish()` uploaded **one** 200-point batch, then asked for the verdict — the server judged a route missing its end (FR-30) | Uploads every pending point first; on failure the claim is queued (FR-20) |
| "Discard and start fresh" left the old server walk active; the new walk reused its id with `seq` from 0, and ignore-duplicates **dropped the new route** | Old walk abandoned; `startWalk` only resumes a walk whose `client_walk_id` is this device's |
| Resuming an interrupted walk never restarted the native tracker — nothing recorded after "Resume" (FR-15) | `resumeWalk` restarts tracking when it isn't running |
| FR-19 auto-end fired on every sample past the cap, submitting the claim repeatedly | Fires once; finish is re-entrancy guarded |
| iOS `getCurrentPosition` swallowed walk samples while a map fix was pending | Samples always recorded; concurrent requests supported |
| Kill while paused counted the pause (and dead time) as walking | Pause persisted; restore treats the gap as paused (FR-16) |
| Sign-out left the previous account's cached profile → next user could skip the username gate | Query cache cleared on every session end |
| Offline claim queue could submit one player's walk under another's session | Queue entries tagged per account |
| Password-recovery flag stuck after a swipe-back — next normal sign-in forced a password reset | Cleared on any exit from the code screen |
| Sign-up confirmation link landed on `localhost` and the copy promised automatic sign-in | 6-digit code confirmation screen; hostable landing page |
| Claim result: a failed fetch rendered as "No claim this time"; `{{distance}}` shown raw | Server verdict carried as fallback; error state with retry; thresholds filled |
| Account deletion failures were swallowed | Error shown; envelope parsed |
| A deleted-but-in-grace-period account could keep playing | `get_me.deletion_requested` → "account is being deleted" screen |

## Performance and battery

| Problem | Fix |
|---|---|
| Loop detection was O(n²) with allocations per pair, re-run every 4 samples: **~10 s per call at 4,000 points** on a desktop | Spatial grid index, same results (equivalence-tested on 300 random walks): **~15 ms** |
| The walk screen re-rendered the whole map and trail every second | Clock isolated; geometry memoised |
| The world map rebuilt all polygon arrays every render | Precomputed per fetch; memoised polygons |
| React Query polled the map every 60 s forever, even in the background during a walk | AppState/NetInfo bound; polling only while the map is focused |
| iOS used navigation-grade GPS for walks | `kCLLocationAccuracyBest` |
| Walk notification text froze with the screen off | Native chronometer on the notification |

## Security and privacy hardening

- `walks`: column-level grants — a client can no longer write `integrity`,
  distance, duration, path or status (other than `active → abandoned`)
  (migration `20260922120000`, tests in `supabase/tests/03_rls.sql`).
- Crash-reporter context is redacted like logs, including arrays of fixes.
- Debug logging can't be enabled in a production build.
- App data excluded from Android backup and device-to-device transfer.
- `npm run release:check` refuses service-role / secret keys in `.env`.
- R8 obfuscation on release builds.

## Store readiness added

Real app icons (adaptive + monochrome, iOS, Play), monochrome notification
icon, dark launch screens and window background, Walk-safely notice with the
home-address warning (doc 06 §4–7), OEM battery guidance (doc 06 §8.2),
report-a-player, precise-location handling, Android 13+ notification
permission, portrait lock, iPhone-only target, export-compliance key, and the
compliance kit in `docs/store/`.

## Open — needs the owner

1. **"Hide the start of my walks"** (doc 06 §4 rule 5). The old toggle saved a
   preference nothing read; it was removed rather than left misleading.
   Building it means trimming the path in `finish_walk` *and* `src/geo` — a
   GR-level rule change. Decide whether v1 needs it.
2. **Crash reporting.** Phase 8 requires crash-free-rate monitoring. Play and
   App Store vitals cover native crashes; for JS stack traces add Sentry
   (`setCrashReporter` is the seam) and update both privacy declarations.
3. **Google Sign-In (FR-01, "Must")** is still not in the UI. If it ships on
   iOS, **Sign in with Apple becomes mandatory** (App Store 4.8).
4. **Raid push notifications (FR-42/70)** are not implemented.
5. **Username moderation.** Names are public; there is a report path but no
   server-side blocklist.
6. **Step counter (doc 06 §2).** Re-add the motion permission and its
   disclosure in the same change that ships it.
7. **Minimum age** is set to 13 (`MIN_SIGNUP_AGE`). Confirm for your launch
   markets and keep the store target-audience answers in step.

## Must be run before release

- iOS: `bundle exec pod install`, then an Xcode build on a real iPhone
  (the Swift and project-file changes could not be compiled on Windows).
- CI's SQL job, or `npm run test:sql` against a PostGIS database, for the two
  new migrations.
- The smoke test in `docs/RELEASE.md` §2.6 on real devices.
