# TerraClaim — Documentation Index

> **Codename:** TerraClaim (placeholder — replace everywhere before launch)
> **One-liner:** A walking game where the route you walk becomes territory you own on a real-world map — and rival players can walk into your land and take it.
> **Platform (v1):** Android (Google Play). iOS is a later phase.
> **Status:** Pre-development. These documents are the source of truth for implementation.

---

## How to use these documents

These docs are written to be handed to an implementing agent (Claude Code) or a
developer. Read them in order. Every requirement has a stable ID (`FR-xx`,
`NFR-xx`, `GR-xx`) so code, commits and tickets can reference it.

| # | Document | What it answers |
|---|---|---|
| 01 | [Product Requirements](01-product-requirements.md) | What are we building, for whom, and what must v1 do? |
| 02 | [Tech Stack](02-tech-stack.md) | What technology, and *why* — with rejected alternatives. |
| 03 | [Game Mechanics Spec](03-game-mechanics-spec.md) | The exact geometry/rules for claiming and stealing land. |
| 04 | [Data Model](04-data-model.md) | Database schema, PostGIS types, indexes, RLS. |
| 05 | [API Spec](05-api-spec.md) | Endpoints, payloads, error codes, realtime channels. |
| 06 | [Anti-Cheat & Compliance](06-anti-cheat-and-compliance.md) | GPS spoofing defence, Play Store policy, privacy. |
| 07 | [Implementation Plan](07-implementation-plan.md) | Phased build order with acceptance criteria. |
| — | [CLAUDE.md](CLAUDE.md) | Working agreement / conventions for the coding agent. |

---

## The core loop in one paragraph

A user signs up, presses **Start Walk**, and the app records their GPS path in
real time on a map. When their path forms a closed loop (they return near where
they started) and the enclosed area passes validation, that polygon becomes
**their parcel** — drawn in their colour on a shared world map. Territory is
scored by total square metres owned. Any other player can walk a loop that
overlaps your land; the overlapping part is cut out of your parcel and given to
them. You get a push notification that you were raided. Leaderboards rank
players by area owned globally, weekly, and by city.

---

## Decisions that are still open

These need your answer before Phase 2. Everything else in these docs is decided.

| ID | Question | Default assumed in docs |
|---|---|---|
| OQ-1 | App name + Play Store package id? | `TerraClaim` / `com.terraclaim.app` |
| OQ-2 | Map provider — MapLibre (free), Mapbox (free tier), or Google Maps? | MapLibre + a free vector tile source, to keep cost at zero |
| OQ-3 | Launch country/region — global from day 1, or one city first? | One city first (seeded density matters for a territory game) |
| OQ-4 | Does unwalked territory decay/expire over time? | No decay in v1; add in v2 if the map gets saturated |
| OQ-5 | Solo only, or teams/clans in v1? | Solo only in v1 |
| OQ-6 | Do you have an existing Google Play developer account (and is it a personal or organisation account)? | Assumed personal, new — this affects testing requirements, see doc 06 |

---

## Deliberately NOT in v1 (parked backlog)

Monetisation and social depth are real, but they are dead weight before the core
loop is fun. Parked, in rough priority order:

- Shields / territory protection (paid) — the most natural first purchase
- Cosmetic parcel colours, patterns, map skins
- Premium stats: heatmaps, history replay, area-over-time graphs
- Clans / teams and team-owned territory
- Friend feed, challenges, weekly duels
- Ad-supported free tier (rewarded video for a one-off shield)
- iOS build

See `01-product-requirements.md` § 8 for how each is scoped.
