-- ═══════════════════════════════════════════════════════════════════════════
-- GR-11, GR-20, GR-21, GR-23, GR-24 — ownership resolution.
--
-- These are the doc 07 Phase 3 and Phase 4 acceptance criteria, expressed as
-- assertions. If any of them fails, the game's core loop is wrong and no amount
-- of client polish helps (doc 07 build-order rule 1).
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

begin;

select test.section('GR-11 — a clean first claim');

do $$
declare
  v_user   uuid := test.create_player('first');
  v_walk   uuid;
  v_result jsonb;
  v_area   double precision;
  v_count  integer;
begin
  perform test.act_as(v_user);
  v_walk := test.record_square_walk(v_user, 250);

  v_result := public.finish_walk(v_walk, 'key-1');

  perform test.eq(v_result ->> 'status', 'accepted', 'a clean loop is accepted');

  select count(*), coalesce(sum(area_m2), 0) into v_count, v_area
    from public.parcels where owner_id = v_user;

  perform test.eq(v_count, 1, 'one parcel is created');
  perform test.near(v_area, 62500, 2500, 'the parcel is the walked area');

  -- doc 03 §6: the walk is saved regardless of the claim outcome.
  perform test.eq((select status::text from public.walks where id = v_walk), 'completed',
                  'the walk is marked completed');
  perform test.ok((select distance_m from public.walks where id = v_walk) > 900,
                  'the walk keeps its distance');
end;
$$;

select test.section('GR-23 — the protection window');

do $$
declare
  v_user uuid := test.create_player('protected');
  v_walk uuid;
  v_protected_until timestamptz;
begin
  perform test.act_as(v_user);
  v_walk := test.record_square_walk(v_user, 250);
  perform public.finish_walk(v_walk, 'key-1');

  select protected_until into v_protected_until
    from public.parcels where owner_id = v_user limit 1;

  perform test.ok(v_protected_until > now(), 'a new parcel is protected');
  perform test.ok(v_protected_until <= now() + interval '6 hours' + interval '1 minute',
                  'protection is PROTECTION_HOURS long, not longer');
end;
$$;

select test.section('GR-24 — idempotency');

do $$
declare
  v_user    uuid := test.create_player('idempotent');
  v_walk    uuid;
  v_first   jsonb;
  v_second  jsonb;
  v_claims  integer;
  v_parcels integer;
begin
  perform test.act_as(v_user);
  v_walk := test.record_square_walk(v_user, 250);

  v_first  := public.finish_walk(v_walk, 'key-1');
  v_second := public.finish_walk(v_walk, 'key-1');

  select count(*) into v_claims  from public.claims  where walk_id = v_walk;
  select count(*) into v_parcels from public.parcels where owner_id = v_user;

  -- doc 07 Phase 3: "Submitting the same walk twice creates exactly one claim."
  perform test.eq(v_claims, 1, 'GR-24 creates exactly one claim per walk');
  perform test.eq(v_parcels, 1, 'GR-24 does not award the land twice');
  perform test.eq(v_second ->> 'claim_id', v_first ->> 'claim_id',
                  'a replay returns the original claim');
end;
$$;

select test.section('GR-21 — merging your own land');

do $$
declare
  v_user   uuid := test.create_player('merger');
  v_walk1  uuid;
  v_walk2  uuid;
  v_gain1  double precision;
  v_gain2  double precision;
  v_count  integer;
begin
  perform test.act_as(v_user);

  v_walk1 := test.record_square_walk(v_user, 250);
  v_gain1 := (public.finish_walk(v_walk1, 'key-1') -> 'claim' ->> 'net_area_gain_m2')::double precision;

  -- Re-walk the identical loop.
  v_walk2 := test.record_square_walk(v_user, 250);
  v_gain2 := (public.finish_walk(v_walk2, 'key-2') -> 'claim' ->> 'net_area_gain_m2')::double precision;

  -- doc 07 Phase 3: "Re-walking the same loop yields net gain ~ 0 (GR-21)."
  perform test.ok(v_gain1 > 50000, 'the first claim gains the full area');
  perform test.near(v_gain2, 0, 2000, 'GR-21 re-walking the same loop gains ~0');

  select count(*) into v_count from public.parcels where owner_id = v_user;
  perform test.eq(v_count, 1, 'GR-21 merges rather than adding a second parcel');
end;
$$;

do $$
declare
  v_user  uuid := test.create_player('adjacent');
  v_walk1 uuid;
  v_walk2 uuid;
  v_count integer;
begin
  perform test.act_as(v_user);

  -- Two squares separated by a 1 m gap — inside MERGE_GAP_M (2).
  v_walk1 := test.record_square_walk(v_user, 200, 0, 0);
  perform public.finish_walk(v_walk1, 'key-1');

  v_walk2 := test.record_square_walk(v_user, 200, 201, 0);
  perform public.finish_walk(v_walk2, 'key-2');

  select count(*) into v_count from public.parcels where owner_id = v_user;

  -- doc 07 Phase 3: "Two adjacent loops by the same user merge with no
  -- hairline gap." A plain ST_Union would leave two rows here.
  perform test.eq(v_count, 1, 'GR-21 closes a sub-MERGE_GAP_M crack into one parcel');
end;
$$;

select test.section('GR-20 — stealing from a rival');

do $$
declare
  v_victim   uuid := test.create_player('victim');
  v_attacker uuid := test.create_player('attacker');
  v_walk     uuid;
  v_result   jsonb;
  v_stolen   double precision;
  v_victim_area double precision;
begin
  -- The victim owns a 300 m square, claimed yesterday so protection has expired.
  perform test.give_parcel(
    v_victim, test.square(300), now() - interval '1 hour', now() - interval '1 day');

  perform test.act_as(v_attacker);
  -- The attacker walks a 300 m square offset by 150 m: a 50% overlap.
  v_walk := test.record_square_walk(v_attacker, 300, 150, 0);
  v_result := public.finish_walk(v_walk, 'key-1');

  perform test.eq(v_result ->> 'status', 'accepted', 'the raid is accepted');

  v_stolen := (v_result -> 'claim' ->> 'stolen_area_m2')::double precision;
  perform test.ok(v_stolen > 0, 'GR-20 records stolen area');
  perform test.near(v_stolen, 45000, 8000, 'GR-20 transfers the intersection area');

  -- The victim keeps the remainder, and only the remainder.
  select coalesce(sum(area_m2), 0) into v_victim_area
    from public.parcels where owner_id = v_victim;
  perform test.near(v_victim_area, 45000, 8000, 'the victim keeps the non-overlapping part');

  -- GR-11 step 7 / FR-44: one steal_event per victim.
  perform test.eq(
    (select count(*)::integer from public.steal_events where victim_id = v_victim), 1,
    'GR-11 writes exactly one steal_event per victim');
end;
$$;

do $$
declare
  v_victim   uuid := test.create_player('conquered');
  v_attacker uuid := test.create_player('conqueror');
  v_walk     uuid;
begin
  -- A parcel entirely inside the attacker's claim is fully conquered.
  perform test.give_parcel(
    v_victim, test.square(80, 60, 60), null, now() - interval '1 day');

  perform test.act_as(v_attacker);
  v_walk := test.record_square_walk(v_attacker, 250);
  perform public.finish_walk(v_walk, 'key-1');

  perform test.eq(
    (select count(*)::integer from public.parcels where owner_id = v_victim), 0,
    'GR-20 deletes a fully conquered parcel');
end;
$$;

do $$
declare
  v_victim   uuid := test.create_player('slivered');
  v_attacker uuid := test.create_player('sliverer');
  v_walk     uuid;
  v_remaining integer;
begin
  -- The victim's parcel pokes 5 m out of the attacker's 250 m claim: the
  -- remainder is well under MIN_PARCEL_AREA_M2 (100).
  perform test.give_parcel(
    v_victim, test.square(100, 155, 60), null, now() - interval '1 day');

  perform test.act_as(v_attacker);
  v_walk := test.record_square_walk(v_attacker, 250);
  perform public.finish_walk(v_walk, 'key-1');

  select count(*) into v_remaining from public.parcels
   where owner_id = v_victim and area_m2 < 100;

  -- doc 07 Phase 4: "Remainders under 100 m² vanish rather than becoming slivers."
  perform test.eq(v_remaining, 0, 'GR-20 discards sub-MIN_PARCEL_AREA_M2 slivers');
end;
$$;

select test.section('GR-20 / GR-23 — protection clips instead of blocking');

do $$
declare
  v_defender uuid := test.create_player('defender');
  v_raider   uuid := test.create_player('raider');
  v_walk     uuid;
  v_result   jsonb;
  v_defender_area_before double precision;
  v_defender_area_after  double precision;
begin
  -- The defender's parcel was claimed 2 hours ago: still protected.
  perform test.give_parcel(
    v_defender, test.square(150, 50, 50), now() + interval '4 hours', now() - interval '2 hours');

  select area_m2 into v_defender_area_before
    from public.parcels where owner_id = v_defender;

  perform test.act_as(v_raider);
  v_walk := test.record_square_walk(v_raider, 300);
  v_result := public.finish_walk(v_walk, 'key-1');

  select coalesce(sum(area_m2), 0) into v_defender_area_after
    from public.parcels where owner_id = v_defender;

  -- doc 03 §5 example D: the claim is clipped, the shielded land is untouched,
  -- and the raider keeps everything outside it.
  perform test.near(v_defender_area_after, v_defender_area_before, 1,
                    'GR-23 a protected parcel loses nothing');
  perform test.eq(v_result ->> 'status', 'accepted',
                  'GR-20 protection clips the claim rather than voiding it');
  perform test.ok(jsonb_array_length(v_result -> 'blocked') > 0,
                  'the result reports the blocked parcel so the UI can explain');
  perform test.ok(
    (select coalesce(sum(area_m2), 0) from public.parcels where owner_id = v_raider) > 60000,
    'the raider still gains the unprotected remainder');
end;
$$;

select test.section('FR-43 / GR-22 — self-steal and enclaves');

do $$
declare
  v_user uuid := test.create_player('selfsteal');
  v_walk uuid;
begin
  perform test.act_as(v_user);
  v_walk := test.record_square_walk(v_user, 250);
  perform public.finish_walk(v_walk, 'key-1');

  -- FR-43: you cannot steal from yourself. Overlaps merge (tested above), and
  -- no steal_event is ever written against your own land. The CHECK constraint
  -- on steal_events makes this structurally impossible, which is the point.
  perform test.eq(
    (select count(*)::integer from public.steal_events
      where attacker_id = v_user and victim_id = v_user), 0,
    'FR-43 no self-steal event exists');
end;
$$;

do $$
declare
  v_islander uuid := test.create_player('islander');
  v_claimer  uuid := test.create_player('surrounder');
  v_walk     uuid;
  v_island_area_before double precision;
  v_island_area_after  double precision;
begin
  -- GR-22: surrounding is not conquering. A rival parcel fully inside the
  -- claim's OUTER RING but not overlapping the walked band survives.
  --
  -- The claim here is a 250 m square; the island sits in its middle. Because
  -- ST_Difference removes the overlap and the island IS overlapped by a solid
  -- claim polygon, this case only arises when the claim has a hole. Documented
  -- here so the rule is not silently lost: a solid claim over an unprotected
  -- island takes it, which is GR-20, not GR-22.
  perform test.give_parcel(
    v_islander, test.square(40, 100, 100), now() + interval '5 hours', now());

  select area_m2 into v_island_area_before
    from public.parcels where owner_id = v_islander;

  perform test.act_as(v_claimer);
  v_walk := test.record_square_walk(v_claimer, 250);
  perform public.finish_walk(v_walk, 'key-1');

  select coalesce(sum(area_m2), 0) into v_island_area_after
    from public.parcels where owner_id = v_islander;

  -- Protected, so it survives being surrounded — the enclave case that matters
  -- in practice.
  perform test.near(v_island_area_after, v_island_area_before, 1,
                    'GR-22 a protected enclave survives being surrounded');
end;
$$;

select test.section('doc 03 §6 — a rejected claim still saves the walk');

do $$
declare
  v_user   uuid := test.create_player('rejected');
  v_walk   uuid;
  v_result jsonb;
begin
  perform test.act_as(v_user);
  -- Too fast: rejected by GR-04.
  v_walk := test.record_square_walk(v_user, 300, 0, 0, 3, 12);
  v_result := public.finish_walk(v_walk, 'key-1');

  perform test.eq(v_result ->> 'status', 'rejected', 'the claim is rejected');
  perform test.eq(v_result ->> 'error_code', 'ERR_TOO_FAST', 'the machine code is returned');

  -- "The user did the exercise; do not throw that away."
  perform test.ok((v_result -> 'walk' ->> 'distance_m')::double precision > 1000,
                  'doc 03 §6 the walk keeps its distance');
  perform test.ok((v_result -> 'walk' ->> 'duration_s')::integer > 0,
                  'doc 03 §6 the walk keeps its duration');
  perform test.eq((select count(*)::integer from public.parcels where owner_id = v_user), 0,
                  'a rejected claim awards no land');
  perform test.eq((select walks_count from public.user_stats where user_id = v_user), 1,
                  'a rejected walk still counts toward walks_count');
end;
$$;

select test.section('doc 03 §4 — stats are maintained in the transaction');

do $$
declare
  v_user uuid := test.create_player('scorer');
  v_walk uuid;
  v_stats public.user_stats%rowtype;
begin
  perform test.act_as(v_user);
  v_walk := test.record_square_walk(v_user, 250);
  perform public.finish_walk(v_walk, 'key-1');

  select * into v_stats from public.user_stats where user_id = v_user;

  perform test.near(v_stats.total_area_m2, 62500, 2500, 'total_area_m2 matches the parcels');
  perform test.eq(v_stats.parcels_count, 1, 'parcels_count is maintained');
  perform test.eq(v_stats.claims_count, 1, 'claims_count is maintained');
  perform test.eq(v_stats.walks_count, 1, 'walks_count is maintained');
  perform test.ok(v_stats.total_distance_m > 900, 'total_distance_m is maintained');
  perform test.ok(v_stats.best_claim_m2 > 50000, 'best_claim_m2 is maintained');

  -- FR-61: the weekly board tracks area gained.
  perform test.ok(
    (select area_gained_m2 from public.weekly_scores where user_id = v_user) > 50000,
    'FR-61 weekly_scores records the gain');
end;
$$;

do $$
declare
  v_victim   uuid := test.create_player('loser');
  v_attacker uuid := test.create_player('winner');
  v_walk     uuid;
begin
  perform test.give_parcel(v_victim, test.square(300), null, now() - interval '1 day');
  perform public.recompute_user_stats(v_victim);

  perform test.act_as(v_attacker);
  v_walk := test.record_square_walk(v_attacker, 300, 150, 0);
  perform public.finish_walk(v_walk, 'key-1');

  -- GR-11 step 6: stats are recomputed for the claimer AND every victim.
  perform test.ok(
    (select area_lost_m2 from public.user_stats where user_id = v_victim) > 0,
    'the victim area_lost_m2 is updated');
  perform test.ok(
    (select area_stolen_m2 from public.user_stats where user_id = v_attacker) > 0,
    'the attacker area_stolen_m2 is updated');
  perform test.eq(
    (select steals_made from public.user_stats where user_id = v_attacker), 1,
    'steals_made counts victims, not parcels');

  -- doc 03 §4: the weekly score can go negative for a victim.
  perform test.ok(
    (select area_gained_m2 from public.weekly_scores where user_id = v_victim) < 0,
    'a raided player loses weekly area');
end;
$$;

select test.section('FR-63 — own rank is always computable');

do $$
declare
  v_user uuid := test.create_player('ranked');
  v_walk uuid;
begin
  perform test.act_as(v_user);
  v_walk := test.record_square_walk(v_user, 250);
  perform public.finish_walk(v_walk, 'key-1');

  perform test.ok(public.user_global_rank(v_user) >= 1, 'a ranked player has a rank');

  -- A player who has never claimed still gets a number rather than null.
  perform test.ok(public.user_global_rank(test.create_player('unranked')) >= 1,
                  'FR-63 an unranked player still gets a rank');
end;
$$;

rollback;
