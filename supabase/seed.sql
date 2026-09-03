-- ═══════════════════════════════════════════════════════════════════════════
-- Seed data
--
-- Run automatically by `supabase db reset` for local development, and applied
-- manually once per hosted project:
--   psql "$DATABASE_URL" -f supabase/seed.sql
--
-- The game_config rows are NOT optional. Every rule function reads them at
-- call time and RAISES on a missing key (CLAUDE.md rule 7) — a claim against a
-- database with no config fails loudly rather than silently using a default.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── doc 03 §1 launch defaults ─────────────────────────────────────────────
insert into public.game_config (key, value, description) values
  ('LOOP_CLOSE_RADIUS_M',     '30',      'GR-02(a): how near the start you must return for the loop to count'),
  ('MIN_CLAIM_AREA_M2',       '500',     'GR-04: smallest claimable polygon (~22 m x 22 m)'),
  ('MAX_CLAIM_AREA_M2',       '2000000', 'GR-04: largest single claim (2 km²)'),
  ('MIN_WALK_DISTANCE_M',     '200',     'GR-04: minimum path length for any claim'),
  ('MIN_WALK_DURATION_S',     '120',     'GR-04: minimum duration for any claim'),
  ('MIN_POINTS',              '20',      'GR-01(6): minimum accepted GPS samples'),
  ('MAX_ACCURACY_M',          '30',      'GR-01(1): worse horizontal accuracy is dropped'),
  ('MAX_SPEED_MPS',           '6.0',     'GR-04: ~21.6 km/h. Sustained excess rejects the walk'),
  ('MAX_BURST_SPEED_MPS',     '12.0',    'GR-01(5): single-segment ceiling; above this is a teleport'),
  ('SIMPLIFY_TOLERANCE_M',    '3',       'GR-03(4): Douglas-Peucker tolerance. Also a privacy control (doc 06 §4.4)'),
  ('ISOPERIMETRIC_TOLERANCE', '1.15',    'GR-05: slack on the max-area-per-perimeter check'),
  ('PROTECTION_HOURS',        '6',       'GR-23: how long a fresh parcel cannot be stolen'),
  ('MIN_PARCEL_AREA_M2',      '100',     'GR-20: remainders smaller than this are discarded as slivers'),
  ('MERGE_GAP_M',             '2',       'GR-21: own parcels closer than this are merged'),
  ('MAX_CLAIMS_PER_DAY',      '10',      'GR-24: max accepted claims per user per rolling 24 h'),
  ('WEEKLY_CONTRACT_TARGET_M2','5000',   'FR-61: weekly area-gained goal shown on the map HUD. Display only')
on conflict (key) do update
  set value       = excluded.value,
      description = excluded.description,
      updated_at  = now();

-- ── The tombstone owner for deleted accounts (doc 06 §5) ──────────────────
--
-- Parcels belonging to a deleted account are reassigned here rather than
-- cascade-deleted, so the world map does not develop holes and other players'
-- raid history keeps resolving. The land stays claimable normally.
--
-- It needs an auth.users row because profiles.id references it. The generated
-- email is unroutable by design; this account can never be signed into.
do $seed$
declare
  v_id uuid := '00000000-0000-0000-0000-000000000001';
begin
  if not exists (select 1 from public.profiles where username = 'deleted_player') then
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                            email_confirmed_at, created_at, updated_at,
                            raw_app_meta_data, raw_user_meta_data)
    values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'deleted-player@terrawars.invalid', '',
            now(), now(), now(),
            '{"provider":"system"}'::jsonb, '{"username":"deleted_player"}'::jsonb)
    on conflict (id) do nothing;

    -- The on_auth_user_created trigger has already created the profile and
    -- assigned it a palette colour. Override to neutral grey so land belonging
    -- to deleted accounts reads as unowned rather than as some live player's.
    insert into public.profiles (id, username, display_name, color_hex)
    values (v_id, 'deleted_player', '[deleted]', '#9CA3AF')
    on conflict (id) do update
      set username     = excluded.username,
          display_name = excluded.display_name,
          color_hex    = excluded.color_hex;

    insert into public.user_stats (user_id) values (v_id)
    on conflict (user_id) do nothing;
  end if;
end;
$seed$;
