-- =====================================================================
-- Nunca partidos duplicados.
-- * Si el admin agregó un partido a mano y después llega el oficial (API o
--   calendario adelantado) con los mismos equipos y fecha (±36 h), el oficial
--   «adopta» el registro manual: mismo partido, ahora vinculado al id oficial.
--   Así se conservan sus pronósticos y no aparece dos veces.
-- * Nunca se publican dos veces los mismos equipos en la misma fecha: la
--   selección automática los salta y publicar un gemelo da DUPLICATE_FIXTURE.
-- * Limpieza del caso actual: Real Betis vs Barcelona agregado a mano se
--   retira (sin borrar historial) en favor del oficial.
-- * Confirmar pago en un toque: folio y motivo pasan a ser opcionales (la
--   confirmación sigue siendo manual, del admin, y queda auditada).
-- =====================================================================

-- Mismos equipos (por id o por nombre normalizado) y fecha cercana.
create or replace function private.same_fixture(h1 uuid, a1 uuid, k1 timestamptz, h2 uuid, a2 uuid, k2 timestamptz)
returns boolean language sql stable security definer set search_path = '' as $$
  select abs(extract(epoch from k1 - k2)) <= 36 * 3600
     and (h1 = h2 or private.team_key((select name from public.teams where id = h1)) = private.team_key((select name from public.teams where id = h2)))
     and (a1 = a2 or private.team_key((select name from public.teams where id = a1)) = private.team_key((select name from public.teams where id = a2)));
$$;

-- Partido manual que corresponde a uno oficial que llega por primera vez.
create or replace function private.adopt_manual_twin(p_provider text, p_external_id text, p_home uuid, p_away uuid, p_kickoff timestamptz)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select m.id into v_id from public.matches m
   where m.provider = 'manual' and m.status = 'scheduled' and not m.is_test_data
     and private.same_fixture(m.home_team_id, m.away_team_id, m.kickoff_at, p_home, p_away, p_kickoff)
   order by abs(extract(epoch from m.kickoff_at - p_kickoff)) limit 1
   for update;
  if v_id is null then return null; end if;
  update public.matches
     set provider = p_provider, external_id = p_external_id, home_team_id = p_home, away_team_id = p_away,
         result_source = 'provider', last_sync_error = null
   where id = v_id;
  perform private.log_audit('match.manual_linked', 'match', v_id::text, jsonb_build_object('provider', p_provider, 'external_id', p_external_id));
  return v_id;
end;
$$;

-- ¿Ya hay publicado (o seleccionado) un gemelo de este partido?
create or replace function private.published_twin(p_match uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select o.id from public.matches m
  join public.pool_matches pm on pm.status = 'published' and pm.match_id <> m.id
  join public.matches o on o.id = pm.match_id
  where m.id = p_match and private.same_fixture(m.home_team_id, m.away_team_id, m.kickoff_at, o.home_team_id, o.away_team_id, o.kickoff_at)
  limit 1;
$$;

create or replace function private.guard_duplicate_publish()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from 'published')
     and private.published_twin(new.match_id) is not null then
    raise exception 'DUPLICATE_FIXTURE' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create or replace trigger pool_matches_no_duplicates before insert or update of status on public.pool_matches
  for each row execute function private.guard_duplicate_publish();

-- Importación de partidos del proveedor: adopta el manual antes de crear uno nuevo.
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
    if v_match is null and not p_is_test_data then
      v_match := private.adopt_manual_twin(p_provider, v_fx ->> 'external_id', v_home, v_away, (v_fx ->> 'kickoff_at')::timestamptz);
      if v_match is not null then
        update public.matches set competition_id = coalesce(v_comp, competition_id) where id = v_match;
        perform public.apply_provider_update(v_match, v_fx);
      end if;
    elsif v_match is not null then
      update public.matches set competition_id = coalesce(v_comp, competition_id) where id = v_match;
      perform public.apply_provider_update(v_match, v_fx);
    end if;
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
    end if;
    v_ids := v_ids || v_match;
  end loop;

  return jsonb_build_object('match_ids', to_jsonb(v_ids), 'inserted', v_inserted, 'total', cardinality(v_ids));
end;
$$;

-- Calendario adelantado: igual, adopta el manual en vez de crear otro.
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
  v_linked int := 0;
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
        insert into public.teams (provider, external_id, name, short_name, logo_url, is_test_data)
        values ('api-football', v_fx #>> array[v_side, 'external_id'], left(v_fx #>> array[v_side, 'name'], 60), left(v_fx #>> array[v_side, 'name'], 20),
                'https://media.api-sports.io/football/teams/' || (v_fx #>> array[v_side, 'external_id']) || '.png', false)
        on conflict (provider, external_id) do nothing returning id into v_team;
        if v_team is null then select id into v_team from public.teams where provider = 'api-football' and external_id = v_fx #>> array[v_side, 'external_id']; end if;
      end if;
      if v_side = 'home' then v_home := v_team; else v_away := v_team; end if;
    end loop;
    if v_home = v_away then v_skipped := v_skipped + 1; continue; end if;
    v_match := private.adopt_manual_twin('api-football', v_fx ->> 'external_id', v_home, v_away, v_ko);
    if v_match is not null then
      update public.matches set kickoff_at = v_ko, competition_id = coalesce(v_comp, competition_id) where id = v_match;
      v_linked := v_linked + 1; v_ids := v_ids || v_match; continue;
    end if;
    insert into public.matches (provider, external_id, competition_id, home_team_id, away_team_id, kickoff_at, status, status_detail, is_test_data)
    values ('api-football', v_fx ->> 'external_id', v_comp, v_home, v_away, v_ko, 'scheduled', 'NS', false)
    on conflict do nothing
    returning id into v_match;
    if v_match is not null then v_new := v_new + 1; v_ids := v_ids || v_match; end if;
  end loop;
  return jsonb_build_object('received', jsonb_array_length(p_fixtures), 'new_matches', v_new, 'linked_manual', v_linked, 'skipped', v_skipped) || private.suggest_and_fill(v_ids);
end;
$$;

-- Agregar a mano un partido que ya existe (oficial o manual) reutiliza ese registro.
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
  where m.status in ('scheduled', 'live', 'finished') and not m.is_test_data
    and private.same_fixture(m.home_team_id, m.away_team_id, m.kickoff_at, p_home, p_away, p_kickoff)
  order by (m.provider <> 'manual') desc, abs(extract(epoch from m.kickoff_at - p_kickoff))
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

-- La selección automática salta partidos cuyo gemelo ya está seleccionado o publicado.
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
  v_next int;
  r record;
begin
  select * into w from public.pool_weeks where id = p_week for update;
  if not found or w.auto_mode = 'off' then return 0; end if;
  for r in
    select m.id, private.week_fit(w, m.id) as fit
    from public.matches m
    where m.provider = 'api-football' and m.status = 'scheduled' and m.kickoff_at > now()
      and private.local_day(m.kickoff_at) between w.week_start and w.week_start + 6
      and private.week_fit(w, m.id) is not null
      and not private.match_has_retired_team(m.id)
      and not exists (select 1 from public.pool_candidates c where c.match_id = m.id and (c.state <> 'suggested' or c.updated_by is not null))
      and not exists (select 1 from public.pool_matches pm where pm.match_id = m.id and pm.status = 'withdrawn')
      and not exists (select 1 from public.pool_candidates c2 join public.matches o on o.id = c2.match_id
                      where c2.state = 'selected' and o.id <> m.id
                        and private.same_fixture(m.home_team_id, m.away_team_id, m.kickoff_at, o.home_team_id, o.away_team_id, o.kickoff_at))
    order by (private.week_fit(w, m.id) = 'team') desc, m.kickoff_at, m.id
  loop
    select count(*) into v_used from public.pool_candidates c join public.matches m on m.id = c.match_id
     where c.state = 'selected' and private.local_day(m.kickoff_at) between w.week_start and w.week_start + 6;
    select count(*) into v_reserved from unnest(w.team_ids) t(ext)
     where not exists (select 1 from public.pool_candidates c join public.matches m on m.id = c.match_id
                       join public.teams ht on ht.id = m.home_team_id join public.teams at on at.id = m.away_team_id
                       where c.state = 'selected' and private.local_day(m.kickoff_at) between w.week_start and w.week_start + 6
                         and (ht.external_id = t.ext or at.external_id = t.ext));
    exit when v_used >= w.max_matches;
    continue when r.fit = 'league' and v_used >= w.max_matches - v_reserved;
    select coalesce(max(c.sort_order), 0) + 1 into v_next from public.pool_candidates c where c.state = 'selected';
    insert into public.pool_candidates (match_id, state, source, sort_order)
    values (r.id, 'selected', 'auto', v_next)
    on conflict (match_id) do update set state = 'selected', sort_order = excluded.sort_order, updated_at = now()
      where public.pool_candidates.state = 'suggested' and public.pool_candidates.updated_by is null;
    v_added := v_added + 1;
  end loop;

  if w.auto_mode = 'publish' then
    insert into public.pool_matches (match_id, status, source, sort_order, week_id)
    select c.match_id, 'published', c.source, c.sort_order, w.id
    from public.pool_candidates c join public.matches m on m.id = c.match_id
    where c.state = 'selected' and m.status = 'scheduled' and m.kickoff_at > now()
      and private.local_day(m.kickoff_at) between w.week_start and w.week_start + 6
      and not exists (select 1 from public.pool_matches pm where pm.match_id = c.match_id)
      and private.published_twin(c.match_id) is null
    on conflict (match_id) do nothing;
  end if;
  return v_added;
end;
$$;

revoke execute on function private.same_fixture(uuid, uuid, timestamptz, uuid, uuid, timestamptz) from public, anon, authenticated;
revoke execute on function private.adopt_manual_twin(text, text, uuid, uuid, timestamptz) from public, anon, authenticated;
revoke execute on function private.published_twin(uuid) from public, anon, authenticated;
revoke execute on function private.guard_duplicate_publish() from public, anon, authenticated;

-- Confirmar pago en un toque: folio y motivo opcionales; sigue siendo manual y auditado.
create or replace function public.admin_confirm_payment(
  p_user uuid, p_status text, p_valid_until timestamptz, p_amount numeric, p_method text, p_bank_reference text, p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := private.assert_admin();
  v_group uuid := private.default_group_id();
  v_old public.group_members;
  v_ref text := private.ensure_payment_reference(p_user);
  v_amount numeric := coalesce(p_amount, (select p.amount from public.payment_info p order by p.id limit 1));
  v_bank text := nullif(left(btrim(coalesce(p_bank_reference, '')), 120), '');
  v_reason text := coalesce(nullif(btrim(coalesce(p_reason, '')), ''),
                            case p_status when 'authorized' then 'Pago confirmado por el administrador' else 'Cambio de pago por el administrador' end);
begin
  if p_status not in ('pending', 'authorized', 'rejected', 'not_applicable') then perform private.fail('INVALID_PAYMENT_STATUS'); end if;
  if p_status = 'authorized' then
    if p_valid_until is not null and p_valid_until <= now() then perform private.fail('PAYMENT_VALIDITY_IN_PAST'); end if;
    if p_amount is not null and p_amount <= 0 then perform private.fail('INVALID_AMOUNT'); end if;
  end if;
  select * into v_old from public.group_members where group_id = v_group and user_id = p_user for update;
  if not found then perform private.fail('USER_NOT_IN_GROUP'); end if;

  perform set_config('shabex.payment_rpc', 'on', true);
  update public.group_members
     set payment_status = p_status,
         payment_valid_until = case when p_status = 'authorized' then p_valid_until end,
         payment_reference = case when p_status = 'authorized' then coalesce(v_bank, v_ref) else payment_reference end,
         payment_method = case when p_status = 'authorized' then nullif(left(btrim(coalesce(p_method, '')), 40), '') else payment_method end,
         payment_amount = case when p_status = 'authorized' then v_amount end,
         payment_confirmed_by = case when p_status = 'authorized' then v_admin end,
         payment_confirmed_at = case when p_status = 'authorized' then now() end
   where group_id = v_group and user_id = p_user;
  perform set_config('shabex.payment_rpc', 'off', true);

  perform private.log_audit('member.payment_changed', 'group_member', v_group::text || ':' || p_user::text,
    jsonb_build_object('from', v_old.payment_status, 'to', p_status, 'reference', v_ref, 'bank_reference', v_bank,
                       'amount', case when p_status = 'authorized' then v_amount end, 'method', p_method, 'valid_until', p_valid_until, 'reason', left(v_reason, 300)));
  return jsonb_build_object('reference', v_ref, 'state', private.payment_state(p_status, p_valid_until), 'amount', case when p_status = 'authorized' then v_amount end);
end;
$$;

-- Limpieza del duplicado actual (solo existe en producción): se retira el
-- Real Betis vs Barcelona agregado a mano y se conserva el oficial.
do $$
declare
  v_manual uuid := 'b871031a-edb2-4c3e-a407-fd5349800706';
begin
  if exists (select 1 from public.matches where id = v_manual and provider = 'manual') then
    update public.pool_matches set status = 'withdrawn', changed_at = now(),
           change_reason = 'Duplicado: se conserva el partido oficial (API-Football #1570413)'
     where match_id = v_manual and status = 'published';
    update public.pool_candidates set state = 'dismissed', updated_at = now() where match_id = v_manual;
    perform private.log_audit('match.duplicate_withdrawn', 'match', v_manual::text, jsonb_build_object('kept', '71e1c095-135d-49fc-874b-d2ab711cdbde'));
  end if;
end;
$$;
