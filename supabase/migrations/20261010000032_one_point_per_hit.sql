-- =====================================================================
-- Puntuación: 1 punto por acertar quién gana o el empate (antes 3).
-- El desempate sigue igual: quien más se acerque al total de goles de la
-- jornada. Se recalcula todo lo ya puntuado para que todos usen la misma regla.
-- =====================================================================
alter table public.pool_scores drop constraint if exists pool_scores_points_check;
alter table public.pool_scores add constraint pool_scores_points_check check (points in (0, 1, 3, 5));

create or replace function private.recompute_pool_match(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m public.matches;
  v_pub boolean;
  v_res text;
begin
  select * into v_m from public.matches where id = p_match_id;
  select pm.status = 'published' into v_pub from public.pool_matches pm where pm.match_id = p_match_id;
  if v_pub is null then return; end if;
  if v_pub and v_m.status in ('live', 'finished') and v_m.home_goals is not null then
    v_res := case when v_m.home_goals > v_m.away_goals then '1' when v_m.home_goals < v_m.away_goals then '2' else 'X' end;
    insert into public.pool_scores (user_id, match_id, points, exact_hit, outcome_hit, goal_error, is_final, counted, computed_at)
    select pp.user_id, pp.match_id,
           case when coalesce(pp.outcome, case when pp.home_goals > pp.away_goals then '1' when pp.home_goals < pp.away_goals then '2'
                                               when pp.home_goals is not null then 'X' end) = v_res then 1 else 0 end,
           pp.home_goals is not null and pp.home_goals = v_m.home_goals and pp.away_goals = v_m.away_goals,
           pp.outcome = v_res,
           case when pp.home_goals is not null then public.goal_error(pp.home_goals, pp.away_goals, v_m.home_goals, v_m.away_goals)
                else v_m.home_goals + v_m.away_goals end,
           v_m.result_confirmed, true, now()
    from public.pool_picks pp
    where pp.match_id = p_match_id and pp.status = 'submitted'
    on conflict (user_id, match_id) do update
      set points = excluded.points, exact_hit = excluded.exact_hit, outcome_hit = excluded.outcome_hit,
          goal_error = excluded.goal_error, is_final = excluded.is_final, counted = true, computed_at = now();
  else
    -- Sin resultado válido (cancelado, aplazado, retirado): no cuenta.
    update public.pool_scores set counted = false, computed_at = now() where match_id = p_match_id and counted;
  end if;
end;
$$;

do $$
declare r record;
begin
  for r in select distinct match_id from public.pool_scores loop
    perform private.recompute_pool_match(r.match_id);
  end loop;
end;
$$;
