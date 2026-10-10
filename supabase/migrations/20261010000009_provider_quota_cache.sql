-- =====================================================================
-- Proveedor deportivo real: protección de la cuota gratuita, caché de
-- respuestas, exclusión de sincronizaciones simultáneas y frecuencia de
-- consulta adaptativa por partido. Todo es de uso exclusivo del servidor.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Frecuencia adaptativa: cada partido sabe cuándo debe consultarse otra vez
-- ---------------------------------------------------------------------
alter table public.matches add column if not exists next_sync_at timestamptz;
alter table public.matches add column if not exists sync_failures smallint not null default 0;
create index if not exists matches_next_sync_idx on public.matches (next_sync_at);

create or replace function private.next_sync_for(p_status text, p_kickoff timestamptz, p_confirmed boolean)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select case
    -- en juego o suspendido: lo más frecuente que permite la cuota (cron cada 10 min)
    when p_status in ('live', 'suspended') then now() + interval '10 minutes'
    -- final confirmado: solo vigilar correcciones
    when p_status = 'finished' and p_confirmed then now() + interval '6 hours'
    -- final sin marcador completo del proveedor: reintentar pronto
    when p_status = 'finished' then now() + interval '15 minutes'
    when p_status = 'postponed' then now() + interval '12 hours'
    when p_status in ('cancelled', 'abandoned') then now() + interval '24 hours'
    -- programado y ya debería haber empezado: esperar el inicio real
    when p_kickoff <= now() + interval '15 minutes' then now() + interval '10 minutes'
    -- faltan menos de 24 h: revisar cambios de horario cada 3 h, sin pasar del inicio
    when p_kickoff <= now() + interval '24 hours' then least(p_kickoff, now() + interval '3 hours')
    -- futuro lejano: una vez al día
    else least(p_kickoff - interval '1 hour', now() + interval '24 hours')
  end;
$$;

-- Se recalcula cada vez que el sincronizador toca el partido (last_synced_at)
-- o cambian su horario o su estado. Un error de sincronización aplica espera
-- progresiva (10, 20, 40… min, máx. 6 h).
create or replace function private.schedule_next_sync()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.last_synced_at is distinct from old.last_synced_at and new.last_sync_error is not null then
    new.sync_failures := least(coalesce(new.sync_failures, 0) + 1, 10);
    new.next_sync_at := now() + least(interval '6 hours', interval '10 minutes' * power(2, new.sync_failures - 1));
  elsif tg_op = 'INSERT'
     or new.last_synced_at is distinct from old.last_synced_at
     or new.kickoff_at is distinct from old.kickoff_at
     or new.status is distinct from old.status then
    if tg_op = 'INSERT' or new.last_synced_at is distinct from old.last_synced_at then
      new.sync_failures := 0;
    end if;
    new.next_sync_at := private.next_sync_for(new.status, new.kickoff_at, new.result_confirmed);
  end if;
  return new;
end;
$$;

create or replace trigger matches_schedule_next_sync before insert or update on public.matches
  for each row execute function private.schedule_next_sync();

-- Partidos que toca consultar ahora (los que no, esperan su turno).
create or replace function public.get_sync_targets(p_horizon_minutes int default 15)
returns table (match_id uuid, provider text, external_id text, kickoff_at timestamptz, status text, last_synced_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  -- p_horizon_minutes: tolerancia para adelantar consultas cercanas y agruparlas en una sola solicitud.
  select distinct m.id, m.provider, m.external_id, m.kickoff_at, m.status, m.last_synced_at
  from public.matches m
  join public.round_matches rm on rm.match_id = m.id
  join public.rounds r on r.id = rm.round_id
  where r.status in ('open', 'closed', 'finished', 'under_review')
    and m.result_source = 'provider'
    and (m.next_sync_at is null or m.next_sync_at <= now() + make_interval(mins => least(greatest(p_horizon_minutes, 0), 60)))
    and not (m.result_confirmed
             and m.confirmed_at < now() - make_interval(hours => private.setting_int('result_correction_window_hours', 72)))
  order by m.kickoff_at;
$$;

-- ---------------------------------------------------------------------
-- Consumo de la API: presupuesto diario (día UTC) y por minuto
-- ---------------------------------------------------------------------
create table if not exists public.provider_usage (
  provider           text not null,
  usage_date         date not null,
  requests           int not null default 0 check (requests >= 0),
  minute_window      timestamptz,
  minute_requests    int not null default 0,
  reported_remaining int,
  reported_limit     int,
  last_request_at    timestamptz,
  last_error         text,
  primary key (provider, usage_date)
);

alter table public.provider_usage enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'provider_usage' and policyname = 'provider_usage_read') then
    create policy provider_usage_read on public.provider_usage
      for select to authenticated using (private.is_admin());
  end if;
end $$;
revoke all on public.provider_usage from anon;
revoke insert, update, delete, truncate on public.provider_usage from authenticated;
grant select on public.provider_usage to authenticated;

-- Reserva atómica de una solicitud. Respeta el presupuesto propio y, si el
-- proveedor informó cuántas quedan, nunca baja de la reserva mínima.
create or replace function public.provider_take_quota(p_provider text, p_daily_budget int, p_minute_budget int, p_reserve int default 5)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.provider_usage;
  v_today date := (now() at time zone 'utc')::date;
begin
  insert into public.provider_usage (provider, usage_date) values (p_provider, v_today)
  on conflict (provider, usage_date) do nothing;
  select * into v_row from public.provider_usage where provider = p_provider and usage_date = v_today for update;

  if v_row.requests >= p_daily_budget then
    return jsonb_build_object('allowed', false, 'reason', 'DAILY_BUDGET', 'used', v_row.requests, 'budget', p_daily_budget);
  end if;
  if v_row.reported_remaining is not null and v_row.reported_remaining <= p_reserve then
    return jsonb_build_object('allowed', false, 'reason', 'PROVIDER_QUOTA_LOW', 'remaining', v_row.reported_remaining);
  end if;
  if v_row.minute_window is not null and v_row.minute_window > now() - interval '1 minute'
     and v_row.minute_requests >= p_minute_budget then
    return jsonb_build_object('allowed', false, 'reason', 'MINUTE_BUDGET', 'used', v_row.requests);
  end if;

  update public.provider_usage
     set requests = requests + 1,
         minute_window = case when minute_window is null or minute_window <= now() - interval '1 minute' then now() else minute_window end,
         minute_requests = case when minute_window is null or minute_window <= now() - interval '1 minute' then 1 else minute_requests + 1 end,
         last_request_at = now()
   where provider = p_provider and usage_date = v_today;
  return jsonb_build_object('allowed', true, 'used', v_row.requests + 1, 'budget', p_daily_budget);
end;
$$;

-- Lo que el proveedor informa en sus cabeceras (solicitudes restantes del día).
create or replace function public.provider_report_quota(p_provider text, p_remaining int, p_limit int, p_error text default null)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.provider_usage (provider, usage_date, reported_remaining, reported_limit, last_error)
  values (p_provider, (now() at time zone 'utc')::date, p_remaining, p_limit, left(p_error, 500))
  on conflict (provider, usage_date) do update
    set reported_remaining = coalesce(excluded.reported_remaining, public.provider_usage.reported_remaining),
        reported_limit = coalesce(excluded.reported_limit, public.provider_usage.reported_limit),
        last_error = excluded.last_error;
$$;

-- ---------------------------------------------------------------------
-- Caché de respuestas (búsquedas del admin, lista de competiciones)
-- ---------------------------------------------------------------------
create table if not exists public.provider_cache (
  provider   text not null,
  cache_key  text not null,
  payload    jsonb not null,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (provider, cache_key)
);

alter table public.provider_cache enable row level security;
revoke all on public.provider_cache from anon, authenticated;

create or replace function public.provider_cache_get(p_provider text, p_key text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select c.payload from public.provider_cache c
  where c.provider = p_provider and c.cache_key = p_key and c.expires_at > now();
$$;

create or replace function public.provider_cache_put(p_provider text, p_key text, p_payload jsonb, p_ttl_seconds int)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.provider_cache (provider, cache_key, payload, fetched_at, expires_at)
  values (p_provider, left(p_key, 500), p_payload, now(), now() + make_interval(secs => greatest(p_ttl_seconds, 60)))
  on conflict (provider, cache_key) do update
    set payload = excluded.payload, fetched_at = excluded.fetched_at, expires_at = excluded.expires_at;
$$;

-- ---------------------------------------------------------------------
-- Candado de sincronización: evita ejecuciones simultáneas (cron + admin)
-- ---------------------------------------------------------------------
create table if not exists public.sync_leases (
  name       text primary key,
  holder     text not null,
  expires_at timestamptz not null
);

alter table public.sync_leases enable row level security;
revoke all on public.sync_leases from anon, authenticated;

create or replace function public.acquire_sync_lease(p_name text, p_holder text, p_seconds int)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_holder text;
begin
  insert into public.sync_leases (name, holder, expires_at)
  values (p_name, p_holder, now() + make_interval(secs => p_seconds))
  on conflict (name) do update
    set holder = excluded.holder, expires_at = excluded.expires_at
    where public.sync_leases.expires_at <= now()
  returning holder into v_holder;
  return coalesce(v_holder = p_holder, false);
end;
$$;

create or replace function public.release_sync_lease(p_name text, p_holder text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.sync_leases set expires_at = now() where name = p_name and holder = p_holder;
$$;

-- ---------------------------------------------------------------------
-- Una jornada no mezcla partidos reales con partidos de prueba
-- ---------------------------------------------------------------------
create or replace function private.guard_round_data_kind()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.round_matches rm
    join public.matches existing on existing.id = rm.match_id
    join public.matches incoming on incoming.id = new.match_id
    where rm.round_id = new.round_id and rm.match_id <> new.match_id
      and existing.is_test_data <> incoming.is_test_data
  ) then
    raise exception 'MIXED_TEST_DATA' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create or replace trigger round_matches_data_kind before insert on public.round_matches
  for each row execute function private.guard_round_data_kind();

-- ---------------------------------------------------------------------
-- Permisos: solo el rol de servicio (Edge Functions)
-- ---------------------------------------------------------------------
revoke execute on function private.next_sync_for(text, timestamptz, boolean) from public, anon, authenticated;
revoke execute on function public.get_sync_targets(int) from public, anon, authenticated;
revoke execute on function public.provider_take_quota(text, int, int, int) from public, anon, authenticated;
revoke execute on function public.provider_report_quota(text, int, int, text) from public, anon, authenticated;
revoke execute on function public.provider_cache_get(text, text) from public, anon, authenticated;
revoke execute on function public.provider_cache_put(text, text, jsonb, int) from public, anon, authenticated;
revoke execute on function public.acquire_sync_lease(text, text, int) from public, anon, authenticated;
revoke execute on function public.release_sync_lease(text, text) from public, anon, authenticated;

grant execute on function public.get_sync_targets(int) to service_role;
grant execute on function public.provider_take_quota(text, int, int, int) to service_role;
grant execute on function public.provider_report_quota(text, int, int, text) to service_role;
grant execute on function public.provider_cache_get(text, text) to service_role;
grant execute on function public.provider_cache_put(text, text, jsonb, int) to service_role;
grant execute on function public.acquire_sync_lease(text, text, int) to service_role;
grant execute on function public.release_sync_lease(text, text) to service_role;
