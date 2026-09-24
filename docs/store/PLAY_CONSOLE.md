# Google Play Console — what to enter

Everything the Play Console asks for before TerraWars can be published, with
the answer that matches what the app actually does. Work through it top to
bottom in **Play Console → your app → Policy → App content**, then **Store
presence → Main store listing**.

The answers here must stay consistent with three other places. If you change
one, change all four:

- the privacy policy (`docs/store/legal/privacy-policy.html`, published at
  `PRIVACY_POLICY_URL`);
- the in-app location disclosure (`permissions.*` in
  `src/core/i18n/locales/en.json`);
- `android/app/src/main/AndroidManifest.xml` (the permissions declared).

Items marked **Verify** are Play policy details that change over time — check
the current Console wording before relying on the answer.

---

## 1. Privacy policy

- **Privacy policy URL:** the public URL where you host
  `docs/store/legal/privacy-policy.html` (default `https://terrawars.app/privacy`).
  Fill in every highlighted `[PLACEHOLDER]` before publishing it.
- The same URL is linked inside the app (sign-up consent and Settings → Privacy
  policy), which Play expects.

## 2. App access

Reviewers must be able to sign in. Choose **"All or some functionality is
restricted"** and add instructions:

- **Username / email:** a test account you create for review, e.g.
  `review@terrawars.app` — sign it up in the production app, confirm its email,
  and choose a username so it lands straight on the map.
- **Password:** its password.
- **Instructions (paste):**

  > Sign in with the account above. The map is the home screen.
  > Tap **Start walk** to see the location disclosure, grant location, and
  > record a walk; the walk keeps recording with the screen off and shows a
  > persistent notification. Territory is only claimed by physically walking a
  > closed loop of at least 200 m that encloses at least 500 m² — a walk that
  > doesn't close a loop is still saved and shows "No claim this time".
  > Account deletion: Profile → Settings → Delete my account.
  > Mock/fake GPS locations are rejected by design (anti-cheat).

## 3. Ads

**Does your app contain ads?** No.

## 4. Content rating (IARC questionnaire)

- **Category:** Game (or "All other app types" if the questionnaire routes a
  location game there — **Verify**).
- Violence, sexuality, language, controlled substances, gambling: **None**.
- **Does the app allow users to interact or exchange content?** Users see each
  other's public usernames, territory and stats; there is **no chat, messaging,
  or user-uploaded media**. Answer the interaction questions accordingly.
- **Does the app share the user's physical location with other users?** **No.**
  Only finished territory areas are public — never a live position or a route.
- **Digital purchases:** No.

Expected result: an all-ages or low-age rating. The app itself gates sign-up at
13+ (`MIN_SIGNUP_AGE`), which is set by the target-audience answer below, not
by the rating.

## 5. Target audience and content

- **Target age groups:** 13–15, 16–17, 18 and over. **Do not select any
  under-13 group** — that would put the app under the Families policy, which a
  location game with public usernames does not meet.
- **Could the app unintentionally appeal to children?** No (no child-directed
  characters or themes).

## 6. News app / Government app / Financial features

All **No**.

## 7. Health apps declaration — **Verify**

TerraWars records walks (distance, duration, pace). If the Console asks
whether the app has health or fitness features, answer that it has
**activity/fitness tracking** (walk recording) and that it does **not** use
Health Connect. It is not a medical app.

## 8. Advertising ID

**Does your app use advertising ID?** **No.** The merged release manifest
contains no `com.google.android.gms.permission.AD_ID` (checked with
`apkanalyzer manifest permissions` on the release APK).

## 9. Foreground service permissions (Android 14+)

TerraWars declares one foreground service, `WalkTrackingService`, with
`foregroundServiceType="location"` and the `FOREGROUND_SERVICE_LOCATION`
permission.

- **Permission:** `FOREGROUND_SERVICE_LOCATION`.
- **Use case / task:** user-initiated, ongoing recording of the user's own
  walking route (fitness-style workout tracking) — the same pattern as a
  run/walk tracker. Closest Console option: location / navigation-style
  tracking — **Verify** the current option names.
- **Description (paste):**

  > The user taps "Start walk" in the app. A foreground service records their
  > GPS route for the duration of that walk only, including while the screen is
  > off, so the app can draw the route and measure the area it encloses (the
  > core game mechanic). It shows a persistent notification with the elapsed
  > time and distance for as long as it runs, and stops the moment the user
  > taps Finish or Discard. It is never started automatically and never runs
  > outside a walk the user started. The app does not request background
  > location permission.

- **Video:** record 30–60 s on a real phone showing: map → Start walk → the
  in-app disclosure → system permission dialog → the walk screen → pull down
  the notification (timer running) → lock the screen, unlock → Finish. Upload
  it unlisted (e.g. YouTube) and paste the link.

## 10. Location permissions

**Nothing to declare**: the app does not request `ACCESS_BACKGROUND_LOCATION`
(ADR D-04). The "Location permissions" declaration form only applies to
background location. The in-app prominent disclosure still exists
(`LocationRationaleScreen`) because Play's User Data policy requires one for
location collected while the app is not in view — here, during a walk with the
screen off.

## 11. Data safety

**Data collection and security**

| Question | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | **Yes** |
| Is all of the user data collected by your app encrypted in transit? | **Yes** (HTTPS/TLS to Supabase and Google) |
| Which account creation methods does your app support? | **Username and password** (email + password) |
| Do you provide a way for users to request that their data is deleted? | **Yes** — in-app (Settings → Delete my account) and the web URL below |
| Delete account URL | Where you host `docs/store/legal/delete-account.html` (default `https://terrawars.app/delete-account`) |

**Data types.** "Shared" is **No** for every type: Supabase and Google Maps
process data on TerraWars' behalf as service providers, which Play does not
count as sharing.

| Category → Type | Collected | Shared | Ephemeral | Required? | Purposes |
|---|---|---|---|---|---|
| Location → **Precise location** | Yes | No | No | Optional — the map, profile and leaderboards work without it; recording a walk needs it | App functionality; Fraud prevention, security & compliance |
| Personal info → **Email address** | Yes | No | No | Required | Account management; App functionality |
| Personal info → **User IDs** (account id, public username) | Yes | No | No | Required | Account management; App functionality |
| Health and fitness → **Fitness info** (walk distance, duration, pace) | Yes | No | No | Optional (only when walks are recorded) | App functionality |
| App activity → **Other actions** (walks, claims, territory, scores) | Yes | No | No | Required | App functionality |
| App info and performance → **Diagnostics** (platform and OS version sent with each walk) | Yes | No | No | Required | App functionality; Fraud prevention, security & compliance |

Answer **No / not collected** for: approximate location (only precise is sent
off the device), name, address, phone, other personal info, financial info,
messages, photos/videos, audio, files, calendar, contacts, web browsing, device
or other IDs, crash logs (no crash SDK is included), app interactions and
in-app search history.

**Google Maps SDK — Verify.** Play holds the app responsible for data its SDKs
collect. Google publishes a Play data-safety disclosure for the Maps SDK for
Android; merge its answers into the table above (it typically adds entries
such as diagnostics and device identifiers used for the map service, with
purposes like app functionality and analytics). Re-check whenever the SDK is
updated.

**If you later add** Sentry/Crashlytics (crash logs, diagnostics), push
notifications (FR-70; device IDs/tokens), or the step counter (doc 06 §2;
physical activity), update this form in the same release.

## 12. Store listing

- **App name:** TerraWars
- **Short description (≤ 80 chars):**
  `Walk a loop, claim the land inside it, and defend your territory on a live map.`
- **Full description:**

  > Walk outside and draw a loop — the land you enclose becomes your territory
  > on a map shared with every player in your city.
  >
  > • **Claim real ground.** Close a loop of at least 200 m and everything
  >   inside it is yours.
  > • **Defend it or lose it.** A rival who walks through your territory takes
  >   everything their loop encloses. Fresh claims are protected for a few
  >   hours.
  > • **Climb the leaderboard.** Ranked by total area held — globally and
  >   every week.
  >
  > **Your privacy.** Location is used only while a walk you started is
  > recording. Other players never see your route or your live position — only
  > the finished territory. Raw location points are deleted after 30 days, and
  > you can delete your account from inside the app at any time.
  >
  > **Walk safely.** Watch the road, not your phone, and never enter private
  > property or unsafe places to claim territory.

- **App category:** Games → Adventure (or Health & Fitness — pick one and keep
  the questionnaire answers consistent).
- **Contact email:** `SUPPORT_EMAIL`. **Website:** your domain.
- **Graphics:**
  - App icon 512 × 512: `docs/store/assets/play-store-icon-512.png`
  - Feature graphic 1024 × 500: `docs/store/assets/play-feature-graphic-1024x500.png`
    (a brand placeholder — replace with designed art when you have it)
  - Phone screenshots: at least 4, taken from a release build on a real
    device: map with territory, the walk screen mid-walk, the claim result,
    the leaderboard. Crop the status bar clean; no fake data from other
    players without their consent.

## 13. Before production — testing requirement — **Verify**

New personal developer accounts have had to run a **closed test** with a
minimum number of testers for a minimum number of days before production
access is granted. Check the current numbers in the Console as soon as the
account exists — it can add weeks and cannot be shortened. Run the internal
testing track end-to-end first (`docs/RELEASE.md`).
