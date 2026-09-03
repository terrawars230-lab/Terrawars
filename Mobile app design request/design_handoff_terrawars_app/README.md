# Handoff: TerraWars mobile app UI (Nocturne dark theme)

## Overview
A full redesign of the TerraWars GPS territory game client: onboarding (3 distinct screens), auth, callsign
setup, location rationale, home map (game HUD over a map), active walk, claim result, parcel detail sheet,
rival public profile sheet, leaderboard, profile, and settings.

Target codebase: the attached React Native app (`TerraWars/`) — `react-native` + `@react-navigation`
(bottom tabs + stack), themed through `src/core/theme/tokens.ts` and `useTheme()`.

## About the design files
`TerraWars App.dc.html` in this bundle is a **design reference built in HTML** — a clickable prototype of the
intended look and behavior. It is **not production code to copy**. Implement these screens in the existing
React Native app using its own patterns: `useTheme()` + tokens (never raw hex in components), the existing
`src/components/` primitives, `routes.ts` route constants, and the existing navigators. Where the prototype
uses HTML/CSS constructs (`clip-path`, CSS gradients, `mix-blend-mode`), pick the RN equivalent
(`react-native-svg`, `react-native-linear-gradient`, `MapView` overlays).

## Fidelity
**High fidelity.** Colors, type sizes, spacing, radii, copy, and interactions are final. Recreate closely,
but express every value through the app's token layer rather than literals.

## Design tokens (Nocturne)
Add/confirm these in `src/core/theme/tokens.ts`; semantic names in parentheses are how components should read them.

| Token | Value | Use |
| --- | --- | --- |
| `bg` | `#161826` | app background |
| `surface` | `#232532` | cards, sheets, tab bar, HUD pills |
| `text` | `#e9e9ed` | primary text |
| `textMuted` | `text` @ 55–70% opacity | secondary/meta text |
| `divider` | `text` @ 16% | row rules, hairlines |
| `accent` | `#9184d9` | primary accent (lines, marks, active states) |
| `accent300` | `#d2cefd` | accent text at body size (contrast-safe) |
| `accent800` | `#423a6a` | tinted fills |
| `accent900` | `#2b2741` | highlighted-row fill |
| `neutral400` | `#b2b6ca` | inactive icons on surface |
| `neutral500` | `#9397ab` | inactive tab labels/icons |
| `neutral700` | `#595d6c` | toggle track off, inactive dots |
| `neutral800` | `#3f424d` | HUD borders, progress track |

Typography: Inter for headings and body. Sizes used: 30 (onboarding H1), 24 (screen H1 / walk metrics),
20 (settings H1), 19 (profile name / stat values), 17–16 (sheet titles, CTA labels), 15 (onboarding body),
14–13.5 (list rows, body), 12.5–11.5 (meta), 11–10.5 (uppercase kickers, tab labels).
Kickers: 10.5–11px, `letter-spacing: .08–.14em`, uppercase, accent or muted.
Weights: 400 body, 600 emphasis, 700 for walk metrics. Do not bolden headings past 500-ish weight per Nocturne.

Radii: 99px pills/dots, 22px bottom-sheet top corners, 14px cards/avatars, 12px HUD cards + map buttons,
10px list chips/parcel swatches, 8px small swatches.
Spacing: screen padding 20–30px; HUD inset 14px; gaps 8/10/12/16/22/26px.
Shadows: `shadow-sm` (HUD pills), `shadow-md` (raid card, marker), `shadow-lg` (bottom sheets, walk panel).

Territory palette (per-player, from the game's existing color assignment — keep as-is):
`#3B82F6 #EF4444 #10B981 #F59E0B #8B5CF6 #EC4899 #14B8A6 #F97316 #6366F1 #84CC16`

## Screens

### 1. Onboarding — 3 separate screens (`features/onboarding/screens/OnboardingScreen.tsx`)
Shared chrome: 54px top inset, right-aligned ghost "Skip"; bottom: clickable page dots (active 20×6px accent,
inactive 6×6px `neutral700`, tapping a dot jumps to that step), then a full-width primary CTA
(56px tall; "Next", "Next", "Get started").

- **1 — "Claim real ground"**: photograph full-bleed across the top 54% of the screen, blended into the ground
  (`mix-blend-mode: lighten` in HTML → in RN use the image at reduced opacity or a `screen` blend + a
  `linear-gradient(transparent 28% → bg 100%)` scrim below it). Text block bottom-left: accent kicker
  "TERRAWARS", H1 30px, body 15px/1.5. Body copy: "Walk a loop outside and the land you enclose becomes your
  territory on the shared map."
- **2 — "Defend it or lose it"**: centered 196px-tall diagram (SVG): your blue parcel
  (`#3B82F6` 26% fill, 2px stroke) overlapped by a dashed accent rival loop (`accent800` 60% fill, dash 7/5)
  with a 3px accent cut line and two 4.5px endpoint dots, on a faint 32px grid. Legend row: "Your land" (blue
  dot) / "Rival loop" (accent dot), 11.5px muted. Then H1 + body: "A rival who walks through your territory
  cuts away everything their loop encloses."
- **3 — "Climb the leaderboard"**: preview of leaderboard rows 4–7 (44px tall, 10px radius, rank / color dot /
  name / area); the user's row is filled `accent900` with a 1px accent border. Then H1 + body: "You're scored
  on total area owned — ranked globally, weekly, and across your city."

### 2. Auth (`features/auth/screens/SignUpScreen.tsx` / `SignInScreen.tsx`)
Centered 52px rounded-square logo tile (`accent800` fill, 1.5px accent border, map-pin icon) + "TerraWars"
20px. Segmented control Sign up / Sign in (drives which screen's copy shows). Email + password fields
(label 12px muted above a 1px-bordered input). Primary CTA 48px ("Create account" / "Sign in"). Divider, then
two secondary 46px buttons: Continue with Google, Continue with Apple (left-aligned icon + label).
Footnote 12px centered: "By continuing you agree this app tracks your location only while walking."

### 3. Choose callsign (`features/auth/screens/ChooseUsernameScreen.tsx`)
Kicker "STEP 1 OF 2", H1 24px "Pick your callsign", body "This is how rivals will see you on the map and
leaderboard." Row: 52px circular avatar (user-supplied photo; use the app's image picker) + name/hint text +
28px color swatch button on the right that **cycles the territory color** on tap. Field "Username"
(placeholder `e.g. northside_raider`). Bottom primary CTA 50px "Continue".

### 4. Location rationale (`features/onboarding/screens/LocationRationaleScreen.tsx`)
76px circular accent-tinted icon badge, H1 22px "TerraWars needs your location", body, then two check rows
(18px accent check + 13px text): "Tracked only during an active walk, never in the background" /
"Your raw route is private — rivals only ever see your finished parcel". Primary CTA 50px
"Allow while using app" + ghost "Not now" (both proceed; the real screen should request the permission).

### 5. Home / Map tab (`features/map/screens/MapScreen.tsx`) — the main redesign
Real map fills the screen (in the app: the existing MapView with a dark tile/style, camera on the user).
The prototype fakes it with an SVG street grid (11px major streets at ~88px pitch, 4px minor streets, one
14px diagonal avenue), a river path (`rgba(84,116,168,.16)`) and a park block (`rgba(104,150,118,.13)`).

Layers over the map, bottom to top:
1. **Territory polygons** — per-owner color, 28% fill (45% for your own), 1.5px solid border; protected parcels
   get a 2.5px accent border. Tap → parcel detail sheet.
2. **Rival pings** — 10px dots in rivals' colors, `pulse` animation (2.6s, staggered 0/0.9/1.7s).
3. **Your marker** — 76px accent halo at 16% opacity pulsing (3s) + 18px accent dot with a 3px bg-colored ring
   and `shadow-md`.
4. **Top HUD** (top inset 52px, side inset 14px, 10px gap):
   - Identity pill: 30px circular avatar + username 12.5px/600 + `"{area} held · #{rank}"` in `accent300` 10.5px.
     Surface at 90% opacity, 1px `neutral800` border, fully rounded, `shadow-sm`.
   - Streak chip on the right: flame icon + "6 days".
   - **Weekly contract card**: kicker "WEEKLY CONTRACT" (`accent300`), right-aligned progress text
     "3,120 / 5,000 m²", and a 5px progress track (`neutral800`) with an accent fill at 62% (animate width 0.3s).
5. **Right rail** (right 14px, bottom 194px): a small state label pill ("All territory" / "Only my land"), the
   44px layers button (toggles the filter; icon turns accent when filtering), and the 44px recenter button.
6. **Bottom stack** (left/right 14px, bottom 14px, 10px gap):
   - **Raid target card** (tappable → that parcel's detail): 38px color swatch, "{owner} is exposed" 13.5px/600,
     "{area} · {distance} from you" 11.5px muted, `Raid` outline tag on the right. `shadow-md`.
   - **Start Walk CTA**: 56px outlined primary button over a pulsing accent glow layer
     (`accent` @18%, 2.8s pulse, `pointer-events:none`), walking-feet icon + "Start Walk".
   - **Live ticker**: 7px pulsing accent dot + "3 rivals walking nearby" 11.5px muted.

Tab bar (all main tabs): surface, 1px top divider, 22px bottom safe-area padding, three items
(Map / Ranks / Profile) — 21px icon + 10.5px label, accent when active, `neutral500` when not.

### 6. Active walk (`features/walk/screens/ActiveWalkScreen.tsx`)
Map background; the recorded trail draws as a 4px accent polyline; once the loop closes, the enclosed polygon
fills `accent800` @40% with a 2px accent stroke. Bottom sheet (surface, 22px top radii, `shadow-lg`):
2×2 metric grid — Distance, Duration, Pace, Enclosed — labels 10px uppercase muted, values 24px/700
(Enclosed turns accent once claimable). Status line 12.5px centered: "Waiting for GPS…" →
"Keep walking to close the loop" → "Loop closed — finish to claim {area}" (accent). Buttons row: secondary
Pause/Resume + primary Finish/Claim (48px each), then a ghost "Discard walk".
Formatting: distance `m` under 1 km then `km` 2dp; duration `m:ss`; area `m²` with thousands separators,
switching to `ha` (2dp) at 10,000 m².

### 7. Claim result (`features/walk/screens/ClaimResultScreen.tsx`)
Success: H1 "Territory claimed", kicker "AREA GAINED", 40px accent area value, optional line
"Includes {area} raided from rivals", plus 14 rising confetti particles (6px squares in territory colors,
2.4s `rise` animation, staggered 0.15s). Rejected: H1 "No territory claimed" + reason paragraph.
Footer meta "Walk saved — {distance} in {duration}" and a 50px primary "Back to map".

### 8. Parcel detail (bottom sheet over the map — `features/map/screens/ParcelDetailScreen.tsx`)
Scrim `rgba(10,11,18,.6)`. Sheet: 34px color swatch + owner (or "You") + "Claimed {relative date}", close
button (32px circle). Card row: kicker "Area" + value, plus a `Protected` outline tag with shield icon when
applicable. Own land → advisory copy. Rival land → copy "Walk a loop that crosses this land to cut away the
overlap and claim it." + primary "Raid this territory" (starts a walk).

### 9. Rival public profile (bottom sheet from a leaderboard row — `features/profile/screens/PublicProfileScreen.tsx`)
52px avatar + username 17px + "Rank #{n} · {area}", close button. Three-column stat grid: Territory (color
swatch), Area, Rank. Copy: "Their nearest parcel to you is open to raid — walk a loop that crosses it to cut
away territory." Primary "Raid their territory" (starts a walk).

### 10. Leaderboard (`features/leaderboard/screens/LeaderboardScreen.tsx`)
H1 24px "Leaderboard", segmented Global / Weekly, then 52px rows: rank 13px muted, 12px color dot, username,
area 13.5px/600, chevron. Rows are tappable → rival public profile. Pinned footer bar: accent fill,
bg-colored text, 48px, 10px radius — "Your rank #6" / "18,940 m²".

### 11. Profile (`features/profile/screens/ProfileScreen.tsx`)
56px circular avatar + name 19px + `@handle` 12.5px muted. Kicker "TOTAL AREA" + 36px accent value +
"Ranked #6 globally". Two-column stat grid (20px gap): Parcels 14, Walks 37, Distance 96.4 km,
Best claim 3,210 m², Stolen 5,880 m², Lost 1,240 m² — labels 10.5px uppercase muted, values 19px/600.
Secondary 46px "Settings".

### 12. Settings
44px minimum rows: Units (segmented Metric/Imperial), Raid notifications (switch: 46×27px track, 22px knob,
accent when on, `neutral700` when off), Dark surface (disabled on-switch at 60% opacity),
Privacy & location (chevron row). Footer secondary "Sign out" → returns to onboarding.

## Interactions & behavior
- Onboarding: Next advances; dots jump; Skip → auth. Auth submit → callsign (sign-up) or main tabs (sign-in).
- Callsign: color swatch cycles the 10 territory colors; Continue → location rationale → main tabs.
- Map: parcel tap → parcel sheet; raid-target card → that parcel's sheet; layers button toggles "only mine";
  Start Walk → active walk.
- Active walk (prototype simulation — replace with real GPS): 1s tick adds 1.35 m and 1 s; after 8 s the loop
  is treated as closed (`canClaim`, 2,340 m²); Pause freezes the tick; Finish → claim result (accepted only if
  the loop closed, with 480 m² attributed as stolen); Discard → map.
- Leaderboard row → rival sheet; "Raid their territory"/"Raid this territory" → start a walk.
- Animations: `pulse` (opacity .55→1, scale 1→1.12) for marker halo, pings, CTA glow, live dot;
  `rise` (translateY 0→-160px, opacity 1→0) for confetti; 0.15–0.3s transitions on toggles/progress.
- Every interactive element needs a themed pressed/hover state from the accent ramp — no default platform
  highlight (RN: `Pressable` with a themed pressed style).

## State
`screen` (route), `onboardingStep` 0–2, `authMode`, `username`, `myColorIdx`, `tab`, `showOnlyMine`,
`selectedParcelId`, `selectedRivalUsername`, `leaderboardScope`, `units`, `notifications`,
`walk { elapsedS, distanceM, areaM2, canClaim, phase }`, `claim { accepted, gained, stolen, reason }`.
In the app these map onto navigation params + the existing walk store; replace the simulated tick with the
real location subscription and the server's claim response.

## Assets
- `assets/photo.jpg` — onboarding hero photograph (from the Nocturne design system; swap for real product
  photography shot on a dark background).
- Icons in the prototype are inline SVG stand-ins; the design system specifies **Phosphor** — use the
  Phosphor RN package (or the app's existing icon set in `src/components/icons/`).
- User avatars are drop-in placeholders in the prototype; wire to the app's real avatar/image picker.

## Files
- `TerraWars App.dc.html` — the full clickable prototype (all screens, all interactions).
- `assets/photo.jpg` — onboarding photograph.
- `nocturne-styles.css` — the design system's token sheet (source of every color/spacing/radius/shadow value).
