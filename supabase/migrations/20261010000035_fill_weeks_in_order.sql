-- =====================================================================
-- Una quiniela a la vez: las semanas se llenan siempre en orden de fecha,
-- así la siguiente nunca se publica antes que la actual cuando llegan
-- partidos de varias semanas a la vez.
-- =====================================================================
create or replace function private.suggest_and_fill(p_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new int := 0;
  v_week int := 0;
  w record;
begin
  with ins as (
    insert into public.pool_candidates (match_id, state, source, sort_order)
    select m.id, 'suggested', 'auto', null from public.matches m
    where m.id = any (p_ids) and m.status = 'scheduled' and m.kickoff_at > now()
      and not private.match_has_retired_team(m.id)
    on conflict (match_id) do nothing
    returning 1)
  select count(*) into v_new from ins;
  update public.pool_candidates set needs_review = false, review_reason = null, updated_at = now()
   where match_id = any (p_ids) and review_reason = 'NOT_IN_PROVIDER';
  -- En orden de fecha: una semana no se publica antes que la anterior.
  for w in select x.id from (select distinct (private.week_for(m.kickoff_at)).id as id, (private.week_for(m.kickoff_at)).week_start as ws
                             from public.matches m where m.id = any (p_ids)) x order by x.ws loop
    if w.id is not null then v_week := v_week + private.fill_week(w.id); end if;
  end loop;
  return jsonb_build_object('suggested', v_new, 'week_selected', v_week);
end;
$$;

create or replace function public.admin_follow_team(p_team uuid, p_follow boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := private.assert_admin();
  t public.teams;
  v_weeks int := 0;
  v_added int := 0;
  w record;
begin
  select * into t from public.teams where id = p_team;
  if not found then perform private.fail('TEAM_NOT_FOUND'); end if;
  if t.provider <> 'api-football' then perform private.fail('TEAM_NOT_OFFICIAL'); end if;
  if coalesce(p_follow, false) and t.retired_at is not null then perform private.fail('TEAM_RETIRED'); end if;
  insert into public.pool_sources (provider, kind, external_id, label, enabled)
  values ('api-football', 'team', t.external_id, left(t.name, 80), coalesce(p_follow, false))
  on conflict (provider, kind, external_id) do update set enabled = excluded.enabled;
  -- Semanas en curso y futuras.
  for w in select * from public.pool_weeks p where p.week_start + 6 >= private.local_day(now()) order by p.week_start loop
    if coalesce(p_follow, false) and not (t.external_id = any (w.team_ids)) then
      update public.pool_weeks set team_ids = team_ids || t.external_id, updated_at = now() where id = w.id;
      v_weeks := v_weeks + 1;
      v_added := v_added + private.fill_week(w.id);
    elsif not coalesce(p_follow, false) and t.external_id = any (w.team_ids) then
      update public.pool_weeks set team_ids = array_remove(team_ids, t.external_id), updated_at = now() where id = w.id;
      v_weeks := v_weeks + 1;
    end if;
  end loop;
  perform private.log_audit(case when coalesce(p_follow, false) then 'team.followed' else 'team.unfollowed' end, 'team', p_team::text,
    jsonb_build_object('weeks', v_weeks, 'selected_now', v_added, 'by', v_admin));
  return jsonb_build_object('followed', coalesce(p_follow, false), 'weeks', v_weeks, 'selected_now', v_added);
end;
$$;
