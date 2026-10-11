-- =====================================================================
-- Nueva mecánica de la quiniela:
-- * Por partido solo se elige quién gana, empate o quién pierde (1 / X / 2).
--   Ya no se captura marcador.
-- * Por semana (jornada) cada participante pone cuántos goles habrá en total
--   en los partidos de la quiniela. Sirve para desempatar: gana quien más
--   aciertos tenga y, si empatan, quien quede más cerca del total real.
-- * El total se puede cambiar hasta que empieza el primer partido de la
--   semana; al enviar la quiniela queda fijo (igual que los pronósticos).
-- Nada se borra: los marcadores ya guardados en borradores se conservan.
-- =====================================================================

create table if not exists public.pool_week_goals (
  user_id      uuid not null references public.profiles (id),
  week_id      uuid not null references public.pool_weeks (id),
  total_goals  smallint not null check (total_goals between 0 and 200),
  status       text not null default 'draft' check (status in ('draft', 'submitted')),
  submitted_at timestamptz,
  updated_at   timestamptz not null default now(),
  primary key (user_id, week_id),
  check ((status = 'submitted') = (submitted_at is not null))
);
alter table public.pool_week_goals enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'pool_week_goals' and policyname = 'pool_week_goals_read') then
    create policy pool_week_goals_read on public.pool_week_goals for select to authenticated using (user_id = (select auth.uid()) or private.is_admin());
  end if;
end $$;
revoke all on public.pool_week_goals from anon;
revoke insert, update, truncate on public.pool_week_goals from authenticated;
grant select on public.pool_week_goals to authenticated;

-- Enviado = inmutable.
create or replace function private.guard_week_goals()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.status = 'submitted' then
    raise exception 'PREDICTION_LOCKED' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  new.updated_at := now();
  return new;
end;
$$;
create or replace trigger pool_week_goals_guard before insert or update or delete on public.pool_week_goals
  for each row execute function private.guard_week_goals();

-- Partidos publicados de una semana (lunes a domingo, CDMX).
create or replace function private.week_published(p_week uuid)
returns table (match_id uuid, kickoff_at timestamptz, status text, home_goals smallint, away_goals smallint, result_confirmed boolean)
language sql stable security definer set search_path = '' as $$
  select m.id, m.kickoff_at, m.status, m.home_goals, m.away_goals, m.result_confirmed
  from public.pool_weeks w
  join public.matches m on private.local_day(m.kickoff_at) between w.week_start and w.week_start + 6
  join public.pool_matches pm on pm.match_id = m.id and pm.status = 'published'
  where w.id = p_week;
$$;

-- El total de goles se puede poner hasta que empieza el primer partido de la semana.
create or replace function private.week_goals_open(p_week uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.pool_weeks where id = p_week)
     and not exists (select 1 from private.week_published(p_week) x where x.kickoff_at <= now() or x.status <> 'scheduled');
$$;

-- Goles reales de la semana (partidos en vivo o terminados con marcador).
create or replace function private.week_real_goals(p_week uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'goals', coalesce(sum(x.home_goals + x.away_goals) filter (where x.status in ('live', 'finished') and x.home_goals is not null), 0),
    'counted', count(*) filter (where x.status in ('live', 'finished') and x.home_goals is not null),
    'total', count(*),
    'final', count(*) > 0 and bool_and(x.status in ('finished', 'cancelled', 'postponed', 'abandoned') and (x.status <> 'finished' or x.result_confirmed)),
    'first_kickoff', min(x.kickoff_at))
  from private.week_published(p_week) x;
$$;

-- Guardar (borrador) el total de goles de la semana.
create or replace function public.save_week_goals(p_week uuid, p_goals int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_cur public.pool_week_goals;
begin
  if p_goals is null or p_goals < 0 or p_goals > 200 then perform private.fail('INVALID_GOALS_TOTAL'); end if;
  if not exists (select 1 from public.pool_weeks where id = p_week) then perform private.fail('WEEK_NOT_FOUND'); end if;
  select * into v_cur from public.pool_week_goals where user_id = v_uid and week_id = p_week;
  if v_cur.status = 'submitted' then perform private.fail('PREDICTION_LOCKED'); end if;
  if not private.week_goals_open(p_week) then perform private.fail('WEEK_GOALS_CLOSED'); end if;
  insert into public.pool_week_goals (user_id, week_id, total_goals) values (v_uid, p_week, p_goals)
  on conflict (user_id, week_id) do update set total_goals = excluded.total_goals;
  return jsonb_build_object('saved', true, 'total_goals', p_goals, 'saved_at', now());
end;
$$;

-- «Enviar quiniela»: 1/X/2 de TODOS los partidos abiertos pendientes y, si la
-- semana aún no empieza, el total de goles. Todo o nada.
create or replace function public.submit_pool_picks(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_elem jsonb; v_it record; v_kick timestamptz; v_cur public.pool_picks;
  v_sub int := 0; v_closed int := 0; v_locked int := 0;
  v_given uuid[] := '{}';
  v_missing int;
  v_outcome text;
  v_weeks uuid[];
  v_week uuid;
  v_goals int := 0;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 100 then perform private.fail('INVALID_ITEMS'); end if;
  -- 1. Cada partido con su 1 / X / 2 (si llega un marcador, el resultado sale de él).
  for v_elem in select e.value from jsonb_array_elements(p_items) e loop
    select * into v_it from private.parse_pool_item(v_elem);
    if coalesce(v_it.outcome, case when v_it.home_goals is null then null when v_it.home_goals > v_it.away_goals then '1' when v_it.home_goals < v_it.away_goals then '2' else 'X' end) is null then
      perform private.fail('OUTCOME_REQUIRED');
    end if;
    v_given := v_given || v_it.match_id;
  end loop;
  -- 2. Completa: todos los partidos abiertos pendientes de este jugador.
  select count(*) into v_missing
  from public.pool_matches pm
  where pm.status = 'published' and private.pool_match_open(pm.match_id)
    and not exists (select 1 from public.pool_picks pp where pp.user_id = v_uid and pp.match_id = pm.match_id and pp.status = 'submitted')
    and not (pm.match_id = any (v_given));
  if v_missing > 0 then perform private.fail('INCOMPLETE_QUINIELA'); end if;
  -- 3. Total de goles de cada semana que aún no empieza (desempate).
  select array(select distinct (private.week_for(m.kickoff_at)).id from public.matches m where m.id = any (v_given)) into v_weeks;
  foreach v_week in array coalesce(v_weeks, '{}') loop
    continue when v_week is null or not private.week_goals_open(v_week);
    continue when exists (select 1 from public.pool_week_goals g where g.user_id = v_uid and g.week_id = v_week and g.status = 'submitted');
    if not exists (select 1 from public.pool_week_goals g where g.user_id = v_uid and g.week_id = v_week) then perform private.fail('WEEK_GOALS_REQUIRED'); end if;
  end loop;

  for v_elem in select e.value from jsonb_array_elements(p_items) e loop
    select * into v_it from private.parse_pool_item(v_elem);
    select * into v_cur from public.pool_picks where user_id = v_uid and match_id = v_it.match_id;
    if v_cur.status = 'submitted' then v_locked := v_locked + 1; continue; end if;
    if not private.pool_match_open(v_it.match_id) then v_closed := v_closed + 1; continue; end if;
    select kickoff_at into v_kick from public.matches where id = v_it.match_id;
    if not private.can_pick(v_uid, v_kick) then perform private.fail('PAYMENT_REQUIRED'); end if;
    v_outcome := coalesce(v_it.outcome, case when v_it.home_goals > v_it.away_goals then '1' when v_it.home_goals < v_it.away_goals then '2' else 'X' end);
    insert into public.pool_picks (user_id, match_id, outcome, home_goals, away_goals, status, submitted_at)
    values (v_uid, v_it.match_id, v_outcome, null, null, 'submitted', now())
    on conflict (user_id, match_id) do update
      set outcome = excluded.outcome, home_goals = null, away_goals = null, status = 'submitted', submitted_at = now();
    v_sub := v_sub + 1;
  end loop;
  if v_sub > 0 then
    with s as (
      update public.pool_week_goals g set status = 'submitted', submitted_at = now()
       where g.user_id = v_uid and g.status = 'draft' and g.week_id = any (coalesce(v_weeks, '{}')) and private.week_goals_open(g.week_id)
      returning 1)
    select count(*) into v_goals from s;
    perform private.log_audit('pool.picks_submitted', 'profile', v_uid::text, jsonb_build_object('count', v_sub, 'week_goals', v_goals));
  end if;
  return jsonb_build_object('submitted', v_sub, 'closed', v_closed, 'already_submitted', v_locked, 'week_goals', v_goals, 'submitted_at', now());
end;
$$;

-- Lo que ve el participante: partidos (con su semana) y sus semanas con el total de goles.
create or replace function public.get_pool(p_days_back int default 10)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_today date := private.local_day(now());
begin
  return jsonb_build_object(
    'server_time', now(),
    'max_goals', private.setting_int('max_goals', 15),
    'can_submit', private.can_pick(v_uid, now()),
    'matches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'match_id', m.id, 'kickoff_at', m.kickoff_at, 'status', m.status, 'elapsed', m.elapsed,
        'home_goals', m.home_goals, 'away_goals', m.away_goals, 'result_confirmed', m.result_confirmed,
        'is_manual', m.provider = 'manual', 'source', pm.source, 'is_test_data', m.is_test_data, 'sort_order', pm.sort_order,
        'week_id', (private.week_for(m.kickoff_at)).id,
        'open', private.pool_match_open(m.id), 'can_submit', private.can_pick(v_uid, m.kickoff_at),
        'competition', case when c.id is null then null else jsonb_build_object('name', c.name, 'logo_url', c.logo_url) end,
        'home', jsonb_build_object('name', ht.name, 'short_name', ht.short_name, 'code', ht.code, 'logo_url', ht.logo_url),
        'away', jsonb_build_object('name', at.name, 'short_name', at.short_name, 'code', at.code, 'logo_url', at.logo_url),
        'pick', case when pp.user_id is null or pp.outcome is null then null else jsonb_build_object(
          'outcome', pp.outcome, 'home', pp.home_goals, 'away', pp.away_goals, 'status', pp.status, 'submitted_at', pp.submitted_at, 'updated_at', pp.updated_at) end,
        'score', case when s.user_id is null or not s.counted then null else jsonb_build_object(
          'points', s.points, 'exact_hit', s.exact_hit, 'outcome_hit', s.outcome_hit, 'is_final', s.is_final) end
      ) order by private.local_day(m.kickoff_at), pm.sort_order nulls last, m.kickoff_at, m.id)
      from public.pool_matches pm
      join public.matches m on m.id = pm.match_id
      join public.teams ht on ht.id = m.home_team_id
      join public.teams at on at.id = m.away_team_id
      left join public.competitions c on c.id = m.competition_id
      left join public.pool_picks pp on pp.match_id = m.id and pp.user_id = v_uid
      left join public.pool_scores s on s.match_id = m.id and s.user_id = v_uid
      where pm.status = 'published'
        and (m.kickoff_at >= now() - make_interval(days => greatest(p_days_back, 0)) or pp.user_id is not null and m.kickoff_at >= now() - interval '60 days')
    ), '[]'::jsonb),
    'weeks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', w.id, 'label', w.label, 'week_start', w.week_start, 'week_end', w.week_start + 6,
        'goals_open', private.week_goals_open(w.id),
        'my_goals', g.total_goals, 'my_goals_status', g.status,
        'real', private.week_real_goals(w.id)) order by w.week_start)
      from public.pool_weeks w
      left join public.pool_week_goals g on g.week_id = w.id and g.user_id = v_uid
      where w.week_start + 6 >= v_today - greatest(p_days_back, 0) and w.week_start <= v_today + 13
        and exists (select 1 from private.week_published(w.id))
    ), '[]'::jsonb));
end;
$$;

-- Clasificación de la semana: aciertos y, en empate, cercanía al total de goles.
create or replace function public.get_week_leaderboard(p_week uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_today date := private.local_day(now());
  v_week public.pool_weeks;
  v_real jsonb;
begin
  if p_week is not null then
    select * into v_week from public.pool_weeks where id = p_week;
  else
    -- La semana en curso; si no tiene partidos, la última jugada; si no, la próxima.
    select * into v_week from public.pool_weeks w
     where exists (select 1 from private.week_published(w.id))
     order by (v_today between w.week_start and w.week_start + 6) desc, (w.week_start <= v_today) desc, abs(w.week_start - v_today)
     limit 1;
  end if;
  if v_week.id is null then
    return jsonb_build_object('week', null, 'rows', '[]'::jsonb, 'weeks', '[]'::jsonb);
  end if;
  v_real := private.week_real_goals(v_week.id);
  return jsonb_build_object(
    'week', jsonb_build_object('id', v_week.id, 'label', v_week.label, 'week_start', v_week.week_start, 'week_end', v_week.week_start + 6,
                               'goals_open', private.week_goals_open(v_week.id)) || jsonb_build_object('real', v_real),
    'rows', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.rank_position, r.display_name)
      from (
        select rank() over (order by x.hits desc, x.diff asc nulls last)::int as rank_position,
               x.user_id, p.display_name, p.avatar_url, x.hits, x.scored, x.picks, x.guess, x.diff, x.user_id = v_uid as is_me
        from (
          select pp.user_id,
                 count(*) filter (where s.counted and s.outcome_hit)::int as hits,
                 count(*) filter (where s.counted)::int as scored,
                 count(*)::int as picks,
                 g.total_goals::int as guess,
                 case when g.total_goals is null then null else abs(g.total_goals - (v_real ->> 'goals')::int) end as diff
          from private.week_published(v_week.id) wp
          join public.pool_picks pp on pp.match_id = wp.match_id and pp.status = 'submitted'
          left join public.pool_scores s on s.user_id = pp.user_id and s.match_id = pp.match_id
          left join public.pool_week_goals g on g.user_id = pp.user_id and g.week_id = v_week.id and g.status = 'submitted'
          group by pp.user_id, g.total_goals
        ) x
        join public.profiles p on p.id = x.user_id
      ) r), '[]'::jsonb),
    'weeks', coalesce((
      select jsonb_agg(jsonb_build_object('id', w.id, 'label', w.label, 'week_start', w.week_start) order by w.week_start desc)
      from (select * from public.pool_weeks w2 where exists (select 1 from private.week_published(w2.id)) order by w2.week_start desc limit 12) w), '[]'::jsonb));
end;
$$;

revoke execute on function private.guard_week_goals() from public, anon, authenticated;
revoke execute on function private.week_published(uuid) from public, anon, authenticated;
revoke execute on function private.week_goals_open(uuid) from public, anon, authenticated;
revoke execute on function private.week_real_goals(uuid) from public, anon, authenticated;
revoke execute on function public.save_week_goals(uuid, int) from public, anon;
revoke execute on function public.get_week_leaderboard(uuid) from public, anon;
grant execute on function public.save_week_goals(uuid, int) to authenticated;
grant execute on function public.get_week_leaderboard(uuid) to authenticated;
