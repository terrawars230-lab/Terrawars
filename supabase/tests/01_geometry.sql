-- ═══════════════════════════════════════════════════════════════════════════
-- GR-01 … GR-05 — point cleaning, loop closure, polygon construction,
-- validation, and the isoperimetric check.
--
-- CLAUDE.md rule 4: no geometry function without a test, including the
-- pathological fixtures. The client mirrors these rules in `src/geo/`; if the
-- two ever disagree, this file is the one that is right.
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

begin;

select test.section('GR-01 — point cleaning');

do $$
declare
  v_user uuid := test.create_player('cleaner');
  v_walk uuid;
  v_kept integer;
  v_raw  integer;
begin
  v_walk := test.record_square_walk(v_user, 250);

  select count(*) into v_raw from public.walk_points where walk_id = v_walk;
  select count(*) into v_kept from public.clean_walk_points(v_walk);

  perform test.ok(v_raw >= 40, 'fixture produced enough raw points');
  perform test.eq(v_kept, v_raw, 'a clean walk loses no points');
end;
$$;

do $$
declare
  v_user uuid := test.create_player('inaccurate');
  v_walk uuid;
  v_kept integer;
begin
  v_walk := test.record_square_walk(v_user, 250);

  -- GR-01(1): worse than MAX_ACCURACY_M (30 m) is dropped.
  update public.walk_points set accuracy_m = 45 where walk_id = v_walk and seq in (3, 7, 11);

  select count(*) into v_kept from public.clean_walk_points(v_walk);
  perform test.eq(v_kept, 46, 'GR-01(1) drops points worse than MAX_ACCURACY_M');
end;
$$;

do $$
declare
  v_user uuid := test.create_player('mocker');
  v_walk uuid;
  v_kept integer;
  v_build record;
begin
  v_walk := test.record_square_walk(v_user, 250);

  -- GR-01(2): mock-provider points are dropped from the geometry...
  update public.walk_points set is_mock = true where walk_id = v_walk and seq < 5;

  select count(*) into v_kept from public.clean_walk_points(v_walk);
  perform test.ok(v_kept < 49, 'GR-01(2) drops mock-provider points');

  -- ...and the ratio is still reported, because doc 06 §3(2) makes >5% a hard
  -- rejection and that verdict belongs to finish_walk, not to cleaning.
  select * into v_build from public.build_claim_polygon(v_walk);
  perform test.ok(v_build.mock_ratio > 0.05, 'mock ratio is reported for doc 06 §3(2)');
end;
$$;

do $$
declare
  v_user uuid := test.create_player('teleporter');
  v_walk uuid;
  v_build record;
begin
  v_walk := test.record_square_walk(v_user, 250);

  -- GR-01(5): ONE teleport is repaired by dropping the point and re-linking.
  update public.walk_points
     set lat = test.origin_lat() + 0.09   -- ~10 km north, in one 10 s step
   where walk_id = v_walk and seq = 20;

  select * into v_build from public.build_claim_polygon(v_walk);
  perform test.ok(v_build.teleports = 1, 'GR-01(5) counts a single teleport');
  perform test.ok(v_build.error_code is distinct from 'ERR_TELEPORT',
                  'GR-01(5) repairs a single teleport rather than rejecting');
end;
$$;

do $$
declare
  v_user uuid := test.create_player('teleporter2');
  v_walk uuid;
  v_build record;
begin
  v_walk := test.record_square_walk(v_user, 250);

  -- Two or more teleports reject the walk.
  update public.walk_points set lat = test.origin_lat() + 0.09
   where walk_id = v_walk and seq = 10;
  update public.walk_points set lat = test.origin_lat() - 0.09
   where walk_id = v_walk and seq = 30;

  select * into v_build from public.build_claim_polygon(v_walk);
  perform test.eq(v_build.error_code, 'ERR_TELEPORT', 'GR-01(5) rejects on a second teleport');
end;
$$;

do $$
declare
  v_user uuid := test.create_player('sparse');
  v_walk uuid;
  v_build record;
begin
  -- GR-01(6): fewer than MIN_POINTS (20) surviving rejects the walk.
  v_walk := test.record_square_walk(v_user, 250, 0, 0, 10, 3);

  select * into v_build from public.build_claim_polygon(v_walk);
  perform test.eq(v_build.error_code, 'ERR_TOO_FEW_POINTS', 'GR-01(6) rejects a sparse walk');
end;
$$;

select test.section('GR-02 / GR-03 — loop closure and polygon construction');

do $$
declare
  v_user uuid := test.create_player('looper');
  v_walk uuid;
  v_build record;
begin
  v_walk := test.record_square_walk(v_user, 250);
  select * into v_build from public.build_claim_polygon(v_walk);

  perform test.ok(v_build.geom is not null, 'GR-03 builds a polygon from a closed loop');
  perform test.eq(extensions.geometrytype(v_build.geom), 'POLYGON',
                  'GR-03(3) yields a POLYGON, never a MULTIPOLYGON');
  perform test.ok(extensions.st_isvalid(v_build.geom), 'GR-03 output is a valid geometry');
  perform test.eq(extensions.st_srid(v_build.geom), 4326, 'geometry is SRID 4326');
end;
$$;

do $$
declare
  v_user uuid := test.create_player('measurer');
  v_walk uuid;
  v_build record;
begin
  -- A 250 m square encloses 62 500 m². CLAUDE.md rule 9: metres, geodesic.
  v_walk := test.record_square_walk(v_user, 250);
  select * into v_build from public.build_claim_polygon(v_walk);

  perform test.near(v_build.area_m2, 62500, 2000,
                    'area matches the analytic value of the square, in m²');
  perform test.ok(v_build.area_m2 > 1000,
                  'area is in metres, not degrees (CLAUDE.md rule 9)');
  perform test.near(v_build.path_length_m, 1000, 60, 'walked path length is ~1 km');
end;
$$;

do $$
declare
  v_user uuid := test.create_player('opener');
  v_walk uuid;
  v_build record;
  v_seq integer;
begin
  -- An open path: strip the closing points so the walk never returns near the
  -- start and never crosses itself.
  v_walk := test.record_square_walk(v_user, 250);
  delete from public.walk_points where walk_id = v_walk and seq > 30;

  select * into v_build from public.build_claim_polygon(v_walk);
  perform test.eq(v_build.error_code, 'ERR_LOOP_NOT_CLOSED', 'GR-02 rejects an open path');
end;
$$;

select test.section('GR-04 — claim validation');

do $$
declare
  v_user uuid := test.create_player('tiny');
  v_walk uuid;
  v_build record;
begin
  -- A 15 m square is ~225 m², under MIN_CLAIM_AREA_M2 (500).
  v_walk := test.record_square_walk(v_user, 15, 0, 0, 10, 20);

  select * into v_build from public.build_claim_polygon(v_walk);
  perform test.ok(v_build.error_code is not null, 'a tiny loop is rejected');
end;
$$;

do $$
declare
  v_user uuid := test.create_player('driver');
  v_walk uuid;
  v_build record;
begin
  -- A 300 m square walked at 1 s per ~25 m sample: ~8 m/s average, above
  -- MAX_SPEED_MPS (6) but below MAX_BURST_SPEED_MPS (12) on every segment, so
  -- the speed check fires rather than the teleport rule.
  v_walk := test.record_square_walk(v_user, 300, 0, 0, 3, 12);

  select * into v_build from public.build_claim_polygon(v_walk);
  perform test.ok(v_build.avg_speed_mps > 6, 'fixture really is too fast');
  perform test.eq(v_build.error_code, 'ERR_TOO_FAST', 'GR-04 rejects vehicle speed');
end;
$$;

select test.section('GR-05 — the isoperimetric ceiling');

do $$
declare
  v_allowed double precision;
begin
  -- doc 03 §5 example A: a 900 m loop may enclose at most ~74 100 m².
  v_allowed := (900 ^ 2 / (4 * pi())) * public.config_number('ISOPERIMETRIC_TOLERANCE');
  perform test.near(v_allowed, 74100, 200, 'GR-05 matches doc 03 example A');

  -- doc 03 §5 example E: 600 m of walking cannot enclose 5 km².
  v_allowed := (600 ^ 2 / (4 * pi())) * public.config_number('ISOPERIMETRIC_TOLERANCE');
  perform test.near(v_allowed, 32900, 200, 'GR-05 matches doc 03 example E');
  perform test.ok(v_allowed < 5000000, 'GR-05 rejects the example E fabrication');
end;
$$;

do $$
declare
  v_user uuid := test.create_player('honest');
  v_walk uuid;
  v_build record;
begin
  -- A genuinely walked loop always satisfies GR-05, because the walked length
  -- is at least the ring perimeter. The check exists for forged point sets.
  v_walk := test.record_square_walk(v_user, 250);
  select * into v_build from public.build_claim_polygon(v_walk);

  perform test.ok(
    v_build.area_m2 <= (v_build.path_length_m ^ 2 / (4 * pi()))
                       * public.config_number('ISOPERIMETRIC_TOLERANCE'),
    'a real walk is inside the GR-05 ceiling by construction');
end;
$$;

select test.section('game_config — CLAUDE.md rule 7');

do $$
begin
  perform test.eq(public.config_number('MIN_CLAIM_AREA_M2'), 500::double precision,
                  'launch default MIN_CLAIM_AREA_M2 is seeded');
  perform test.eq(public.config_int('PROTECTION_HOURS'), 6,
                  'launch default PROTECTION_HOURS is seeded');
end;
$$;

do $$
begin
  -- A missing key must RAISE, not default. A silently defaulted constant
  -- changes the rules of the game without anyone noticing.
  begin
    perform public.config_number('NO_SUCH_KEY');
    perform test.fail('config_number should raise on a missing key');
  exception
    when others then
      raise notice '  ok: config_number raises on a missing key (rule 7)';
  end;
end;
$$;

select test.section('format_area — doc 03 §4');

do $$
begin
  perform test.ok(public.format_area(9999) like '%m²', 'below 10 000 m² displays as m²');
  perform test.ok(public.format_area(41000) like '%km²', 'above 10 000 m² displays as km²');
  perform test.eq(public.format_area(null), null::text, 'null area formats as null');
end;
$$;

rollback;
