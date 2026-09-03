-- ═══════════════════════════════════════════════════════════════════════════
-- 1100 · WEEKLY_CONTRACT_TARGET_M2
--
-- The map HUD shows a player's progress towards a weekly area goal (FR-61,
-- design handoff §5). The number it counts up is real — `weekly_scores.
-- area_gained_m2`, the same value the weekly leaderboard ranks on — but the
-- TARGET it counts towards is a tunable, and CLAUDE.md rule 7 says tunables
-- live here rather than as a literal in a React component.
--
-- Presentation only: nothing in `finish_walk` reads this key, and missing the
-- goal costs a player nothing. It is in `game_config` so the goal can be
-- retuned from real walk data after launch (doc 07 build-order rule 5) without
-- shipping a release.
-- ═══════════════════════════════════════════════════════════════════════════

insert into public.game_config (key, value, description) values
  ('WEEKLY_CONTRACT_TARGET_M2', '5000',
   'FR-61: weekly area-gained goal shown on the map HUD. Display only.')
on conflict (key) do update
  set description = excluded.description,
      updated_at  = now();
