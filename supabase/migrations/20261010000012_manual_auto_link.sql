-- =====================================================================
-- Vinculación automática de partidos manuales. El plan gratuito del
-- proveedor solo consulta fechas cercanas (ayer, hoy y mañana), así que el
-- admin puede capturar la jornada con días de anticipación y el
-- sincronizador vincula cada partido cuando entra en esa ventana.
-- La vinculación conserva el id del partido: los pronósticos no se tocan.
-- =====================================================================

-- Partidos manuales de jornadas (incluidas las de borrador) que ya pueden
-- buscarse en el proveedor. Como máximo un intento cada 3 h por partido.
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
  join public.round_matches rm on rm.match_id = m.id
  where m.provider = 'manual'
    and (m.kickoff_at at time zone 'utc')::date between (now() at time zone 'utc')::date - greatest(p_days_back, 0)
                                                    and (now() at time zone 'utc')::date + greatest(p_days_ahead, 0)
    and (m.last_synced_at is null or m.last_synced_at < now() - interval '3 hours')
  order by m.kickoff_at
  limit 50;
$$;

create or replace function public.link_manual_match(p_match_id uuid, p_provider text, p_fixture jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.matches;
  v_existing uuid;
  v_comp uuid;
  v_home uuid;
  v_away uuid;
begin
  select * into v_old from public.matches where id = p_match_id for update;
  if not found or v_old.provider <> 'manual' then
    return jsonb_build_object('linked', false, 'reason', 'NOT_MANUAL');
  end if;

  select id into v_existing from public.matches where provider = p_provider and external_id = p_fixture ->> 'external_id';
  if v_existing is not null then
    -- Ya existe ese partido del proveedor: no se crea un duplicado. Queda para el admin.
    update public.matches set last_synced_at = now(), last_sync_error = 'PROVIDER_MATCH_ALREADY_IMPORTED' where id = p_match_id;
    return jsonb_build_object('linked', false, 'reason', 'ALREADY_IMPORTED', 'existing_match_id', v_existing);
  end if;

  if jsonb_typeof(p_fixture -> 'competition') = 'object' then
    insert into public.competitions (provider, external_id, name, country, season, logo_url, is_test_data)
    values (p_provider, p_fixture #>> '{competition,external_id}', p_fixture #>> '{competition,name}',
            p_fixture #>> '{competition,country}', p_fixture #>> '{competition,season}', p_fixture #>> '{competition,logo_url}', v_old.is_test_data)
    on conflict (provider, external_id) do update set name = excluded.name
    returning id into v_comp;
  end if;
  insert into public.teams (provider, external_id, name, short_name, logo_url, is_test_data)
  values (p_provider, p_fixture #>> '{home,external_id}', p_fixture #>> '{home,name}',
          coalesce(p_fixture #>> '{home,short_name}', p_fixture #>> '{home,name}'), p_fixture #>> '{home,logo_url}', v_old.is_test_data)
  on conflict (provider, external_id) do update set name = excluded.name
  returning id into v_home;
  insert into public.teams (provider, external_id, name, short_name, logo_url, is_test_data)
  values (p_provider, p_fixture #>> '{away,external_id}', p_fixture #>> '{away,name}',
          coalesce(p_fixture #>> '{away,short_name}', p_fixture #>> '{away,name}'), p_fixture #>> '{away,logo_url}', v_old.is_test_data)
  on conflict (provider, external_id) do update set name = excluded.name
  returning id into v_away;

  -- Mismo id: jornadas y pronósticos siguen apuntando al mismo partido.
  -- Si el admin ya registró el resultado, se respeta (result_source = 'admin').
  update public.matches
     set provider = p_provider,
         external_id = p_fixture ->> 'external_id',
         competition_id = coalesce(v_comp, competition_id),
         home_team_id = v_home,
         away_team_id = v_away,
         result_source = case when v_old.result_confirmed then 'admin' else 'provider' end,
         last_sync_error = null
   where id = p_match_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, details)
  values (null, 'match.manual_auto_linked', 'match', p_match_id::text, jsonb_build_object(
    'provider', p_provider, 'external_id', p_fixture ->> 'external_id',
    'manual', jsonb_build_object('kickoff_at', v_old.kickoff_at),
    'provider_kickoff_at', p_fixture ->> 'kickoff_at'));

  -- Estado, horario y marcador del proveedor, con su historial.
  perform public.apply_provider_update(p_match_id, p_fixture);
  return jsonb_build_object('linked', true);
end;
$$;

create or replace function public.record_link_attempt(p_match_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.matches set last_synced_at = now(), last_sync_error = 'NOT_FOUND_IN_PROVIDER_YET'
   where id = p_match_id and provider = 'manual';
$$;

revoke execute on function public.get_link_candidates(int, int) from public, anon, authenticated;
revoke execute on function public.link_manual_match(uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function public.record_link_attempt(uuid) from public, anon, authenticated;
grant execute on function public.get_link_candidates(int, int) to service_role;
grant execute on function public.link_manual_match(uuid, text, jsonb) to service_role;
grant execute on function public.record_link_attempt(uuid) to service_role;
