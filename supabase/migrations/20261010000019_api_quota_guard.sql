-- =====================================================================
-- Protección de la cuota gratuita de API-Football (100 solicitudes/día).
--
-- * Presupuesto interno: 80 solicitudes por día UTC (00:00 UTC = 18:00 en
--   Ciudad de México), el mismo día calendario con el que reinicia el
--   proveedor. No se usan ventanas móviles de 24 h para el presupuesto diario.
-- * Margen de 20: si el proveedor informa que le quedan 20 o menos, SHABEX
--   deja de consultar aunque su propio contador diga que aún tiene cupo.
-- * Toda solicitud real pasa por provider_reserve (reserva atómica ANTES de
--   salir) y provider_finish (resultado). Las respuestas de caché no cuentan.
-- * Prioridades: 1 en vivo · 2 próximos/finales pendientes · 3 calendario e
--   importación · 4 auxiliares de Inicio · 5 consultas del panel admin.
--   Cada prioridad necesita un saldo mínimo; con poca cuota solo pasa lo vital.
-- Todo es de uso exclusivo del servidor; el admin lo ve con admin_api_usage().
-- =====================================================================

insert into public.app_settings (key, value, description) values
  ('api_daily_budget', '80', 'Presupuesto interno diario de solicitudes a API-Football (máximo 80; día UTC)'),
  ('api_provider_margin', '20', 'Solicitudes del proveedor que nunca se usan (margen de seguridad)'),
  ('api_minute_limit', '8', 'Solicitudes por minuto como máximo (el plan gratuito permite 10)')
on conflict (key) do nothing;

-- El presupuesto nunca puede superar 80 aunque alguien cambie el ajuste.
create or replace function private.api_daily_budget()
returns int language sql stable security definer set search_path = '' as $$
  select least(greatest(private.setting_int('api_daily_budget', 80), 0), 80);
$$;
create or replace function private.api_provider_margin()
returns int language sql stable security definer set search_path = '' as $$
  select greatest(private.setting_int('api_provider_margin', 20), 20);
$$;
create or replace function private.api_minute_limit()
returns int language sql stable security definer set search_path = '' as $$
  select least(greatest(private.setting_int('api_minute_limit', 8), 1), 9);
$$;
-- Saldo mínimo que debe quedar para que pase una solicitud de cada prioridad.
create or replace function private.api_priority_floor(p_priority int)
returns int language sql immutable set search_path = '' as $$
  select case p_priority when 1 then 0 when 2 then 5 when 3 then 15 when 4 then 20 else 30 end;
$$;

-- ---------------------------------------------------------------------
-- Contadores diarios (ampliación de provider_usage, ya existente)
-- ---------------------------------------------------------------------
alter table public.provider_usage add column if not exists succeeded int not null default 0;
alter table public.provider_usage add column if not exists failed int not null default 0;
alter table public.provider_usage add column if not exists blocked int not null default 0;
alter table public.provider_usage add column if not exists cache_hits int not null default 0;
alter table public.provider_usage add column if not exists paused_until timestamptz;
alter table public.provider_usage add column if not exists pause_reason text;
alter table public.provider_usage add column if not exists reported_at timestamptz;
alter table public.provider_usage add column if not exists requests_at_report int;
alter table public.provider_usage add column if not exists provider_current int;
alter table public.provider_usage add column if not exists provider_checked_at timestamptz;
alter table public.provider_usage add column if not exists external_usage boolean not null default false;

-- ---------------------------------------------------------------------
-- Registro de cada solicitud (sin claves ni cabeceras)
-- ---------------------------------------------------------------------
create table if not exists public.provider_requests (
  id                 bigint generated always as identity primary key,
  provider           text not null,
  usage_date         date not null,
  created_at         timestamptz not null default now(),
  finished_at        timestamptz,
  priority           smallint not null,
  purpose            text not null,
  endpoint           text not null,
  counted            boolean not null,
  outcome            text not null check (outcome in ('pending', 'success', 'empty', 'error', 'rate_limited', 'quota_exhausted', 'blocked')),
  block_reason       text,
  http_status        int,
  duration_ms        int,
  results            int,
  reported_remaining int,
  error              text
);
create index if not exists provider_requests_recent_idx on public.provider_requests (provider, created_at desc);
alter table public.provider_requests enable row level security;
revoke all on public.provider_requests from anon, authenticated;

-- Mismo día que usa el proveedor para reiniciar su cuota.
create or replace function private.api_today()
returns date language sql stable set search_path = '' as $$
  select (now() at time zone 'utc')::date;
$$;

-- Estado de la cuota de hoy (sin efectos).
create or replace function private.api_quota_state(p_provider text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.provider_usage;
  v_budget int := private.api_daily_budget();
  v_margin int := private.api_provider_margin();
  v_internal int;
  v_provider int;
  v_effective int;
  v_paused boolean;
begin
  select * into v from public.provider_usage where provider = p_provider and usage_date = private.api_today();
  v_internal := v_budget - coalesce(v.requests, 0);
  -- Estimación del saldo del proveedor: lo último que informó menos lo que
  -- SHABEX consumió después. Solo es una estimación.
  if v.reported_remaining is not null then
    v_provider := v.reported_remaining - greatest(coalesce(v.requests, 0) - coalesce(v.requests_at_report, v.requests, 0), 0);
  end if;
  v_effective := greatest(least(v_internal, coalesce(v_provider - v_margin, v_internal)), 0);
  v_paused := v.paused_until is not null and v.paused_until > now();
  return jsonb_build_object(
    'usage_date', private.api_today(), 'budget', v_budget, 'margin', v_margin, 'used', coalesce(v.requests, 0),
    'remaining_internal', greatest(v_internal, 0), 'provider_remaining_estimate', v_provider, 'provider_reported_at', v.reported_at,
    'provider_limit', v.reported_limit, 'effective_remaining', v_effective,
    'paused', v_paused, 'paused_until', case when v_paused then v.paused_until end, 'pause_reason', case when v_paused then v.pause_reason end,
    'blocked', coalesce(v.blocked, 0), 'succeeded', coalesce(v.succeeded, 0), 'failed', coalesce(v.failed, 0), 'cache_hits', coalesce(v.cache_hits, 0),
    'external_usage', coalesce(v.external_usage, false), 'provider_current', v.provider_current, 'provider_checked_at', v.provider_checked_at
  );
end;
$$;

create or replace function public.provider_quota_state(p_provider text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select private.api_quota_state(p_provider);
$$;

-- ---------------------------------------------------------------------
-- Reserva ANTES de cada solicitud real. Atómica: el bloqueo de la fila del
-- día serializa a todas las funciones que intenten consultar a la vez.
-- p_counted = false solo para /status (el proveedor no lo cuenta), que aun
-- así respeta la pausa y el límite por minuto.
-- ---------------------------------------------------------------------
create or replace function public.provider_reserve(p_provider text, p_priority int, p_purpose text, p_endpoint text, p_counted boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.provider_usage;
  v_today date := private.api_today();
  v_state jsonb;
  v_reason text;
  v_minute int;
  v_id bigint;
  v_prio int := least(greatest(coalesce(p_priority, 5), 1), 5);
begin
  insert into public.provider_usage (provider, usage_date) values (p_provider, v_today)
  on conflict (provider, usage_date) do nothing;
  select * into v from public.provider_usage where provider = p_provider and usage_date = v_today for update;
  v_state := private.api_quota_state(p_provider);

  if v.paused_until is not null and v.paused_until > now() then
    v_reason := 'PAUSED:' || coalesce(v.pause_reason, '?');
  elsif p_counted and (v_state ->> 'effective_remaining')::int <= private.api_priority_floor(v_prio) then
    v_reason := case when (v_state ->> 'effective_remaining')::int <= 0 then 'BUDGET_EXHAUSTED' else 'LOW_BUDGET_P' || v_prio end;
  else
    select count(*) into v_minute from public.provider_requests
     where provider = p_provider and outcome <> 'blocked' and created_at > now() - interval '1 minute';
    if v_minute >= private.api_minute_limit() then v_reason := 'MINUTE_LIMIT'; end if;
  end if;

  if v_reason is not null then
    update public.provider_usage set blocked = blocked + 1 where provider = p_provider and usage_date = v_today;
    insert into public.provider_requests (provider, usage_date, priority, purpose, endpoint, counted, outcome, block_reason, finished_at)
    values (p_provider, v_today, v_prio, left(coalesce(p_purpose, '?'), 40), left(coalesce(p_endpoint, '?'), 200), false, 'blocked', v_reason, now());
    return jsonb_build_object('allowed', false, 'reason', v_reason, 'effective_remaining', (v_state ->> 'effective_remaining')::int);
  end if;

  if p_counted then
    update public.provider_usage set requests = requests + 1, last_request_at = now() where provider = p_provider and usage_date = v_today;
  end if;
  insert into public.provider_requests (provider, usage_date, priority, purpose, endpoint, counted, outcome)
  values (p_provider, v_today, v_prio, left(coalesce(p_purpose, '?'), 40), left(coalesce(p_endpoint, '?'), 200), p_counted, 'pending')
  returning id into v_id;
  return jsonb_build_object('allowed', true, 'request_id', v_id,
    'effective_remaining', (v_state ->> 'effective_remaining')::int - case when p_counted then 1 else 0 end);
end;
$$;

-- Resultado de una solicitud reservada. Solo se aplica una vez.
create or replace function public.provider_finish(
  p_request_id bigint, p_outcome text, p_http_status int, p_remaining int, p_limit int, p_duration_ms int, p_results int, p_error text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req public.provider_requests;
  v_outcome text := case when p_outcome in ('success', 'empty', 'error', 'rate_limited', 'quota_exhausted') then p_outcome else 'error' end;
  v_usage public.provider_usage;
  v_tomorrow timestamptz := ((private.api_today() + 1)::timestamp at time zone 'utc');
begin
  update public.provider_requests
     set outcome = v_outcome, finished_at = now(), http_status = p_http_status, duration_ms = p_duration_ms,
         results = p_results, reported_remaining = p_remaining, error = left(p_error, 300)
   where id = p_request_id and outcome = 'pending'
  returning * into v_req;
  if not found then return jsonb_build_object('applied', false); end if;

  select * into v_usage from public.provider_usage where provider = v_req.provider and usage_date = v_req.usage_date for update;
  update public.provider_usage
     set succeeded = succeeded + case when v_outcome in ('success', 'empty') then 1 else 0 end,
         failed = failed + case when v_outcome in ('success', 'empty') then 0 else 1 end,
         last_error = case when v_outcome in ('success', 'empty') then last_error else left(coalesce(p_error, v_outcome), 500) end,
         reported_remaining = coalesce(p_remaining, reported_remaining),
         reported_limit = coalesce(p_limit, reported_limit),
         reported_at = case when p_remaining is not null then now() else reported_at end,
         requests_at_report = case when p_remaining is not null then requests else requests_at_report end,
         -- El proveedor contó más de lo que SHABEX envió: otra app usa la misma clave.
         external_usage = external_usage or (p_remaining is not null and p_limit is not null and (p_limit - p_remaining) > requests + 3),
         paused_until = case
           when v_outcome = 'quota_exhausted' then v_tomorrow
           when v_outcome = 'rate_limited' then greatest(coalesce(paused_until, now()), now() + interval '2 minutes')
           when p_remaining is not null and p_remaining <= private.api_provider_margin() then v_tomorrow
           else paused_until end,
         pause_reason = case
           when v_outcome = 'quota_exhausted' then 'PROVIDER_DAILY_LIMIT'
           when v_outcome = 'rate_limited' then 'RATE_LIMITED'
           when p_remaining is not null and p_remaining <= private.api_provider_margin() then 'PROVIDER_MARGIN'
           else pause_reason end
   where provider = v_req.provider and usage_date = v_req.usage_date;
  return jsonb_build_object('applied', true);
end;
$$;

-- Lectura servida desde caché: se cuenta aparte, nunca como solicitud.
create or replace function public.provider_cache_hit(p_provider text, p_hits int default 1)
returns void language sql security definer set search_path = '' as $$
  insert into public.provider_usage (provider, usage_date, cache_hits) values (p_provider, private.api_today(), greatest(p_hits, 0))
  on conflict (provider, usage_date) do update set cache_hits = public.provider_usage.cache_hits + greatest(p_hits, 0);
$$;

-- Saldo real informado por /status del proveedor (contraste con el contador interno).
create or replace function public.provider_record_status(p_provider text, p_current int, p_limit int)
returns void language sql security definer set search_path = '' as $$
  insert into public.provider_usage (provider, usage_date) values (p_provider, private.api_today())
  on conflict (provider, usage_date) do nothing;
  update public.provider_usage
     set provider_current = p_current, provider_checked_at = now(),
         reported_limit = coalesce(p_limit, reported_limit),
         reported_remaining = case when p_current is not null and p_limit is not null then greatest(p_limit - p_current, 0) else reported_remaining end,
         reported_at = case when p_current is not null and p_limit is not null then now() else reported_at end,
         requests_at_report = case when p_current is not null and p_limit is not null then requests else requests_at_report end,
         external_usage = external_usage or (p_current is not null and p_current > requests + 3)
   where provider = p_provider and usage_date = private.api_today();
$$;

-- Antigüedad de entradas de caché (para que el planificador decida sin leer el contenido).
create or replace function public.provider_cache_ages(p_provider text, p_keys text[])
returns table (cache_key text, fetched_at timestamptz, expires_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select c.cache_key, c.fetched_at, c.expires_at from public.provider_cache c
  where c.provider = p_provider and c.cache_key = any (p_keys);
$$;

-- Actualiza partidos dentro de un día en caché con datos más recientes (en
-- vivo) sin alargar su vigencia ni gastar solicitudes.
create or replace function public.provider_cache_merge(p_provider text, p_key text, p_fixtures jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload jsonb;
  v_n int;
begin
  select payload into v_payload from public.provider_cache where provider = p_provider and cache_key = p_key for update;
  if v_payload is null or jsonb_typeof(v_payload) <> 'array' then return 0; end if;
  select count(*) into v_n from jsonb_array_elements(v_payload) e
   where exists (select 1 from jsonb_array_elements(p_fixtures) f where f ->> 'external_id' = e ->> 'external_id');
  if v_n = 0 then return 0; end if;
  update public.provider_cache c
     set payload = (select jsonb_agg(coalesce((select f from jsonb_array_elements(p_fixtures) f where f ->> 'external_id' = e ->> 'external_id' limit 1), e) order by ord)
                      from jsonb_array_elements(v_payload) with ordinality as t(e, ord))
   where c.provider = p_provider and c.cache_key = p_key;
  return v_n;
end;
$$;

-- Partidos que SHABEX necesita (quiniela publicada o jornadas activas) en la
-- ventana consultable del plan. Los finales confirmados vienen marcados: el
-- planificador ya no consulta por ellos.
create or replace function public.get_tracked_matches(p_provider text)
returns table (match_id uuid, external_id text, kickoff_at timestamptz, status text, home_goals smallint, away_goals smallint,
               elapsed smallint, status_detail text, result_confirmed boolean, last_synced_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct m.id, m.external_id, m.kickoff_at, m.status, m.home_goals, m.away_goals, m.elapsed, m.status_detail, m.result_confirmed, m.last_synced_at
  from public.matches m
  where m.provider = p_provider
    and m.result_source = 'provider'
    and m.kickoff_at between now() - interval '2 days' and now() + interval '2 days'
    and (exists (select 1 from public.pool_matches pm where pm.match_id = m.id and pm.status = 'published')
         or exists (select 1 from public.round_matches rm join public.rounds r on r.id = rm.round_id
                    where rm.match_id = m.id and r.status in ('open', 'closed', 'finished', 'under_review')))
  order by m.kickoff_at;
$$;

-- Lo que ven los jugadores: cuándo se actualizaron los resultados (sin detalles internos).
create or replace function public.get_results_freshness()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'updated_at', (select max(r.finished_at) from public.sync_runs r where r.provider = 'api-football' and r.status in ('success', 'partial')),
    'delayed', coalesce((private.api_quota_state('api-football') ->> 'paused')::boolean, false)
             or coalesce((private.api_quota_state('api-football') ->> 'effective_remaining')::int, 0) <= 0
  )
  where auth.uid() is not null;
$$;

-- ---------------------------------------------------------------------
-- Panel «Consumo API» (solo el administrador autorizado)
-- ---------------------------------------------------------------------
create or replace function public.admin_api_usage()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_state jsonb;
  v_recent_errors int;
  v_status text;
  v_last_ok timestamptz;
begin
  perform private.assert_admin();
  v_state := private.api_quota_state('api-football');
  select count(*) into v_recent_errors from (
    select outcome from public.provider_requests where provider = 'api-football' and outcome not in ('blocked', 'pending')
    order by created_at desc limit 3) x where outcome not in ('success', 'empty');
  select max(finished_at) into v_last_ok from public.sync_runs where provider = 'api-football' and status = 'success';
  v_status := case
    when (v_state ->> 'paused')::boolean or (v_state ->> 'effective_remaining')::int <= 0 then 'paused'
    when v_recent_errors >= 3 then 'error'
    when (v_state ->> 'effective_remaining')::int <= 20 or (v_state ->> 'external_usage')::boolean then 'low'
    else 'normal' end;
  return v_state || jsonb_build_object(
    'status', v_status,
    'last_success_sync', v_last_ok,
    'live_matches', (select count(*) from public.matches m where m.provider = 'api-football' and m.status in ('live', 'suspended')),
    'live_featured', (select count(*) from public.featured_fixtures f where f.provider = 'api-football' and f.featured_until > now() and f.status = 'live'),
    'history', coalesce((select jsonb_agg(jsonb_build_object('usage_date', u.usage_date, 'requests', u.requests, 'blocked', u.blocked, 'failed', u.failed, 'cache_hits', u.cache_hits) order by u.usage_date desc)
                         from (select * from public.provider_usage where provider = 'api-football' order by usage_date desc limit 7) u), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(jsonb_build_object('at', r.created_at, 'priority', r.priority, 'purpose', r.purpose, 'endpoint', r.endpoint,
                          'counted', r.counted, 'outcome', r.outcome, 'reason', r.block_reason, 'http', r.http_status, 'ms', r.duration_ms,
                          'results', r.results, 'error', r.error) order by r.created_at desc)
                        from (select * from public.provider_requests where provider = 'api-football' order by created_at desc limit 40) r), '[]'::jsonb),
    'server_time', now()
  );
end;
$$;

-- ---------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------
revoke execute on function private.api_daily_budget() from public, anon, authenticated;
revoke execute on function private.api_provider_margin() from public, anon, authenticated;
revoke execute on function private.api_minute_limit() from public, anon, authenticated;
revoke execute on function private.api_priority_floor(int) from public, anon, authenticated;
revoke execute on function private.api_today() from public, anon, authenticated;
revoke execute on function private.api_quota_state(text) from public, anon, authenticated;
revoke execute on function public.provider_quota_state(text) from public, anon, authenticated;
revoke execute on function public.provider_reserve(text, int, text, text, boolean) from public, anon, authenticated;
revoke execute on function public.provider_finish(bigint, text, int, int, int, int, int, text) from public, anon, authenticated;
revoke execute on function public.provider_cache_hit(text, int) from public, anon, authenticated;
revoke execute on function public.provider_record_status(text, int, int) from public, anon, authenticated;
revoke execute on function public.provider_cache_ages(text, text[]) from public, anon, authenticated;
revoke execute on function public.provider_cache_merge(text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.get_tracked_matches(text) from public, anon, authenticated;
revoke execute on function public.get_results_freshness() from public, anon;
revoke execute on function public.admin_api_usage() from public, anon;

grant execute on function public.provider_quota_state(text) to service_role;
grant execute on function public.provider_reserve(text, int, text, text, boolean) to service_role;
grant execute on function public.provider_finish(bigint, text, int, int, int, int, int, text) to service_role;
grant execute on function public.provider_cache_hit(text, int) to service_role;
grant execute on function public.provider_record_status(text, int, int) to service_role;
grant execute on function public.provider_cache_ages(text, text[]) to service_role;
grant execute on function public.provider_cache_merge(text, text, jsonb) to service_role;
grant execute on function public.get_tracked_matches(text) to service_role;
grant execute on function public.get_results_freshness() to authenticated;
grant execute on function public.admin_api_usage() to authenticated;
-- La función antigua de reserva queda sin uso (se conserva por compatibilidad).
revoke execute on function public.provider_take_quota(text, int, int, int) from public, anon, authenticated;
