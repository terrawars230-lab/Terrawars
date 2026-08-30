# 03 — Game Mechanics Spec

This is the most important document in the set. It defines exactly how a walk
becomes land. Every rule has an ID (`GR-xx`) and every tunable has a named
constant. **All of this executes server-side (D-05).**

---

## 1. Tunable constants

Store these in a `game_config` table so they can be changed without a release.
Values below are the launch defaults.

| Constant | Default | Meaning |
|---|---|---|
| `LOOP_CLOSE_RADIUS_M` | 30 | How near the start you must return for the loop to count |
| `MIN_CLAIM_AREA_M2` | 500 | Smallest claimable polygon (~22 m × 22 m) |
| `MAX_CLAIM_AREA_M2` | 2 000 000 | Largest single claim (2 km²) |
| `MIN_WALK_DISTANCE_M` | 200 | Minimum path length for any claim |
| `MIN_WALK_DURATION_S` | 120 | Minimum duration for any claim |
| `MIN_POINTS` | 20 | Minimum accepted GPS samples |
| `MAX_ACCURACY_M` | 30 | Points with worse horizontal accuracy are dropped |
| `MAX_SPEED_MPS` | 6.0 | ~21.6 km/h. Sustained excess ⇒ rejection |
| `MAX_BURST_SPEED_MPS` | 12.0 | Single-segment ceiling; above ⇒ teleport |
| `SIMPLIFY_TOLERANCE_M` | 3 | Douglas-Peucker tolerance before storage |
| `ISOPERIMETRIC_TOLERANCE` | 1.15 | Slack on the max-area-per-perimeter check |
| `PROTECTION_HOURS` | 6 | How long a fresh parcel cannot be stolen |
| `MIN_PARCEL_AREA_M2` | 100 | Remainders smaller than this are discarded as slivers |
| `MERGE_GAP_M` | 2 | Own parcels closer than this are merged |

---

## 2. From GPS points to a polygon

### GR-01 — Point cleaning (in order)

1. Drop any point where `accuracy > MAX_ACCURACY_M`.
2. Drop any point flagged `is_mock = true` (and mark the whole walk suspicious —
   see doc 06).
3. Drop duplicate timestamps; sort strictly by timestamp.
4. Drop any point < 2 m from the previous accepted point (GPS jitter).
5. Compute per-segment speed. If `speed > MAX_BURST_SPEED_MPS`, mark the segment
   as a **teleport**. One teleport ⇒ drop the offending point and re-link. Two or
   more ⇒ reject the walk (`ERR_TELEPORT`).
6. If fewer than `MIN_POINTS` remain ⇒ reject (`ERR_TOO_FEW_POINTS`).

### GR-02 — Loop closure detection

A loop is closed when **either**:

- **(a) Return-to-start:** the last accepted point is within
  `LOOP_CLOSE_RADIUS_M` of the first accepted point, **and** the path has
  already travelled at least `MIN_WALK_DISTANCE_M`; or
- **(b) Self-intersection:** any later segment crosses an earlier segment. In
  this case the loop is the sub-path between the two crossing segments, and
  points before the intersection are discarded.

Case (b) is the common real-world case — people rarely stop on the exact metre
they started. Implement (b) with a sweep over segment pairs, skipping adjacent
segments. On the client, run this incrementally after each new point so the
"you can close now" prompt (FR-18) is instant.

### GR-03 — Polygon construction

1. Take the loop sub-path as a `LINESTRING`.
2. Force closure by appending the first vertex.
3. `ST_MakeValid` the resulting polygon. If the result is a `MULTIPOLYGON`
   (self-touching path), **keep only the largest ring by area** and discard the
   rest.
4. `ST_SimplifyPreserveTopology(geom, SIMPLIFY_TOLERANCE_M)` — converted to
   degrees at that latitude, or done in a local projection.
5. Re-validate. If invalid after simplification, fall back to the unsimplified
   polygon.

Store as `geometry(Polygon, 4326)`. Compute area as `ST_Area(geom::geography)`
so it is real square metres, not degrees.

### GR-04 — Claim validation

Reject with the given code unless all hold:

| Check | Error code |
|---|---|
| `area >= MIN_CLAIM_AREA_M2` | `ERR_AREA_TOO_SMALL` |
| `area <= MAX_CLAIM_AREA_M2` | `ERR_AREA_TOO_LARGE` |
| `path_length >= MIN_WALK_DISTANCE_M` | `ERR_DISTANCE_TOO_SHORT` |
| `duration >= MIN_WALK_DURATION_S` | `ERR_DURATION_TOO_SHORT` |
| Loop closed per GR-02 | `ERR_LOOP_NOT_CLOSED` |
| Isoperimetric check (GR-05) | `ERR_IMPOSSIBLE_AREA` |
| Average speed ≤ `MAX_SPEED_MPS` | `ERR_TOO_FAST` |
| Integrity checks pass (doc 06) | `ERR_INTEGRITY` |

### GR-05 — The isoperimetric sanity check

For any closed curve of perimeter `L`, the maximum area it can enclose is
`L² / (4π)` — a perfect circle. So:

```
area_m2 <= (perimeter_m^2 / (4 * pi)) * ISOPERIMETRIC_TOLERANCE
```

This is a cheap, mathematically airtight check that catches fabricated
polygons submitted with a short or fake path. Use the *walked path length*, not
the simplified polygon perimeter, so that shortcuts across the polygon cannot
inflate the allowance.

---

## 3. Ownership resolution

### GR-10 — Data shape

Ownership is stored as **parcels**: one row per contiguous polygon, with an
owner. A user's territory is the union of their parcels. Never store one giant
per-user `MULTIPOLYGON` — it makes every viewport query touch every user.

### GR-11 — Resolution order

When claim polygon `C` by user `U` is accepted, run inside one transaction:

1. Find all parcels `P` where `ST_Intersects(P.geom, C)`, locking them
   `FOR UPDATE` ordered by `id` (consistent order prevents deadlocks).
2. Partition them into `own` (`P.owner = U`) and `rival` (`P.owner != U`).
3. Apply GR-20 to each rival parcel.
4. Apply GR-21 to own parcels.
5. Insert the resulting parcel(s) for `U`.
6. Recompute `user_stats` for `U` and every affected victim.
7. Write one `steal_event` row per victim.
8. Emit notifications after commit.

### GR-20 — Stealing from a rival

For each rival parcel `P`:

- If `P.protected_until > now()` ⇒ **`C` is clipped instead**:
  `C := ST_Difference(C, P.geom)`. The claimer walks around protected land; it
  does not block the rest of their claim. Record it as a `blocked` outcome so
  the UI can explain it.
- Otherwise the overlap transfers:
  - `overlap := ST_Intersection(P.geom, C)`
  - `remainder := ST_Difference(P.geom, C)`
  - If `remainder` is empty ⇒ delete `P` (fully conquered).
  - If `remainder` is a `MULTIPOLYGON` ⇒ split into one parcel row per part,
    keeping `P`'s original `claimed_at` and `owner`.
  - Discard any remainder part with area `< MIN_PARCEL_AREA_M2` (sliver rule).
    That area simply goes to the claimer along with the rest.
  - Record `steal_event(attacker=U, victim=P.owner, area=ST_Area(overlap))`.

### GR-21 — Overlapping your own land

Own parcels are **merged**, not stolen (FR-43):

```
merged := ST_Union(C, ST_Union(all own intersecting parcels))
```

Also union in any own parcel within `MERGE_GAP_M` (use `ST_DWithin`) so that two
adjacent loops don't leave a hairline crack between them. Delete the merged-in
rows; insert one new parcel. Its `claimed_at` is `now()` and it receives a fresh
protection window — walking your own perimeter is a legitimate way to refresh
protection, and that is a deliberate, healthy defensive mechanic.

**Net area gained** for the user is
`ST_Area(merged) − sum(ST_Area(old own parcels))`, not the raw claim area.
Re-walking the same loop must yield ~0 gain.

### GR-22 — Enclaves and holes

If a claim polygon fully surrounds but does not overlap a rival parcel, the
rival parcel **survives** as an island inside your territory. Do not fill holes.
Surrounding is not conquering. (Optional v2 rule: an enclave smaller than
`MIN_CLAIM_AREA_M2` fully surrounded by one owner is absorbed.)

### GR-23 — Protection window

`protected_until = claimed_at + PROTECTION_HOURS`. Applies to newly claimed and
newly merged parcels. A parcel that only *lost* area (a remainder) keeps its
original timestamps and does **not** gain protection — otherwise a victim would
be rewarded for being raided.

### GR-24 — Fairness rules

- A user cannot claim the same polygon repeatedly for score; net-area
  accounting (GR-21) already prevents this.
- Rate limit: max 10 accepted claims per user per rolling 24 h.
- A walk may be submitted for a claim exactly once (idempotency key = walk id).

---

## 4. Scoring

| Metric | Definition |
|---|---|
| `total_area_m2` | `SUM(area)` over the user's parcels. The primary score. |
| `weekly_area_gained_m2` | Sum of net area gained in claims within the current ISO week. Can be negative if raided. |
| `steals_made` / `area_stolen_m2` | From `steal_events` where the user is attacker. |
| `area_lost_m2` | From `steal_events` where the user is victim. |
| `total_distance_m`, `walks_count` | Lifetime totals, including walks that produced no claim. |

Display areas in **km² above 10 000 m²**, otherwise **m²**, always rounded to
3 significant figures. Never show raw floats to users.

`user_stats` is a denormalised table updated inside the claim transaction — not
computed on read. Leaderboards read from it directly.

---

## 5. Worked examples

**Example A — clean first claim.**
New user walks a 900 m loop around a park in 11 minutes, returning 12 m from
start. Path length 900 m ⇒ max possible area `900²/(4π) × 1.15 ≈ 74 100 m²`.
Actual enclosed area 41 000 m². All checks pass. One parcel created, protected
for 6 hours. Score: 41 000 m².

**Example B — a raid.**
Player B walks a loop that covers 60% of Player A's 41 000 m² parcel, claimed
yesterday (protection expired). B's total claim polygon is 55 000 m².
- A's parcel becomes a 16 400 m² remainder.
- B gains the full 55 000 m², of which 24 600 m² was taken from A.
- `steal_event(B → A, 24 600 m²)` is written; A gets a push notification.

**Example C — cut in two.**
B's loop is a long thin corridor straight through the middle of A's square.
`ST_Difference` returns a `MULTIPOLYGON` of two pieces. A now owns two separate
parcels (rows), each with A's original `claimed_at`. If one piece is only
70 m², it is below `MIN_PARCEL_AREA_M2` and is discarded — B absorbs it.

**Example D — walking against a shield.**
B's loop overlaps A's parcel, claimed 2 hours ago. Protection is active. B's
claim polygon is clipped by A's parcel: B keeps everything outside it and gains
nothing from inside. The result screen tells B the parcel was shielded and when
the shield expires — which is exactly the moment shields become a saleable
product later.

**Example E — the cheat attempt.**
A user submits 21 points describing a 5 km² polygon with a path length of
600 m. Isoperimetric check: `600²/(4π) × 1.15 ≈ 32 900 m²` allowed versus
5 000 000 m² claimed ⇒ `ERR_IMPOSSIBLE_AREA`. Rejected before any geometry is
written.

---

## 6. Failure messages (user-facing)

Never show an error code alone. Map each to a plain sentence and, where
possible, a next action.

| Code | Message |
|---|---|
| `ERR_LOOP_NOT_CLOSED` | "Your walk didn't make a loop. Walk back near where you started to claim the area." |
| `ERR_AREA_TOO_SMALL` | "That loop is too small to claim. Try one at least the size of a city block." |
| `ERR_DISTANCE_TOO_SHORT` | "You need to walk at least 200 m to claim land." |
| `ERR_TOO_FAST` | "This looks like a ride, not a walk. Claims are for walking and running only." |
| `ERR_IMPOSSIBLE_AREA` | "We couldn't verify this route. Your walk was still saved." |
| `ERR_INTEGRITY` | "We couldn't verify your location data on this device." |

In every rejection case, **still save the walk** with its distance and duration.
The user did the exercise; do not throw that away.
