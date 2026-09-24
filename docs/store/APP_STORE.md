# App Store Connect — what to enter

Everything App Store Connect asks for before TerraWars can ship on iOS. The
privacy answers must match `ios/TerraWars/PrivacyInfo.xcprivacy` and the
privacy policy; change them together.

Items marked **Verify** depend on the current App Store Connect wording.

---

## 1. App information

- **Bundle ID:** `com.terrawars` (set in the Xcode project; register it in
  Certificates, Identifiers & Profiles first).
- **Name:** TerraWars · **Subtitle (≤ 30):** `Walk it. Claim it. Defend it.`
- **Primary category:** Games (Adventure) · **Secondary:** Health & Fitness.
- **Privacy policy URL:** your hosted `docs/store/legal/privacy-policy.html`.
- **Devices:** iPhone only. The target is set to iPhone
  (`TARGETED_DEVICE_FAMILY = 1`): the UI is designed for phones, and a
  universal app would also need iPad screenshots and iPad review.

## 2. App Privacy ("nutrition label")

**Do you or your third-party partners collect data from this app?** Yes.

**Data used to track you:** none. The app has no advertising, no ad SDKs and no
cross-app tracking, so no App Tracking Transparency prompt is needed.

**Data linked to you** — every type below: *Linked to the user: Yes*, *Used for
tracking: No*, purpose **App Functionality**.

| App Store Connect type | What it is in TerraWars |
|---|---|
| Location → **Precise Location** | The walk route, only while a walk records |
| Contact Info → **Email Address** | Account sign-in |
| Identifiers → **User ID** | Account id and the public username |
| User Content → **Gameplay Content** | Territory, claims, scores, rankings |
| Health & Fitness → **Fitness** | Walk distance, duration and pace |
| Diagnostics → **Other Diagnostic Data** | Platform and OS version sent with walks |

Not collected: name, phone, physical address, health, financial info,
contacts, photos/videos, audio, browsing/search history, purchases, crash data
(no crash SDK), performance data, advertising data, device ID.

If Sentry or another crash reporter is added, add **Crash Data** and
**Performance Data** here and in the privacy manifest in the same release.

## 3. Age rating

Answer the questionnaire honestly: no violence, sexual content, profanity,
gambling or unrestricted web access. **User-generated content** is limited to
public usernames (there is no chat or media); a report mechanism exists
(player profile → Report this player). Choose a rating of at least **13+**
(**Verify** the current age bands) so it agrees with the in-app sign-up age
gate (`MIN_SIGNUP_AGE = 13`).

## 4. Export compliance

Handled in the binary: `ITSAppUsesNonExemptEncryption = false` in Info.plist.
The app uses only the operating system's HTTPS/TLS. App Store Connect will not
ask on each upload.

## 5. App Review information

- **Sign-in required:** Yes. Provide a demo account (email + password) that is
  already confirmed and has a username, so the reviewer lands on the map.
- **Notes (paste):**

  > TerraWars is a walking game: the player walks a closed loop outdoors and
  > the area it encloses becomes their territory on a shared map.
  >
  > **Location and background mode.** The app requests only "When In Use"
  > location — never "Always". When the player taps Start walk, an in-app
  > screen first explains what is collected and why; then the system prompt
  > appears. The `location` background mode is used solely to keep recording
  > the walk the player started while the phone is locked or in a pocket; the
  > blue location indicator is shown the whole time
  > (`showsBackgroundLocationIndicator`). Tracking stops as soon as the player
  > taps Finish or Discard. Location is never collected outside an active walk.
  >
  > **Testing a walk.** Claiming territory requires physically walking a loop
  > (at least 200 m, enclosing at least 500 m²). Simulated locations are
  > rejected by design (anti-cheat). A short test walk is still saved and shows
  > "No claim this time" with the reason — that is expected behaviour.
  >
  > **Account deletion:** Profile → Settings → Delete my account (also
  > available on our website).
  > **Reporting players:** open any player's profile → Report this player.
  > **Sign-in:** email and password only; no third-party sign-in, so Sign in
  > with Apple is not required.

## 6. Screenshots

iPhone 6.9" (and 6.5" if still requested — **Verify**), taken from a release
build: the map with territory, a walk in progress, the claim result, the
leaderboard. The app is dark-only; capture on a device in any appearance.

## 7. Before submitting

- Run `pod install` in `ios/` after pulling — the Podfile now registers the
  `react-native-permissions` handlers (`LocationWhenInUse`,
  `LocationAccuracy`). Without them every location request fails on iOS.
- Archive from Xcode with a Distribution certificate for team
  `[YOUR TEAM ID]`; set the team in *Signing & Capabilities*.
- Bump `MARKETING_VERSION` and `CURRENT_PROJECT_VERSION` together with
  `app.json` (`docs/RELEASE.md`).
- Test on a real iPhone: grant location, lock the phone mid-walk, confirm the
  walk keeps recording and the blue indicator shows.
