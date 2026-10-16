-- =====================================================================
-- Transparencia en la clasificación: quien ya pagó y ya envió su quiniela
-- ve quién eligió qué (y el total de goles) de cada participante, sin
-- esperar a que empiece el partido. Los pronósticos enviados ya no se
-- pueden cambiar. Para que nadie copie, quien aún no envía su pronóstico de
-- un partido no ve los de los demás hasta que ese partido empiece. El admin
-- siempre ve todo.
-- =====================================================================

-- ¿El participante puede ver los pronósticos enviados de un partido?
create or replace function private.sees_pick(p_viewer uuid, p_match uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_admin()
      or (private.can_pick(p_viewer, now())
          and exists (select 1 from public.pool_picks pp where pp.user_id = p_viewer and pp.match_id = p_match and pp.status = 'submitted'));
$$;

-- ¿Puede ver el total de goles de la jornada de los demás?
create or replace function private.sees_week_goals(p_viewer uuid, p_week uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_admin()
      or (private.can_pick(p_viewer, now())
          and exists (select 1 from public.pool_week_goals g where g.user_id = p_viewer and g.week_id = p_week and g.status = 'submitted'));
$$;

revoke execute on function private.sees_pick(uuid, uuid) from public, anon, authenticated;
revoke execute on function private.sees_week_goals(uuid, uuid) from public, anon, authenticated;

create or replace function public.get_week_standings(p_week uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_week public.pool_weeks;
  v_real jsonb;
  v_open boolean;
  v_see boolean;
begin
  select * into v_week from public.pool_weeks where id = private.pick_week(p_week);
  if v_week.id is null then
    return jsonb_build_object('week', null, 'summary', null, 'rows', '[]'::jsonb, 'weeks', '[]'::jsonb,
      'updated_at', (select max(r.finished_at) from public.sync_runs r where r.provider = 'api-football' and r.status in ('success', 'partial')));
  end if;
  v_real := private.week_real_goals(v_week.id);
  v_open := private.week_goals_open(v_week.id);
  v_see := private.sees_week_goals(v_uid, v_week.id);
  return jsonb_build_object(
    'week', jsonb_build_object('id', v_week.id, 'label', v_week.label, 'week_start', v_week.week_start, 'week_end', v_week.week_start + 6,
                               'goals_open', v_open, 'real', v_real),
    'summary', (select jsonb_build_object(
        'total', count(*),
        'finished', count(*) filter (where x.status = 'finished'),
        'confirmed', count(*) filter (where private.match_final(x.status, x.result_confirmed)),
        'live', count(*) filter (where x.status in ('live', 'suspended')),
        'pending', count(*) filter (where x.status = 'scheduled'),
        'void', count(*) filter (where x.status in ('postponed', 'cancelled', 'abandoned')))
      from private.week_published(v_week.id) x),
    'updated_at', (select max(r.finished_at) from public.sync_runs r where r.provider = 'api-football' and r.status in ('success', 'partial')),
    'delayed', coalesce((private.api_quota_state('api-football') ->> 'paused')::boolean, false),
    'rows', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.rank_position, r.display_name)
      from (
        select rank() over (order by x.points desc, x.diff asc nulls last)::int as rank_position,
               x.user_id, p.display_name, p.avatar_url, x.points, x.hits, x.misses, x.live, x.pending, x.picks,
               case when x.user_id = v_uid or not v_open or v_see then x.guess end as guess,
               case when x.user_id = v_uid or not v_open or v_see then x.diff end as diff,
               x.user_id = v_uid as is_me
        from (
          select pp.user_id,
                 coalesce(sum(s.points) filter (where s.counted and private.match_final(wp.status, wp.result_confirmed)), 0)::int as points,
                 count(*) filter (where s.counted and s.outcome_hit and private.match_final(wp.status, wp.result_confirmed))::int as hits,
                 count(*) filter (where s.counted and not s.outcome_hit and private.match_final(wp.status, wp.result_confirmed))::int as misses,
                 count(*) filter (where wp.status in ('live', 'suspended'))::int as live,
                 count(*) filter (where not private.match_final(wp.status, wp.result_confirmed) and wp.status not in ('postponed', 'cancelled', 'abandoned'))::int as pending,
                 count(*)::int as picks,
                 g.total_goals::int as guess,
                 case when g.total_goals is null then null else abs(g.total_goals - (v_real ->> 'goals')::int) end as diff
          from private.week_published(v_week.id) wp
          join public.pool_picks pp on pp.match_id = wp.match_id and pp.status = 'submitted'
          left join public.pool_scores s on s.user_id = pp.user_id and s.match_id = pp.match_id
          left join public.pool_week_goals g on g.user_id = pp.user_id and g.week_id = v_week.id and g.status = 'submitted'
          group by pp.user_id, g.total_goals
        ) x
        join public.profiles p on p.id = x.user_id
      ) r), '[]'::jsonb),
    'weeks', coalesce((
      select jsonb_agg(jsonb_build_object('id', w.id, 'label', w.label, 'week_start', w.week_start) order by w.week_start desc)
      from (select * from public.pool_weeks w2 where exists (select 1 from private.week_published(w2.id)) order by w2.week_start desc limit 12) w), '[]'::jsonb));
end;
$$;

create or replace function public.get_week_participant(p_week uuid, p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_week uuid := private.pick_week(p_week);
  v_me boolean := p_user = v_uid;
  v_open boolean := private.week_goals_open(v_week);
  v_see boolean := private.sees_week_goals(v_uid, private.pick_week(p_week));
begin
  if v_week is null or not exists (select 1 from public.profiles where id = p_user) then perform private.fail('NOT_FOUND'); end if;
  return (
    select jsonb_build_object(
      'user', jsonb_build_object('user_id', p.id, 'display_name', p.display_name, 'avatar_url', p.avatar_url, 'is_me', v_me),
      'guess', (select g.total_goals from public.pool_week_goals g where g.user_id = p_user and g.week_id = v_week and g.status = 'submitted' and (v_me or not v_open or v_see)),
      'matches', coalesce((
        select jsonb_agg(jsonb_build_object(
          'match_id', m.id, 'kickoff_at', m.kickoff_at, 'status', m.status, 'elapsed', m.elapsed,
          'home_goals', m.home_goals, 'away_goals', m.away_goals, 'result_confirmed', m.result_confirmed,
          'started', m.kickoff_at <= now() or m.status <> 'scheduled',
          'competition', case when c.id is null then null else jsonb_build_object('name', c.name) end,
          'home', jsonb_build_object('name', ht.name, 'short_name', ht.short_name, 'code', ht.code, 'logo_url', ht.logo_url),
          'away', jsonb_build_object('name', at.name, 'short_name', at.short_name, 'code', at.code, 'logo_url', at.logo_url),
          'pick', case when pp.status = 'submitted' and (v_me or m.kickoff_at <= now() or m.status <> 'scheduled' or private.sees_pick(v_uid, m.id)) then pp.outcome end,
          'hidden', pp.status = 'submitted' and not v_me and m.kickoff_at > now() and m.status = 'scheduled' and not private.sees_pick(v_uid, m.id),
          'result', case
            when pp.status is distinct from 'submitted' then 'none'
            when m.status in ('postponed', 'cancelled', 'abandoned') then 'void'
            when private.match_final(m.status, m.result_confirmed) then case when s.outcome_hit then 'hit' else 'miss' end
            when m.status in ('live', 'suspended') then 'live'
            when m.status = 'finished' then 'unconfirmed'
            else 'pending' end,
          'points', case when private.match_final(m.status, m.result_confirmed) and s.counted then s.points end
        ) order by m.kickoff_at, m.id)
        from private.week_published(v_week) wp
        join public.matches m on m.id = wp.match_id
        join public.teams ht on ht.id = m.home_team_id
        join public.teams at on at.id = m.away_team_id
        left join public.competitions c on c.id = m.competition_id
        left join public.pool_picks pp on pp.match_id = m.id and pp.user_id = p_user
        left join public.pool_scores s on s.match_id = m.id and s.user_id = p_user), '[]'::jsonb))
    from public.profiles p where p.id = p_user);
end;
$$;
