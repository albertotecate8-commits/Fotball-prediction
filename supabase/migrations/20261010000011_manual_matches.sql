-- =====================================================================
-- Partidos capturados a mano. La Edge Function provider-fixtures primero
-- intenta vincularlos con el proveedor (equipos, fecha y competición); solo
-- si el admin lo pide explícitamente se crea un partido SIN proveedor, cuyo
-- resultado registra el admin. Nunca se duplica un partido.
-- =====================================================================

create or replace function private.team_key(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select left(regexp_replace(lower(translate(btrim(p_name),
    'ÁÀÄÂÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛÑáàäâéèëêíìïîóòöôúùüûñ', 'AAAAEEEEIIIIOOOOUUUUNaaaaeeeeiiiioooouuuun')), '[^a-z0-9]+', '-', 'g'), 60);
$$;

create or replace function public.create_manual_match(p_home text, p_away text, p_kickoff timestamptz, p_competition text, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_home uuid; v_away uuid; v_comp uuid; v_match uuid;
begin
  if char_length(btrim(coalesce(p_home, ''))) < 2 or char_length(btrim(coalesce(p_away, ''))) < 2
     or private.team_key(p_home) = private.team_key(p_away) or p_kickoff is null then
    perform private.fail('INVALID_MATCH');
  end if;

  insert into public.teams (provider, external_id, name, short_name, is_test_data)
  values ('manual', private.team_key(p_home), left(btrim(p_home), 60), left(btrim(p_home), 20), false)
  on conflict (provider, external_id) do update set name = public.teams.name
  returning id into v_home;
  insert into public.teams (provider, external_id, name, short_name, is_test_data)
  values ('manual', private.team_key(p_away), left(btrim(p_away), 60), left(btrim(p_away), 20), false)
  on conflict (provider, external_id) do update set name = public.teams.name
  returning id into v_away;

  if char_length(btrim(coalesce(p_competition, ''))) >= 2 then
    insert into public.competitions (provider, external_id, name, is_test_data)
    values ('manual', private.team_key(p_competition), left(btrim(p_competition), 80), false)
    on conflict (provider, external_id) do update set name = public.competitions.name
    returning id into v_comp;
  end if;

  -- Sin duplicados: mismo par de equipos con inicio a menos de 6 h.
  select m.id into v_match from public.matches m
  where m.provider = 'manual' and m.home_team_id = v_home and m.away_team_id = v_away
    and abs(extract(epoch from m.kickoff_at - p_kickoff)) <= 6 * 3600
  limit 1;
  if v_match is not null then
    return jsonb_build_object('match_id', v_match, 'created', false);
  end if;

  insert into public.matches (provider, external_id, competition_id, home_team_id, away_team_id, kickoff_at, result_source, is_test_data)
  values ('manual', gen_random_uuid()::text, v_comp, v_home, v_away, p_kickoff, 'admin', false)
  returning id into v_match;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, details)
  values (p_actor, 'match.manual_created', 'match', v_match::text,
          jsonb_build_object('home', p_home, 'away', p_away, 'kickoff_at', p_kickoff, 'competition', p_competition));
  return jsonb_build_object('match_id', v_match, 'created', true);
end;
$$;

revoke execute on function private.team_key(text) from public, anon, authenticated;
revoke execute on function public.create_manual_match(text, text, timestamptz, text, uuid) from public, anon, authenticated;
grant execute on function public.create_manual_match(text, text, timestamptz, text, uuid) to service_role;
