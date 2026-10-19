-- =====================================================================
-- Clasificación de la quiniela en curso. Al terminar una jornada y empezar
-- la siguiente, la anterior se guarda (sigue en la base y el admin la ve),
-- pero ya no aparece para los participantes. Así cada semana.
-- =====================================================================

-- ¿Terminó la jornada? Todos sus partidos publicados finalizados (o anulados).
create or replace function private.week_done(p_week uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.week_published(p_week))
     and not exists (select 1 from private.week_published(p_week) wp where wp.status in ('scheduled', 'live', 'suspended', 'unknown'));
$$;

-- Jornada por defecto: la primera que sigue en juego (por su primer partido);
-- si todas terminaron, la más reciente.
create or replace function private.pick_week(p_week uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select coalesce(p_week, (
    select w.id from public.pool_weeks w
     where exists (select 1 from private.week_published(w.id))
     order by private.week_done(w.id),
              case when private.week_done(w.id) then null else (select min(wp.kickoff_at) from private.week_published(w.id) wp) end nulls last,
              (select max(wp.kickoff_at) from private.week_published(w.id) wp) desc
     limit 1));
$$;

-- Jornadas en el selector: el admin ve todas (las 12 más recientes); los
-- participantes, solo las que siguen en juego o, si ninguna, la última.
create or replace function private.listed_weeks()
returns setof uuid language sql stable security definer set search_path = '' as $$
  with w as (
    select w.id, w.week_start, private.week_done(w.id) as done
      from public.pool_weeks w
     where exists (select 1 from private.week_published(w.id))
  )
  (select id from w where private.is_admin() order by week_start desc limit 12)
  union
  (select id from w where not private.is_admin() and not done)
  union
  (select id from w where not private.is_admin() and not exists (select 1 from w x where not x.done) and id = private.pick_week(null));
$$;
revoke execute on function private.week_done(uuid) from public, anon, authenticated;
revoke execute on function private.listed_weeks() from public, anon, authenticated;

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
    'week', jsonb_build_object('id', v_week.id, 'label', v_week.label, 'week_start', v_week.week_start, 'week_end', coalesce(v_week.end_day, v_week.week_start + 6),
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
      from (select * from public.pool_weeks w2 where w2.id in (select private.listed_weeks())) w), '[]'::jsonb));
end;
$$;
