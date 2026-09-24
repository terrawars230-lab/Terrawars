-- ═══════════════════════════════════════════════════════════════════════════
-- 20260922120100 · get_me reports a pending account deletion (FR-06)
--
-- request_account_deletion soft-deletes and the hard delete follows after the
-- 7-day grace period. Nothing stopped the same person signing straight back in
-- during that week and playing on — recording walks and winning territory in
-- an account that was about to be erased, with no word about it.
--
-- get_me now says so, and the app shows a "this account is being deleted"
-- screen instead of the game. Same signature and same other fields: this is
-- additive, and a client that predates it reads the flag as absent.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.get_me()
returns jsonb
language sql
stable
set search_path = public, extensions
as $fn$
  select jsonb_build_object(
    'id',            p.id,
    'username',      p.username,
    'display_name',  p.display_name,
    'avatar_url',    p.avatar_url,
    'color_hex',     p.color_hex,
    'home_city',     p.home_city,
    'home_region',   p.home_region,
    -- The app treats a `user_`-prefixed username as "not chosen yet" (FR-02).
    'needs_username', (p.username like 'user\_%'),
    -- FR-06: inside the deletion grace period.
    'deletion_requested', (p.deleted_at is not null),
    'created_at',    p.created_at,
    'stats', jsonb_build_object(
      'total_area_m2',    round(us.total_area_m2::numeric, 0),
      'area_display',     public.format_area(us.total_area_m2),
      'parcels_count',    us.parcels_count,
      'total_distance_m', round(us.total_distance_m::numeric, 0),
      'walks_count',      us.walks_count,
      'claims_count',     us.claims_count,
      'area_stolen_m2',   round(us.area_stolen_m2::numeric, 0),
      'area_lost_m2',     round(us.area_lost_m2::numeric, 0),
      'steals_made',      us.steals_made,
      'best_claim_m2',    round(us.best_claim_m2::numeric, 0),
      'rank_global',      public.user_global_rank(p.id)
    )
  )
  from public.profiles p
  join public.user_stats us on us.user_id = p.id
  where p.id = auth.uid();
$fn$;

comment on function public.get_me is
  'FR-04: the caller''s own profile and stats. FR-06: deletion_requested during the grace period.';
