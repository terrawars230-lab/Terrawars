# 01 — Product Requirements (PRD)

## 1. Problem & opportunity

Fitness apps track walks but the walk itself has no stakes. Territory games
(Turf Wars, Paper.io, Ingress) have stakes but are either abstract or
check-in based. TerraClaim makes the *shape* of your walk the reward: the
ground you enclose becomes yours, visibly, on a map other people see — and it
can be taken from you, which is what creates repeat sessions.

## 2. Target user

| Persona | Description | Primary motivation |
|---|---|---|
| **Casual walker** (primary) | 20–40, walks 20–45 min a few times a week, already uses a step counter | A reason to walk a different route than yesterday |
| **Competitive local** (retention driver) | Checks the leaderboard, plans routes, defends their neighbourhood | Rank, ownership, revenge |
| **Social explorer** | Walks with friends, screenshots the map | Sharing, discovery |

Do not design for cyclists or drivers. Speed limits in doc 06 will exclude them
deliberately.

## 3. Product goals (v1)

| Goal | Metric | Target at 90 days |
|---|---|---|
| Core loop is understood | % of new users completing a first valid claim in session 1 | ≥ 40% |
| Repeat behaviour | D7 retention | ≥ 20% |
| Conflict happens | % of active users who have both stolen and been stolen from | ≥ 30% |
| Trust | % of claims auto-rejected as fraudulent | < 3% |

## 4. Scope of v1

**In scope:** account + profile, live walk tracking with map, loop-based land
claim, land stealing, world map of all parcels, personal stats, three
leaderboards, push notification when raided, in-app account deletion.

**Out of scope:** payments, ads, teams, chat, iOS, wearables, offline map tiles,
route planning, indoor/GPS-denied handling.

## 5. Functional requirements

### 5.1 Accounts & profile

| ID | Requirement | Priority |
|---|---|---|
| FR-01 | User can create an account with email + password, or Google Sign-In. | Must |
| FR-02 | User must pick a unique username (3–20 chars, `a-z0-9_`) on first launch; it is public. | Must |
| FR-03 | User is assigned a territory colour at signup; changeable once per 30 days in v1. | Should |
| FR-04 | User can view their own profile: username, colour, total area owned, parcel count, total distance, walks completed, steals made, area lost. | Must |
| FR-05 | User can view another player's public profile (same fields, no PII, no route history). | Should |
| FR-06 | User can delete their account in-app. Deletion removes profile, walks and raw points; parcels are anonymised or released (see doc 06 § 5). | Must (Play policy) |
| FR-07 | Session persists across app restarts; token refresh is silent. | Must |

### 5.2 Walk recording

| ID | Requirement | Priority |
|---|---|---|
| FR-10 | User presses **Start Walk**; app requests foreground location permission if not granted, with a rationale screen shown *before* the system dialog. | Must |
| FR-11 | While a walk is active a foreground service with a persistent notification runs, showing live distance and duration. | Must |
| FR-12 | GPS is sampled on a distance filter of 5 m with a max interval of 5 s; points with horizontal accuracy worse than 30 m are discarded (see GR-10). | Must |
| FR-13 | The walked path is drawn live on the map as a coloured trail. | Must |
| FR-14 | The map shows live distance, duration, current pace, and enclosed-area estimate once the path is self-intersecting. | Should |
| FR-15 | Points are persisted to local storage immediately, so an app crash or kill does not lose the walk. On relaunch the user is offered to resume or discard the interrupted walk. | Must |
| FR-16 | User can pause and resume a walk. Paused time does not count toward duration and no points are recorded. | Should |
| FR-17 | User can end a walk at any time. If the loop is not closed, the walk is saved as distance-only with no claim, and the reason is shown plainly. | Must |
| FR-18 | When the app detects the loop has closed (GR-02), the user is prompted: *"Claim this area?"* with the polygon highlighted and its size shown. | Must |
| FR-19 | A walk has a hard cap of 4 hours and 25 km; exceeding either auto-ends it. | Should |
| FR-20 | If the device is offline at the end of a walk, the claim is queued and submitted automatically when connectivity returns (queue survives app restart, max age 24 h). | Must |

### 5.3 Claiming territory

| ID | Requirement | Priority |
|---|---|---|
| FR-30 | On walk finish the client uploads the full point set; **all claim validation and geometry resolution happens server-side**. The client's polygon is a preview only. | Must |
| FR-31 | The server returns a claim result: `accepted` (with net area gained, area stolen, victims) or `rejected` (with a machine code and human-readable reason). | Must |
| FR-32 | An accepted claim immediately updates the user's owned area and appears on the world map. | Must |
| FR-33 | Claim resolution is atomic: either the claimer gains and all victims lose, or nothing changes. | Must |
| FR-34 | Post-claim screen shows: area gained, area stolen and from whom, new total, new rank, and a share image. | Should |

### 5.4 Stealing

| ID | Requirement | Priority |
|---|---|---|
| FR-40 | A new claim that overlaps another player's parcel transfers the overlapping area to the claimer (GR-20). | Must |
| FR-41 | A parcel is protected from being stolen for 6 hours after it is claimed (GR-24). Protected areas are visually marked on the map. | Must |
| FR-42 | A victim receives a push notification: who took how much, and where. Tapping it opens that spot on the map. | Must |
| FR-43 | A user cannot steal from themselves; overlapping their own parcels merges them instead. | Must |
| FR-44 | Steal events are recorded and visible on both players' profiles as a simple history list. | Should |

### 5.5 Map & discovery

| ID | Requirement | Priority |
|---|---|---|
| FR-50 | World map renders all parcels in their owners' colours, with the current user's parcels visually distinct. | Must |
| FR-51 | Parcels are fetched by viewport bounding box and zoom level; below a zoom threshold, aggregated counts are shown instead of geometry. | Must |
| FR-52 | Tapping a parcel shows owner username, area, claimed date, and protection status. | Must |
| FR-53 | Map has a "recenter on me" control and a toggle for *my parcels only*. | Should |
| FR-54 | Newly claimed or stolen parcels appear for other users within 60 seconds without an app restart. | Should |

### 5.6 Stats & leaderboards

| ID | Requirement | Priority |
|---|---|---|
| FR-60 | Leaderboard — Global by total area owned. | Must |
| FR-61 | Leaderboard — Weekly by area *gained* in the current ISO week (resets Monday 00:00 UTC). | Must |
| FR-62 | Leaderboard — Local, scoped to the user's city/region. | Should |
| FR-63 | The user's own rank is always visible, even outside the top 100. | Must |
| FR-64 | Personal stats screen: total area, area over time, distance, walks, best single claim, steal record. | Should |

### 5.7 Notifications

| ID | Requirement | Priority |
|---|---|---|
| FR-70 | Push: your territory was stolen. | Must |
| FR-71 | Push: weekly leaderboard result (opt-in). | Could |
| FR-72 | All non-essential notifications are opt-in and individually toggleable in settings. | Must |

## 6. Non-functional requirements

| ID | Requirement |
|---|---|
| NFR-01 | **Battery:** a 60-minute tracked walk consumes ≤ 8% battery on a mid-range Android device (reference: Redmi Note 12 class). |
| NFR-02 | **Claim latency:** p95 server claim resolution < 2 s for a polygon overlapping ≤ 50 parcels. |
| NFR-03 | **Map performance:** ≥ 45 fps while panning with 500 parcels in viewport. |
| NFR-04 | **Viewport query:** p95 < 400 ms for a bbox containing ≤ 2000 parcels. |
| NFR-05 | **Availability:** 99.5% monthly for the claim endpoint. |
| NFR-06 | **Data integrity:** no claim may be applied twice; all mutating endpoints are idempotent by client-supplied key. |
| NFR-07 | **Min Android:** API 26 (Android 8.0). Target the API level currently required by Play (verify in console — it moves every August). |
| NFR-08 | **Offline tolerance:** the app records a full walk with zero connectivity and syncs later. |
| NFR-09 | **Privacy:** raw GPS points are deleted 30 days after a walk; only derived geometry is retained. |
| NFR-10 | **Accessibility:** all interactive targets ≥ 48 dp; map info also available as text; supports system font scaling to 200%. |
| NFR-11 | **Localisation-ready:** no hardcoded strings in UI code. v1 ships English only, Urdu is a fast follow. |
| NFR-12 | **Cost:** infrastructure ≤ $50/month up to 10k MAU. |

## 7. Key user stories

- *As a new user*, I want the app to explain in under 20 seconds that I have to
  walk in a loop to own land, so my first walk isn't wasted.
- *As a walker mid-route*, I want to see how much area I'd get if I closed the
  loop right now, so I can decide whether to go one more block.
- *As a player who got raided*, I want to know exactly which part I lost and to
  whom, so I can go take it back.
- *As a competitive player*, I want to see whether a parcel is currently
  protected before I plan a route through it, so I don't waste a walk.
- *As a privacy-conscious user*, I want to know that other people see my
  territory but never my route or my live position.

> **Design constraint arising from the last story:** other users must never see a
> live position or a route line. Only finished, simplified parcels are public.

## 8. Parked backlog (post-v1, monetisation)

| Item | Shape | Notes |
|---|---|---|
| **Shield** | Consumable IAP; extends a parcel's protection window by 24–72 h | The most natural first purchase because the pain is already designed in (FR-41) |
| **Pro subscription** | Monthly; larger max claim area, faster protection recharge, stats history, no ads | Careful: anything that grants *area* advantage risks pay-to-win backlash |
| **Cosmetics** | Parcel patterns, colours, profile borders | Safest revenue, zero balance impact |
| **Rewarded video** | Watch an ad → one free 12 h shield | Bridges free users into the shield economy |
| **Clans** | Shared team territory, team leaderboards | Big scope; only after solo retention is proven |

Do not build any of these until the metrics in § 3 are met. Payments introduce
Play Billing compliance, refund handling, and tax setup — all of which cost more
than they return on an unproven loop.
