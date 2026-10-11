-- =====================================================================
-- «Próxima quiniela» y catálogo de equipos controlado por el administrador.
--
-- * La importación automática ya NO publica: los partidos reales descubiertos
--   quedan como sugerencias (pool_candidates). El admin los selecciona, ordena
--   y publica. Volver a sincronizar nunca pisa su selección.
-- * Publicar aplica la selección a la quiniela oficial (pool_matches): agrega
--   lo seleccionado y retira (sin borrar) lo que se quitó. Pronósticos,
--   marcadores y puntos se conservan.
-- * Partidos aplazados/cancelados o que el proveedor deja de devolver quedan
--   marcados para revisión, nunca se borran en silencio.
-- * Equipos: retirar (con motivo, reversible) o eliminar solo si no tienen
--   ningún partido; los retirados no vuelven a sugerirse automáticamente.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Equipos retirados
-- ---------------------------------------------------------------------
alter table public.teams add column if not exists retired_at timestamptz;
alter table public.teams add column if not exists retired_by uuid references public.profiles (id) on delete set null;
alter table public.teams add column if not exists retire_reason text check (retire_reason is null or char_length(retire_reason) <= 300);

-- ---------------------------------------------------------------------
-- Borrador de la próxima quiniela
-- ---------------------------------------------------------------------
create table if not exists public.pool_candidates (
  match_id      uuid primary key references public.matches (id),
  state         text not null default 'suggested' check (state in ('suggested', 'selected', 'dismissed')),
  sort_order    int,
  source        text not null default 'auto' check (source in ('auto', 'admin')),
  needs_review  boolean not null default false,
  review_reason text,
  discovered_at timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  updated_by    uuid references public.profiles (id) on delete set null
);
alter table public.pool_candidates enable row level security;
revoke all on public.pool_candidates from anon, authenticated;

alter table public.pool_matches add column if not exists sort_order int;

-- Lo ya publicado entra al borrador como seleccionado (nada cambia para los jugadores).
insert into public.pool_candidates (match_id, state, source, sort_order)
select pm.match_id, case when pm.status = 'published' then 'selected' else 'dismissed' end, pm.source,
       row_number() over (order by m.kickoff_at, m.id)
from public.pool_matches pm join public.matches m on m.id = pm.match_id
on conflict (match_id) do nothing;
update public.pool_matches pm set sort_order = c.sort_order
  from public.pool_candidates c where c.match_id = pm.match_id and pm.sort_order is null;

create or replace function private.match_has_retired_team(p_match uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.matches m join public.teams t on t.id in (m.home_team_id, m.away_team_id)
                 where m.id = p_match and t.retired_at is not null);
$$;

-- Importación automática: solo sugiere (nunca publica ni pisa decisiones del admin).
create or replace function public.pool_auto_import(p_provider text, p_fixtures jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_new int := 0;
begin
  if p_fixtures is null or jsonb_typeof(p_fixtures) <> 'array' or jsonb_array_length(p_fixtures) = 0 then
    return jsonb_build_object('imported', 0, 'added', 0, 'suggested', 0);
  end if;
  select array(select (x ->> 0)::uuid from jsonb_array_elements(public.upsert_provider_fixtures(p_provider, p_fixtures, false) -> 'match_ids') x) into v_ids;
  with ins as (
    insert into public.pool_candidates (match_id, state, source, sort_order)
    select m.id, 'suggested', 'auto', null from public.matches m
    where m.id = any (v_ids) and m.status = 'scheduled' and m.kickoff_at > now()
      and not private.match_has_retired_team(m.id)
    on conflict (match_id) do nothing
    returning 1)
  select count(*) into v_new from ins;
  -- Si el proveedor vuelve a devolverlo, deja de estar «desaparecido».
  update public.pool_candidates set needs_review = false, review_reason = null, updated_at = now()
   where match_id = any (v_ids) and review_reason = 'NOT_IN_PROVIDER';
  return jsonb_build_object('imported', coalesce(array_length(v_ids, 1), 0), 'added', 0, 'suggested', v_new);
end;
$$;

-- Aplazados, cancelados o suspendidos: a revisión del admin.
create or replace function private.flag_candidate_status()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from old.status and new.status in ('postponed', 'cancelled', 'abandoned', 'suspended') then
    update public.pool_candidates set needs_review = true, review_reason = 'STATUS:' || new.status, updated_at = now()
     where match_id = new.id;
  elsif new.status is distinct from old.status and old.status in ('postponed', 'suspended') and new.status in ('scheduled', 'live', 'finished') then
    update public.pool_candidates set needs_review = false, review_reason = null, updated_at = now()
     where match_id = new.id and review_reason like 'STATUS:%';
  end if;
  return null;
end;
$$;
create or replace trigger matches_flag_candidates after update of status on public.matches
  for each row execute function private.flag_candidate_status();

-- El sincronizador avisa qué partidos de un día ya no devuelve el proveedor.
create or replace function public.pool_mark_missing(p_provider text, p_date date, p_present text[])
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare v_n int;
begin
  with flagged as (
    update public.pool_candidates c set needs_review = true, review_reason = 'NOT_IN_PROVIDER', updated_at = now()
      from public.matches m
     where m.id = c.match_id and m.provider = p_provider and c.state <> 'dismissed'
       and (m.kickoff_at at time zone 'utc')::date = p_date
       and not (m.external_id = any (coalesce(p_present, '{}')))
       and m.status not in ('finished', 'cancelled')
       and coalesce(c.review_reason, '') <> 'NOT_IN_PROVIDER'
    returning 1)
  select count(*) into v_n from flagged;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------
-- Panel: próxima quiniela
-- ---------------------------------------------------------------------
create or replace function public.admin_next_pool()
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
      'match_id', m.id, 'kickoff_at', m.kickoff_at, 'status', m.status, 'elapsed', m.elapsed,
      'home_goals', m.home_goals, 'away_goals', m.away_goals, 'result_confirmed', m.result_confirmed,
      'provider', m.provider, 'external_id', case when m.provider = 'manual' then null else m.external_id end,
      'competition', case when co.id is null then null else jsonb_build_object('id', co.id, 'name', co.name, 'logo_url', co.logo_url) end,
      'home', jsonb_build_object('id', ht.id, 'name', ht.name, 'short_name', ht.short_name, 'code', ht.code, 'logo_url', ht.logo_url, 'retired', ht.retired_at is not null),
      'away', jsonb_build_object('id', at.id, 'name', at.name, 'short_name', at.short_name, 'code', at.code, 'logo_url', at.logo_url, 'retired', at.retired_at is not null),
      'state', coalesce(c.state, 'selected'),
      'published', coalesce(pm.status = 'published', false),
      'withdrawn', coalesce(pm.status = 'withdrawn', false),
      'source', coalesce(c.source, pm.source, 'auto'),
      'sort_order', coalesce(c.sort_order, pm.sort_order),
      'needs_review', coalesce(c.needs_review, false), 'review_reason', c.review_reason,
      'open', private.pool_match_open(m.id) or (pm.match_id is null and m.status = 'scheduled' and m.kickoff_at > now()),
      'picks', (select count(*) from public.pool_picks pp where pp.match_id = m.id and pp.status = 'submitted')
    ) order by coalesce(c.sort_order, pm.sort_order) nulls last, m.kickoff_at, m.id)
    from public.matches m
    left join public.pool_candidates c on c.match_id = m.id
    left join public.pool_matches pm on pm.match_id = m.id
    join public.teams ht on ht.id = m.home_team_id
    join public.teams at on at.id = m.away_team_id
    left join public.competitions co on co.id = m.competition_id
    where (c.match_id is not null or pm.match_id is not null)
      and not m.is_test_data
      and (m.kickoff_at >= now() - interval '6 hours' or m.status in ('live', 'suspended')
           or (pm.status = 'published' and not m.result_confirmed and m.kickoff_at >= now() - interval '3 days'))
  ), '[]'::jsonb);
end;
$$;

-- Guardar el borrador: qué entra, qué no y en qué orden. No toca lo publicado.
-- p_items: [{ match_id, selected: bool, dismissed?: bool, sort_order: int }]
create or replace function public.admin_save_selection(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := private.assert_admin();
  v_elem jsonb;
  v_id uuid;
  v_state text;
  v_saved int := 0;
  v_skipped int := 0;
  v_published boolean;
  v_open boolean;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 300 then perform private.fail('INVALID_ITEMS'); end if;
  for v_elem in select e.value from jsonb_array_elements(p_items) e loop
    begin v_id := (v_elem ->> 'match_id')::uuid; exception when others then perform private.fail('INVALID_MATCH'); end;
    if not exists (select 1 from public.matches where id = v_id) then perform private.fail('MATCH_NOT_FOUND'); end if;
    v_state := case when (v_elem ->> 'dismissed')::boolean is true then 'dismissed'
                    when (v_elem ->> 'selected')::boolean is true then 'selected' else 'suggested' end;
    select coalesce(pm.status = 'published', false) into v_published from public.pool_matches pm where pm.match_id = v_id;
    v_published := coalesce(v_published, false);
    select m.status = 'scheduled' and m.kickoff_at > now() into v_open from public.matches m where m.id = v_id;
    -- Un partido ya iniciado no puede agregarse como nuevo (sí conservarse si ya estaba publicado).
    if v_state = 'selected' and not v_open and not v_published then v_skipped := v_skipped + 1; continue; end if;
    insert into public.pool_candidates (match_id, state, source, sort_order, updated_by, updated_at)
    values (v_id, v_state, 'admin', nullif(v_elem ->> 'sort_order', '')::int, v_admin, now())
    on conflict (match_id) do update set state = excluded.state, sort_order = coalesce(excluded.sort_order, public.pool_candidates.sort_order),
      updated_by = v_admin, updated_at = now();
    v_saved := v_saved + 1;
  end loop;
  perform private.log_audit('pool.selection_saved', 'pool', 'next', jsonb_build_object('items', v_saved, 'skipped_started', v_skipped));
  return jsonb_build_object('saved', v_saved, 'skipped_started', v_skipped);
end;
$$;

-- Publicar: la quiniela oficial pasa a ser exactamente la selección.
create or replace function public.admin_publish_selection(p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := private.assert_admin();
  v_pub int := 0;
  v_wd int := 0;
  v_wd_picks int := 0;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  -- Lo que se va a retirar (publicado y ya no seleccionado, sin haber empezado).
  select count(*), coalesce(sum((select count(*) from public.pool_picks pp where pp.match_id = pm.match_id and pp.status = 'submitted')), 0)
    into v_wd, v_wd_picks
    from public.pool_matches pm
    join public.pool_candidates c on c.match_id = pm.match_id
   where pm.status = 'published' and c.state <> 'selected';
  if v_wd > 0 and char_length(coalesce(v_reason, '')) < 5 then perform private.fail('REASON_REQUIRED'); end if;

  update public.pool_matches pm set status = 'withdrawn', changed_by = v_admin, changed_at = now(), change_reason = left(v_reason, 300)
    from public.pool_candidates c
   where c.match_id = pm.match_id and pm.status = 'published' and c.state <> 'selected';

  with up as (
    insert into public.pool_matches (match_id, status, source, added_by, sort_order)
    select c.match_id, 'published', c.source, v_admin, c.sort_order
    from public.pool_candidates c join public.matches m on m.id = c.match_id
    where c.state = 'selected' and m.status = 'scheduled' and m.kickoff_at > now()
      and not exists (select 1 from public.pool_matches x where x.match_id = c.match_id and x.status = 'published')
    on conflict (match_id) do update set status = 'published', sort_order = excluded.sort_order, changed_by = v_admin, changed_at = now(),
      change_reason = 'Publicado por el administrador'
    returning 1)
  select count(*) into v_pub from up;

  -- Orden de presentación para los jugadores.
  update public.pool_matches pm set sort_order = c.sort_order
    from public.pool_candidates c where c.match_id = pm.match_id and pm.sort_order is distinct from c.sort_order;

  perform private.log_audit('pool.selection_published', 'pool', 'next',
    jsonb_build_object('published', v_pub, 'withdrawn', v_wd, 'withdrawn_with_picks', v_wd_picks, 'reason', v_reason));
  return jsonb_build_object('published', v_pub, 'withdrawn', v_wd, 'withdrawn_picks', v_wd_picks);
end;
$$;

-- Altas manuales del admin y partidos vinculados con la API: entran a la selección (se publican con «Publicar»).
create or replace function public.admin_publish_match(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := private.assert_admin();
begin
  if not exists (select 1 from public.matches where id = p_match_id) then perform private.fail('MATCH_NOT_FOUND'); end if;
  insert into public.pool_candidates (match_id, state, source, updated_by)
  values (p_match_id, 'selected', 'admin', v_admin)
  on conflict (match_id) do update set state = 'selected', updated_by = v_admin, updated_at = now();
  perform private.log_audit('pool.match_selected', 'match', p_match_id::text, '{}'::jsonb);
end;
$$;

create or replace function public.admin_create_pool_match(p_home uuid, p_away uuid, p_kickoff timestamptz, p_competition_id uuid, p_competition_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := private.assert_admin();
  v_comp uuid := p_competition_id;
  v_match uuid;
begin
  if p_home is null or p_away is null or p_home = p_away or p_kickoff is null then perform private.fail('INVALID_MATCH'); end if;
  if p_kickoff <= now() then perform private.fail('KICKOFF_IN_PAST'); end if;
  if not exists (select 1 from public.teams where id = p_home) or not exists (select 1 from public.teams where id = p_away) then perform private.fail('INVALID_TEAM'); end if;
  if v_comp is null and char_length(btrim(coalesce(p_competition_name, ''))) >= 2 then
    insert into public.competitions (provider, external_id, name, is_test_data)
    values ('manual', private.team_key(p_competition_name), left(btrim(p_competition_name), 80), false)
    on conflict (provider, external_id) do update set name = public.competitions.name
    returning id into v_comp;
  end if;
  select m.id into v_match from public.matches m
  where m.home_team_id = p_home and m.away_team_id = p_away and abs(extract(epoch from m.kickoff_at - p_kickoff)) <= 6 * 3600
  limit 1;
  if v_match is not null then
    insert into public.pool_candidates (match_id, state, source, updated_by) values (v_match, 'selected', 'admin', v_admin)
    on conflict (match_id) do update set state = 'selected', updated_by = v_admin, updated_at = now();
    return jsonb_build_object('match_id', v_match, 'created', false);
  end if;
  insert into public.matches (provider, external_id, competition_id, home_team_id, away_team_id, kickoff_at, result_source, is_test_data)
  values ('manual', gen_random_uuid()::text, v_comp, p_home, p_away, p_kickoff, 'admin', false)
  returning id into v_match;
  insert into public.pool_candidates (match_id, state, source, updated_by) values (v_match, 'selected', 'admin', v_admin);
  perform private.log_audit('pool.manual_match_created', 'match', v_match::text, jsonb_build_object('kickoff_at', p_kickoff, 'competition', coalesce(p_competition_name, v_comp::text)));
  return jsonb_build_object('match_id', v_match, 'created', true);
end;
$$;

-- Orden del admin también para los jugadores (por día y luego por su orden).
create or replace function public.get_pool(p_days_back int default 10)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
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
    ), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------
-- Catálogo de equipos
-- ---------------------------------------------------------------------
-- El selector de partidos ya no ofrece equipos retirados.
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
  where not t.is_test_data and t.retired_at is null
    and (p_query is null or btrim(p_query) = ''
         or private.team_key(t.name) like '%' || private.team_key(p_query) || '%'
         or t.external_id = btrim(p_query))
  order by (private.team_key(t.name) = private.team_key(p_query)) desc, t.name
  limit 30;
end;
$$;

-- Lista completa con uso (partidos, pronósticos, borrador) para decidir retirar o eliminar.
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
             t.retired_at is not null as retired, t.retired_at, t.retire_reason,
             (select count(*) from public.matches m where t.id in (m.home_team_id, m.away_team_id)) as matches,
             (select count(*) from public.matches m join public.pool_picks pp on pp.match_id = m.id where t.id in (m.home_team_id, m.away_team_id)) as pool_picks,
             (select count(*) from public.matches m join public.prediction_picks pr on pr.match_id = m.id where t.id in (m.home_team_id, m.away_team_id)) as round_picks,
             (select count(*) from public.matches m join public.pool_candidates c on c.match_id = m.id where t.id in (m.home_team_id, m.away_team_id) and c.state = 'selected') as selected,
             not exists (select 1 from public.matches m where t.id in (m.home_team_id, m.away_team_id)) as deletable
      from public.teams t
      where not t.is_test_data
        and (p_include_retired or t.retired_at is null)
        and (p_query is null or btrim(p_query) = ''
             or private.team_key(t.name) like '%' || private.team_key(p_query) || '%'
             or t.external_id = btrim(p_query))
      order by t.name
      limit 200
    ) x), '[]'::jsonb);
end;
$$;

-- Alta sin duplicados (por id del proveedor y por nombre). Un equipo manual se
-- convierte en oficial si después se identifica en API-Football.
create or replace function public.admin_create_team(p_name text, p_short_name text, p_logo_url text, p_provider_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := private.assert_admin();
  v_name text := btrim(coalesce(p_name, ''));
  v_pid text := nullif(btrim(coalesce(p_provider_id, '')), '');
  v_logo text := nullif(btrim(coalesce(p_logo_url, '')), '');
  v_found public.teams;
  v_id uuid;
begin
  if char_length(v_name) < 2 or char_length(v_name) > 60 then perform private.fail('INVALID_TEAM'); end if;
  if v_pid is not null and v_pid !~ '^[0-9]{1,10}$' then perform private.fail('INVALID_PROVIDER_ID'); end if;
  if v_logo is not null and v_logo !~ '^https://' then perform private.fail('INVALID_LOGO_URL'); end if;
  -- 1. Mismo id oficial
  if v_pid is not null then
    select * into v_found from public.teams t where t.provider = 'api-football' and t.external_id = v_pid;
    if found then
      return jsonb_build_object('id', v_found.id, 'created', false, 'retired', v_found.retired_at is not null, 'match', 'provider_id');
    end if;
  end if;
  -- 2. Mismo nombre
  select * into v_found from public.teams t where private.team_key(t.name) = private.team_key(v_name) and not t.is_test_data
    order by (t.provider = 'api-football') desc limit 1;
  if found then
    if v_pid is not null and v_found.provider = 'manual' then
      -- El manual se vuelve oficial (mismo registro: sus partidos y su historial no cambian).
      update public.teams set provider = 'api-football', external_id = v_pid, logo_url = coalesce(v_logo, logo_url) where id = v_found.id;
      perform private.log_audit('team.linked_to_provider', 'team', v_found.id::text, jsonb_build_object('provider_id', v_pid));
      return jsonb_build_object('id', v_found.id, 'created', false, 'retired', v_found.retired_at is not null, 'match', 'name_upgraded');
    end if;
    return jsonb_build_object('id', v_found.id, 'created', false, 'retired', v_found.retired_at is not null, 'match', 'name');
  end if;
  insert into public.teams (provider, external_id, name, short_name, logo_url, is_test_data)
  values (case when v_pid is null then 'manual' else 'api-football' end, coalesce(v_pid, private.team_key(v_name)),
          v_name, left(coalesce(nullif(btrim(p_short_name), ''), v_name), 20), v_logo, false)
  returning id into v_id;
  perform private.log_audit('team.created', 'team', v_id::text, jsonb_build_object('name', v_name, 'provider_id', v_pid, 'logo', v_logo is not null));
  return jsonb_build_object('id', v_id, 'created', true, 'retired', false);
end;
$$;

-- Retirar: sale del catálogo activo y de las sugerencias; su historial queda intacto.
create or replace function public.admin_retire_team(p_team uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := private.assert_admin();
  v_dismissed int;
begin
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then perform private.fail('REASON_REQUIRED'); end if;
  update public.teams set retired_at = now(), retired_by = v_admin, retire_reason = left(btrim(p_reason), 300)
   where id = p_team and retired_at is null;
  if not found then perform private.fail('TEAM_NOT_FOUND'); end if;
  -- Sugerencias pendientes de ese equipo (no publicadas) dejan de ofrecerse.
  with d as (
    update public.pool_candidates c set state = 'dismissed', updated_by = v_admin, updated_at = now()
      from public.matches m
     where m.id = c.match_id and p_team in (m.home_team_id, m.away_team_id) and c.state = 'suggested'
    returning 1)
  select count(*) into v_dismissed from d;
  perform private.log_audit('team.retired', 'team', p_team::text, jsonb_build_object('reason', btrim(p_reason), 'suggestions_dismissed', v_dismissed));
  return jsonb_build_object('retired', true, 'suggestions_dismissed', v_dismissed);
end;
$$;

create or replace function public.admin_restore_team(p_team uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := private.assert_admin();
begin
  update public.teams set retired_at = null, retired_by = null, retire_reason = null where id = p_team and retired_at is not null;
  if not found then perform private.fail('TEAM_NOT_FOUND'); end if;
  perform private.log_audit('team.restored', 'team', p_team::text, jsonb_build_object('by', v_admin));
end;
$$;

-- Eliminar de verdad: solo si ningún partido lo usa (sin cascadas).
create or replace function public.admin_delete_team(p_team uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := private.assert_admin();
  v_t public.teams;
begin
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then perform private.fail('REASON_REQUIRED'); end if;
  select * into v_t from public.teams where id = p_team for update;
  if not found then perform private.fail('TEAM_NOT_FOUND'); end if;
  if exists (select 1 from public.matches m where p_team in (m.home_team_id, m.away_team_id)) then perform private.fail('TEAM_HAS_HISTORY'); end if;
  delete from public.teams where id = p_team;
  perform private.log_audit('team.deleted', 'team', p_team::text,
    jsonb_build_object('name', v_t.name, 'provider', v_t.provider, 'provider_id', case when v_t.provider = 'manual' then null else v_t.external_id end, 'reason', btrim(p_reason), 'by', v_admin));
end;
$$;

-- Cualquier publicación o retiro hecho por otra vía mantiene el borrador al día,
-- así «Publicar selección» nunca deshace una decisión tomada en otra pantalla.
create or replace function private.sync_candidate_from_pool()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from 'published') then
    insert into public.pool_candidates (match_id, state, source, sort_order)
    values (new.match_id, 'selected', new.source, new.sort_order)
    on conflict (match_id) do update set state = 'selected', updated_at = now()
      where public.pool_candidates.state <> 'selected';
  elsif new.status = 'withdrawn' and tg_op = 'UPDATE' and old.status = 'published' then
    update public.pool_candidates set state = 'suggested', updated_at = now() where match_id = new.match_id and state = 'selected';
  end if;
  return null;
end;
$$;
create or replace trigger pool_matches_sync_candidate after insert or update of status on public.pool_matches
  for each row execute function private.sync_candidate_from_pool();

-- El plan semanal anterior ya no publica: solo sugiere sus partidos.
create or replace function private.fill_week(p_week uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.pool_weeks;
  v_n int;
begin
  select * into w from public.pool_weeks where id = p_week;
  if not found then return 0; end if;
  with ins as (
    insert into public.pool_candidates (match_id, state, source)
    select m.id, 'suggested', 'auto' from public.matches m
    where m.provider = 'api-football' and m.status = 'scheduled' and m.kickoff_at > now()
      and private.local_day(m.kickoff_at) between w.week_start and w.week_start + 6
      and private.week_fit(w, m.id) is not null and not private.match_has_retired_team(m.id)
    on conflict (match_id) do nothing
    returning 1)
  select count(*) into v_n from ins;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------
revoke execute on function private.match_has_retired_team(uuid) from public, anon, authenticated;
revoke execute on function private.flag_candidate_status() from public, anon, authenticated;
revoke execute on function private.sync_candidate_from_pool() from public, anon, authenticated;
revoke execute on function public.pool_mark_missing(text, date, text[]) from public, anon, authenticated;
grant execute on function public.pool_mark_missing(text, date, text[]) to service_role;
revoke execute on function public.admin_next_pool() from public, anon;
revoke execute on function public.admin_save_selection(jsonb) from public, anon;
revoke execute on function public.admin_publish_selection(text) from public, anon;
revoke execute on function public.admin_team_catalog(text, boolean) from public, anon;
revoke execute on function public.admin_retire_team(uuid, text) from public, anon;
revoke execute on function public.admin_restore_team(uuid) from public, anon;
revoke execute on function public.admin_delete_team(uuid, text) from public, anon;
grant execute on function public.admin_next_pool() to authenticated;
grant execute on function public.admin_save_selection(jsonb) to authenticated;
grant execute on function public.admin_publish_selection(text) to authenticated;
grant execute on function public.admin_team_catalog(text, boolean) to authenticated;
grant execute on function public.admin_retire_team(uuid, text) to authenticated;
grant execute on function public.admin_restore_team(uuid) to authenticated;
grant execute on function public.admin_delete_team(uuid, text) to authenticated;
