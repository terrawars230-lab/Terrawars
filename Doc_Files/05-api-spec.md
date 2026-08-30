# 05 — API Spec

With Supabase, most of this is PostgREST over tables plus RPC calls to the
functions in doc 04 § 3. The shapes below are what the Flutter repository layer
must expose, regardless of transport — which keeps the D-02 migration cheap.

**Auth:** every call carries the Supabase JWT. `user_id` is always taken from
the token, **never** from the request body.

---

## 1. Auth & profile

### `POST /auth/signup` · `POST /auth/signin` · Google OAuth
Handled by Supabase Auth SDK. No custom endpoint.

### `GET /me`
```json
{
  "id": "uuid",
  "username": "hamza",
  "display_name": "Hamza",
  "color_hex": "#3B82F6",
  "home_city": "Lahore",
  "stats": {
    "total_area_m2": 184300,
    "parcels_count": 7,
    "total_distance_m": 96400,
    "walks_count": 41,
    "area_stolen_m2": 52100,
    "area_lost_m2": 18900,
    "rank_global": 214
  }
}
```

### `PATCH /me`
Body: `{ "display_name"?, "color_hex"?, "home_city"? }`
`409 USERNAME_TAKEN` on username conflict. `429 COLOR_CHANGE_COOLDOWN` if
changed within 30 days (FR-03).

### `POST /account/delete`
Body: `{ "confirmation": "DELETE" }`. Soft-deletes immediately (user is signed
out), hard-deletes after a 7-day grace period. Required by Play policy (FR-06).

---

## 2. Walks

### `POST /walks` — start
```json
{ "client_walk_id": "uuid", "started_at": "2026-08-30T09:14:00Z" }
```
→ `201 { "walk_id": "uuid", "status": "active" }`
`409 ACTIVE_WALK_EXISTS` if one is already open — response includes the existing
walk so the client can resume it (FR-15).

### `POST /walks/{id}/points` — batch upload
Called every ~30 s during the walk and once before finishing.
```json
{
  "batch_seq": 3,
  "points": [
    { "seq": 120, "ts": "2026-08-30T09:16:02Z", "lat": 31.5204, "lng": 74.3587,
      "accuracy_m": 8.2, "speed_mps": 1.4, "altitude_m": 217, "heading": 84.0,
      "is_mock": false }
  ]
}
```
→ `200 { "accepted": 40, "duplicates": 0 }`
Idempotent on `(walk_id, seq)` — re-sending a batch is safe and expected on
flaky networks.

### `POST /walks/{id}/finish`
```json
{
  "ended_at": "2026-08-30T09:58:11Z",
  "attempt_claim": true,
  "idempotency_key": "uuid",
  "integrity_token": "<Play Integrity token>"
}
```

**Accepted:**
```json
{
  "status": "accepted",
  "walk": { "distance_m": 3120, "duration_s": 2651, "avg_speed_mps": 1.18 },
  "claim": {
    "id": "uuid",
    "raw_area_m2": 84210,
    "net_area_gain_m2": 61050,
    "stolen_area_m2": 23160,
    "geometry": { "type": "Polygon", "coordinates": [[...]] }
  },
  "steals": [
    { "victim_username": "sara", "area_m2": 23160 }
  ],
  "blocked": [
    { "owner_username": "ali", "area_m2": 4100, "protected_until": "2026-08-30T13:00:00Z" }
  ],
  "stats": { "total_area_m2": 245350, "rank_global": 180, "rank_delta": 34 }
}
```

**Rejected:**
```json
{
  "status": "rejected",
  "error_code": "ERR_LOOP_NOT_CLOSED",
  "message": "Your walk didn't make a loop...",
  "walk": { "distance_m": 1840, "duration_s": 1502 }
}
```
Note the walk data is present in both — the exercise is always saved (doc 03 § 6).

### `POST /walks/{id}/abandon`
Discards an interrupted walk. → `200 { "status": "abandoned" }`

### `GET /walks?limit=20&cursor=...`
Own walk history. Includes `path` for own walks only.

---

## 3. Map

### `GET /map/parcels?bbox=minLng,minLat,maxLng,maxLat&zoom=15`
```json
{
  "zoom": 15,
  "mode": "geometry",
  "features": [
    {
      "type": "Feature",
      "id": "uuid",
      "geometry": { "type": "Polygon", "coordinates": [[...]] },
      "properties": {
        "owner_id": "uuid",
        "owner_username": "sara",
        "color_hex": "#EF4444",
        "area_m2": 41200,
        "claimed_at": "2026-08-29T18:04:00Z",
        "protected_until": null,
        "is_mine": false
      }
    }
  ],
  "truncated": false
}
```
At `zoom < 12`, `mode` is `"aggregate"` and features are points with
`{ "parcel_count": 340, "total_area_m2": 8210000 }`.

Rules: bbox area is capped server-side; oversized requests get `400 BBOX_TOO_LARGE`.
Responses are cached 30 s at the edge.

### `GET /map/parcels/{id}`
Detail for the tap sheet (FR-52).

### `GET /me/parcels`
All of the user's parcels, with total area.

---

## 4. Leaderboards

### `GET /leaderboards/{scope}?limit=50&offset=0`
`scope` ∈ `global` | `weekly` | `local`. `local` takes `&city=Lahore`.

```json
{
  "scope": "weekly",
  "period": { "iso_year": 2026, "iso_week": 35 },
  "entries": [
    { "rank": 1, "user_id": "uuid", "username": "sara",
      "color_hex": "#EF4444", "value_m2": 412000 }
  ],
  "me": { "rank": 180, "value_m2": 61050 }
}
```
`me` is always populated, even outside the page (FR-63).

---

## 5. Profiles & history

### `GET /users/{username}`
Public fields only. **Never** returns walks, paths or points.

### `GET /me/steal-events?direction=incoming|outgoing`
Raid history for both profiles (FR-44).

---

## 6. Realtime

Supabase Realtime channels:

| Channel | Payload | Used for |
|---|---|---|
| `parcels:bbox:{geohash5}` | insert/update/delete of parcels in that cell | live map refresh (FR-54) |
| `user:{id}:events` | `steal`, `rank_change` | in-app banners |

The client subscribes to the geohash cells covering the current viewport and
resubscribes on pan. Cap at 9 concurrent cells.

Push (FCM) is fired from a database trigger via an Edge Function, after the
claim transaction commits:
```json
{ "type": "territory_stolen", "attacker_username": "hamza",
  "area_m2": 23160, "lat": 31.5204, "lng": 74.3587 }
```

---

## 7. Errors

Uniform envelope:
```json
{ "error": { "code": "ERR_AREA_TOO_SMALL", "message": "…", "details": {} } }
```

| HTTP | Codes |
|---|---|
| 400 | `ERR_VALIDATION`, `BBOX_TOO_LARGE`, `ERR_TOO_FEW_POINTS` |
| 401 | `UNAUTHENTICATED` |
| 403 | `ERR_INTEGRITY`, `ACCOUNT_SUSPENDED` |
| 404 | `NOT_FOUND` |
| 409 | `ACTIVE_WALK_EXISTS`, `USERNAME_TAKEN`, `WALK_ALREADY_FINISHED` |
| 422 | all `ERR_*` claim-rule rejections from doc 03 § GR-04 |
| 429 | `RATE_LIMITED` (includes `retry_after_s`) |
| 500 | `INTERNAL` |

**Client rule:** any `422` is a normal, expected outcome — show the friendly
message from doc 03 § 6 and keep the saved walk. Only `5xx` deserves a retry.

---

## 8. Rate limits

| Endpoint | Limit |
|---|---|
| `POST /walks` | 20 / hour / user |
| `POST /walks/{id}/points` | 200 / hour / user |
| `POST /walks/{id}/finish` | 10 accepted claims / 24 h / user (GR-24) |
| `GET /map/parcels` | 120 / minute / user |
| `GET /leaderboards/*` | 60 / minute / user |
