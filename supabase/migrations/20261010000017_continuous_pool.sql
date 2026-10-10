-- =====================================================================
-- Quiniela continua: partidos publicados (importados o añadidos por el
-- admin), cada uno con su propio cierre al inicio programado. Las jornadas
-- antiguas se conservan como historial; nada se borra.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Administración: solo cuentas autorizadas por correo (shabex10@gmail.com)
-- ---------------------------------------------------------------------
create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    join auth.users u on u.id = p.id
    join private.admin_email_allowlist a on a.email = lower(u.email)
    where p.id = auth.uid() and p.role = 'admin' and p.status = 'active'
  );
$$;

create or replace function public.am_i_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_admin();
$$;

-- Al confirmar su correo, la cuenta autorizada pasa a admin y las demás
-- cuentas con rol admin quedan como participantes normales (conservan sus datos).
create or replace function private.promote_allowlisted_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email_confirmed_at is not null
     and exists (select 1 from private.admin_email_allowlist a where a.email = lower(new.email))
     and exists (select 1 from public.profiles p where p.id = new.id and p.role <> 'admin') then
    update public.profiles set role = 'admin' where id = new.id;
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, details)
    values (null, 'admin.allowlist_promoted', 'profile', new.id::text, jsonb_build_object('email_domain', split_part(new.email, '@', 2)));
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, details)
    select null, 'admin.demoted_not_allowlisted', 'profile', p.id::text, '{}'::jsonb
    from public.profiles p join auth.users u on u.id = p.id
    where p.role = 'admin' and p.id <> new.id
      and not exists (select 1 from private.admin_email_allowlist a where a.email = lower(u.email));
    update public.profiles p set role = 'player'
    from auth.users u
    where u.id = p.id and p.role = 'admin' and p.id <> new.id
      and not exists (select 1 from private.admin_email_allowlist a where a.email = lower(u.email));
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Catálogo de fuentes automáticas (competiciones y equipos de API-Football)
-- ---------------------------------------------------------------------
create table if not exists public.pool_sources (
  id          bigint generated always as identity primary key,
  provider    text not null default 'api-football',
  kind        text not null check (kind in ('league', 'team')),
  external_id text not null,
  label       text not null,
  enabled     boolean not null default true,
  unique (provider, kind, external_id)
);
alter table public.pool_sources enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'pool_sources' and policyname = 'pool_sources_read') then
    create policy pool_sources_read on public.pool_sources for select to authenticated using (true);
  end if;
end $$;
revoke all on public.pool_sources from anon;
revoke insert, update, truncate on public.pool_sources from authenticated;
grant select on public.pool_sources to authenticated, service_role;
-- Ids verificados con la cuenta real de API-Football (10-oct-2026).
insert into public.pool_sources (kind, external_id, label) values
  ('league', '262', 'Liga MX'), ('team', '529', 'Barcelona'), ('team', '541', 'Real Madrid'), ('team', '15941', 'Durango (Alacranes)')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- Partidos de la quiniela
-- ---------------------------------------------------------------------
create table if not exists public.pool_matches (
  match_id      uuid primary key references public.matches (id),
  status        text not null default 'published' check (status in ('published', 'withdrawn')),
  source        text not null check (source in ('auto', 'admin')),
  closes_at     timestamptz,  -- se fija al empezar el partido y nunca se reabre
  added_by      uuid references public.profiles (id) on delete set null,
  added_at      timestamptz not null default now(),
  changed_by    uuid references public.profiles (id) on delete set null,
  changed_at    timestamptz,
  change_reason text check (change_reason is null or char_length(change_reason) <= 300)
);
alter table public.pool_matches enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'pool_matches' and policyname = 'pool_matches_read') then
    create policy pool_matches_read on public.pool_matches for select to authenticated using (status = 'published' or private.is_admin());
  end if;
end $$;
revoke all on public.pool_matches from anon;
revoke insert, update, truncate on public.pool_matches from authenticated;
grant select on public.pool_matches to authenticated;

create or replace function private.pool_match_open(p_match_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select pm.status = 'published' and pm.closes_at is null and m.status = 'scheduled' and m.kickoff_at > now()
    from public.pool_matches pm join public.matches m on m.id = pm.match_id
    where pm.match_id = p_match_id), false);
$$;

-- Un partido que ya empezó queda cerrado aunque después cambie su horario.
create or replace function private.close_started_pool_match()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (old.kickoff_at <= now() or new.kickoff_at <= now() or new.status <> 'scheduled')
     and exists (select 1 from public.pool_matches pm where pm.match_id = new.id and pm.closes_at is null) then
    update public.pool_matches set closes_at = least(old.kickoff_at, now()) where match_id = new.id and closes_at is null;
  end if;
  if new.kickoff_at is distinct from old.kickoff_at and exists (select 1 from public.pool_matches pm where pm.match_id = new.id) then
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, details)
    values (auth.uid(), 'pool.kickoff_changed', 'match', new.id::text, jsonb_build_object('from', old.kickoff_at, 'to', new.kickoff_at));
  end if;
  return new;
end;
$$;
create or replace trigger matches_close_pool before update of kickoff_at, status on public.matches
  for each row execute function private.close_started_pool_match();

-- ---------------------------------------------------------------------
-- Pronósticos por partido
-- ---------------------------------------------------------------------
create table if not exists public.pool_picks (
  user_id      uuid not null references public.profiles (id),
  match_id     uuid not null references public.matches (id),
  outcome      text check (outcome in ('1', 'X', '2')),
  home_goals   smallint check (home_goals between 0 and 99),
  away_goals   smallint check (away_goals between 0 and 99),
  status       text not null default 'draft' check (status in ('draft', 'submitted')),
  submitted_at timestamptz,
  updated_at   timestamptz not null default now(),
  primary key (user_id, match_id),
  check ((home_goals is null) = (away_goals is null)),
  check (home_goals is null or outcome is not null),
  check ((status = 'submitted') = (submitted_at is not null)),
  check (status = 'draft' or outcome is not null)
);
create index if not exists pool_picks_match_idx on public.pool_picks (match_id);
alter table public.pool_picks enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'pool_picks' and policyname = 'pool_picks_read') then
    create policy pool_picks_read on public.pool_picks for select to authenticated using (user_id = (select auth.uid()) or private.is_admin());
  end if;
end $$;
revoke all on public.pool_picks from anon;
revoke insert, update, truncate on public.pool_picks from authenticated;
grant select on public.pool_picks to authenticated;

-- Guardián: enviado = inmutable; partido cerrado = sin cambios (incluido el admin).
create or replace function private.guard_pool_pick()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.status = 'submitted' then
    raise exception 'PREDICTION_LOCKED' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if not private.pool_match_open(new.match_id) then
    raise exception 'MATCH_CLOSED' using errcode = 'P0001';
  end if;
  if new.home_goals is not null then
    new.outcome := case when new.home_goals > new.away_goals then '1' when new.home_goals < new.away_goals then '2' else 'X' end;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create or replace trigger pool_picks_guard before insert or update or delete on public.pool_picks
  for each row execute function private.guard_pool_pick();

-- ---------------------------------------------------------------------
-- Puntos por partido (reglas existentes: 1X2 = 3, exacto = 5)
-- ---------------------------------------------------------------------
create table if not exists public.pool_scores (
  user_id     uuid not null references public.profiles (id),
  match_id    uuid not null references public.matches (id),
  points      smallint not null check (points in (0, 3, 5)),
  exact_hit   boolean not null,
  outcome_hit boolean not null,
  goal_error  smallint not null check (goal_error >= 0),
  is_final    boolean not null,
  counted     boolean not null default true,
  computed_at timestamptz not null default now(),
  primary key (user_id, match_id)
);
alter table public.pool_scores enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'pool_scores' and policyname = 'pool_scores_read') then
    create policy pool_scores_read on public.pool_scores for select to authenticated using (user_id = (select auth.uid()) or private.is_admin());
  end if;
end $$;
revoke all on public.pool_scores from anon;
revoke insert, update, truncate on public.pool_scores from authenticated;
grant select on public.pool_scores to authenticated;

-- Idempotente: recalcular dos veces da lo mismo (no se suman puntos dos veces).
create or replace function private.recompute_pool_match(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m public.matches;
  v_pub boolean;
  v_res text;
begin
  select * into v_m from public.matches where id = p_match_id;
  select pm.status = 'published' into v_pub from public.pool_matches pm where pm.match_id = p_match_id;
  if v_pub is null then return; end if;
  if v_pub and v_m.status in ('live', 'finished') and v_m.home_goals is not null then
    v_res := case when v_m.home_goals > v_m.away_goals then '1' when v_m.home_goals < v_m.away_goals then '2' else 'X' end;
    insert into public.pool_scores (user_id, match_id, points, exact_hit, outcome_hit, goal_error, is_final, counted, computed_at)
    select pp.user_id, pp.match_id,
           case when pp.home_goals is not null then public.score_prediction(pp.home_goals, pp.away_goals, v_m.home_goals, v_m.away_goals)
                when pp.outcome = v_res then 3 else 0 end,
           pp.home_goals is not null and pp.home_goals = v_m.home_goals and pp.away_goals = v_m.away_goals,
           pp.outcome = v_res,
           case when pp.home_goals is not null then public.goal_error(pp.home_goals, pp.away_goals, v_m.home_goals, v_m.away_goals)
                else v_m.home_goals + v_m.away_goals end,
           v_m.result_confirmed, true, now()
    from public.pool_picks pp
    where pp.match_id = p_match_id and pp.status = 'submitted'
    on conflict (user_id, match_id) do update
      set points = excluded.points, exact_hit = excluded.exact_hit, outcome_hit = excluded.outcome_hit,
          goal_error = excluded.goal_error, is_final = excluded.is_final, counted = true, computed_at = now();
  else
    -- Sin resultado válido (cancelado, aplazado, retirado): no cuenta.
    update public.pool_scores set counted = false, computed_at = now() where match_id = p_match_id and counted;
  end if;
end;
$$;

create or replace function private.on_match_result_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.pool_matches pm where pm.match_id = new.id) then
    perform private.recompute_pool_match(new.id);
  end if;
  return new;
end;
$$;
create or replace trigger matches_pool_scores after update of status, home_goals, away_goals, result_confirmed on public.matches
  for each row execute function private.on_match_result_change();

create or replace function private.on_pool_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.recompute_pool_match(new.match_id);
  return new;
end;
$$;
create or replace trigger pool_matches_scores after update of status on public.pool_matches
  for each row execute function private.on_pool_status_change();

-- ---------------------------------------------------------------------
-- Participación: pago confirmado y vigente al inicio de cada partido
-- ---------------------------------------------------------------------
create or replace function private.can_pick(p_user_id uuid, p_kickoff timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select not g.requires_payment
           or (gm.status = 'active' and gm.payment_status = 'authorized'
               and (gm.payment_valid_until is null or gm.payment_valid_until >= p_kickoff))
    from public.groups g
    left join public.group_members gm on gm.group_id = g.id and gm.user_id = p_user_id
    where g.id = private.default_group_id()), false);
$$;

-- ---------------------------------------------------------------------
-- API del participante
-- ---------------------------------------------------------------------
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
        'is_manual', m.provider = 'manual', 'source', pm.source, 'is_test_data', m.is_test_data,
        'open', private.pool_match_open(m.id), 'can_submit', private.can_pick(v_uid, m.kickoff_at),
        'competition', case when c.id is null then null else jsonb_build_object('name', c.name, 'logo_url', c.logo_url) end,
        'home', jsonb_build_object('name', ht.name, 'short_name', ht.short_name, 'code', ht.code, 'logo_url', ht.logo_url),
        'away', jsonb_build_object('name', at.name, 'short_name', at.short_name, 'code', at.code, 'logo_url', at.logo_url),
        'pick', case when pp.user_id is null or pp.outcome is null then null else jsonb_build_object(
          'outcome', pp.outcome, 'home', pp.home_goals, 'away', pp.away_goals, 'status', pp.status, 'submitted_at', pp.submitted_at, 'updated_at', pp.updated_at) end,
        'score', case when s.user_id is null or not s.counted then null else jsonb_build_object(
          'points', s.points, 'exact_hit', s.exact_hit, 'outcome_hit', s.outcome_hit, 'is_final', s.is_final) end
      ) order by m.kickoff_at, m.id)
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

create or replace function private.parse_pool_item(p_elem jsonb, out match_id uuid, out outcome text, out home_goals smallint, out away_goals smallint)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_max int := private.setting_int('max_goals', 15);
  v_h numeric; v_a numeric;
begin
  if jsonb_typeof(p_elem) <> 'object' then perform private.fail('INVALID_ITEMS'); end if;
  begin match_id := (p_elem ->> 'match_id')::uuid; exception when others then perform private.fail('INVALID_MATCH'); end;
  if match_id is null then perform private.fail('INVALID_MATCH'); end if;
  outcome := nullif(p_elem ->> 'outcome', '');
  if outcome is not null and outcome not in ('1', 'X', '2') then perform private.fail('INVALID_OUTCOME'); end if;
  if coalesce(jsonb_typeof(p_elem -> 'home'), 'null') <> 'null' or coalesce(jsonb_typeof(p_elem -> 'away'), 'null') <> 'null' then
    if jsonb_typeof(p_elem -> 'home') is distinct from 'number' or jsonb_typeof(p_elem -> 'away') is distinct from 'number' then perform private.fail('INVALID_GOALS'); end if;
    v_h := (p_elem ->> 'home')::numeric; v_a := (p_elem ->> 'away')::numeric;
    if v_h <> trunc(v_h) or v_a <> trunc(v_a) or v_h < 0 or v_a < 0 or v_h > v_max or v_a > v_max then perform private.fail('INVALID_GOALS'); end if;
    if outcome is not null and outcome <> (case when v_h > v_a then '1' when v_h < v_a then '2' else 'X' end) then perform private.fail('OUTCOME_MISMATCH'); end if;
    home_goals := v_h::smallint; away_goals := v_a::smallint;
  end if;
end;
$$;

-- «Guardar mi quiniela»: borradores en el servidor (con o sin pago).
create or replace function public.save_pool_picks(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_elem jsonb; v_it record; v_saved int := 0; v_closed int := 0; v_locked int := 0; v_cur public.pool_picks;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 100 then perform private.fail('INVALID_ITEMS'); end if;
  for v_elem in select e.value from jsonb_array_elements(p_items) e loop
    select * into v_it from private.parse_pool_item(v_elem);
    select * into v_cur from public.pool_picks where user_id = v_uid and match_id = v_it.match_id;
    if v_cur.status = 'submitted' then v_locked := v_locked + 1; continue; end if;
    if not private.pool_match_open(v_it.match_id) then v_closed := v_closed + 1; continue; end if;
    insert into public.pool_picks (user_id, match_id, outcome, home_goals, away_goals)
    values (v_uid, v_it.match_id, v_it.outcome, v_it.home_goals, v_it.away_goals)
    on conflict (user_id, match_id) do update
      set outcome = excluded.outcome, home_goals = excluded.home_goals, away_goals = excluded.away_goals;
    v_saved := v_saved + 1;
  end loop;
  return jsonb_build_object('saved', v_saved, 'closed', v_closed, 'already_submitted', v_locked, 'saved_at', now());
end;
$$;

-- «Enviar pronósticos»: definitivo por partido; exige pago y partido abierto.
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
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 100 then perform private.fail('INVALID_ITEMS'); end if;
  for v_elem in select e.value from jsonb_array_elements(p_items) e loop
    select * into v_it from private.parse_pool_item(v_elem);
    select * into v_cur from public.pool_picks where user_id = v_uid and match_id = v_it.match_id;
    if v_cur.status = 'submitted' then v_locked := v_locked + 1; continue; end if;
    if not private.pool_match_open(v_it.match_id) then v_closed := v_closed + 1; continue; end if;
    if v_it.outcome is null and v_it.home_goals is null then perform private.fail('INCOMPLETE_PREDICTION'); end if;
    select kickoff_at into v_kick from public.matches where id = v_it.match_id;
    if not private.can_pick(v_uid, v_kick) then perform private.fail('PAYMENT_REQUIRED'); end if;
    insert into public.pool_picks (user_id, match_id, outcome, home_goals, away_goals, status, submitted_at)
    values (v_uid, v_it.match_id, v_it.outcome, v_it.home_goals, v_it.away_goals, 'submitted', now())
    on conflict (user_id, match_id) do update
      set outcome = excluded.outcome, home_goals = excluded.home_goals, away_goals = excluded.away_goals,
          status = 'submitted', submitted_at = now();
    v_sub := v_sub + 1;
  end loop;
  if v_sub > 0 then
    perform private.log_audit('pool.picks_submitted', 'profile', v_uid::text, jsonb_build_object('count', v_sub));
  end if;
  return jsonb_build_object('submitted', v_sub, 'closed', v_closed, 'already_submitted', v_locked, 'submitted_at', now());
end;
$$;

create or replace function public.get_pool_leaderboard()
returns table (
  rank_position int, user_id uuid, display_name text, avatar_url text,
  points int, exact_hits int, outcome_hits int, goal_error int,
  rounds_played int, scored_matches int, is_provisional boolean, is_me boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with agg as (
    select s.user_id, sum(s.points)::int pts, count(*) filter (where s.exact_hit)::int ex, count(*) filter (where s.outcome_hit)::int oh,
           sum(s.goal_error)::int ge, count(*)::int n, bool_or(not s.is_final) prov
    from public.pool_scores s
    join public.pool_matches pm on pm.match_id = s.match_id and pm.status = 'published'
    where s.counted
    group by s.user_id
  )
  select rank() over (order by a.pts desc, a.ex desc, a.ge asc, a.oh desc)::int, a.user_id, p.display_name, p.avatar_url,
         a.pts, a.ex, a.oh, a.ge, a.n, a.n, a.prov, a.user_id = auth.uid()
  from agg a join public.profiles p on p.id = a.user_id
  where auth.uid() is not null
  order by 1, p.display_name;
$$;

-- ---------------------------------------------------------------------
-- API del administrador
-- ---------------------------------------------------------------------
create or replace function public.admin_pool_list(p_days_back int default 14)
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
      'match_id', m.id, 'kickoff_at', m.kickoff_at, 'status', m.status, 'home_goals', m.home_goals, 'away_goals', m.away_goals,
      'result_confirmed', m.result_confirmed, 'result_source', m.result_source, 'provider', m.provider, 'external_id', case when m.provider = 'manual' then null else m.external_id end,
      'pool_status', pm.status, 'source', pm.source, 'open', private.pool_match_open(m.id), 'closes_at', pm.closes_at,
      'change_reason', pm.change_reason, 'added_at', pm.added_at,
      'competition', case when c.id is null then null else jsonb_build_object('id', c.id, 'name', c.name) end,
      'home', jsonb_build_object('id', ht.id, 'name', ht.name, 'short_name', ht.short_name, 'code', ht.code, 'logo_url', ht.logo_url),
      'away', jsonb_build_object('id', at.id, 'name', at.name, 'short_name', at.short_name, 'code', at.code, 'logo_url', at.logo_url),
      'picks', (select count(*) from public.pool_picks pp where pp.match_id = m.id and pp.status = 'submitted')
    ) order by m.kickoff_at, m.id)
    from public.pool_matches pm
    join public.matches m on m.id = pm.match_id
    join public.teams ht on ht.id = m.home_team_id
    join public.teams at on at.id = m.away_team_id
    left join public.competitions c on c.id = m.competition_id
    where m.kickoff_at >= now() - make_interval(days => greatest(p_days_back, 0))
       or (m.status <> 'finished' or not m.result_confirmed)), '[]'::jsonb);
end;
$$;

-- Publicar en la quiniela un partido existente (p. ej. vinculado con la API).
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
  insert into public.pool_matches (match_id, status, source, added_by) values (p_match_id, 'published', 'admin', v_admin)
  on conflict (match_id) do update set status = 'published', changed_by = v_admin, changed_at = now(), change_reason = 'Publicado por el administrador';
  perform private.log_audit('pool.match_published', 'match', p_match_id::text, '{}'::jsonb);
end;
$$;

create or replace function public.admin_set_pool_status(p_match_id uuid, p_status text, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := private.assert_admin();
  v_old text;
begin
  if p_status not in ('published', 'withdrawn') then perform private.fail('INVALID_STATUS'); end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then perform private.fail('REASON_REQUIRED'); end if;
  select status into v_old from public.pool_matches where match_id = p_match_id for update;
  if v_old is null then perform private.fail('MATCH_NOT_FOUND'); end if;
  update public.pool_matches set status = p_status, changed_by = v_admin, changed_at = now(), change_reason = btrim(p_reason) where match_id = p_match_id;
  perform private.log_audit('pool.match_status', 'match', p_match_id::text, jsonb_build_object('from', v_old, 'to', p_status, 'reason', p_reason));
end;
$$;

-- Catálogo de equipos: búsqueda sin duplicados.
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
  where not t.is_test_data
    and (p_query is null or btrim(p_query) = ''
         or private.team_key(t.name) like '%' || private.team_key(p_query) || '%'
         or t.external_id = btrim(p_query))
  order by (private.team_key(t.name) = private.team_key(p_query)) desc, t.name
  limit 30;
end;
$$;

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
  v_id uuid;
begin
  if char_length(v_name) < 2 or char_length(v_name) > 60 then perform private.fail('INVALID_TEAM'); end if;
  if v_pid is not null and v_pid !~ '^[0-9]{1,10}$' then perform private.fail('INVALID_PROVIDER_ID'); end if;
  if v_logo is not null and v_logo !~ '^https://' then perform private.fail('INVALID_LOGO_URL'); end if;
  -- ¿Ya existe? por id del proveedor o por nombre normalizado
  select t.id into v_id from public.teams t
  where (v_pid is not null and t.provider = 'api-football' and t.external_id = v_pid)
     or private.team_key(t.name) = private.team_key(v_name)
  order by (t.provider = 'api-football') desc limit 1;
  if v_id is not null then
    return jsonb_build_object('id', v_id, 'created', false);
  end if;
  insert into public.teams (provider, external_id, name, short_name, logo_url, is_test_data)
  values (case when v_pid is null then 'manual' else 'api-football' end, coalesce(v_pid, private.team_key(v_name)),
          v_name, left(coalesce(nullif(btrim(p_short_name), ''), v_name), 20), v_logo, false)
  returning id into v_id;
  perform private.log_audit('team.created', 'team', v_id::text, jsonb_build_object('name', v_name, 'provider_id', v_pid, 'logo', v_logo is not null));
  return jsonb_build_object('id', v_id, 'created', true);
end;
$$;

-- Partido añadido por el admin sin identificador del proveedor.
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
  -- Sin duplicados: mismos equipos con inicio a menos de 6 h (de cualquier origen).
  select m.id into v_match from public.matches m
  where m.home_team_id = p_home and m.away_team_id = p_away and abs(extract(epoch from m.kickoff_at - p_kickoff)) <= 6 * 3600
  limit 1;
  if v_match is not null then
    return jsonb_build_object('match_id', v_match, 'created', false);
  end if;
  insert into public.matches (provider, external_id, competition_id, home_team_id, away_team_id, kickoff_at, result_source, is_test_data)
  values ('manual', gen_random_uuid()::text, v_comp, p_home, p_away, p_kickoff, 'admin', false)
  returning id into v_match;
  insert into public.pool_matches (match_id, status, source, added_by) values (v_match, 'published', 'admin', v_admin);
  perform private.log_audit('pool.manual_match_created', 'match', v_match::text, jsonb_build_object('kickoff_at', p_kickoff, 'competition', coalesce(p_competition_name, v_comp::text)));
  return jsonb_build_object('match_id', v_match, 'created', true);
end;
$$;

-- Cambio de horario de un partido manual (auditado; nunca reabre uno empezado).
create or replace function public.admin_update_pool_match(p_match_id uuid, p_kickoff timestamptz, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := private.assert_admin();
  v_m public.matches;
begin
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then perform private.fail('REASON_REQUIRED'); end if;
  select * into v_m from public.matches where id = p_match_id for update;
  if not found then perform private.fail('MATCH_NOT_FOUND'); end if;
  if v_m.provider <> 'manual' then perform private.fail('PROVIDER_MATCH_READONLY'); end if;
  update public.matches set kickoff_at = p_kickoff where id = p_match_id;
  update public.pool_matches set changed_by = v_admin, changed_at = now(), change_reason = btrim(p_reason) where match_id = p_match_id;
  perform private.log_audit('pool.match_rescheduled', 'match', p_match_id::text, jsonb_build_object('from', v_m.kickoff_at, 'to', p_kickoff, 'reason', p_reason));
end;
$$;

-- ---------------------------------------------------------------------
-- Importación automática (rol de servicio, desde sync-results)
-- ---------------------------------------------------------------------
create or replace function public.pool_auto_import(p_provider text, p_fixtures jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_new int;
begin
  if p_fixtures is null or jsonb_typeof(p_fixtures) <> 'array' or jsonb_array_length(p_fixtures) = 0 then
    return jsonb_build_object('imported', 0, 'added', 0);
  end if;
  select array(select (x ->> 0)::uuid from jsonb_array_elements(public.upsert_provider_fixtures(p_provider, p_fixtures, false) -> 'match_ids') x) into v_ids;
  -- Solo partidos por jugar; los retirados por el admin no se vuelven a publicar.
  with ins as (
    insert into public.pool_matches (match_id, status, source)
    select m.id, 'published', 'auto' from public.matches m
    where m.id = any (v_ids) and m.status = 'scheduled' and m.kickoff_at > now()
    on conflict (match_id) do nothing
    returning 1)
  select count(*) into v_new from ins;
  return jsonb_build_object('imported', coalesce(array_length(v_ids, 1), 0), 'added', v_new);
end;
$$;

-- El sincronizador consulta también los partidos de la quiniela continua.
create or replace function public.get_sync_targets(p_horizon_minutes int default 15)
returns table (match_id uuid, provider text, external_id text, kickoff_at timestamptz, status text, last_synced_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct m.id, m.provider, m.external_id, m.kickoff_at, m.status, m.last_synced_at
  from public.matches m
  where m.result_source = 'provider'
    and (exists (select 1 from public.round_matches rm join public.rounds r on r.id = rm.round_id
                 where rm.match_id = m.id and r.status in ('open', 'closed', 'finished', 'under_review'))
         or exists (select 1 from public.pool_matches pm where pm.match_id = m.id and pm.status = 'published'))
    and (m.next_sync_at is null or m.next_sync_at <= now() + make_interval(mins => least(greatest(p_horizon_minutes, 0), 60)))
    and not (m.result_confirmed
             and m.confirmed_at < now() - make_interval(hours => private.setting_int('result_correction_window_hours', 72)))
  order by m.kickoff_at;
$$;

create or replace function public.get_link_candidates(p_days_back int default 1, p_days_ahead int default 1)
returns table (match_id uuid, home text, away text, kickoff_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct m.id, h.name, a.name, m.kickoff_at
  from public.matches m
  join public.teams h on h.id = m.home_team_id
  join public.teams a on a.id = m.away_team_id
  where m.provider = 'manual'
    and (exists (select 1 from public.round_matches rm where rm.match_id = m.id)
         or exists (select 1 from public.pool_matches pm where pm.match_id = m.id and pm.status = 'published'))
    and (m.kickoff_at at time zone 'utc')::date between (now() at time zone 'utc')::date - greatest(p_days_back, 0)
                                                    and (now() at time zone 'utc')::date + greatest(p_days_ahead, 0)
    and (m.last_synced_at is null or m.last_synced_at < now() - interval '3 hours')
  order by m.kickoff_at
  limit 50;
$$;

-- ---------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------
revoke execute on function private.pool_match_open(uuid) from public, anon;
revoke execute on function private.close_started_pool_match() from public, anon, authenticated;
revoke execute on function private.guard_pool_pick() from public, anon, authenticated;
revoke execute on function private.recompute_pool_match(uuid) from public, anon, authenticated;
revoke execute on function private.on_match_result_change() from public, anon, authenticated;
revoke execute on function private.on_pool_status_change() from public, anon, authenticated;
revoke execute on function private.can_pick(uuid, timestamptz) from public, anon, authenticated;
revoke execute on function private.parse_pool_item(jsonb) from public, anon, authenticated;
grant execute on function private.pool_match_open(uuid) to authenticated, service_role;

revoke execute on function public.am_i_admin() from public, anon;
revoke execute on function public.get_pool(int) from public, anon;
revoke execute on function public.save_pool_picks(jsonb) from public, anon;
revoke execute on function public.submit_pool_picks(jsonb) from public, anon;
revoke execute on function public.get_pool_leaderboard() from public, anon;
revoke execute on function public.admin_pool_list(int) from public, anon;
revoke execute on function public.admin_publish_match(uuid) from public, anon;
revoke execute on function public.admin_set_pool_status(uuid, text, text) from public, anon;
revoke execute on function public.admin_search_teams(text) from public, anon;
revoke execute on function public.admin_create_team(text, text, text, text) from public, anon;
revoke execute on function public.admin_create_pool_match(uuid, uuid, timestamptz, uuid, text) from public, anon;
revoke execute on function public.admin_update_pool_match(uuid, timestamptz, text) from public, anon;
revoke execute on function public.pool_auto_import(text, jsonb) from public, anon, authenticated;
revoke execute on function public.get_sync_targets(int) from public, anon, authenticated;
revoke execute on function public.get_link_candidates(int, int) from public, anon, authenticated;

grant execute on function public.am_i_admin() to authenticated;
grant execute on function public.get_pool(int) to authenticated;
grant execute on function public.save_pool_picks(jsonb) to authenticated;
grant execute on function public.submit_pool_picks(jsonb) to authenticated;
grant execute on function public.get_pool_leaderboard() to authenticated;
grant execute on function public.admin_pool_list(int) to authenticated;
grant execute on function public.admin_publish_match(uuid) to authenticated;
grant execute on function public.admin_set_pool_status(uuid, text, text) to authenticated;
grant execute on function public.admin_search_teams(text) to authenticated;
grant execute on function public.admin_create_team(text, text, text, text) to authenticated;
grant execute on function public.admin_create_pool_match(uuid, uuid, timestamptz, uuid, text) to authenticated;
grant execute on function public.admin_update_pool_match(uuid, timestamptz, text) to authenticated;
grant execute on function public.pool_auto_import(text, jsonb) to service_role;
grant execute on function public.get_sync_targets(int) to service_role;
grant execute on function public.get_link_candidates(int, int) to service_role;
