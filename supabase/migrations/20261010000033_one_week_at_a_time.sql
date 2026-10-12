-- =====================================================================
-- Una quiniela a la vez. Los partidos de la semana siguiente se eligen
-- (borrador del admin), pero se publican hasta que termina la quiniela
-- anterior: cuando el último partido de esa semana finaliza, la siguiente se
-- publica sola. Lo ya publicado de la semana siguiente sin pronósticos
-- enviados se retira de la vista y vuelve a salir al terminar la actual.
-- =====================================================================

-- ¿Terminó la semana anterior? Sin partidos publicados pendientes y sin
-- partidos elegidos que aún esperan su turno para publicarse.
create or replace function private.previous_week_done(p_week_start date)
returns boolean language sql stable security definer set search_path = '' as $$
  select not exists (
           select 1 from public.pool_matches pm join public.matches m on m.id = pm.match_id
           where pm.status = 'published'
             and private.local_day(m.kickoff_at) between p_week_start - 7 and p_week_start - 1
             and m.status in ('scheduled', 'live', 'suspended', 'unknown')
             and m.kickoff_at > now() - interval '4 days')
     and not exists (
           select 1 from public.pool_candidates c join public.matches m on m.id = c.match_id
           where c.state = 'selected' and m.status = 'scheduled' and m.kickoff_at > now()
             and private.local_day(m.kickoff_at) between p_week_start - 7 and p_week_start - 1
             and not exists (select 1 from public.pool_matches pm where pm.match_id = c.match_id));
$$;

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

  -- Una quiniela a la vez: la semana se publica cuando terminó la anterior.
  if w.auto_mode = 'publish' and private.previous_week_done(w.week_start) then
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

-- Al finalizar un partido, si su semana ya terminó se publica la siguiente.
create or replace function private.release_next_week()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  w record;
begin
  if new.status in ('finished', 'cancelled', 'postponed', 'abandoned') and old.status is distinct from new.status
     and exists (select 1 from public.pool_matches pm where pm.match_id = new.id and pm.status = 'published') then
    for w in select id from public.pool_weeks
              where auto_mode = 'publish' and week_start > private.local_day(new.kickoff_at)
                and week_start <= private.local_day(new.kickoff_at) + 14
              order by week_start loop
      perform private.fill_week(w.id);
    end loop;
  end if;
  return new;
end;
$$;
create or replace trigger matches_release_next_week after update of status on public.matches
  for each row execute function private.release_next_week();

revoke execute on function private.previous_week_done(date) from public, anon, authenticated;
revoke execute on function private.release_next_week() from public, anon, authenticated;

-- La semana siguiente ya publicada antes de tiempo: se guarda para después
-- (sigue elegida; se publica sola al terminar la actual). Solo partidos sin
-- pronósticos enviados.
do $$
declare
  v_n int;
begin
  with held as (
    delete from public.pool_matches pm
     using public.matches m
     where m.id = pm.match_id and pm.status = 'published' and m.status = 'scheduled' and m.kickoff_at > now()
       and not private.previous_week_done((private.week_for(m.kickoff_at)).week_start)
       and not exists (select 1 from public.pool_picks pp where pp.match_id = pm.match_id and pp.status = 'submitted')
    returning pm.match_id, pm.source)
  select count(*) into v_n from held;
  if v_n > 0 then
    perform private.log_audit('pool.week_held', 'pool', 'next_week', jsonb_build_object('matches', v_n, 'reason', 'Una quiniela a la vez'));
  end if;
end;
$$;
