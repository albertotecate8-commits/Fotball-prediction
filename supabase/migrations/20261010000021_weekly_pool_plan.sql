-- =====================================================================
-- Quiniela semanal armada por la app. El admin pide «la quiniela de la
-- próxima semana» (lunes a domingo, hora de Ciudad de México) con un cupo
-- (12 por omisión), equipos (Barcelona 529 y Real Madrid 541, solo su partido
-- de fin de semana) y ligas (Liga MX 262). La importación automática llena el
-- cupo con partidos REALES a medida que el proveedor los publica (el plan
-- gratuito solo deja consultar de ayer a mañana): primero los equipos, luego
-- la liga por fecha. Nunca se inventan partidos.
-- =====================================================================

create table if not exists public.pool_weeks (
  id                 uuid primary key default gen_random_uuid(),
  week_start         date not null unique,            -- lunes (CDMX)
  max_matches        int not null default 12 check (max_matches between 1 and 30),
  team_ids           text[] not null default '{}',    -- ids de API-Football
  team_weekend_only  boolean not null default true,   -- equipos: solo viernes a domingo
  league_ids         text[] not null default '{}',
  label              text not null,
  created_by         uuid references public.profiles (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
alter table public.pool_weeks enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'pool_weeks' and policyname = 'pool_weeks_read') then
    create policy pool_weeks_read on public.pool_weeks for select to authenticated using (true);
  end if;
end $$;
revoke all on public.pool_weeks from anon;
revoke insert, update, delete, truncate on public.pool_weeks from authenticated;
grant select on public.pool_weeks to authenticated;

alter table public.pool_matches add column if not exists week_id uuid references public.pool_weeks (id);
create index if not exists pool_matches_week_idx on public.pool_matches (week_id);

-- Día local (CDMX) de un partido y semana que lo contiene.
create or replace function private.local_day(p_ts timestamptz)
returns date language sql stable set search_path = '' as $$
  select (p_ts at time zone coalesce((select s.value #>> '{}' from public.app_settings s where s.key = 'timezone'), 'America/Mexico_City'))::date;
$$;
create or replace function private.week_for(p_ts timestamptz)
returns public.pool_weeks language sql stable security definer set search_path = '' as $$
  select w.* from public.pool_weeks w
  where private.local_day(p_ts) between w.week_start and w.week_start + 6
  limit 1;
$$;

-- ¿Un partido entra en el plan de la semana? 'team' | 'league' | null
create or replace function private.week_fit(w public.pool_weeks, p_match uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (ht.external_id = any (w.team_ids) or at.external_id = any (w.team_ids))
         and (not w.team_weekend_only or extract(isodow from private.local_day(m.kickoff_at)) in (5, 6, 7)) then 'team'
    when c.external_id = any (w.league_ids) then 'league'
    else null end
  from public.matches m
  join public.teams ht on ht.id = m.home_team_id
  join public.teams at on at.id = m.away_team_id
  left join public.competitions c on c.id = m.competition_id
  where m.id = p_match and m.provider = 'api-football';
$$;

-- Llena el cupo de una semana con los partidos ya conocidos (sin consultar al
-- proveedor). Los equipos tienen lugar reservado hasta que aparezca su partido.
create or replace function private.fill_week(p_week uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.pool_weeks;
  v_added int := 0;
  v_used int;
  v_reserved int;
  r record;
begin
  select * into w from public.pool_weeks where id = p_week for update;
  if not found then return 0; end if;
  for r in
    select m.id, private.week_fit(w, m.id) as fit
    from public.matches m
    where m.provider = 'api-football' and m.status = 'scheduled' and m.kickoff_at > now()
      and private.local_day(m.kickoff_at) between w.week_start and w.week_start + 6
      and private.week_fit(w, m.id) is not null
      and not exists (select 1 from public.pool_matches pm where pm.match_id = m.id and (pm.week_id = w.id or pm.status = 'withdrawn'))
    order by (private.week_fit(w, m.id) = 'team') desc, m.kickoff_at, m.id
  loop
    select count(*) into v_used from public.pool_matches pm where pm.week_id = w.id and pm.status = 'published';
    -- Lugares guardados para equipos cuyo partido de fin de semana aún no aparece.
    select count(*) into v_reserved from unnest(w.team_ids) t(ext)
     where not exists (select 1 from public.pool_matches pm join public.matches m on m.id = pm.match_id
                       join public.teams ht on ht.id = m.home_team_id join public.teams at on at.id = m.away_team_id
                       where pm.week_id = w.id and pm.status = 'published' and (ht.external_id = t.ext or at.external_id = t.ext));
    exit when v_used >= w.max_matches;
    continue when r.fit = 'league' and v_used >= w.max_matches - v_reserved;
    insert into public.pool_matches (match_id, status, source, week_id)
    values (r.id, 'published', 'auto', w.id)
    on conflict (match_id) do update set week_id = excluded.week_id
      where public.pool_matches.week_id is null and public.pool_matches.status = 'published';
    v_added := v_added + 1;
  end loop;
  return v_added;
end;
$$;

-- Importación automática (redefinida): en semanas con plan solo entra lo que
-- el plan pide y hasta su cupo; fuera de ellas, como antes (fuentes activas).
create or replace function public.pool_auto_import(p_provider text, p_fixtures jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_new int := 0;
  v_week int := 0;
  w record;
begin
  if p_fixtures is null or jsonb_typeof(p_fixtures) <> 'array' or jsonb_array_length(p_fixtures) = 0 then
    return jsonb_build_object('imported', 0, 'added', 0);
  end if;
  select array(select (x ->> 0)::uuid from jsonb_array_elements(public.upsert_provider_fixtures(p_provider, p_fixtures, false) -> 'match_ids') x) into v_ids;
  -- Semanas con plan: el cupo decide.
  for w in select distinct (private.week_for(m.kickoff_at)).id as id from public.matches m where m.id = any (v_ids) loop
    if w.id is not null then v_week := v_week + private.fill_week(w.id); end if;
  end loop;
  -- Fuera de una semana con plan: partidos por jugar de las fuentes (los retirados no vuelven).
  with ins as (
    insert into public.pool_matches (match_id, status, source)
    select m.id, 'published', 'auto' from public.matches m
    where m.id = any (v_ids) and m.status = 'scheduled' and m.kickoff_at > now()
      and (private.week_for(m.kickoff_at)).id is null
    on conflict (match_id) do nothing
    returning 1)
  select count(*) into v_new from ins;
  return jsonb_build_object('imported', coalesce(array_length(v_ids, 1), 0), 'added', v_new + v_week, 'week_added', v_week);
end;
$$;

-- El admin pide la quiniela de la próxima semana (o de la semana indicada).
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
  v_start date := coalesce(p_week_start, v_today + (8 - extract(isodow from v_today)::int));  -- próximo lunes
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
  -- Partidos manuales o ya publicados de esa semana cuentan para el cupo.
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

-- Estado de las semanas planificadas (admin): cupo, llenos y faltantes.
create or replace function public.admin_week_plans()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', w.id, 'week_start', w.week_start, 'week_end', w.week_start + 6, 'label', w.label, 'max_matches', w.max_matches,
      'team_ids', w.team_ids, 'league_ids', w.league_ids, 'team_weekend_only', w.team_weekend_only,
      'filled', (select count(*) from public.pool_matches pm where pm.week_id = w.id and pm.status = 'published'),
      'teams_found', (select coalesce(jsonb_agg(distinct t.ext), '[]'::jsonb) from unnest(w.team_ids) t(ext)
                       where exists (select 1 from public.pool_matches pm join public.matches m on m.id = pm.match_id
                                     join public.teams ht on ht.id = m.home_team_id join public.teams at on at.id = m.away_team_id
                                     where pm.week_id = w.id and pm.status = 'published' and (ht.external_id = t.ext or at.external_id = t.ext)))
    ) order by w.week_start desc)
    from public.pool_weeks w where w.week_start + 6 >= private.local_day(now()) - 7), '[]'::jsonb);
end;
$$;

-- Para los jugadores: la semana en curso o la próxima con su avance.
create or replace function public.get_pool_week()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('label', w.label, 'week_start', w.week_start, 'week_end', w.week_start + 6, 'max_matches', w.max_matches,
    'filled', (select count(*) from public.pool_matches pm where pm.week_id = w.id and pm.status = 'published'))
  from public.pool_weeks w
  where auth.uid() is not null and w.week_start + 6 >= private.local_day(now())
  order by w.week_start
  limit 1;
$$;

-- Lo que el admin publica a mano dentro de una semana planificada cuenta para ella.
create or replace function private.attach_week()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.week_id is null then
    select (private.week_for(m.kickoff_at)).id into new.week_id from public.matches m where m.id = new.match_id;
  end if;
  return new;
end;
$$;
create or replace trigger pool_matches_attach_week before insert on public.pool_matches
  for each row execute function private.attach_week();

-- Solo Barcelona, Real Madrid y Liga MX como fuentes automáticas.
update public.pool_sources set enabled = false where external_id = '15941' and kind = 'team';

revoke execute on function private.local_day(timestamptz) from public, anon, authenticated;
revoke execute on function private.week_for(timestamptz) from public, anon, authenticated;
revoke execute on function private.week_fit(public.pool_weeks, uuid) from public, anon, authenticated;
revoke execute on function private.fill_week(uuid) from public, anon, authenticated;
revoke execute on function private.attach_week() from public, anon, authenticated;
revoke execute on function public.admin_plan_week(date, int, text[], text[], boolean) from public, anon;
revoke execute on function public.admin_week_plans() from public, anon;
revoke execute on function public.get_pool_week() from public, anon;
grant execute on function public.admin_plan_week(date, int, text[], text[], boolean) to authenticated;
grant execute on function public.admin_week_plans() to authenticated;
grant execute on function public.get_pool_week() to authenticated;
