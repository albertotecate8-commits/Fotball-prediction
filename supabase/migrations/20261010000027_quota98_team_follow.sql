-- =====================================================================
-- 1) Cuota de API-Football: 98 de las 100 solicitudes diarias del plan
--    (margen de 2). Las prioridades siguen protegiendo «en vivo».
-- 2) Equipos con apodos (p. ej. «Alacranes» → Durango) e ids de
--    TheSportsDB para su calendario adelantado.
-- 3) «Incluir cada semana»: seguir un equipo en todas las quinielas
--    automáticas (presentes y futuras) con un solo interruptor.
-- =====================================================================

-- 1) Cuota ------------------------------------------------------------
create or replace function private.api_daily_budget()
returns int language sql stable security definer set search_path = '' as $$
  select least(greatest(private.setting_int('api_daily_budget', 98), 0), 98);
$$;
create or replace function private.api_provider_margin()
returns int language sql stable security definer set search_path = '' as $$
  select greatest(private.setting_int('api_provider_margin', 2), 2);
$$;
update public.app_settings set value = '98', description = 'Presupuesto interno diario de solicitudes a API-Football (máximo 98 de 100; día UTC)' where key = 'api_daily_budget';
update public.app_settings set value = '2', description = 'Solicitudes del proveedor que nunca se usan (margen de seguridad, mínimo 2)' where key = 'api_provider_margin';

-- 2) Apodos e ids de calendario -----------------------------------------
alter table public.teams add column if not exists aliases text[] not null default '{}';
alter table public.teams add column if not exists tsdb_id text check (tsdb_id is null or tsdb_id ~ '^\d{1,10}$');
alter table public.teams add column if not exists tsdb_league text check (tsdb_league is null or tsdb_league ~ '^\d{1,10}$');

-- Ids reales de TheSportsDB (verificados: cada uno trae el id de API-Football del mismo equipo).
update public.teams set tsdb_id = '133739', tsdb_league = '4335' where provider = 'api-football' and external_id = '529' and tsdb_id is null;
update public.teams set tsdb_id = '133738', tsdb_league = '4335' where provider = 'api-football' and external_id = '541' and tsdb_id is null;
update public.teams set tsdb_id = '146383', tsdb_league = '4654',
  aliases = (select array(select distinct unnest(aliases || array['Alacranes', 'Alacranes de Durango'])))
 where provider = 'api-football' and external_id = '15941';

-- Coincidencia por nombre o por apodo.
create or replace function private.team_matches(t public.teams, p_query text)
returns boolean language sql stable set search_path = '' as $$
  select p_query is null or btrim(p_query) = ''
      or private.team_key(t.name) like '%' || private.team_key(p_query) || '%'
      or t.external_id = btrim(p_query)
      or exists (select 1 from unnest(t.aliases) a where private.team_key(a) like '%' || private.team_key(p_query) || '%');
$$;

create or replace function public.admin_search_teams(p_query text)
returns table (id uuid, name text, short_name text, logo_url text, provider text, external_id text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_admin();
  return query
  select t.id, t.name, t.short_name, t.logo_url, t.provider, case when t.provider = 'manual' then null else t.external_id end
  from public.teams t
  where not t.is_test_data and t.retired_at is null and private.team_matches(t, p_query)
  order by (private.team_key(t.name) = private.team_key(p_query)) desc, t.name
  limit 30;
end;
$$;

create or replace function public.admin_team_catalog(p_query text default null, p_include_retired boolean default true)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_admin();
  return coalesce((
    select jsonb_agg(row_to_json(x)::jsonb order by x.retired, x.name)
    from (
      select t.id, t.name, t.short_name, t.logo_url, t.provider,
             case when t.provider = 'manual' then null else t.external_id end as external_id,
             t.aliases, t.retired_at is not null as retired, t.retired_at, t.retire_reason,
             (t.provider = 'api-football' and exists (select 1 from public.pool_sources s where s.provider = 'api-football' and s.kind = 'team'
                                                       and s.external_id = t.external_id and s.enabled)) as followed,
             (select count(*) from public.matches m where t.id in (m.home_team_id, m.away_team_id)) as matches,
             (select count(*) from public.matches m join public.pool_picks pp on pp.match_id = m.id where t.id in (m.home_team_id, m.away_team_id)) as pool_picks,
             (select count(*) from public.matches m join public.prediction_picks pr on pr.match_id = m.id where t.id in (m.home_team_id, m.away_team_id)) as round_picks,
             (select count(*) from public.matches m join public.pool_candidates c on c.match_id = m.id where t.id in (m.home_team_id, m.away_team_id) and c.state = 'selected') as selected,
             not exists (select 1 from public.matches m where t.id in (m.home_team_id, m.away_team_id)) as deletable
      from public.teams t
      where not t.is_test_data and (p_include_retired or t.retired_at is null) and private.team_matches(t, p_query)
      order by t.name
      limit 200
    ) x), '[]'::jsonb);
end;
$$;

-- Apodos e ids de calendario de un equipo (al añadirlo desde la búsqueda en internet).
create or replace function public.admin_set_team_meta(p_team uuid, p_aliases text[], p_tsdb_id text, p_tsdb_league text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := private.assert_admin();
  v_aliases text[];
begin
  select array(select distinct left(btrim(a), 60) from unnest(coalesce(p_aliases, '{}')) a where char_length(btrim(a)) >= 2 limit 10) into v_aliases;
  if nullif(btrim(coalesce(p_tsdb_id, '')), '') !~ '^\d{1,10}$' then p_tsdb_id := null; end if;
  if nullif(btrim(coalesce(p_tsdb_league, '')), '') !~ '^\d{1,10}$' then p_tsdb_league := null; end if;
  update public.teams t set
    aliases = (select array(select distinct x from unnest(t.aliases || v_aliases) x where private.team_key(x) <> private.team_key(t.name) limit 12)),
    tsdb_id = coalesce(btrim(p_tsdb_id), t.tsdb_id), tsdb_league = coalesce(btrim(p_tsdb_league), t.tsdb_league)
   where t.id = p_team;
  if not found then perform private.fail('TEAM_NOT_FOUND'); end if;
  perform private.log_audit('team.meta_updated', 'team', p_team::text, jsonb_build_object('aliases', v_aliases, 'tsdb_id', p_tsdb_id, 'by', v_admin));
end;
$$;

-- 3) Seguir un equipo cada semana ---------------------------------------
create or replace function public.admin_follow_team(p_team uuid, p_follow boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := private.assert_admin();
  t public.teams;
  v_weeks int := 0;
  v_added int := 0;
  w record;
begin
  select * into t from public.teams where id = p_team;
  if not found then perform private.fail('TEAM_NOT_FOUND'); end if;
  if t.provider <> 'api-football' then perform private.fail('TEAM_NOT_OFFICIAL'); end if;
  if coalesce(p_follow, false) and t.retired_at is not null then perform private.fail('TEAM_RETIRED'); end if;
  insert into public.pool_sources (provider, kind, external_id, label, enabled)
  values ('api-football', 'team', t.external_id, left(t.name, 80), coalesce(p_follow, false))
  on conflict (provider, kind, external_id) do update set enabled = excluded.enabled;
  -- Semanas en curso y futuras.
  for w in select * from public.pool_weeks p where p.week_start + 6 >= private.local_day(now()) loop
    if coalesce(p_follow, false) and not (t.external_id = any (w.team_ids)) then
      update public.pool_weeks set team_ids = team_ids || t.external_id, updated_at = now() where id = w.id;
      v_weeks := v_weeks + 1;
      v_added := v_added + private.fill_week(w.id);
    elsif not coalesce(p_follow, false) and t.external_id = any (w.team_ids) then
      update public.pool_weeks set team_ids = array_remove(team_ids, t.external_id), updated_at = now() where id = w.id;
      v_weeks := v_weeks + 1;
    end if;
  end loop;
  perform private.log_audit(case when coalesce(p_follow, false) then 'team.followed' else 'team.unfollowed' end, 'team', p_team::text,
    jsonb_build_object('weeks', v_weeks, 'selected_now', v_added, 'by', v_admin));
  return jsonb_build_object('followed', coalesce(p_follow, false), 'weeks', v_weeks, 'selected_now', v_added);
end;
$$;

-- Al planear una semana, sus ligas y equipos quedan como fuentes activas de la importación.
create or replace function public.admin_plan_week(
  p_week_start date default null, p_max int default 12,
  p_teams text[] default array['529', '541'], p_leagues text[] default array['262'], p_team_weekend_only boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := private.assert_admin();
  v_today date := private.local_day(now());
  v_start date := coalesce(p_week_start, v_today + (8 - extract(isodow from v_today)::int));
  v_id uuid;
  v_added int;
begin
  if extract(isodow from v_start) <> 1 then perform private.fail('WEEK_MUST_START_MONDAY'); end if;
  if v_start + 6 < v_today then perform private.fail('WEEK_IN_PAST'); end if;
  if p_max is null or p_max < 1 or p_max > 30 then perform private.fail('INVALID_MAX'); end if;
  if exists (select 1 from unnest(coalesce(p_teams, '{}') || coalesce(p_leagues, '{}')) x where x !~ '^\d{1,10}$') then perform private.fail('INVALID_PROVIDER_ID'); end if;
  insert into public.pool_weeks (week_start, max_matches, team_ids, team_weekend_only, league_ids, label, created_by)
  values (v_start, p_max, coalesce(p_teams, '{}'), coalesce(p_team_weekend_only, true), coalesce(p_leagues, '{}'),
          'Semana ' || to_char(v_start, 'DD') || '–' || to_char(v_start + 6, 'DD/MM'), v_admin)
  on conflict (week_start) do update set max_matches = excluded.max_matches, team_ids = excluded.team_ids,
    team_weekend_only = excluded.team_weekend_only, league_ids = excluded.league_ids, updated_at = now()
  returning id into v_id;
  insert into public.pool_sources (provider, kind, external_id, label, enabled)
  select 'api-football', 'team', x, coalesce((select left(t.name, 80) from public.teams t where t.provider = 'api-football' and t.external_id = x), 'Equipo #' || x), true
  from unnest(coalesce(p_teams, '{}')) x
  on conflict (provider, kind, external_id) do update set enabled = true;
  insert into public.pool_sources (provider, kind, external_id, label, enabled)
  select 'api-football', 'league', x, coalesce((select left(c.name, 80) from public.competitions c where c.provider = 'api-football' and c.external_id = x), 'Liga #' || x), true
  from unnest(coalesce(p_leagues, '{}')) x
  on conflict (provider, kind, external_id) do update set enabled = true;
  update public.pool_matches pm set week_id = v_id
   from public.matches m
   where m.id = pm.match_id and pm.week_id is null and pm.status = 'published'
     and private.local_day(m.kickoff_at) between v_start and v_start + 6;
  v_added := private.fill_week(v_id);
  perform private.log_audit('pool.week_planned', 'pool_week', v_id::text,
    jsonb_build_object('week_start', v_start, 'max', p_max, 'teams', p_teams, 'leagues', p_leagues, 'added_now', v_added));
  return jsonb_build_object('id', v_id, 'week_start', v_start, 'added_now', v_added);
end;
$$;

-- Calendario: también los ids de TheSportsDB de los equipos que se siguen.
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
                                        'weekend_only', p.team_weekend_only,
                                        'teams', (select coalesce(jsonb_agg(jsonb_build_object('af', t.external_id, 'tsdb', t.tsdb_id, 'tsdb_league', t.tsdb_league)), '[]'::jsonb)
                                                  from public.teams t where t.provider = 'api-football' and t.external_id = any (p.team_ids)))
                     order by p.week_start)
    from public.pool_weeks p
    where p.auto_mode <> 'off' and p.week_start + 6 >= v_today and p.week_start <= v_today + 13), '[]'::jsonb);
end;
$$;

revoke execute on function private.team_matches(public.teams, text) from public, anon, authenticated;
revoke execute on function public.admin_set_team_meta(uuid, text[], text, text) from public, anon;
revoke execute on function public.admin_follow_team(uuid, boolean) from public, anon;
grant execute on function public.admin_set_team_meta(uuid, text[], text, text) to authenticated;
grant execute on function public.admin_follow_team(uuid, boolean) to authenticated;
