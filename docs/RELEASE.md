# Releasing TerraWars

The runbook for shipping a build to Google Play and the App Store. Part 1 is
done once per project; part 2 on every release. Store-form answers live in
`docs/store/` (see `docs/store/README.md`).

---

## Part 1 — one-time setup

### 1.1 Supabase production project

The app is only as correct as the database behind it. In the production
project:

1. **Apply the schema.** Push every file in `supabase/migrations/` in order
   (`node scripts/db-push.mjs` or the Supabase CLI), then run
   `supabase/seed.sql` once — every rule function reads `game_config` and
   raises on a missing key, and the seed also creates the `deleted_player`
   owner that account deletion reassigns territory to.
2. **Schedule the nightly job — required, not optional.** Enable `pg_cron`
   (Database → Extensions) and run once:

   ```sql
   select public.schedule_maintenance();
   ```

   This job is what deletes raw GPS points after 30 days, abandons stale walks
   and hard-deletes accounts after the 7-day grace period. The privacy policy
   and the in-app disclosure both promise those deletions; without the job
   they never happen. Confirm with `select * from cron.job;`.
3. **Auth → Providers → Email:** email confirmation **on**; minimum password
   length **8** (matches the app); leaked-password protection on if your plan
   has it.
4. **Auth → Email templates:** both **Confirm signup** and **Reset password**
   must include the code — the app confirms accounts and resets passwords with
   the 6-digit code, not the link:

   ```html
   <p>Your TerraWars code is <strong>{{ .Token }}</strong></p>
   ```

   Keep the email OTP length at **6** digits (Auth settings); the app's input
   is 6 digits.
5. **Auth → URL configuration:** set **Site URL** to your hosted
   `email-confirmed.html` page, and add the same URL to **Redirect URLs**
   (it is `AUTH_EMAIL_REDIRECT_URL` in `.env`). Otherwise a user who taps the
   link instead of typing the code lands on `localhost`.
6. **Custom SMTP (Auth → SMTP settings).** Supabase's built-in mailer is
   limited to a handful of emails per hour and is not meant for production —
   at launch, sign-ups would fail with "too many emails". Use Resend,
   SendGrid, Postmark, SES or similar, and raise the email rate limit.
7. **Security & performance advisors** (Database → Advisors): resolve every
   security warning before launch.
8. **Backups:** use a plan with daily backups / point-in-time recovery. The
   migrations are forward-only.

### 1.2 Public pages

Host the four pages in `docs/store/legal/` on your domain (GitHub Pages,
Netlify, Vercel, Cloudflare Pages — any static host with HTTPS), after filling
in every highlighted `[PLACEHOLDER]` (legal name, address, dates, Supabase
region, email provider, jurisdiction):

| File | URL (default) | `.env` key |
|---|---|---|
| `privacy-policy.html` | `https://terrawars.app/privacy` | `PRIVACY_POLICY_URL` |
| `terms.html` | `https://terrawars.app/terms` | `TERMS_URL` |
| `delete-account.html` | `https://terrawars.app/delete-account` | `ACCOUNT_DELETION_URL` |
| `email-confirmed.html` | `https://terrawars.app/email-confirmed` | `AUTH_EMAIL_REDIRECT_URL` |

Make sure `SUPPORT_EMAIL` is a real, monitored inbox: deletion requests,
player reports and store reviewers all arrive there.

### 1.3 Android signing

Play uses **Play App Signing**: you sign uploads with an *upload key*; Google
re-signs for users with the *app signing key* it holds.

1. Create the upload key (keep the passwords in a password manager):

   ```sh
   keytool -genkeypair -v -storetype PKCS12 -keystore terrawars-upload.jks \
     -alias terrawars-upload -keyalg RSA -keysize 2048 -validity 10000
   ```

2. Put it **outside the repo** (or in `android/app/`, where `*.jks` is
   git-ignored) and create `android/keystore.properties` (git-ignored):

   ```properties
   storeFile=/absolute/path/to/terrawars-upload.jks
   storePassword=…
   keyAlias=terrawars-upload
   keyPassword=…
   ```

   CI can instead set `TERRAWARS_UPLOAD_STORE_FILE`,
   `TERRAWARS_UPLOAD_STORE_PASSWORD`, `TERRAWARS_UPLOAD_KEY_ALIAS` and
   `TERRAWARS_UPLOAD_KEY_PASSWORD`. `bundleRelease` refuses to run without one
   of the two.
3. **Back up the keystore and its passwords** in two places. Losing the upload
   key means a support ticket to Google; losing it without Play App Signing
   means you can never update the app again.

### 1.4 Google Maps keys — the production gotcha

Restrict the **Android** Maps key to package `com.terrawars` **and add every
SHA-1 that signs a build users run**:

- the **app signing key** SHA-1 — Play Console → *Test and release → App
  integrity → App signing*. This is the one Play users' phones see. Missing it
  is the classic "the map is blank grey in production but fine in my build";
- the **upload key** SHA-1 (`keytool -list -v -keystore terrawars-upload.jks`)
  for release builds you install directly;
- the debug SHA-1 for development, on a *separate* development key.

Restrict the **iOS** key to bundle id `com.terrawars`. Enable only "Maps SDK
for Android" / "Maps SDK for iOS" on each key, and set a daily quota and a
billing alert (doc 06 §8.4).

### 1.5 iOS

1. Register `com.terrawars` in the Apple Developer portal; create the app in
   App Store Connect.
2. In Xcode → target *TerraWars* → *Signing & Capabilities*, select your team.
   The *Background Modes → Location updates* capability is already declared in
   Info.plist.
3. `cd ios && bundle install && bundle exec pod install`.

---

## Part 2 — every release

### 2.1 Version

Edit **`app.json`** — Android reads it for `versionName` / `versionCode`, and
the app shows it in Settings:

```json
{ "version": "1.0.1", "buildNumber": 2 }
```

`buildNumber` must go **up by at least 1 on every upload**, even for the same
version. Mirror both in Xcode (`MARKETING_VERSION` = version,
`CURRENT_PROJECT_VERSION` = buildNumber) and `package.json`'s `version`.

### 2.2 Checks

```sh
npm run verify             # typecheck + lint + unit tests
npm run test:coverage      # the src/geo coverage gate
npm run release:check      # the .env about to be compiled in (production, no secret keys, links)
```

CI must be green, including the **SQL rules** job — it runs every migration
against real PostGIS. Apply new migrations to a **staging** Supabase project
and smoke-test before production.

### 2.3 Android build

```sh
cd android
./gradlew clean bundleRelease        # Windows: gradlew.bat clean bundleRelease
```

Output: `android/app/build/outputs/bundle/release/app-release.aab`. R8 is on
for release builds; the obfuscation mapping is embedded in the bundle, so Play
de-obfuscates Java/Kotlin crash stack traces automatically.

To try a release build on a device before uploading:
`./gradlew assembleRelease` and install
`app/build/outputs/apk/release/app-release.apk` (signed with the upload key if
configured, otherwise the debug key — never upload that one).

### 2.4 iOS build

Xcode → *Product → Archive* (scheme TerraWars, Release, "Any iOS Device") →
*Distribute App → App Store Connect*. Then add the build to TestFlight.

### 2.5 Staged rollout

1. **Internal testing** track → install from Play, run the smoke test below.
2. **Closed testing** — required before production for new personal
   developer accounts (see `docs/store/PLAY_CONSOLE.md` §13).
3. **Production** with a staged rollout: 10 % → watch Android vitals
   (crash-rate and ANR thresholds) for 24–48 h → 50 % → 100 %. Halt the
   rollout if the crash-free rate drops below 99 % (doc 07 Phase 8).

### 2.6 Smoke test (real devices)

Cover at least: Android 8 (minSdk), Android 13 (notification permission),
Android 14/15/16 (foreground-service rules), one Xiaomi/Redmi and one
Infinix/Tecno (aggressive battery killers), and a recent iPhone.

- [ ] Fresh install → onboarding → sign up → **6-digit code** arrives and confirms → username.
- [ ] Start walk → "Walk safely" (first time) → location disclosure → system dialog.
- [ ] Choose **approximate** location (Android 12+ / iOS Precise off) → app explains and asks for precise.
- [ ] Walk 10+ minutes with the **screen locked**: notification timer runs (Android), blue pill shows (iOS), route recorded.
- [ ] Go back to the map mid-walk → "Back to your walk" → nothing lost.
- [ ] Force-stop the app mid-walk → reopen → **Resume** → recording continues.
- [ ] Airplane mode at Finish → "Walk saved" → back online → claim appears on the map.
- [ ] Close a real loop → claim accepted → territory on the map.
- [ ] Settings → Privacy policy / Terms / Contact support open.
- [ ] Sign out → sign in (onboarding skipped) → Delete account → signed out; signing in again shows "being deleted".

### 2.7 Rollback

Play and the App Store cannot roll a user back to an older binary: ship a
fixed build with a higher `buildNumber`. Halt a staged rollout immediately
when vitals turn. Database migrations are forward-only — a bad migration is
fixed by a new migration, which is why they go through staging first.
