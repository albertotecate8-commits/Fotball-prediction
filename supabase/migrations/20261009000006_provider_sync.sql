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
