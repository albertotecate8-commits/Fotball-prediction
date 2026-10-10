-- Football Predictions: migraciones 03-06 + alineación del historial.
-- Idempotente (se puede ejecutar más de una vez). Supabase → SQL Editor → Run.
-- Contiene DELETE solo dentro de definiciones de funciones: no borra datos al ejecutarse.
begin;

-- >>> 20261009000003_scoring_core.sql
-- =====================================================================
-- Puntuación oficial, ciclo de vida de jornadas y API del jugador.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Reglas oficiales (deben coincidir con src/lib/scoring.ts)
--   3 pts por acertar 1X2, +2 por marcador exacto (máx. 5 por partido)
-- ---------------------------------------------------------------------
create or replace function public.score_prediction(p_pred_home int, p_pred_away int, p_real_home int, p_real_away int)
returns smallint
language sql
immutable
strict
set search_path = ''
as $$
  select (case
    when p_pred_home = p_real_home and p_pred_away = p_real_away then 5
    when sign(p_pred_home - p_pred_away) = sign(p_real_home - p_real_away) then 3
    else 0
  end)::smallint;
$$;

create or replace function public.goal_error(p_pred_home int, p_pred_away int, p_real_home int, p_real_away int)
returns smallint
language sql
immutable
strict
set search_path = ''
as $$
  select (abs(p_pred_home - p_real_home) + abs(p_pred_away - p_real_away))::smallint;
$$;

-- ---------------------------------------------------------------------
-- Errores de negocio: se lanzan con un código estable que el frontend
-- traduce. errcode P0001 = raise_exception.
-- ---------------------------------------------------------------------
create or replace function private.fail(p_code text, p_detail text default null)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception '%', p_code using errcode = 'P0001', detail = coalesce(p_detail, '');
end;
$$;

create or replace function private.require_user()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    perform private.fail('NOT_AUTHENTICATED');
  end if;
  return v_uid;
end;
$$;

create or replace function private.setting_int(p_key text, p_default int)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select (s.value #>> '{}')::int from public.app_settings s where s.key = p_key), p_default);
$$;

-- Fase visible de una jornada (derivada del estado + reloj del servidor)
create or replace function private.round_phase(p_round public.rounds)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when p_round.status = 'draft' then 'draft'
    when p_round.status = 'finished' then 'finished'
    when p_round.status = 'under_review' then 'under_review'
    when p_round.status = 'open' and p_round.opens_at is not null and now() < p_round.opens_at then 'upcoming'
    when p_round.status = 'open' and now() < p_round.deadline_at then 'open'
    when exists (
      select 1 from public.round_matches rm join public.matches m on m.id = rm.match_id
      where rm.round_id = p_round.id and (m.kickoff_at <= now() or m.status in ('live', 'finished'))
    ) then 'in_progress'
    else 'closed'
  end;
$$;

-- ---------------------------------------------------------------------
-- Recalculo de puntos (idempotente: borra y vuelve a calcular)
-- ---------------------------------------------------------------------
create or replace function private.recompute_round_scores(p_round_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_official boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended('round_scores:' || p_round_id::text, 0));

  select r.status = 'finished' into v_official from public.rounds r where r.id = p_round_id;
  if v_official is null then
    return;
  end if;

  delete from public.prediction_item_scores pis
    using public.predictions p
    where pis.prediction_id = p.id and p.round_id = p_round_id;

  insert into public.prediction_item_scores (prediction_id, match_id, points, exact_hit, outcome_hit, goal_error, is_final, computed_at)
  select p.id,
         pi.match_id,
         public.score_prediction(pi.home_goals, pi.away_goals, m.home_goals, m.away_goals),
         pi.home_goals = m.home_goals and pi.away_goals = m.away_goals,
         sign(pi.home_goals - pi.away_goals) = sign(m.home_goals - m.away_goals),
         public.goal_error(pi.home_goals, pi.away_goals, m.home_goals, m.away_goals),
         m.result_confirmed,
         now()
  from public.predictions p
  join public.prediction_items pi on pi.prediction_id = p.id
  join public.round_matches rm on rm.round_id = p.round_id and rm.match_id = pi.match_id
  join public.matches m on m.id = pi.match_id
  where p.round_id = p_round_id
    and p.status = 'submitted'
    and m.status in ('live', 'finished')
    and m.home_goals is not null;

  delete from public.round_scores rs where rs.round_id = p_round_id;

  insert into public.round_scores (round_id, user_id, points, exact_hits, outcome_hits, goal_error, scored_matches, is_official, computed_at)
  select p.round_id,
         p.user_id,
         coalesce(sum(s.points), 0),
         count(*) filter (where s.exact_hit),
         count(*) filter (where s.outcome_hit),
         coalesce(sum(s.goal_error), 0),
         count(s.match_id),
         v_official,
         now()
  from public.predictions p
  left join public.prediction_item_scores s on s.prediction_id = p.id
  where p.round_id = p_round_id and p.status = 'submitted'
  group by p.round_id, p.user_id;
end;
$$;

-- Avanza el estado de la jornada según el reloj y los resultados, y recalcula.
create or replace function private.refresh_round_state(p_round_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round public.rounds;
begin
  select * into v_round from public.rounds where id = p_round_id for update;
  if not found then
    return null;
  end if;

  if v_round.status = 'open' and now() >= v_round.deadline_at then
    update public.rounds set status = 'closed', closed_at = now() where id = p_round_id;
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, details)
      values (null, 'round.auto_closed', 'round', p_round_id::text, jsonb_build_object('deadline_at', v_round.deadline_at));
    v_round.status := 'closed';
  end if;

  if v_round.status = 'closed'
     and exists (select 1 from public.round_matches rm where rm.round_id = p_round_id)
     and not exists (
       select 1 from public.round_matches rm join public.matches m on m.id = rm.match_id
       where rm.round_id = p_round_id
         and not ((m.status = 'finished' and m.result_confirmed) or m.status in ('cancelled', 'abandoned'))
     ) then
    update public.rounds set status = 'finished', finalized_at = now() where id = p_round_id;
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, details)
      values (null, 'round.auto_finalized', 'round', p_round_id::text, '{}'::jsonb);
    v_round.status := 'finished';
  end if;

  if v_round.status <> 'draft' then
    perform private.recompute_round_scores(p_round_id);
  end if;
  return v_round.status;
end;
$$;

-- ---------------------------------------------------------------------
-- Validación de pronósticos
-- ---------------------------------------------------------------------
create or replace function private.parse_prediction_items(p_round_id uuid, p_items jsonb, p_require_complete boolean)
returns table (match_id uuid, home_goals smallint, away_goals smallint)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_max int := private.setting_int('max_goals', 15);
  v_elem jsonb;
  v_mid uuid;
  v_h numeric;
  v_a numeric;
  v_seen uuid[] := '{}';
  v_total int;
  v_home_null boolean;
  v_away_null boolean;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    perform private.fail('INVALID_ITEMS');
  end if;
  if jsonb_array_length(p_items) > 50 then
    perform private.fail('INVALID_ITEMS');
  end if;

  for v_elem in select e.value from jsonb_array_elements(p_items) as e loop
    if jsonb_typeof(v_elem) <> 'object' then
      perform private.fail('INVALID_ITEMS');
    end if;
    begin
      v_mid := (v_elem ->> 'match_id')::uuid;
    exception when others then
      perform private.fail('INVALID_MATCH');
    end;
    if v_mid is null then
      perform private.fail('INVALID_MATCH');
    end if;
    if v_mid = any (v_seen) then
      perform private.fail('DUPLICATE_MATCH');
    end if;
    if not exists (select 1 from public.round_matches rm where rm.round_id = p_round_id and rm.match_id = v_mid) then
      perform private.fail('MATCH_NOT_IN_ROUND');
    end if;

    v_home_null := coalesce(jsonb_typeof(v_elem -> 'home'), 'null') = 'null';
    v_away_null := coalesce(jsonb_typeof(v_elem -> 'away'), 'null') = 'null';

    if v_home_null and v_away_null then
      if p_require_complete then
        perform private.fail('INCOMPLETE_PREDICTION');
      end if;
      continue; -- en borrador: partido aún sin pronóstico
    end if;

    if jsonb_typeof(v_elem -> 'home') is distinct from 'number' or jsonb_typeof(v_elem -> 'away') is distinct from 'number' then
      perform private.fail('INVALID_GOALS');
    end if;
    v_h := (v_elem ->> 'home')::numeric;
    v_a := (v_elem ->> 'away')::numeric;
    if v_h <> trunc(v_h) or v_a <> trunc(v_a) or v_h < 0 or v_a < 0 or v_h > v_max or v_a > v_max then
      perform private.fail('INVALID_GOALS', format('Goles entre 0 y %s', v_max));
    end if;

    v_seen := v_seen || v_mid;
    match_id := v_mid;
    home_goals := v_h::smallint;
    away_goals := v_a::smallint;
    return next;
  end loop;

  if p_require_complete then
    select count(*) into v_total from public.round_matches rm where rm.round_id = p_round_id;
    if v_total = 0 or cardinality(v_seen) <> v_total then
      perform private.fail('INCOMPLETE_PREDICTION');
    end if;
  end if;
end;
$$;

-- Bloquea la jornada en modo compartido y comprueba que acepte pronósticos.
create or replace function private.lock_round_for_play(p_round_id uuid, p_user_id uuid)
returns public.rounds
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round public.rounds;
begin
  select * into v_round from public.rounds where id = p_round_id for share;
  if not found or not private.can_view_round(p_round_id, p_user_id) then
    perform private.fail('ROUND_NOT_FOUND');
  end if;
  return v_round;
end;
$$;

create or replace function private.assert_round_accepting(p_round public.rounds)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_round.status <> 'open' then
    perform private.fail('ROUND_CLOSED');
  end if;
  if p_round.opens_at is not null and now() < p_round.opens_at then
    perform private.fail('ROUND_NOT_OPEN_YET');
  end if;
  if now() >= p_round.deadline_at then
    perform private.fail('DEADLINE_PASSED');
  end if;
end;
$$;

create or replace function private.lock_prediction(p_round_id uuid, p_user_id uuid)
returns public.predictions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pred public.predictions;
begin
  insert into public.predictions (round_id, user_id)
  values (p_round_id, p_user_id)
  on conflict (round_id, user_id) do nothing;

  select * into v_pred from public.predictions
  where round_id = p_round_id and user_id = p_user_id
  for update;
  return v_pred;
end;
$$;

-- >>> 20261009000004_player_api.sql
-- =====================================================================
-- API del jugador (lectura y escritura de quinielas, clasificación).
-- =====================================================================

-- ---------------------------------------------------------------------
-- API del jugador
-- ---------------------------------------------------------------------
create or replace function public.get_server_time()
returns timestamptz
language sql
stable
set search_path = ''
as $$ select now(); $$;

create or replace function public.get_app_config()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'timezone', coalesce((select s.value #>> '{}' from public.app_settings s where s.key = 'timezone'), 'America/Mexico_City'),
    'max_goals', private.setting_int('max_goals', 15),
    'payments_enabled', false,
    'server_time', now()
  );
$$;

-- Guarda el borrador completo (snapshot). Las solicitudes con una
-- secuencia menor o igual a la ya guardada se ignoran (llegaron tarde).
create or replace function public.save_prediction_draft(p_round_id uuid, p_items jsonb, p_client_seq bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_round public.rounds;
  v_pred public.predictions;
  v_count int;
begin
  v_round := private.lock_round_for_play(p_round_id, v_uid);
  v_pred := private.lock_prediction(p_round_id, v_uid);

  if v_pred.status = 'submitted' then
    return jsonb_build_object('status', 'submitted', 'applied', false, 'submitted_at', v_pred.submitted_at, 'client_seq', v_pred.client_seq);
  end if;

  perform private.assert_round_accepting(v_round);

  if p_client_seq is null or p_client_seq <= v_pred.client_seq then
    return jsonb_build_object('status', 'draft', 'applied', false, 'reason', 'stale', 'client_seq', v_pred.client_seq, 'saved_at', v_pred.updated_at);
  end if;

  create temporary table if not exists pg_temp._draft_items (match_id uuid primary key, home_goals smallint, away_goals smallint) on commit drop;
  delete from pg_temp._draft_items;
  insert into pg_temp._draft_items select * from private.parse_prediction_items(p_round_id, p_items, false);

  delete from public.prediction_items pi
    where pi.prediction_id = v_pred.id
      and not exists (select 1 from pg_temp._draft_items d where d.match_id = pi.match_id);

  insert into public.prediction_items (prediction_id, match_id, home_goals, away_goals)
  select v_pred.id, d.match_id, d.home_goals, d.away_goals from pg_temp._draft_items d
  on conflict (prediction_id, match_id) do update
    set home_goals = excluded.home_goals, away_goals = excluded.away_goals
    where public.prediction_items.home_goals is distinct from excluded.home_goals
       or public.prediction_items.away_goals is distinct from excluded.away_goals;

  update public.predictions set client_seq = p_client_seq where id = v_pred.id;
  select count(*) into v_count from pg_temp._draft_items;

  return jsonb_build_object('status', 'draft', 'applied', true, 'client_seq', p_client_seq, 'saved_at', now(), 'items_count', v_count);
end;
$$;

-- Envío definitivo. Atómico, idempotente y sin posibilidad de edición posterior.
create or replace function public.submit_prediction(p_round_id uuid, p_items jsonb, p_client_seq bigint default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_round public.rounds;
  v_pred public.predictions;
  v_count int;
begin
  v_round := private.lock_round_for_play(p_round_id, v_uid);
  v_pred := private.lock_prediction(p_round_id, v_uid);

  if v_pred.status = 'submitted' then
    -- Reintento o doble clic: se devuelve el estado existente, sin cambios.
    return jsonb_build_object('status', 'submitted', 'already_submitted', true, 'submitted_at', v_pred.submitted_at);
  end if;

  perform private.assert_round_accepting(v_round);

  create temporary table if not exists pg_temp._submit_items (match_id uuid primary key, home_goals smallint, away_goals smallint) on commit drop;
  delete from pg_temp._submit_items;
  insert into pg_temp._submit_items select * from private.parse_prediction_items(p_round_id, p_items, true);

  delete from public.prediction_items pi where pi.prediction_id = v_pred.id;
  insert into public.prediction_items (prediction_id, match_id, home_goals, away_goals)
  select v_pred.id, s.match_id, s.home_goals, s.away_goals from pg_temp._submit_items s;

  update public.predictions
     set status = 'submitted',
         submitted_at = now(),
         client_seq = greatest(client_seq, coalesce(p_client_seq, client_seq))
   where id = v_pred.id
  returning * into v_pred;

  select count(*) into v_count from pg_temp._submit_items;
  perform private.log_audit('prediction.submitted', 'prediction', v_pred.id::text,
    jsonb_build_object('round_id', p_round_id, 'items', v_count));

  return jsonb_build_object('status', 'submitted', 'already_submitted', false, 'submitted_at', v_pred.submitted_at);
end;
$$;

create or replace function public.join_group(p_invite_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_group public.groups;
  v_status text;
begin
  select * into v_group from public.groups
  where invite_code = upper(btrim(coalesce(p_invite_code, ''))) and is_active;
  if not found then
    perform private.fail('INVALID_INVITE_CODE');
  end if;

  insert into public.group_members (group_id, user_id, status)
  values (v_group.id, v_uid, case when v_group.join_requires_approval then 'pending' else 'active' end)
  on conflict (group_id, user_id) do nothing;

  select gm.status into v_status from public.group_members gm where gm.group_id = v_group.id and gm.user_id = v_uid;
  perform private.log_audit('group.join_requested', 'group', v_group.id::text, jsonb_build_object('status', v_status));
  return jsonb_build_object('group_id', v_group.id, 'name', v_group.name, 'status', v_status);
end;
$$;

create or replace function public.get_my_groups()
returns table (group_id uuid, name text, description text, member_status text, joined_at timestamptz, members_count int)
language sql
stable
security definer
set search_path = ''
as $$
  select g.id, g.name, g.description, gm.status, gm.joined_at,
         (select count(*)::int from public.group_members x where x.group_id = g.id and x.status = 'active')
  from public.group_members gm
  join public.groups g on g.id = gm.group_id and g.is_active
  where gm.user_id = auth.uid()
  order by gm.status = 'active' desc, gm.joined_at;
$$;

create or replace function private.assert_group_access(p_group_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_user();
  if not (private.is_admin() or private.is_active_member(p_group_id)) then
    perform private.fail('FORBIDDEN');
  end if;
end;
$$;

-- Jornadas visibles del grupo con el estado personal del jugador.
create or replace function public.get_my_rounds(p_group_id uuid)
returns table (
  round_id uuid, name text, description text, status text, phase text,
  opens_at timestamptz, deadline_at timestamptz, finalized_at timestamptz,
  match_count int, first_kickoff timestamptz, last_kickoff timestamptz,
  my_status text, my_items int, my_submitted_at timestamptz,
  my_points int, my_exact_hits int, my_outcome_hits int, my_position int, players int, is_official boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := private.require_user();
begin
  perform private.assert_group_access(p_group_id);
  return query
  with visible as (
    select r.* from public.rounds r
    where r.group_id = p_group_id and private.can_view_round(r.id, v_uid)
  ),
  ranked as (
    select rs.round_id, rs.user_id, rs.points, rs.exact_hits, rs.outcome_hits, rs.is_official,
           rank() over (partition by rs.round_id order by rs.points desc, rs.exact_hits desc, rs.goal_error asc, rs.outcome_hits desc)::int as pos,
           count(*) over (partition by rs.round_id)::int as players
    from public.round_scores rs
    where rs.round_id in (select v.id from visible v)
  )
  select v.id, v.name, v.description, v.status, private.round_phase(rr),
         v.opens_at, v.deadline_at, v.finalized_at,
         (select count(*)::int from public.round_matches rm where rm.round_id = v.id),
         (select min(m.kickoff_at) from public.round_matches rm join public.matches m on m.id = rm.match_id where rm.round_id = v.id),
         (select max(m.kickoff_at) from public.round_matches rm join public.matches m on m.id = rm.match_id where rm.round_id = v.id),
         coalesce(p.status, 'none'),
         (select count(*)::int from public.prediction_items pi where pi.prediction_id = p.id),
         p.submitted_at,
         rk.points, rk.exact_hits, rk.outcome_hits, rk.pos,
         (select max(r2.players) from ranked r2 where r2.round_id = v.id),
         coalesce(rk.is_official, v.status = 'finished')
  from visible v
  join public.rounds rr on rr.id = v.id
  left join public.predictions p on p.round_id = v.id and p.user_id = v_uid
  left join ranked rk on rk.round_id = v.id and rk.user_id = v_uid
  order by v.deadline_at desc;
end;
$$;

-- Detalle completo de una jornada para el jugador (partidos, su quiniela y puntos).
create or replace function public.get_round_detail(p_round_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_round public.rounds;
  v_pred public.predictions;
  v_matches jsonb;
  v_summary jsonb;
begin
  select * into v_round from public.rounds where id = p_round_id;
  if not found or not (private.can_view_round(p_round_id, v_uid) or private.is_admin()) then
    perform private.fail('ROUND_NOT_FOUND');
  end if;

  select * into v_pred from public.predictions where round_id = p_round_id and user_id = v_uid;

  select coalesce(jsonb_agg(jsonb_build_object(
      'match_id', m.id,
      'position', rm.position,
      'kickoff_at', m.kickoff_at,
      'status', m.status,
      'status_detail', m.status_detail,
      'elapsed', m.elapsed,
      'home_goals', m.home_goals,
      'away_goals', m.away_goals,
      'result_confirmed', m.result_confirmed,
      'is_test_data', m.is_test_data,
      'competition', case when c.id is null then null else jsonb_build_object('name', c.name, 'logo_url', c.logo_url) end,
      'home', jsonb_build_object('id', ht.id, 'name', ht.name, 'short_name', ht.short_name, 'code', ht.code, 'logo_url', ht.logo_url),
      'away', jsonb_build_object('id', at.id, 'name', at.name, 'short_name', at.short_name, 'code', at.code, 'logo_url', at.logo_url),
      'pick', case when pi.match_id is null then null else jsonb_build_object('home', pi.home_goals, 'away', pi.away_goals) end,
      'score', case when s.match_id is null then null else jsonb_build_object(
          'points', s.points, 'exact_hit', s.exact_hit, 'outcome_hit', s.outcome_hit, 'goal_error', s.goal_error, 'is_final', s.is_final) end
    ) order by rm.position), '[]'::jsonb)
  into v_matches
  from public.round_matches rm
  join public.matches m on m.id = rm.match_id
  join public.teams ht on ht.id = m.home_team_id
  join public.teams at on at.id = m.away_team_id
  left join public.competitions c on c.id = m.competition_id
  left join public.prediction_items pi on pi.prediction_id = v_pred.id and pi.match_id = m.id
  left join public.prediction_item_scores s on s.prediction_id = v_pred.id and s.match_id = m.id
  where rm.round_id = p_round_id;

  with ranked as (
    select rs.*, rank() over (order by rs.points desc, rs.exact_hits desc, rs.goal_error asc, rs.outcome_hits desc)::int as pos,
           count(*) over ()::int as players
    from public.round_scores rs where rs.round_id = p_round_id
  )
  select jsonb_build_object(
      'points', coalesce(r.points, 0),
      'exact_hits', coalesce(r.exact_hits, 0),
      'outcome_hits', coalesce(r.outcome_hits, 0),
      'goal_error', coalesce(r.goal_error, 0),
      'scored_matches', coalesce(r.scored_matches, 0),
      'position', r.pos,
      'players', coalesce(r.players, (select count(*) from ranked)),
      'is_official', v_round.status = 'finished',
      'max_possible', 5 * (select count(*) from public.round_matches rm join public.matches m on m.id = rm.match_id
                           where rm.round_id = p_round_id and m.status not in ('cancelled', 'abandoned'))
    )
  into v_summary
  from (select 1) one
  left join ranked r on r.user_id = v_uid;

  return jsonb_build_object(
    'round', jsonb_build_object(
      'id', v_round.id, 'group_id', v_round.group_id, 'name', v_round.name, 'description', v_round.description,
      'status', v_round.status, 'phase', private.round_phase(v_round),
      'opens_at', v_round.opens_at, 'deadline_at', v_round.deadline_at, 'finalized_at', v_round.finalized_at),
    'server_time', now(),
    'max_goals', private.setting_int('max_goals', 15),
    'prediction', case when v_pred.id is null then null else jsonb_build_object(
      'id', v_pred.id, 'status', v_pred.status, 'submitted_at', v_pred.submitted_at,
      'client_seq', v_pred.client_seq, 'updated_at', v_pred.updated_at) end,
    'matches', v_matches,
    'summary', v_summary
  );
end;
$$;

-- Clasificación oficial. Desempates: puntos ↓, exactos ↓, error de goles ↑,
-- aciertos 1X2 ↓. Empate total ⇒ posición compartida (RANK).
create or replace function public.get_leaderboard(p_group_id uuid, p_round_id uuid default null)
returns table (
  rank_position int, user_id uuid, display_name text, avatar_url text,
  points int, exact_hits int, outcome_hits int, goal_error int,
  rounds_played int, scored_matches int, is_provisional boolean, is_me boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.assert_group_access(p_group_id);
  if p_round_id is not null and not exists (
    select 1 from public.rounds r
    where r.id = p_round_id and r.group_id = p_group_id
      and (private.is_admin() or private.can_view_round(r.id))
  ) then
    perform private.fail('ROUND_NOT_FOUND');
  end if;

  return query
  with agg as (
    select rs.user_id,
           sum(rs.points)::int as pts,
           sum(rs.exact_hits)::int as ex,
           sum(rs.outcome_hits)::int as oc,
           sum(rs.goal_error)::int as ge,
           count(*)::int as rp,
           sum(rs.scored_matches)::int as sm,
           bool_or(not rs.is_official) as prov
    from public.round_scores rs
    join public.rounds r on r.id = rs.round_id
    where r.group_id = p_group_id
      and (r.status in ('closed', 'finished', 'under_review') or (r.status = 'open' and r.deadline_at <= now()))
      and (p_round_id is null or rs.round_id = p_round_id)
    group by rs.user_id
  )
  select rank() over (order by a.pts desc, a.ex desc, a.ge asc, a.oc desc)::int,
         a.user_id, p.display_name, p.avatar_url,
         a.pts, a.ex, a.oc, a.ge, a.rp, a.sm, a.prov, a.user_id = auth.uid()
  from agg a
  join public.profiles p on p.id = a.user_id
  order by 1, p.display_name;
end;
$$;

-- Evolución de la posición acumulada del jugador jornada a jornada.
create or replace function public.get_position_history(p_group_id uuid)
returns table (
  round_id uuid, round_name text, deadline_at timestamptz,
  round_points int, round_position int, cumulative_points int, cumulative_position int, players int, is_official boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := private.require_user();
begin
  perform private.assert_group_access(p_group_id);
  return query
  with scored as (
    select r.id, r.name, r.deadline_at, r.status
    from public.rounds r
    where r.group_id = p_group_id
      and (r.status in ('closed', 'finished', 'under_review') or (r.status = 'open' and r.deadline_at <= now()))
  ),
  per_round as (
    select rs.round_id, rs.user_id, rs.points,
           rank() over (partition by rs.round_id order by rs.points desc, rs.exact_hits desc, rs.goal_error asc, rs.outcome_hits desc)::int as pos
    from public.round_scores rs where rs.round_id in (select s.id from scored s)
  ),
  cumulative as (
    select s.id as round_id, rs.user_id,
           sum(rs.points)::int as pts, sum(rs.exact_hits)::int as ex,
           sum(rs.goal_error)::int as ge, sum(rs.outcome_hits)::int as oc
    from scored s
    join scored prev on prev.deadline_at <= s.deadline_at
    join public.round_scores rs on rs.round_id = prev.id
    group by s.id, rs.user_id
  ),
  cumulative_ranked as (
    select c.*, rank() over (partition by c.round_id order by c.pts desc, c.ex desc, c.ge asc, c.oc desc)::int as pos,
           count(*) over (partition by c.round_id)::int as players
    from cumulative c
  )
  select s.id, s.name, s.deadline_at, pr.points, pr.pos, cr.pts, cr.pos, cr.players, s.status = 'finished'
  from scored s
  join cumulative_ranked cr on cr.round_id = s.id and cr.user_id = v_uid
  left join per_round pr on pr.round_id = s.id and pr.user_id = v_uid
  order by s.deadline_at;
end;
$$;

-- Resumen de rendimiento para la pantalla de inicio.
create or replace function public.get_player_summary(p_group_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_me record;
  v_players int;
  v_last record;
begin
  perform private.assert_group_access(p_group_id);

  select * into v_me from public.get_leaderboard(p_group_id, null) lb where lb.user_id = v_uid;
  select count(*) into v_players from public.get_leaderboard(p_group_id, null);

  select h.round_id, h.round_name, h.round_points, h.round_position, h.is_official
    into v_last
    from public.get_position_history(p_group_id) h
    order by h.deadline_at desc limit 1;

  return jsonb_build_object(
    'total_points', coalesce(v_me.points, 0),
    'position', v_me.rank_position,
    'players', v_players,
    'exact_hits', coalesce(v_me.exact_hits, 0),
    'outcome_hits', coalesce(v_me.outcome_hits, 0),
    'rounds_played', coalesce(v_me.rounds_played, 0),
    'is_provisional', coalesce(v_me.is_provisional, false),
    'last_round', case when v_last.round_id is null then null else jsonb_build_object(
       'round_id', v_last.round_id, 'name', v_last.round_name, 'points', coalesce(v_last.round_points, 0),
       'position', v_last.round_position, 'is_official', v_last.is_official) end
  );
end;
$$;

-- Próximos partidos: SOLO los incluidos en jornadas visibles del grupo.
create or replace function public.get_upcoming_matches(p_group_id uuid, p_limit int default 8)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_result jsonb;
begin
  perform private.assert_group_access(p_group_id);
  select coalesce(jsonb_agg(x order by x ->> 'kickoff_at'), '[]'::jsonb) into v_result
  from (
    select distinct on (m.id) jsonb_build_object(
      'match_id', m.id, 'kickoff_at', m.kickoff_at, 'status', m.status, 'elapsed', m.elapsed,
      'home_goals', m.home_goals, 'away_goals', m.away_goals, 'is_test_data', m.is_test_data,
      'round_id', r.id, 'round_name', r.name,
      'home', jsonb_build_object('name', ht.name, 'short_name', ht.short_name, 'code', ht.code, 'logo_url', ht.logo_url),
      'away', jsonb_build_object('name', at.name, 'short_name', at.short_name, 'code', at.code, 'logo_url', at.logo_url)
    ) as x
    from public.rounds r
    join public.round_matches rm on rm.round_id = r.id
    join public.matches m on m.id = rm.match_id
    join public.teams ht on ht.id = m.home_team_id
    join public.teams at on at.id = m.away_team_id
    where r.group_id = p_group_id
      and private.can_view_round(r.id, v_uid)
      and m.status in ('scheduled', 'live')
      and m.kickoff_at >= now() - interval '3 hours'
    order by m.id, r.deadline_at
  ) sub
  limit greatest(1, least(p_limit, 30));
  return v_result;
end;
$$;

-- Arranque: el primer usuario registrado puede reclamar el rol de admin
-- únicamente si todavía no existe ningún administrador.
create or replace function public.claim_first_admin()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
begin
  lock table public.profiles in share row exclusive mode;
  if exists (select 1 from public.profiles where role = 'admin') then
    return false;
  end if;
  update public.profiles set role = 'admin' where id = v_uid;
  perform private.log_audit('admin.bootstrap', 'profile', v_uid::text, '{}'::jsonb);
  return true;
end;
$$;

-- ---------------------------------------------------------------------
-- Permisos de ejecución
-- ---------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_admin() to authenticated;
grant execute on function private.is_active_member(uuid) to authenticated;
grant execute on function private.shares_group(uuid) to authenticated;
grant execute on function private.can_view_round(uuid, uuid) to authenticated;
grant execute on function private.can_view_match(uuid) to authenticated;

grant execute on function public.score_prediction(int, int, int, int) to authenticated;
grant execute on function public.goal_error(int, int, int, int) to authenticated;
grant execute on function public.get_server_time() to authenticated, anon;
grant execute on function public.get_app_config() to authenticated;
grant execute on function public.save_prediction_draft(uuid, jsonb, bigint) to authenticated;
grant execute on function public.submit_prediction(uuid, jsonb, bigint) to authenticated;
grant execute on function public.join_group(text) to authenticated;
grant execute on function public.get_my_groups() to authenticated;
grant execute on function public.get_my_rounds(uuid) to authenticated;
grant execute on function public.get_round_detail(uuid) to authenticated;
grant execute on function public.get_leaderboard(uuid, uuid) to authenticated;
grant execute on function public.get_position_history(uuid) to authenticated;
grant execute on function public.get_player_summary(uuid) to authenticated;
grant execute on function public.get_upcoming_matches(uuid, int) to authenticated;
grant execute on function public.claim_first_admin() to authenticated;

-- >>> 20261009000005_admin_api.sql
-- =====================================================================
-- API administrativa. Cada función valida que el llamante sea admin
-- activo y registra la operación en audit_logs.
-- =====================================================================

create or replace function private.assert_admin()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
begin
  if not private.is_admin() then
    perform private.fail('FORBIDDEN');
  end if;
  return v_uid;
end;
$$;

-- ---------------------------------------------------------------------
-- Dashboard
-- ---------------------------------------------------------------------
create or replace function public.admin_dashboard_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_last public.sync_runs;
begin
  perform private.assert_admin();
  select * into v_last from public.sync_runs order by started_at desc limit 1;
  return jsonb_build_object(
    'participants_total', (select count(*) from public.profiles),
    'participants_active', (select count(distinct gm.user_id) from public.group_members gm
                            join public.profiles p on p.id = gm.user_id
                            where gm.status = 'active' and p.status = 'active'),
    'pending_approvals', (select count(*) from public.group_members where status = 'pending'),
    'groups', (select count(*) from public.groups where is_active),
    'rounds_open', (select count(*) from public.rounds where status = 'open' and deadline_at > now()),
    'rounds_draft', (select count(*) from public.rounds where status = 'draft'),
    'predictions_submitted', (select count(*) from public.predictions where status = 'submitted'),
    'matches_pending_result', (select count(distinct m.id) from public.matches m
                               join public.round_matches rm on rm.match_id = m.id
                               join public.rounds r on r.id = rm.round_id and r.status in ('open', 'closed', 'under_review')
                               where m.kickoff_at <= now() and not m.result_confirmed and m.status not in ('cancelled', 'abandoned')),
    'last_sync', case when v_last.id is null then null else jsonb_build_object(
        'id', v_last.id, 'provider', v_last.provider, 'status', v_last.status,
        'started_at', v_last.started_at, 'finished_at', v_last.finished_at,
        'matches_checked', v_last.matches_checked, 'matches_updated', v_last.matches_updated,
        'error_message', v_last.error_message) end,
    'sync_errors_24h', (select count(*) from public.sync_runs where status in ('error', 'partial') and started_at > now() - interval '24 hours'),
    'server_time', now()
  );
end;
$$;

-- ---------------------------------------------------------------------
-- Participantes
-- ---------------------------------------------------------------------
create or replace function public.admin_list_participants()
returns table (
  user_id uuid, display_name text, email text, role text, status text,
  created_at timestamptz, last_sign_in_at timestamptz,
  memberships jsonb, rounds_submitted int, total_points int
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.assert_admin();
  return query
  select p.id, p.display_name, u.email::text, p.role, p.status, p.created_at, u.last_sign_in_at,
         coalesce((select jsonb_agg(jsonb_build_object(
                     'group_id', g.id, 'group_name', g.name, 'status', gm.status,
                     'payment_status', gm.payment_status, 'joined_at', gm.joined_at) order by g.name)
                   from public.group_members gm join public.groups g on g.id = gm.group_id
                   where gm.user_id = p.id), '[]'::jsonb),
         (select count(*)::int from public.predictions pr where pr.user_id = p.id and pr.status = 'submitted'),
         (select coalesce(sum(rs.points), 0)::int from public.round_scores rs where rs.user_id = p.id)
  from public.profiles p
  join auth.users u on u.id = p.id
  order by p.created_at desc;
end;
$$;

create or replace function public.admin_set_user_status(p_user_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := private.assert_admin();
  v_old text;
begin
  if p_status not in ('active', 'suspended') then
    perform private.fail('INVALID_STATUS');
  end if;
  if p_user_id = v_admin then
    perform private.fail('CANNOT_CHANGE_SELF');
  end if;
  select status into v_old from public.profiles where id = p_user_id for update;
  if not found then
    perform private.fail('USER_NOT_FOUND');
  end if;
  update public.profiles set status = p_status where id = p_user_id;
  perform private.log_audit('user.status_changed', 'profile', p_user_id::text,
    jsonb_build_object('from', v_old, 'to', p_status));
end;
$$;

create or replace function public.admin_set_user_role(p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := private.assert_admin();
  v_old text;
begin
  if p_role not in ('player', 'admin') then
    perform private.fail('INVALID_ROLE');
  end if;
  if p_user_id = v_admin then
    perform private.fail('CANNOT_CHANGE_SELF');
  end if;
  select role into v_old from public.profiles where id = p_user_id for update;
  if not found then
    perform private.fail('USER_NOT_FOUND');
  end if;
  update public.profiles set role = p_role where id = p_user_id;
  perform private.log_audit('user.role_changed', 'profile', p_user_id::text,
    jsonb_build_object('from', v_old, 'to', p_role));
end;
$$;

-- ---------------------------------------------------------------------
-- Grupos y membresías
-- ---------------------------------------------------------------------
create or replace function public.admin_save_group(
  p_group_id uuid, p_name text, p_description text, p_join_requires_approval boolean, p_is_active boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := private.assert_admin();
  v_id uuid;
begin
  if p_group_id is null then
    insert into public.groups (name, description, join_requires_approval, is_active, created_by)
    values (btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''), coalesce(p_join_requires_approval, true), coalesce(p_is_active, true), v_admin)
    returning id into v_id;
    -- El admin que crea el grupo queda como miembro activo.
    insert into public.group_members (group_id, user_id, status, approved_at, approved_by)
    values (v_id, v_admin, 'active', now(), v_admin)
    on conflict do nothing;
    perform private.log_audit('group.created', 'group', v_id::text, jsonb_build_object('name', p_name));
  else
    update public.groups
       set name = btrim(p_name),
           description = nullif(btrim(coalesce(p_description, '')), ''),
           join_requires_approval = coalesce(p_join_requires_approval, join_requires_approval),
           is_active = coalesce(p_is_active, is_active)
     where id = p_group_id
    returning id into v_id;
    if v_id is null then
      perform private.fail('GROUP_NOT_FOUND');
    end if;
    perform private.log_audit('group.updated', 'group', v_id::text,
      jsonb_build_object('name', p_name, 'is_active', p_is_active, 'join_requires_approval', p_join_requires_approval));
  end if;
  return v_id;
end;
$$;

create or replace function public.admin_regenerate_invite_code(p_group_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text;
begin
  perform private.assert_admin();
  update public.groups set invite_code = private.generate_invite_code() where id = p_group_id returning invite_code into v_code;
  if v_code is null then
    perform private.fail('GROUP_NOT_FOUND');
  end if;
  perform private.log_audit('group.invite_regenerated', 'group', p_group_id::text, '{}'::jsonb);
  return v_code;
end;
$$;

create or replace function public.admin_set_member(p_group_id uuid, p_user_id uuid, p_status text, p_payment_status text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := private.assert_admin();
  v_old public.group_members;
begin
  if p_status not in ('pending', 'active', 'suspended') then
    perform private.fail('INVALID_STATUS');
  end if;
  if p_payment_status is not null and p_payment_status not in ('not_applicable', 'pending', 'authorized', 'rejected') then
    perform private.fail('INVALID_PAYMENT_STATUS');
  end if;
  if not exists (select 1 from public.groups where id = p_group_id) then
    perform private.fail('GROUP_NOT_FOUND');
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    perform private.fail('USER_NOT_FOUND');
  end if;

  select * into v_old from public.group_members where group_id = p_group_id and user_id = p_user_id for update;

  insert into public.group_members (group_id, user_id, status, payment_status, approved_at, approved_by)
  values (p_group_id, p_user_id, p_status, coalesce(p_payment_status, 'not_applicable'),
          case when p_status = 'active' then now() end, case when p_status = 'active' then v_admin end)
  on conflict (group_id, user_id) do update
    set status = excluded.status,
        payment_status = coalesce(p_payment_status, public.group_members.payment_status),
        approved_at = case when excluded.status = 'active' and public.group_members.status <> 'active' then now() else public.group_members.approved_at end,
        approved_by = case when excluded.status = 'active' and public.group_members.status <> 'active' then v_admin else public.group_members.approved_by end;

  perform private.log_audit('member.updated', 'group_member', p_group_id::text || ':' || p_user_id::text,
    jsonb_build_object('from_status', v_old.status, 'to_status', p_status,
                       'from_payment', v_old.payment_status, 'to_payment', coalesce(p_payment_status, v_old.payment_status)));
end;
$$;

create or replace function public.admin_add_member_by_email(p_group_id uuid, p_email text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
begin
  perform private.assert_admin();
  select u.id into v_uid from auth.users u where lower(u.email) = lower(btrim(p_email));
  if v_uid is null then
    perform private.fail('USER_NOT_FOUND');
  end if;
  perform public.admin_set_member(p_group_id, v_uid, 'active', null);
  return v_uid;
end;
$$;

create or replace function public.admin_group_members(p_group_id uuid)
returns table (user_id uuid, display_name text, email text, member_status text, payment_status text, profile_status text, joined_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.assert_admin();
  return query
  select p.id, p.display_name, u.email::text, gm.status, gm.payment_status, p.status, gm.joined_at
  from public.group_members gm
  join public.profiles p on p.id = gm.user_id
  join auth.users u on u.id = p.id
  where gm.group_id = p_group_id
  order by gm.status = 'pending' desc, p.display_name;
end;
$$;

-- ---------------------------------------------------------------------
-- Jornadas
-- ---------------------------------------------------------------------
create or replace function public.admin_save_round(
  p_round_id uuid, p_group_id uuid, p_name text, p_description text,
  p_opens_at timestamptz, p_deadline_at timestamptz, p_participation text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := private.assert_admin();
  v_old public.rounds;
  v_id uuid;
  v_has_submissions boolean;
begin
  if p_deadline_at is null then
    perform private.fail('DEADLINE_REQUIRED');
  end if;
  if coalesce(p_participation, 'all_members') not in ('all_members', 'selected') then
    perform private.fail('INVALID_PARTICIPATION');
  end if;

  if p_round_id is null then
    if not exists (select 1 from public.groups where id = p_group_id) then
      perform private.fail('GROUP_NOT_FOUND');
    end if;
    insert into public.rounds (group_id, name, description, opens_at, deadline_at, participation, created_by)
    values (p_group_id, btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''), p_opens_at, p_deadline_at,
            coalesce(p_participation, 'all_members'), v_admin)
    returning id into v_id;
    perform private.log_audit('round.created', 'round', v_id::text,
      jsonb_build_object('name', p_name, 'deadline_at', p_deadline_at, 'group_id', p_group_id));
    return v_id;
  end if;

  select * into v_old from public.rounds where id = p_round_id for update;
  if not found then
    perform private.fail('ROUND_NOT_FOUND');
  end if;
  if v_old.status in ('finished', 'under_review') then
    perform private.fail('ROUND_LOCKED');
  end if;
  v_has_submissions := exists (select 1 from public.predictions where round_id = p_round_id and status = 'submitted');
  if v_has_submissions and p_participation is distinct from v_old.participation then
    perform private.fail('ROUND_HAS_SUBMISSIONS');
  end if;
  -- Con jornada abierta, la fecha límite no puede quedar en el pasado.
  if v_old.status = 'open' and p_deadline_at <= now() then
    perform private.fail('DEADLINE_IN_PAST');
  end if;

  update public.rounds
     set name = btrim(p_name),
         description = nullif(btrim(coalesce(p_description, '')), ''),
         opens_at = p_opens_at,
         deadline_at = p_deadline_at,
         participation = coalesce(p_participation, participation)
   where id = p_round_id;

  perform private.log_audit('round.updated', 'round', p_round_id::text, jsonb_build_object(
    'had_submissions', v_has_submissions,
    'before', jsonb_build_object('name', v_old.name, 'opens_at', v_old.opens_at, 'deadline_at', v_old.deadline_at, 'participation', v_old.participation),
    'after', jsonb_build_object('name', p_name, 'opens_at', p_opens_at, 'deadline_at', p_deadline_at, 'participation', p_participation)));
  return p_round_id;
end;
$$;

create or replace function public.admin_set_round_matches(p_round_id uuid, p_match_ids uuid[])
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round public.rounds;
  v_old uuid[];
  v_count int := coalesce(cardinality(p_match_ids), 0);
begin
  perform private.assert_admin();
  select * into v_round from public.rounds where id = p_round_id for update;
  if not found then
    perform private.fail('ROUND_NOT_FOUND');
  end if;
  if v_round.status not in ('draft', 'open') then
    perform private.fail('ROUND_LOCKED');
  end if;
  if v_count > 50 then
    perform private.fail('TOO_MANY_MATCHES');
  end if;
  if v_count <> (select count(distinct x) from unnest(p_match_ids) x) then
    perform private.fail('DUPLICATE_MATCH');
  end if;
  if exists (select 1 from unnest(p_match_ids) x where not exists (select 1 from public.matches m where m.id = x)) then
    perform private.fail('MATCH_NOT_FOUND');
  end if;
  if v_round.status = 'open' and v_count = 0 then
    perform private.fail('ROUND_NEEDS_MATCHES');
  end if;

  select coalesce(array_agg(match_id order by position), '{}') into v_old from public.round_matches where round_id = p_round_id;
  if v_old = coalesce(p_match_ids, '{}') then
    return v_count; -- sin cambios
  end if;

  -- El trigger guard_round_matches bloquea esto si ya hay quinielas enviadas.
  delete from public.round_matches where round_id = p_round_id and not (match_id = any (coalesce(p_match_ids, '{}')));
  -- Reordenamiento en dos pasos para no chocar con unique(round_id, position).
  update public.round_matches set position = position + 100 where round_id = p_round_id;
  insert into public.round_matches (round_id, match_id, position)
  select p_round_id, x.id, x.ord::smallint
  from unnest(p_match_ids) with ordinality as x(id, ord)
  on conflict (round_id, match_id) do update set position = excluded.position;

  perform private.log_audit('round.matches_set', 'round', p_round_id::text,
    jsonb_build_object('before', to_jsonb(v_old), 'after', to_jsonb(p_match_ids), 'status', v_round.status));
  return v_count;
end;
$$;

create or replace function public.admin_set_round_participants(p_round_id uuid, p_user_ids uuid[])
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round public.rounds;
begin
  perform private.assert_admin();
  select * into v_round from public.rounds where id = p_round_id for update;
  if not found then
    perform private.fail('ROUND_NOT_FOUND');
  end if;
  if v_round.status not in ('draft', 'open') then
    perform private.fail('ROUND_LOCKED');
  end if;
  if exists (
    select 1 from unnest(coalesce(p_user_ids, '{}')) x
    where not exists (select 1 from public.group_members gm where gm.group_id = v_round.group_id and gm.user_id = x)
  ) then
    perform private.fail('USER_NOT_IN_GROUP');
  end if;
  -- No se puede excluir a quien ya envió su quiniela.
  if exists (
    select 1 from public.predictions p
    where p.round_id = p_round_id and p.status = 'submitted' and not (p.user_id = any (coalesce(p_user_ids, '{}')))
  ) and v_round.participation = 'selected' then
    perform private.fail('ROUND_HAS_SUBMISSIONS');
  end if;

  delete from public.round_participants where round_id = p_round_id;
  insert into public.round_participants (round_id, user_id)
  select distinct p_round_id, x from unnest(coalesce(p_user_ids, '{}')) x;

  perform private.log_audit('round.participants_set', 'round', p_round_id::text,
    jsonb_build_object('users', to_jsonb(p_user_ids)));
  return coalesce(cardinality(p_user_ids), 0);
end;
$$;

create or replace function public.admin_set_round_status(p_round_id uuid, p_status text, p_reason text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round public.rounds;
  v_first_kickoff timestamptz;
  v_matches int;
begin
  perform private.assert_admin();
  select * into v_round from public.rounds where id = p_round_id for update;
  if not found then
    perform private.fail('ROUND_NOT_FOUND');
  end if;
  if v_round.status = p_status then
    return p_status;
  end if;

  select count(*), min(m.kickoff_at) into v_matches, v_first_kickoff
  from public.round_matches rm join public.matches m on m.id = rm.match_id
  where rm.round_id = p_round_id;

  case
    when v_round.status = 'draft' and p_status = 'open' then
      if v_matches = 0 then
        perform private.fail('ROUND_NEEDS_MATCHES');
      end if;
      if v_round.deadline_at <= now() then
        perform private.fail('DEADLINE_IN_PAST');
      end if;
      if v_round.deadline_at > v_first_kickoff then
        perform private.fail('DEADLINE_AFTER_KICKOFF');
      end if;
      if v_round.participation = 'selected' and not exists (select 1 from public.round_participants where round_id = p_round_id) then
        perform private.fail('ROUND_NEEDS_PARTICIPANTS');
      end if;
      update public.rounds set status = 'open', opened_at = coalesce(opened_at, now()) where id = p_round_id;

    when v_round.status = 'open' and p_status = 'draft' then
      if exists (select 1 from public.predictions where round_id = p_round_id) then
        perform private.fail('ROUND_HAS_PREDICTIONS');
      end if;
      update public.rounds set status = 'draft' where id = p_round_id;

    when v_round.status = 'open' and p_status = 'closed' then
      update public.rounds set status = 'closed', closed_at = now() where id = p_round_id;

    when v_round.status = 'closed' and p_status = 'open' then
      if v_round.deadline_at <= now() then
        perform private.fail('DEADLINE_IN_PAST');
      end if;
      update public.rounds set status = 'open', closed_at = null where id = p_round_id;

    when v_round.status = 'closed' and p_status = 'finished' then
      if exists (
        select 1 from public.round_matches rm join public.matches m on m.id = rm.match_id
        where rm.round_id = p_round_id
          and not ((m.status = 'finished' and m.result_confirmed) or m.status in ('cancelled', 'abandoned', 'postponed'))
      ) then
        perform private.fail('RESULTS_PENDING');
      end if;
      update public.rounds set status = 'finished', finalized_at = now() where id = p_round_id;

    when v_round.status = 'finished' and p_status = 'under_review' then
      if p_reason is null or char_length(btrim(p_reason)) < 5 then
        perform private.fail('REASON_REQUIRED');
      end if;
      update public.rounds set status = 'under_review' where id = p_round_id;

    when v_round.status = 'under_review' and p_status = 'finished' then
      update public.rounds set status = 'finished', finalized_at = now() where id = p_round_id;

    else
      perform private.fail('INVALID_TRANSITION', v_round.status || ' -> ' || p_status);
  end case;

  perform private.recompute_round_scores(p_round_id);
  perform private.log_audit('round.status_changed', 'round', p_round_id::text,
    jsonb_build_object('from', v_round.status, 'to', p_status, 'reason', p_reason));
  return p_status;
end;
$$;

create or replace function public.admin_delete_round(p_round_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round public.rounds;
begin
  perform private.assert_admin();
  select * into v_round from public.rounds where id = p_round_id for update;
  if not found then
    perform private.fail('ROUND_NOT_FOUND');
  end if;
  if v_round.status <> 'draft' or exists (select 1 from public.predictions where round_id = p_round_id) then
    perform private.fail('ROUND_LOCKED');
  end if;
  delete from public.rounds where id = p_round_id;
  perform private.log_audit('round.deleted', 'round', p_round_id::text, jsonb_build_object('name', v_round.name));
end;
$$;

create or replace function public.admin_round_submissions(p_round_id uuid)
returns table (user_id uuid, display_name text, prediction_status text, items int, submitted_at timestamptz, points int)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_round public.rounds;
begin
  perform private.assert_admin();
  select * into v_round from public.rounds where id = p_round_id;
  if not found then
    perform private.fail('ROUND_NOT_FOUND');
  end if;
  return query
  select p.id, p.display_name, coalesce(pr.status, 'none'),
         (select count(*)::int from public.prediction_items pi where pi.prediction_id = pr.id),
         pr.submitted_at, rs.points
  from public.group_members gm
  join public.profiles p on p.id = gm.user_id
  left join public.predictions pr on pr.round_id = p_round_id and pr.user_id = p.id
  left join public.round_scores rs on rs.round_id = p_round_id and rs.user_id = p.id
  where gm.group_id = v_round.group_id and gm.status = 'active'
    and (v_round.participation = 'all_members'
         or exists (select 1 from public.round_participants rp where rp.round_id = p_round_id and rp.user_id = p.id))
  order by pr.submitted_at nulls last, p.display_name;
end;
$$;

-- ---------------------------------------------------------------------
-- Resultados: corrección manual controlada (siempre con motivo y auditoría)
-- ---------------------------------------------------------------------
create or replace function public.admin_record_result(
  p_match_id uuid, p_home int, p_away int, p_status text, p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := private.assert_admin();
  v_old public.matches;
  v_round uuid;
begin
  if p_status not in ('scheduled', 'live', 'finished', 'postponed', 'suspended', 'cancelled', 'abandoned') then
    perform private.fail('INVALID_STATUS');
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 5 then
    perform private.fail('REASON_REQUIRED');
  end if;
  if (p_home is null) <> (p_away is null) or p_home < 0 or p_away < 0 or p_home > 99 or p_away > 99 then
    perform private.fail('INVALID_GOALS');
  end if;
  if p_status in ('live', 'finished') and p_home is null then
    perform private.fail('INVALID_GOALS');
  end if;

  select * into v_old from public.matches where id = p_match_id for update;
  if not found then
    perform private.fail('MATCH_NOT_FOUND');
  end if;

  update public.matches
     set status = p_status,
         home_goals = case when p_status in ('cancelled', 'postponed') then null else p_home end,
         away_goals = case when p_status in ('cancelled', 'postponed') then null else p_away end,
         result_confirmed = (p_status = 'finished'),
         confirmed_at = case when p_status = 'finished' then now() else null end,
         result_source = 'admin'
   where id = p_match_id;

  insert into public.match_results (match_id, status, home_goals, away_goals, is_final, source, reason, recorded_by)
  values (p_match_id, p_status, p_home, p_away, p_status = 'finished', 'admin', btrim(p_reason), v_admin);

  perform private.log_audit('match.result_overridden', 'match', p_match_id::text, jsonb_build_object(
    'reason', p_reason,
    'before', jsonb_build_object('status', v_old.status, 'home', v_old.home_goals, 'away', v_old.away_goals, 'confirmed', v_old.result_confirmed),
    'after', jsonb_build_object('status', p_status, 'home', p_home, 'away', p_away)));

  for v_round in
    select rm.round_id from public.round_matches rm join public.rounds r on r.id = rm.round_id
    where rm.match_id = p_match_id and r.status <> 'draft'
  loop
    perform private.refresh_round_state(v_round);
  end loop;
end;
$$;

-- Devuelve el control del marcador al proveedor automático.
create or replace function public.admin_release_result_override(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_admin();
  update public.matches set result_source = 'provider' where id = p_match_id and result_source = 'admin';
  if found then
    perform private.log_audit('match.override_released', 'match', p_match_id::text, '{}'::jsonb);
  end if;
end;
$$;

create or replace function public.admin_recompute_round(p_round_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  perform private.assert_admin();
  v_status := private.refresh_round_state(p_round_id);
  if v_status is null then
    perform private.fail('ROUND_NOT_FOUND');
  end if;
  perform private.log_audit('round.recomputed', 'round', p_round_id::text, jsonb_build_object('status', v_status));
  return v_status;
end;
$$;

create or replace function public.admin_update_setting(p_key text, p_value jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := private.assert_admin();
  v_old jsonb;
begin
  if p_key = 'payments_enabled' then
    perform private.fail('SETTING_LOCKED', 'Los cobros reales están deshabilitados en esta versión');
  end if;
  if p_key = 'max_goals' and ((p_value #>> '{}')::int not between 5 and 30) then
    perform private.fail('INVALID_SETTING');
  end if;
  select value into v_old from public.app_settings where key = p_key for update;
  if not found then
    perform private.fail('SETTING_NOT_FOUND');
  end if;
  update public.app_settings set value = p_value, updated_at = now(), updated_by = v_admin where key = p_key;
  perform private.log_audit('setting.updated', 'app_setting', p_key, jsonb_build_object('from', v_old, 'to', p_value));
end;
$$;

-- ---------------------------------------------------------------------
-- Permisos de ejecución
-- ---------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;
revoke execute on function private.assert_admin() from public, anon, authenticated;

grant execute on function public.admin_dashboard_stats() to authenticated;
grant execute on function public.admin_list_participants() to authenticated;
grant execute on function public.admin_set_user_status(uuid, text) to authenticated;
grant execute on function public.admin_set_user_role(uuid, text) to authenticated;
grant execute on function public.admin_save_group(uuid, text, text, boolean, boolean) to authenticated;
grant execute on function public.admin_regenerate_invite_code(uuid) to authenticated;
grant execute on function public.admin_set_member(uuid, uuid, text, text) to authenticated;
grant execute on function public.admin_add_member_by_email(uuid, text) to authenticated;
grant execute on function public.admin_group_members(uuid) to authenticated;
grant execute on function public.admin_save_round(uuid, uuid, text, text, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.admin_set_round_matches(uuid, uuid[]) to authenticated;
grant execute on function public.admin_set_round_participants(uuid, uuid[]) to authenticated;
grant execute on function public.admin_set_round_status(uuid, text, text) to authenticated;
grant execute on function public.admin_delete_round(uuid) to authenticated;
grant execute on function public.admin_round_submissions(uuid) to authenticated;
grant execute on function public.admin_record_result(uuid, int, int, text, text) to authenticated;
grant execute on function public.admin_release_result_override(uuid) to authenticated;
grant execute on function public.admin_recompute_round(uuid) to authenticated;
grant execute on function public.admin_update_setting(text, jsonb) to authenticated;
-- Las funciones de jugador ya se concedieron en la migración anterior.
grant execute on function public.score_prediction(int, int, int, int) to authenticated;
grant execute on function public.goal_error(int, int, int, int) to authenticated;
grant execute on function public.get_server_time() to authenticated, anon;
grant execute on function public.get_app_config() to authenticated;
grant execute on function public.save_prediction_draft(uuid, jsonb, bigint) to authenticated;
grant execute on function public.submit_prediction(uuid, jsonb, bigint) to authenticated;
grant execute on function public.join_group(text) to authenticated;
grant execute on function public.get_my_groups() to authenticated;
grant execute on function public.get_my_rounds(uuid) to authenticated;
grant execute on function public.get_round_detail(uuid) to authenticated;
grant execute on function public.get_leaderboard(uuid, uuid) to authenticated;
grant execute on function public.get_position_history(uuid) to authenticated;
grant execute on function public.get_player_summary(uuid) to authenticated;
grant execute on function public.get_upcoming_matches(uuid, int) to authenticated;
grant execute on function public.claim_first_admin() to authenticated;

-- >>> 20261009000006_provider_sync.sql
-- =====================================================================
-- Sincronización con el proveedor deportivo. Estas funciones SOLO las
-- ejecuta el rol de servicio (Edge Functions), nunca el navegador.
-- Todas son idempotentes: aplicar dos veces la misma actualización no
-- duplica historial ni puntos.
-- =====================================================================

create or replace function public.upsert_provider_fixtures(p_provider text, p_fixtures jsonb, p_is_test_data boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fx jsonb;
  v_comp uuid;
  v_home uuid;
  v_away uuid;
  v_match uuid;
  v_ids uuid[] := '{}';
  v_inserted int := 0;
begin
  if p_fixtures is null or jsonb_typeof(p_fixtures) <> 'array' then
    perform private.fail('INVALID_FIXTURES');
  end if;

  for v_fx in select e.value from jsonb_array_elements(p_fixtures) e loop
    v_comp := null;
    if v_fx ? 'competition' and jsonb_typeof(v_fx -> 'competition') = 'object' then
      insert into public.competitions (provider, external_id, name, country, season, logo_url, is_test_data)
      values (p_provider, v_fx #>> '{competition,external_id}', v_fx #>> '{competition,name}',
              v_fx #>> '{competition,country}', v_fx #>> '{competition,season}', v_fx #>> '{competition,logo_url}', p_is_test_data)
      on conflict (provider, external_id) do update
        set name = excluded.name, country = excluded.country, season = excluded.season, logo_url = excluded.logo_url
      returning id into v_comp;
    end if;

    insert into public.teams (provider, external_id, name, short_name, code, logo_url, is_test_data)
    values (p_provider, v_fx #>> '{home,external_id}', v_fx #>> '{home,name}',
            coalesce(v_fx #>> '{home,short_name}', v_fx #>> '{home,name}'), left(v_fx #>> '{home,code}', 5), v_fx #>> '{home,logo_url}', p_is_test_data)
    on conflict (provider, external_id) do update
      set name = excluded.name, short_name = excluded.short_name, code = coalesce(excluded.code, public.teams.code), logo_url = excluded.logo_url
    returning id into v_home;

    insert into public.teams (provider, external_id, name, short_name, code, logo_url, is_test_data)
    values (p_provider, v_fx #>> '{away,external_id}', v_fx #>> '{away,name}',
            coalesce(v_fx #>> '{away,short_name}', v_fx #>> '{away,name}'), left(v_fx #>> '{away,code}', 5), v_fx #>> '{away,logo_url}', p_is_test_data)
    on conflict (provider, external_id) do update
      set name = excluded.name, short_name = excluded.short_name, code = coalesce(excluded.code, public.teams.code), logo_url = excluded.logo_url
    returning id into v_away;

    select id into v_match from public.matches where provider = p_provider and external_id = v_fx ->> 'external_id';
    if v_match is null then
      insert into public.matches (provider, external_id, competition_id, home_team_id, away_team_id, kickoff_at,
                                  status, status_detail, elapsed, home_goals, away_goals, result_confirmed, confirmed_at,
                                  last_synced_at, is_test_data)
      values (p_provider, v_fx ->> 'external_id', v_comp, v_home, v_away, (v_fx ->> 'kickoff_at')::timestamptz,
              coalesce(v_fx ->> 'status', 'scheduled'), v_fx ->> 'status_detail', (v_fx ->> 'elapsed')::smallint,
              (v_fx ->> 'home_goals')::smallint, (v_fx ->> 'away_goals')::smallint,
              coalesce(v_fx ->> 'status', '') = 'finished' and v_fx ->> 'home_goals' is not null,
              case when coalesce(v_fx ->> 'status', '') = 'finished' and v_fx ->> 'home_goals' is not null then now() end,
              now(), p_is_test_data)
      returning id into v_match;
      v_inserted := v_inserted + 1;
    else
      update public.matches set competition_id = coalesce(v_comp, competition_id) where id = v_match;
      perform public.apply_provider_update(v_match, v_fx);
    end if;
    v_ids := v_ids || v_match;
  end loop;

  return jsonb_build_object('match_ids', to_jsonb(v_ids), 'inserted', v_inserted, 'total', cardinality(v_ids));
end;
$$;

create or replace function public.apply_provider_update(p_match_id uuid, p_update jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.matches;
  v_status text := coalesce(p_update ->> 'status', 'unknown');
  v_home smallint;
  v_away smallint;
  v_kickoff timestamptz := coalesce((p_update ->> 'kickoff_at')::timestamptz, null);
  v_final boolean;
  v_window int := private.setting_int('result_correction_window_hours', 72);
  v_result_changed boolean;
  v_any_changed boolean;
  v_round uuid;
begin
  if v_status not in ('scheduled', 'live', 'finished', 'postponed', 'suspended', 'cancelled', 'abandoned', 'unknown') then
    v_status := 'unknown';
  end if;

  select * into v_old from public.matches where id = p_match_id for update;
  if not found then
    perform private.fail('MATCH_NOT_FOUND');
  end if;

  -- El admin tomó el control manual: el proveedor no sobrescribe.
  if v_old.result_source = 'admin' then
    update public.matches set last_synced_at = now(), last_sync_error = null where id = p_match_id;
    return jsonb_build_object('changed', false, 'reason', 'admin_override');
  end if;

  -- Fuera de la ventana de correcciones, el resultado confirmado queda fijo.
  if v_old.result_confirmed and v_old.confirmed_at < now() - make_interval(hours => v_window) then
    update public.matches set last_synced_at = now() where id = p_match_id;
    return jsonb_build_object('changed', false, 'reason', 'outside_correction_window');
  end if;

  -- Un estado desconocido nunca degrada un partido ya conocido.
  if v_status = 'unknown' and v_old.status <> 'unknown' then
    update public.matches set last_synced_at = now(), last_sync_error = 'UNKNOWN_PROVIDER_STATUS: ' || coalesce(p_update ->> 'status_detail', '?')
      where id = p_match_id;
    return jsonb_build_object('changed', false, 'reason', 'unknown_status');
  end if;

  if v_status in ('live', 'finished', 'suspended', 'abandoned') then
    v_home := (p_update ->> 'home_goals')::smallint;
    v_away := (p_update ->> 'away_goals')::smallint;
  end if;
  if (v_home is null) <> (v_away is null) then
    v_home := null; v_away := null;
  end if;
  -- Nunca se marca finalizado sin marcador del proveedor.
  if v_status = 'finished' and v_home is null then
    update public.matches set last_synced_at = now(), last_sync_error = 'FINISHED_WITHOUT_SCORE' where id = p_match_id;
    return jsonb_build_object('changed', false, 'reason', 'finished_without_score');
  end if;
  v_final := v_status = 'finished';

  v_result_changed := v_status is distinct from v_old.status
                   or v_home is distinct from v_old.home_goals
                   or v_away is distinct from v_old.away_goals;
  v_any_changed := v_result_changed
                or (v_kickoff is not null and v_kickoff is distinct from v_old.kickoff_at)
                or (p_update ->> 'elapsed')::smallint is distinct from v_old.elapsed
                or (p_update ->> 'status_detail') is distinct from v_old.status_detail;

  update public.matches
     set status = v_status,
         status_detail = p_update ->> 'status_detail',
         elapsed = (p_update ->> 'elapsed')::smallint,
         home_goals = v_home,
         away_goals = v_away,
         kickoff_at = coalesce(v_kickoff, kickoff_at),
         result_confirmed = v_final,
         confirmed_at = case when v_final and not v_old.result_confirmed then now()
                             when v_final then v_old.confirmed_at
                             else null end,
         last_synced_at = now(),
         last_sync_error = null
   where id = p_match_id;

  if v_result_changed then
    insert into public.match_results (match_id, status, home_goals, away_goals, is_final, source, provider_payload)
    values (p_match_id, v_status, v_home, v_away, v_final, 'provider', p_update -> 'raw');

    if v_old.result_confirmed then
      insert into public.audit_logs (actor_id, action, entity_type, entity_id, details)
      values (null, 'match.result_corrected_by_provider', 'match', p_match_id::text, jsonb_build_object(
        'before', jsonb_build_object('status', v_old.status, 'home', v_old.home_goals, 'away', v_old.away_goals),
        'after', jsonb_build_object('status', v_status, 'home', v_home, 'away', v_away)));
    end if;
  end if;

  if v_kickoff is not null and v_kickoff is distinct from v_old.kickoff_at then
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, details)
    values (null, 'match.kickoff_changed', 'match', p_match_id::text,
            jsonb_build_object('from', v_old.kickoff_at, 'to', v_kickoff));
  end if;

  if v_result_changed then
    for v_round in
      select rm.round_id from public.round_matches rm join public.rounds r on r.id = rm.round_id
      where rm.match_id = p_match_id and r.status <> 'draft'
    loop
      perform private.refresh_round_state(v_round);
    end loop;
  end if;

  return jsonb_build_object('changed', v_any_changed, 'result_changed', v_result_changed, 'status', v_status);
end;
$$;

create or replace function public.record_match_sync_error(p_match_id uuid, p_error text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.matches set last_sync_error = left(p_error, 500), last_synced_at = now() where id = p_match_id;
$$;

-- Partidos que vale la pena consultar ahora (minimiza llamadas a la API).
create or replace function public.get_sync_targets(p_horizon_minutes int default 15)
returns table (match_id uuid, provider text, external_id text, kickoff_at timestamptz, status text, last_synced_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct m.id, m.provider, m.external_id, m.kickoff_at, m.status, m.last_synced_at
  from public.matches m
  join public.round_matches rm on rm.match_id = m.id
  join public.rounds r on r.id = rm.round_id
  where r.status in ('open', 'closed', 'finished', 'under_review')
    and m.result_source = 'provider'
    and (
      -- en juego o por empezar, sin resultado confirmado
      (not m.result_confirmed and m.status not in ('cancelled') and m.kickoff_at <= now() + make_interval(mins => p_horizon_minutes))
      -- futuros: revisar cambios de horario / aplazamientos cada 12 h
      or (m.status in ('scheduled', 'postponed', 'unknown') and m.kickoff_at > now() + make_interval(mins => p_horizon_minutes)
          and (m.last_synced_at is null or m.last_synced_at < now() - interval '12 hours'))
      -- confirmados recientemente: vigilar correcciones cada 6 h
      or (m.result_confirmed and m.confirmed_at > now() - make_interval(hours => private.setting_int('result_correction_window_hours', 72))
          and (m.last_synced_at is null or m.last_synced_at < now() - interval '6 hours'))
    )
  order by m.kickoff_at;
$$;

-- Cierre automático por fecha límite y finalización de jornadas completas.
create or replace function public.run_maintenance()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round uuid;
  v_count int := 0;
begin
  for v_round in
    select id from public.rounds
    where (status = 'open' and deadline_at <= now()) or status = 'closed'
  loop
    perform private.refresh_round_state(v_round);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.start_sync_run(p_provider text, p_trigger text)
returns bigint
language sql
security definer
set search_path = ''
as $$
  insert into public.sync_runs (provider, trigger_source) values (p_provider, p_trigger) returning id;
$$;

create or replace function public.finish_sync_run(
  p_run_id bigint, p_status text, p_checked int, p_updated int, p_error text, p_details jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.sync_runs
     set finished_at = now(), status = p_status, matches_checked = p_checked, matches_updated = p_updated,
         error_message = left(p_error, 1000), details = coalesce(p_details, '{}'::jsonb)
   where id = p_run_id;
$$;

revoke execute on function public.upsert_provider_fixtures(text, jsonb, boolean) from public, anon, authenticated;
revoke execute on function public.apply_provider_update(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.record_match_sync_error(uuid, text) from public, anon, authenticated;
revoke execute on function public.get_sync_targets(int) from public, anon, authenticated;
revoke execute on function public.run_maintenance() from public, anon, authenticated;
revoke execute on function public.start_sync_run(text, text) from public, anon, authenticated;
revoke execute on function public.finish_sync_run(bigint, text, int, int, text, jsonb) from public, anon, authenticated;

grant execute on function public.upsert_provider_fixtures(text, jsonb, boolean) to service_role;
grant execute on function public.apply_provider_update(uuid, jsonb) to service_role;
grant execute on function public.record_match_sync_error(uuid, text) to service_role;
grant execute on function public.get_sync_targets(int) to service_role;
grant execute on function public.run_maintenance() to service_role;
grant execute on function public.start_sync_run(text, text) to service_role;
grant execute on function public.finish_sync_run(bigint, text, int, int, text, jsonb) to service_role;

-- >>> reconcile_migration_history.sql
-- Alinea supabase_migrations.schema_migrations con los archivos del repo
-- (las migraciones se aplicaron por partes desde el MCP). Re-ejecutable.
update supabase_migrations.schema_migrations
   set version = '20261009000003', name = 'scoring_core'
 where version = '20261009233214' and name = 'scoring_core_rules';
insert into supabase_migrations.schema_migrations (version, name) values
  ('20261009000003', 'scoring_core'),
  ('20261009000004', 'player_api'),
  ('20261009000005', 'admin_api'),
  ('20261009000006', 'provider_sync')
on conflict (version) do nothing;

-- >>> Aviso de seguridad de Supabase: pg_net debe vivir en el esquema extensions.
-- (Sus funciones siguen en el esquema net; el cron no cambia.)
do $$
begin
  if exists (select 1 from pg_extension e join pg_namespace n on n.oid = e.extnamespace
             where e.extname = 'pg_net' and n.nspname = 'public') then
    drop extension pg_net;
    create extension pg_net with schema extensions;
  end if;
end $$;

commit;
