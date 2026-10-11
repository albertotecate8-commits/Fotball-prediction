-- =====================================================================
-- Quinielas automáticas por semana + control por partido.
--
-- Cada semana planificada (lunes a domingo, CDMX) tiene un modo:
--   * 'publish' → la app SELECCIONA y PUBLICA sola los partidos reales que
--                 cumplen el plan (ligas/equipos/cupo) a medida que el
--                 proveedor los da a conocer.
--   * 'select'  → la app los selecciona; el admin revisa y publica.
--   * 'off'     → el plan no hace nada (todo a mano, partido por partido).
-- El admin siempre puede agregar o quitar partidos sueltos. Lo que el admin
-- quitó o retiró nunca vuelve a entrar solo. Nunca se inventan partidos.
-- =====================================================================

alter table public.pool_weeks add column if not exists auto_mode text not null default 'select';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'pool_weeks_auto_mode_check') then
    alter table public.pool_weeks add constraint pool_weeks_auto_mode_check check (auto_mode in ('off', 'select', 'publish'));
  end if;
end $$;

-- Llena el cupo de la semana con los partidos ya conocidos (sin consultar al proveedor).
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
      -- Decisiones del admin (quitado, descartado, retirado) se respetan.
      and not exists (select 1 from public.pool_candidates c where c.match_id = m.id and (c.state <> 'suggested' or c.updated_by is not null))
      and not exists (select 1 from public.pool_matches pm where pm.match_id = m.id and pm.status = 'withdrawn')
    order by (private.week_fit(w, m.id) = 'team') desc, m.kickoff_at, m.id
  loop
    select count(*) into v_used from public.pool_candidates c join public.matches m on m.id = c.match_id
     where c.state = 'selected' and private.local_day(m.kickoff_at) between w.week_start and w.week_start + 6;
    -- Lugares guardados para equipos cuyo partido aún no aparece.
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

  -- Modo automático: lo seleccionado de la semana se publica solo (cada partido cierra a su hora).
  if w.auto_mode = 'publish' then
    insert into public.pool_matches (match_id, status, source, sort_order, week_id)
    select c.match_id, 'published', c.source, c.sort_order, w.id
    from public.pool_candidates c join public.matches m on m.id = c.match_id
    where c.state = 'selected' and m.status = 'scheduled' and m.kickoff_at > now()
      and private.local_day(m.kickoff_at) between w.week_start and w.week_start + 6
      and not exists (select 1 from public.pool_matches pm where pm.match_id = c.match_id)
    on conflict (match_id) do nothing;
  end if;
  return v_added;
end;
$$;

-- Importación automática: sugiere todo lo de las fuentes y aplica el plan de la semana.
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
    return jsonb_build_object('imported', 0, 'added', 0, 'suggested', 0, 'week_selected', 0);
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
  update public.pool_candidates set needs_review = false, review_reason = null, updated_at = now()
   where match_id = any (v_ids) and review_reason = 'NOT_IN_PROVIDER';
  for w in select distinct (private.week_for(m.kickoff_at)).id as id from public.matches m where m.id = any (v_ids) loop
    if w.id is not null then v_week := v_week + private.fill_week(w.id); end if;
  end loop;
  return jsonb_build_object('imported', coalesce(array_length(v_ids, 1), 0), 'added', 0, 'suggested', v_new, 'week_selected', v_week);
end;
$$;

-- Modo de una semana: automática, solo seleccionar o apagada.
create or replace function public.admin_set_week_mode(p_week uuid, p_mode text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := private.assert_admin();
  v_added int;
begin
  if p_mode is null or p_mode not in ('off', 'select', 'publish') then perform private.fail('INVALID_MODE'); end if;
  update public.pool_weeks set auto_mode = p_mode, updated_at = now() where id = p_week;
  if not found then perform private.fail('WEEK_NOT_FOUND'); end if;
  v_added := private.fill_week(p_week);
  perform private.log_audit('pool.week_mode', 'pool_week', p_week::text, jsonb_build_object('mode', p_mode, 'selected_now', v_added, 'by', v_admin));
  return jsonb_build_object('mode', p_mode, 'selected_now', v_added);
end;
$$;

-- Semanas planificadas con su avance y las fuentes disponibles.
create or replace function public.admin_week_plans()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_admin();
  return jsonb_build_object(
    'plans', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', w.id, 'week_start', w.week_start, 'week_end', w.week_start + 6, 'label', w.label, 'max_matches', w.max_matches,
        'team_ids', w.team_ids, 'league_ids', w.league_ids, 'team_weekend_only', w.team_weekend_only, 'auto_mode', w.auto_mode,
        'selected', (select count(*) from public.pool_candidates c join public.matches m on m.id = c.match_id
                     where c.state = 'selected' and private.local_day(m.kickoff_at) between w.week_start and w.week_start + 6),
        'published', (select count(*) from public.pool_matches pm join public.matches m on m.id = pm.match_id
                      where pm.status = 'published' and private.local_day(m.kickoff_at) between w.week_start and w.week_start + 6),
        'teams_found', (select coalesce(jsonb_agg(distinct t.ext), '[]'::jsonb) from unnest(w.team_ids) t(ext)
                        where exists (select 1 from public.pool_candidates c join public.matches m on m.id = c.match_id
                                      join public.teams ht on ht.id = m.home_team_id join public.teams at on at.id = m.away_team_id
                                      where c.state = 'selected' and private.local_day(m.kickoff_at) between w.week_start and w.week_start + 6
                                        and (ht.external_id = t.ext or at.external_id = t.ext)))
      ) order by w.week_start)
      from public.pool_weeks w where w.week_start + 6 >= private.local_day(now())), '[]'::jsonb),
    'sources', coalesce((select jsonb_agg(jsonb_build_object('kind', s.kind, 'external_id', s.external_id, 'label', s.label, 'enabled', s.enabled) order by s.kind, s.label)
                         from public.pool_sources s where s.provider = 'api-football'), '[]'::jsonb),
    'today', private.local_day(now()));
end;
$$;

revoke execute on function public.admin_set_week_mode(uuid, text) from public, anon;
grant execute on function public.admin_set_week_mode(uuid, text) to authenticated;
