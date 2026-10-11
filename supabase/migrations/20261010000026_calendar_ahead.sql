-- =====================================================================
-- Calendario adelantado (jornada completa de viernes a domingo).
--
-- El plan gratuito de API-Football solo deja ver partidos de ayer a mañana.
-- Para publicar la quiniela COMPLETA antes del viernes, el calendario de la
-- semana se toma de TheSportsDB, que publica cada partido con su id OFICIAL de
-- API-Football (y el de cada equipo). Se guarda como partido de API-Football
-- con ese mismo id: cuando entra en la ventana del plan gratuito, la
-- sincronización normal lo actualiza (horario, en vivo, resultado) sin
-- duplicados. Solo se agregan partidos que aún no existen; nunca se inventan.
--
-- Además:
-- * «Solo viernes a domingo» aplica a ligas y equipos.
-- * Una semana puede repetirse sola cada semana con el mismo plan.
-- =====================================================================

alter table public.pool_weeks add column if not exists repeat_weekly boolean not null default false;

-- Viernes a domingo (hora de CDMX) también para las ligas cuando el plan lo pide.
create or replace function private.week_fit(w public.pool_weeks, p_match uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when w.team_weekend_only and extract(isodow from private.local_day(m.kickoff_at)) not in (5, 6, 7) then null
    when ht.external_id = any (w.team_ids) or at.external_id = any (w.team_ids) then 'team'
    when c.external_id = any (w.league_ids) then 'league'
    else null end
  from public.matches m
  join public.teams ht on ht.id = m.home_team_id
  join public.teams at on at.id = m.away_team_id
  left join public.competitions c on c.id = m.competition_id
  where m.id = p_match and m.provider = 'api-football';
$$;

-- Sugerir lo importado y aplicar el plan de cada semana tocada.
create or replace function private.suggest_and_fill(p_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new int := 0;
  v_week int := 0;
  w record;
begin
  with ins as (
    insert into public.pool_candidates (match_id, state, source, sort_order)
    select m.id, 'suggested', 'auto', null from public.matches m
    where m.id = any (p_ids) and m.status = 'scheduled' and m.kickoff_at > now()
      and not private.match_has_retired_team(m.id)
    on conflict (match_id) do nothing
    returning 1)
  select count(*) into v_new from ins;
  update public.pool_candidates set needs_review = false, review_reason = null, updated_at = now()
   where match_id = any (p_ids) and review_reason = 'NOT_IN_PROVIDER';
  for w in select distinct (private.week_for(m.kickoff_at)).id as id from public.matches m where m.id = any (p_ids) loop
    if w.id is not null then v_week := v_week + private.fill_week(w.id); end if;
  end loop;
  return jsonb_build_object('suggested', v_new, 'week_selected', v_week);
end;
$$;

create or replace function public.pool_auto_import(p_provider text, p_fixtures jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  if p_fixtures is null or jsonb_typeof(p_fixtures) <> 'array' or jsonb_array_length(p_fixtures) = 0 then
    return jsonb_build_object('imported', 0, 'added', 0, 'suggested', 0, 'week_selected', 0);
  end if;
  select array(select (x ->> 0)::uuid from jsonb_array_elements(public.upsert_provider_fixtures(p_provider, p_fixtures, false) -> 'match_ids') x) into v_ids;
  return jsonb_build_object('imported', coalesce(array_length(v_ids, 1), 0), 'added', 0) || private.suggest_and_fill(v_ids);
end;
$$;

-- Partidos del calendario adelantado (ids oficiales de API-Football). Solo agrega lo que falta.
-- p_fixtures: [{ external_id, kickoff_at, competition: {external_id, name}, home: {external_id, name}, away: {...} }]
create or replace function public.calendar_import(p_fixtures jsonb)
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
  v_new int := 0;
  v_skipped int := 0;
  v_ko timestamptz;
  v_side text;
  v_team uuid;
begin
  if p_fixtures is null or jsonb_typeof(p_fixtures) <> 'array' or jsonb_array_length(p_fixtures) > 200 then perform private.fail('INVALID_FIXTURES'); end if;
  for v_fx in select e.value from jsonb_array_elements(p_fixtures) e loop
    begin v_ko := (v_fx ->> 'kickoff_at')::timestamptz; exception when others then v_ko := null; end;
    if coalesce(v_fx ->> 'external_id', '') !~ '^\d{1,10}$' or coalesce(v_fx #>> '{home,external_id}', '') !~ '^\d{1,10}$'
       or coalesce(v_fx #>> '{away,external_id}', '') !~ '^\d{1,10}$' or coalesce(v_fx #>> '{competition,external_id}', '') !~ '^\d{1,10}$'
       or v_ko is null or v_ko <= now() or v_ko > now() + interval '60 days'
       or char_length(coalesce(v_fx #>> '{home,name}', '')) < 2 or char_length(coalesce(v_fx #>> '{away,name}', '')) < 2 then
      v_skipped := v_skipped + 1; continue;
    end if;
    select id into v_match from public.matches where provider = 'api-football' and external_id = v_fx ->> 'external_id';
    if v_match is not null then v_ids := v_ids || v_match; continue; end if;

    select id into v_comp from public.competitions where provider = 'api-football' and external_id = v_fx #>> '{competition,external_id}';
    if v_comp is null then
      insert into public.competitions (provider, external_id, name, is_test_data)
      values ('api-football', v_fx #>> '{competition,external_id}', left(v_fx #>> '{competition,name}', 80), false)
      on conflict (provider, external_id) do nothing returning id into v_comp;
      if v_comp is null then select id into v_comp from public.competitions where provider = 'api-football' and external_id = v_fx #>> '{competition,external_id}'; end if;
    end if;
    foreach v_side in array array['home', 'away'] loop
      select id into v_team from public.teams where provider = 'api-football' and external_id = v_fx #>> array[v_side, 'external_id'];
      if v_team is null then
        -- Equipo oficial nuevo: escudo del propio API-Football (por su id), nunca inventado.
        insert into public.teams (provider, external_id, name, short_name, logo_url, is_test_data)
        values ('api-football', v_fx #>> array[v_side, 'external_id'], left(v_fx #>> array[v_side, 'name'], 60), left(v_fx #>> array[v_side, 'name'], 20),
                'https://media.api-sports.io/football/teams/' || (v_fx #>> array[v_side, 'external_id']) || '.png', false)
        on conflict (provider, external_id) do nothing returning id into v_team;
        if v_team is null then select id into v_team from public.teams where provider = 'api-football' and external_id = v_fx #>> array[v_side, 'external_id']; end if;
      end if;
      if v_side = 'home' then v_home := v_team; else v_away := v_team; end if;
    end loop;
    if v_home = v_away then v_skipped := v_skipped + 1; continue; end if;
    insert into public.matches (provider, external_id, competition_id, home_team_id, away_team_id, kickoff_at, status, status_detail, is_test_data)
    values ('api-football', v_fx ->> 'external_id', v_comp, v_home, v_away, v_ko, 'scheduled', 'NS', false)
    on conflict do nothing
    returning id into v_match;
    if v_match is not null then v_new := v_new + 1; v_ids := v_ids || v_match; end if;
  end loop;
  return jsonb_build_object('received', jsonb_array_length(p_fixtures), 'new_matches', v_new, 'skipped', v_skipped) || private.suggest_and_fill(v_ids);
end;
$$;

-- Semanas que necesitan calendario (y repetición semanal de planes).
create or replace function public.calendar_weeks()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := private.local_day(now());
  w public.pool_weeks;
begin
  -- Un plan con «repetir» se copia a la semana siguiente cuando su semana ya empezó.
  for w in select * from public.pool_weeks p where p.repeat_weekly and p.week_start <= v_today
             and not exists (select 1 from public.pool_weeks n where n.week_start = p.week_start + 7) loop
    insert into public.pool_weeks (week_start, max_matches, team_ids, team_weekend_only, league_ids, label, created_by, auto_mode, repeat_weekly)
    values (w.week_start + 7, w.max_matches, w.team_ids, w.team_weekend_only, w.league_ids,
            'Semana ' || to_char(w.week_start + 7, 'DD') || '–' || to_char(w.week_start + 13, 'DD/MM'), w.created_by, w.auto_mode, true)
    on conflict (week_start) do nothing;
    update public.pool_weeks set repeat_weekly = false, updated_at = now() where id = w.id;
    perform private.log_audit('pool.week_repeated', 'pool_week', w.id::text, jsonb_build_object('next_week_start', w.week_start + 7));
  end loop;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'week_start', p.week_start, 'league_ids', p.league_ids, 'team_ids', p.team_ids,
                                        'weekend_only', p.team_weekend_only) order by p.week_start)
    from public.pool_weeks p
    where p.auto_mode <> 'off' and p.week_start + 6 >= v_today and p.week_start <= v_today + 13), '[]'::jsonb);
end;
$$;

-- Repetir (o no) el plan cada semana.
create or replace function public.admin_set_week_repeat(p_week uuid, p_repeat boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := private.assert_admin();
begin
  update public.pool_weeks set repeat_weekly = coalesce(p_repeat, false), updated_at = now() where id = p_week;
  if not found then perform private.fail('WEEK_NOT_FOUND'); end if;
  perform private.log_audit('pool.week_repeat', 'pool_week', p_week::text, jsonb_build_object('repeat', coalesce(p_repeat, false), 'by', v_admin));
end;
$$;

create or replace function public.admin_week_plans()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_admin();
  return jsonb_build_object(
    'plans', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', w.id, 'week_start', w.week_start, 'week_end', w.week_start + 6, 'label', w.label, 'max_matches', w.max_matches,
        'team_ids', w.team_ids, 'league_ids', w.league_ids, 'team_weekend_only', w.team_weekend_only, 'auto_mode', w.auto_mode,
        'repeat_weekly', w.repeat_weekly,
        'selected', (select count(*) from public.pool_candidates c join public.matches m on m.id = c.match_id
                     where c.state = 'selected' and private.local_day(m.kickoff_at) between w.week_start and w.week_start + 6),
        'published', (select count(*) from public.pool_matches pm join public.matches m on m.id = pm.match_id
                      where pm.status = 'published' and private.local_day(m.kickoff_at) between w.week_start and w.week_start + 6),
        'known', (select count(*) from public.matches m where m.provider = 'api-football' and m.status = 'scheduled'
                    and private.local_day(m.kickoff_at) between w.week_start and w.week_start + 6 and private.week_fit(w, m.id) is not null),
        'teams_found', (select coalesce(jsonb_agg(distinct t.ext), '[]'::jsonb) from unnest(w.team_ids) t(ext)
                        where exists (select 1 from public.pool_candidates c join public.matches m on m.id = c.match_id
                                      join public.teams ht on ht.id = m.home_team_id join public.teams at on at.id = m.away_team_id
                                      where c.state = 'selected' and private.local_day(m.kickoff_at) between w.week_start and w.week_start + 6
                                        and (ht.external_id = t.ext or at.external_id = t.ext)))
      ) order by w.week_start)
      from public.pool_weeks w where w.week_start + 6 >= private.local_day(now())), '[]'::jsonb),
    'sources', coalesce((select jsonb_agg(jsonb_build_object('kind', s.kind, 'external_id', s.external_id, 'label', s.label, 'enabled', s.enabled) order by s.kind, s.label)
                         from public.pool_sources s where s.provider = 'api-football'), '[]'::jsonb),
    'calendar', (select jsonb_build_object('at', c.fetched_at, 'summary', c.payload) from public.provider_cache c
                 where c.provider = 'thesportsdb' and c.cache_key = 'calendar:last' order by c.fetched_at desc limit 1),
    'today', private.local_day(now()));
end;
$$;

revoke execute on function private.suggest_and_fill(uuid[]) from public, anon, authenticated;
revoke execute on function public.calendar_import(jsonb) from public, anon, authenticated;
revoke execute on function public.calendar_weeks() from public, anon, authenticated;
grant execute on function public.calendar_import(jsonb) to service_role;
grant execute on function public.calendar_weeks() to service_role;
revoke execute on function public.admin_set_week_repeat(uuid, boolean) from public, anon;
grant execute on function public.admin_set_week_repeat(uuid, boolean) to authenticated;
