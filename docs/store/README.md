# Store compliance kit

Everything needed to get TerraWars through Google Play and App Store review,
and where each piece lives. Start here; the release mechanics are in
[`docs/RELEASE.md`](../RELEASE.md).

| What | Where |
|---|---|
| Play Console answers (Data safety, foreground service, content rating, target audience, app access, listing) | [`PLAY_CONSOLE.md`](PLAY_CONSOLE.md) |
| App Store Connect answers (privacy labels, review notes, age rating, export compliance) | [`APP_STORE.md`](APP_STORE.md) |
| Privacy policy — hostable page | [`legal/privacy-policy.html`](legal/privacy-policy.html) |
| Terms of service — hostable page | [`legal/terms.html`](legal/terms.html) |
| Account deletion without the app — hostable page (Play requirement) | [`legal/delete-account.html`](legal/delete-account.html) |
| "Email confirmed" landing page for the sign-up link | [`legal/email-confirmed.html`](legal/email-confirmed.html) |
| Play icon 512 × 512 | [`assets/play-store-icon-512.png`](assets/play-store-icon-512.png) |
| Play feature graphic 1024 × 500 (placeholder art) | [`assets/play-feature-graphic-1024x500.png`](assets/play-feature-graphic-1024x500.png) |

Icons are generated from one definition by `npm run icons`
(`scripts/generate-icons.py`), which also writes the iOS App Store icon and the
Android launcher fallbacks.

## What the app already does for compliance

| Requirement | Where it is met |
|---|---|
| Prominent location disclosure before the system prompt (Play User Data policy) | `LocationRationaleScreen` — what, when (incl. screen off during a walk), why, who sees it, retention |
| Location only while in use; no background-location permission (ADR D-04) | Manifest has no `ACCESS_BACKGROUND_LOCATION`; iOS asks When-In-Use only |
| Foreground service typed `location`, user-started, with a persistent notification | `WalkTrackingService` |
| No permission for a feature that doesn't exist yet | Motion / `ACTIVITY_RECOGNITION` removed until the step counter ships |
| Precise vs approximate location handled (Android 12+, iOS 14+) | `services/permissions/permissions.ts` |
| In-app account deletion (Play, App Store 5.1.1(v)) | Settings → Delete my account; `request_account_deletion` |
| Web account deletion (Play) | `legal/delete-account.html` |
| Privacy policy reachable in-app | Sign-up consent + Settings → Privacy policy |
| Terms accepted at sign-up; minimum age 13 | `ConsentCheckbox` (`MIN_SIGNUP_AGE`) |
| Report a player (UGC, App Store 1.2; doc 06 §7) | Public profile → Report this player |
| Walk safety notice (doc 06 §7) | `SafetyNoticeScreen`, before the first walk and in Settings |
| iOS privacy manifest with collected data and required-reason APIs | `ios/TerraWars/PrivacyInfo.xcprivacy` (now bundled in the app) |
| Export compliance | `ITSAppUsesNonExemptEncryption = false` |
| App data excluded from backup and device transfer | `data_extraction_rules.xml`, `backup_rules.xml` |
| Release signed with an upload key, never the debug key | `android/app/build.gradle` |
| Raw GPS deleted after 30 days; accounts purged after 7 days | `run_nightly_maintenance` — **must be scheduled** (RELEASE.md §1.1) |

## Before you submit — checklist

- [ ] Fill every `[PLACEHOLDER]` in `legal/*.html` and host the four pages over HTTPS.
- [ ] Set `PRIVACY_POLICY_URL`, `TERMS_URL`, `ACCOUNT_DELETION_URL`, `SUPPORT_EMAIL`, `AUTH_EMAIL_REDIRECT_URL` in the production `.env`; `npm run release:check` passes.
- [ ] Supabase production: migrations + seed applied, **nightly job scheduled**, email templates carry `{{ .Token }}`, custom SMTP configured (RELEASE.md §1.1).
- [ ] Maps Android key restricted to the **Play app-signing SHA-1** (RELEASE.md §1.4).
- [ ] A confirmed review account with a username exists; its credentials are in Play *App access* and App Store *Review information*.
- [ ] Play Data safety and App Store privacy answers entered exactly as in the two guides.
- [ ] Foreground-service declaration and demo video submitted in Play Console.
- [ ] Screenshots captured from a release build.
- [ ] Closed-testing requirement for your Play account type checked early.
