-- =====================================================================
-- Una quiniela ya empezada no recibe partidos nuevos. El calendario puede
-- encontrar un partido tarde (p. ej. Leones Negros vs Durango apareció el
-- viernes en la noche) y se publicaba solo en la quiniela en curso. Ahora,
-- en cuanto empieza el primer partido de la semana, ya no se agregan más.
-- (El admin todavía puede agregar uno a mano si así lo quiere.)
-- =====================================================================
create or replace function private.fill_week(p_week uuid)
returns integer
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
  -- Quiniela ya empezada: no se toca.
  if exists (select 1 from private.week_published(w.id) wp where wp.kickoff_at <= now()) then return 0; end if;
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
