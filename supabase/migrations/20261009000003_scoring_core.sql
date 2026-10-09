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
