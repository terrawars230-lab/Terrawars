# CLAUDE.md — Working agreement for the coding agent

Place this file at the repository root. It is read at the start of every Claude
Code session.

---

## What this project is

TerraClaim: an Android walking game. A user's walked loop becomes a polygon of
territory they own on a shared world map. Other players can walk over that land
and take it. Flutter client, Supabase/PostGIS backend.

Full context lives in `docs/`. **Read `docs/03-game-mechanics-spec.md` before
touching anything related to claims, parcels or area.** It is the product.

---

## Non-negotiable rules

1. **Never trust the client.** Ownership, area and validation are decided only
   by server-side SQL. The Flutter app may compute a preview; it may never
   compute a result. No code path may let a client insert or update a `parcel`.
2. **Claim resolution is one transaction.** Partial ownership transfer is a data
   corruption bug, not a UX issue.
3. **Cite the rule ID.** Any code implementing a rule from doc 03 carries a
   comment with its `GR-xx` id, and the commit message references it.
4. **No geometry function without a pgTAP test**, including a pathological
   fixture (self-intersecting, figure-eight, sliver remainder, enclave).
5. **Never add `ACCESS_BACKGROUND_LOCATION`** without an explicit decision from
   the project owner. See ADR D-04.
6. **Never expose another user's path, walk points, or live position.** Only
   simplified parcel polygons are public.
7. **Tunables come from `game_config`**, never hardcoded literals.
8. **Secrets are never committed.** Not the service-role key, not the tile API
   key, not FCM credentials.
9. **Areas are metres**, computed with `::geography`. Never present or store an
   area computed in degrees.
10. **Idempotency:** every mutating endpoint accepts and honours an idempotency
    key. A walk can be claimed exactly once.

---

## Architecture rules

- `features/` may import `domain/` and repository *interfaces* only. Never
  `supabase_flutter` or `drift` directly.
- `domain/` is pure Dart: no I/O, no Flutter imports, fully unit-testable.
- Migrations are forward-only, numbered, and never edited after merge.
- All models use `freezed`; no untyped `Map<String, dynamic>` crossing a layer
  boundary.

## Style

- Dart: `flutter analyze` clean, no lint suppressions without a comment stating
  why. Prefer explicit types on public APIs.
- SQL: lower case keywords, snake_case, one statement per migration concern,
  every function has a leading comment naming the rules it implements.
- Error handling: return typed results for expected failures (a rejected claim
  is *expected*), throw only for genuine faults.
- User-facing strings: no hardcoded literals in widgets; use the localisation
  layer from day one.

## Commits & PRs

```
feat(claim): GR-20 rival parcel difference and multipolygon split
fix(walk): drop points above MAX_ACCURACY_M before distance sum (GR-01)
test(geom): figure-eight path resolves to largest ring
```

A PR must state which requirement IDs it implements and how it was verified. If
it changes a doc-03 rule, it updates doc 03 in the same PR.

## Before you write code

- If the task touches geometry → read doc 03 and doc 04 § 3.
- If the task touches the API surface → read doc 05.
- If the task touches permissions, location, or anything user-visible about
  privacy → read doc 06.
- If a requirement is ambiguous, **ask rather than guess**, and propose the
  answer you'd pick. Silent guesses about game rules produce bugs that look like
  design decisions and survive for months.

## Definition of done

- [ ] Implements the referenced requirement IDs, all of them
- [ ] Tests added, including the unhappy path
- [ ] `flutter analyze` and `flutter test` pass; migrations apply cleanly on a
      fresh database
- [ ] No secret, key, or environment URL added to the repo
- [ ] Verified on a real Android device if it touches location or the map
- [ ] Docs updated if behaviour changed
