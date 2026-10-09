-- =====================================================================
-- API del jugador (lectura y escritura de quinielas, clasificación).
-- =====================================================================

-- ---------------------------------------------------------------------
-- API del jugador
-- ---------------------------------------------------------------------
create or replace function public.get_server_time()
returns timestamptz
language sql
stable
set search_path = ''
as $$ select now(); $$;

create or replace function public.get_app_config()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'timezone', coalesce((select s.value #>> '{}' from public.app_settings s where s.key = 'timezone'), 'America/Mexico_City'),
    'max_goals', private.setting_int('max_goals', 15),
    'payments_enabled', false,
    'server_time', now()
  );
$$;

-- Guarda el borrador completo (snapshot). Las solicitudes con una
-- secuencia menor o igual a la ya guardada se ignoran (llegaron tarde).
create or replace function public.save_prediction_draft(p_round_id uuid, p_items jsonb, p_client_seq bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_round public.rounds;
  v_pred public.predictions;
  v_count int;
begin
  v_round := private.lock_round_for_play(p_round_id, v_uid);
  v_pred := private.lock_prediction(p_round_id, v_uid);

  if v_pred.status = 'submitted' then
    return jsonb_build_object('status', 'submitted', 'applied', false, 'submitted_at', v_pred.submitted_at, 'client_seq', v_pred.client_seq);
  end if;

  perform private.assert_round_accepting(v_round);

  if p_client_seq is null or p_client_seq <= v_pred.client_seq then
    return jsonb_build_object('status', 'draft', 'applied', false, 'reason', 'stale', 'client_seq', v_pred.client_seq, 'saved_at', v_pred.updated_at);
  end if;

  create temporary table if not exists pg_temp._draft_items (match_id uuid primary key, home_goals smallint, away_goals smallint) on commit drop;
  delete from pg_temp._draft_items;
  insert into pg_temp._draft_items select * from private.parse_prediction_items(p_round_id, p_items, false);

  delete from public.prediction_items pi
    where pi.prediction_id = v_pred.id
      and not exists (select 1 from pg_temp._draft_items d where d.match_id = pi.match_id);

  insert into public.prediction_items (prediction_id, match_id, home_goals, away_goals)
  select v_pred.id, d.match_id, d.home_goals, d.away_goals from pg_temp._draft_items d
  on conflict (prediction_id, match_id) do update
    set home_goals = excluded.home_goals, away_goals = excluded.away_goals
    where public.prediction_items.home_goals is distinct from excluded.home_goals
       or public.prediction_items.away_goals is distinct from excluded.away_goals;

  update public.predictions set client_seq = p_client_seq where id = v_pred.id;
  select count(*) into v_count from pg_temp._draft_items;

  return jsonb_build_object('status', 'draft', 'applied', true, 'client_seq', p_client_seq, 'saved_at', now(), 'items_count', v_count);
end;
$$;

-- Envío definitivo. Atómico, idempotente y sin posibilidad de edición posterior.
create or replace function public.submit_prediction(p_round_id uuid, p_items jsonb, p_client_seq bigint default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_round public.rounds;
  v_pred public.predictions;
  v_count int;
begin
  v_round := private.lock_round_for_play(p_round_id, v_uid);
  v_pred := private.lock_prediction(p_round_id, v_uid);

  if v_pred.status = 'submitted' then
    -- Reintento o doble clic: se devuelve el estado existente, sin cambios.
    return jsonb_build_object('status', 'submitted', 'already_submitted', true, 'submitted_at', v_pred.submitted_at);
  end if;

  perform private.assert_round_accepting(v_round);

  create temporary table if not exists pg_temp._submit_items (match_id uuid primary key, home_goals smallint, away_goals smallint) on commit drop;
  delete from pg_temp._submit_items;
  insert into pg_temp._submit_items select * from private.parse_prediction_items(p_round_id, p_items, true);

  delete from public.prediction_items pi where pi.prediction_id = v_pred.id;
  insert into public.prediction_items (prediction_id, match_id, home_goals, away_goals)
  select v_pred.id, s.match_id, s.home_goals, s.away_goals from pg_temp._submit_items s;

  update public.predictions
     set status = 'submitted',
         submitted_at = now(),
         client_seq = greatest(client_seq, coalesce(p_client_seq, client_seq))
   where id = v_pred.id
  returning * into v_pred;

  select count(*) into v_count from pg_temp._submit_items;
  perform private.log_audit('prediction.submitted', 'prediction', v_pred.id::text,
    jsonb_build_object('round_id', p_round_id, 'items', v_count));

  return jsonb_build_object('status', 'submitted', 'already_submitted', false, 'submitted_at', v_pred.submitted_at);
end;
$$;

create or replace function public.join_group(p_invite_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_group public.groups;
  v_status text;
begin
  select * into v_group from public.groups
  where invite_code = upper(btrim(coalesce(p_invite_code, ''))) and is_active;
  if not found then
    perform private.fail('INVALID_INVITE_CODE');
  end if;

  insert into public.group_members (group_id, user_id, status)
  values (v_group.id, v_uid, case when v_group.join_requires_approval then 'pending' else 'active' end)
  on conflict (group_id, user_id) do nothing;

  select gm.status into v_status from public.group_members gm where gm.group_id = v_group.id and gm.user_id = v_uid;
  perform private.log_audit('group.join_requested', 'group', v_group.id::text, jsonb_build_object('status', v_status));
  return jsonb_build_object('group_id', v_group.id, 'name', v_group.name, 'status', v_status);
end;
$$;

create or replace function public.get_my_groups()
returns table (group_id uuid, name text, description text, member_status text, joined_at timestamptz, members_count int)
language sql
stable
security definer
set search_path = ''
as $$
  select g.id, g.name, g.description, gm.status, gm.joined_at,
         (select count(*)::int from public.group_members x where x.group_id = g.id and x.status = 'active')
  from public.group_members gm
  join public.groups g on g.id = gm.group_id and g.is_active
  where gm.user_id = auth.uid()
  order by gm.status = 'active' desc, gm.joined_at;
$$;

create or replace function private.assert_group_access(p_group_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_user();
  if not (private.is_admin() or private.is_active_member(p_group_id)) then
    perform private.fail('FORBIDDEN');
  end if;
end;
$$;

-- Jornadas visibles del grupo con el estado personal del jugador.
create or replace function public.get_my_rounds(p_group_id uuid)
returns table (
  round_id uuid, name text, description text, status text, phase text,
  opens_at timestamptz, deadline_at timestamptz, finalized_at timestamptz,
  match_count int, first_kickoff timestamptz, last_kickoff timestamptz,
  my_status text, my_items int, my_submitted_at timestamptz,
  my_points int, my_exact_hits int, my_outcome_hits int, my_position int, players int, is_official boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := private.require_user();
begin
  perform private.assert_group_access(p_group_id);
  return query
  with visible as (
    select r.* from public.rounds r
    where r.group_id = p_group_id and private.can_view_round(r.id, v_uid)
  ),
  ranked as (
    select rs.round_id, rs.user_id, rs.points, rs.exact_hits, rs.outcome_hits, rs.is_official,
           rank() over (partition by rs.round_id order by rs.points desc, rs.exact_hits desc, rs.goal_error asc, rs.outcome_hits desc)::int as pos,
           count(*) over (partition by rs.round_id)::int as players
    from public.round_scores rs
    where rs.round_id in (select v.id from visible v)
  )
  select v.id, v.name, v.description, v.status, private.round_phase(rr),
         v.opens_at, v.deadline_at, v.finalized_at,
         (select count(*)::int from public.round_matches rm where rm.round_id = v.id),
         (select min(m.kickoff_at) from public.round_matches rm join public.matches m on m.id = rm.match_id where rm.round_id = v.id),
         (select max(m.kickoff_at) from public.round_matches rm join public.matches m on m.id = rm.match_id where rm.round_id = v.id),
         coalesce(p.status, 'none'),
         (select count(*)::int from public.prediction_items pi where pi.prediction_id = p.id),
         p.submitted_at,
         rk.points, rk.exact_hits, rk.outcome_hits, rk.pos,
         (select max(r2.players) from ranked r2 where r2.round_id = v.id),
         coalesce(rk.is_official, v.status = 'finished')
  from visible v
  join public.rounds rr on rr.id = v.id
  left join public.predictions p on p.round_id = v.id and p.user_id = v_uid
  left join ranked rk on rk.round_id = v.id and rk.user_id = v_uid
  order by v.deadline_at desc;
end;
$$;

-- Detalle completo de una jornada para el jugador (partidos, su quiniela y puntos).
create or replace function public.get_round_detail(p_round_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_round public.rounds;
  v_pred public.predictions;
  v_matches jsonb;
  v_summary jsonb;
begin
  select * into v_round from public.rounds where id = p_round_id;
  if not found or not (private.can_view_round(p_round_id, v_uid) or private.is_admin()) then
    perform private.fail('ROUND_NOT_FOUND');
  end if;

  select * into v_pred from public.predictions where round_id = p_round_id and user_id = v_uid;

  select coalesce(jsonb_agg(jsonb_build_object(
      'match_id', m.id,
      'position', rm.position,
      'kickoff_at', m.kickoff_at,
      'status', m.status,
      'status_detail', m.status_detail,
      'elapsed', m.elapsed,
      'home_goals', m.home_goals,
      'away_goals', m.away_goals,
      'result_confirmed', m.result_confirmed,
      'is_test_data', m.is_test_data,
      'competition', case when c.id is null then null else jsonb_build_object('name', c.name, 'logo_url', c.logo_url) end,
      'home', jsonb_build_object('id', ht.id, 'name', ht.name, 'short_name', ht.short_name, 'code', ht.code, 'logo_url', ht.logo_url),
      'away', jsonb_build_object('id', at.id, 'name', at.name, 'short_name', at.short_name, 'code', at.code, 'logo_url', at.logo_url),
      'pick', case when pi.match_id is null then null else jsonb_build_object('home', pi.home_goals, 'away', pi.away_goals) end,
      'score', case when s.match_id is null then null else jsonb_build_object(
          'points', s.points, 'exact_hit', s.exact_hit, 'outcome_hit', s.outcome_hit, 'goal_error', s.goal_error, 'is_final', s.is_final) end
    ) order by rm.position), '[]'::jsonb)
  into v_matches
  from public.round_matches rm
  join public.matches m on m.id = rm.match_id
  join public.teams ht on ht.id = m.home_team_id
  join public.teams at on at.id = m.away_team_id
  left join public.competitions c on c.id = m.competition_id
  left join public.prediction_items pi on pi.prediction_id = v_pred.id and pi.match_id = m.id
  left join public.prediction_item_scores s on s.prediction_id = v_pred.id and s.match_id = m.id
  where rm.round_id = p_round_id;

  with ranked as (
    select rs.*, rank() over (order by rs.points desc, rs.exact_hits desc, rs.goal_error asc, rs.outcome_hits desc)::int as pos,
           count(*) over ()::int as players
    from public.round_scores rs where rs.round_id = p_round_id
  )
  select jsonb_build_object(
      'points', coalesce(r.points, 0),
      'exact_hits', coalesce(r.exact_hits, 0),
      'outcome_hits', coalesce(r.outcome_hits, 0),
      'goal_error', coalesce(r.goal_error, 0),
      'scored_matches', coalesce(r.scored_matches, 0),
      'position', r.pos,
      'players', coalesce(r.players, (select count(*) from ranked)),
      'is_official', v_round.status = 'finished',
      'max_possible', 5 * (select count(*) from public.round_matches rm join public.matches m on m.id = rm.match_id
                           where rm.round_id = p_round_id and m.status not in ('cancelled', 'abandoned'))
    )
  into v_summary
  from (select 1) one
  left join ranked r on r.user_id = v_uid;

  return jsonb_build_object(
    'round', jsonb_build_object(
      'id', v_round.id, 'group_id', v_round.group_id, 'name', v_round.name, 'description', v_round.description,
      'status', v_round.status, 'phase', private.round_phase(v_round),
      'opens_at', v_round.opens_at, 'deadline_at', v_round.deadline_at, 'finalized_at', v_round.finalized_at),
    'server_time', now(),
    'max_goals', private.setting_int('max_goals', 15),
    'prediction', case when v_pred.id is null then null else jsonb_build_object(
      'id', v_pred.id, 'status', v_pred.status, 'submitted_at', v_pred.submitted_at,
      'client_seq', v_pred.client_seq, 'updated_at', v_pred.updated_at) end,
    'matches', v_matches,
    'summary', v_summary
  );
end;
$$;

-- Clasificación oficial. Desempates: puntos ↓, exactos ↓, error de goles ↑,
-- aciertos 1X2 ↓. Empate total ⇒ posición compartida (RANK).
create or replace function public.get_leaderboard(p_group_id uuid, p_round_id uuid default null)
returns table (
  rank_position int, user_id uuid, display_name text, avatar_url text,
  points int, exact_hits int, outcome_hits int, goal_error int,
  rounds_played int, scored_matches int, is_provisional boolean, is_me boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.assert_group_access(p_group_id);
  if p_round_id is not null and not exists (
    select 1 from public.rounds r
    where r.id = p_round_id and r.group_id = p_group_id
      and (private.is_admin() or private.can_view_round(r.id))
  ) then
    perform private.fail('ROUND_NOT_FOUND');
  end if;

  return query
  with agg as (
    select rs.user_id,
           sum(rs.points)::int as pts,
           sum(rs.exact_hits)::int as ex,
           sum(rs.outcome_hits)::int as oc,
           sum(rs.goal_error)::int as ge,
           count(*)::int as rp,
           sum(rs.scored_matches)::int as sm,
           bool_or(not rs.is_official) as prov
    from public.round_scores rs
    join public.rounds r on r.id = rs.round_id
    where r.group_id = p_group_id
      and (r.status in ('closed', 'finished', 'under_review') or (r.status = 'open' and r.deadline_at <= now()))
      and (p_round_id is null or rs.round_id = p_round_id)
    group by rs.user_id
  )
  select rank() over (order by a.pts desc, a.ex desc, a.ge asc, a.oc desc)::int,
         a.user_id, p.display_name, p.avatar_url,
         a.pts, a.ex, a.oc, a.ge, a.rp, a.sm, a.prov, a.user_id = auth.uid()
  from agg a
  join public.profiles p on p.id = a.user_id
  order by 1, p.display_name;
end;
$$;

-- Evolución de la posición acumulada del jugador jornada a jornada.
create or replace function public.get_position_history(p_group_id uuid)
returns table (
  round_id uuid, round_name text, deadline_at timestamptz,
  round_points int, round_position int, cumulative_points int, cumulative_position int, players int, is_official boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := private.require_user();
begin
  perform private.assert_group_access(p_group_id);
  return query
  with scored as (
    select r.id, r.name, r.deadline_at, r.status
    from public.rounds r
    where r.group_id = p_group_id
      and (r.status in ('closed', 'finished', 'under_review') or (r.status = 'open' and r.deadline_at <= now()))
  ),
  per_round as (
    select rs.round_id, rs.user_id, rs.points,
           rank() over (partition by rs.round_id order by rs.points desc, rs.exact_hits desc, rs.goal_error asc, rs.outcome_hits desc)::int as pos
    from public.round_scores rs where rs.round_id in (select s.id from scored s)
  ),
  cumulative as (
    select s.id as round_id, rs.user_id,
           sum(rs.points)::int as pts, sum(rs.exact_hits)::int as ex,
           sum(rs.goal_error)::int as ge, sum(rs.outcome_hits)::int as oc
    from scored s
    join scored prev on prev.deadline_at <= s.deadline_at
    join public.round_scores rs on rs.round_id = prev.id
    group by s.id, rs.user_id
  ),
  cumulative_ranked as (
    select c.*, rank() over (partition by c.round_id order by c.pts desc, c.ex desc, c.ge asc, c.oc desc)::int as pos,
           count(*) over (partition by c.round_id)::int as players
    from cumulative c
  )
  select s.id, s.name, s.deadline_at, pr.points, pr.pos, cr.pts, cr.pos, cr.players, s.status = 'finished'
  from scored s
  join cumulative_ranked cr on cr.round_id = s.id and cr.user_id = v_uid
  left join per_round pr on pr.round_id = s.id and pr.user_id = v_uid
  order by s.deadline_at;
end;
$$;

-- Resumen de rendimiento para la pantalla de inicio.
create or replace function public.get_player_summary(p_group_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_me record;
  v_players int;
  v_last record;
begin
  perform private.assert_group_access(p_group_id);

  select * into v_me from public.get_leaderboard(p_group_id, null) lb where lb.user_id = v_uid;
  select count(*) into v_players from public.get_leaderboard(p_group_id, null);

  select h.round_id, h.round_name, h.round_points, h.round_position, h.is_official
    into v_last
    from public.get_position_history(p_group_id) h
    order by h.deadline_at desc limit 1;

  return jsonb_build_object(
    'total_points', coalesce(v_me.points, 0),
    'position', v_me.rank_position,
    'players', v_players,
    'exact_hits', coalesce(v_me.exact_hits, 0),
    'outcome_hits', coalesce(v_me.outcome_hits, 0),
    'rounds_played', coalesce(v_me.rounds_played, 0),
    'is_provisional', coalesce(v_me.is_provisional, false),
    'last_round', case when v_last.round_id is null then null else jsonb_build_object(
       'round_id', v_last.round_id, 'name', v_last.round_name, 'points', coalesce(v_last.round_points, 0),
       'position', v_last.round_position, 'is_official', v_last.is_official) end
  );
end;
$$;

-- Próximos partidos: SOLO los incluidos en jornadas visibles del grupo.
create or replace function public.get_upcoming_matches(p_group_id uuid, p_limit int default 8)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_result jsonb;
begin
  perform private.assert_group_access(p_group_id);
  select coalesce(jsonb_agg(x order by x ->> 'kickoff_at'), '[]'::jsonb) into v_result
  from (
    select distinct on (m.id) jsonb_build_object(
      'match_id', m.id, 'kickoff_at', m.kickoff_at, 'status', m.status, 'elapsed', m.elapsed,
      'home_goals', m.home_goals, 'away_goals', m.away_goals, 'is_test_data', m.is_test_data,
      'round_id', r.id, 'round_name', r.name,
      'home', jsonb_build_object('name', ht.name, 'short_name', ht.short_name, 'code', ht.code, 'logo_url', ht.logo_url),
      'away', jsonb_build_object('name', at.name, 'short_name', at.short_name, 'code', at.code, 'logo_url', at.logo_url)
    ) as x
    from public.rounds r
    join public.round_matches rm on rm.round_id = r.id
    join public.matches m on m.id = rm.match_id
    join public.teams ht on ht.id = m.home_team_id
    join public.teams at on at.id = m.away_team_id
    where r.group_id = p_group_id
      and private.can_view_round(r.id, v_uid)
      and m.status in ('scheduled', 'live')
      and m.kickoff_at >= now() - interval '3 hours'
    order by m.id, r.deadline_at
  ) sub
  limit greatest(1, least(p_limit, 30));
  return v_result;
end;
$$;

-- Arranque: el primer usuario registrado puede reclamar el rol de admin
-- únicamente si todavía no existe ningún administrador.
create or replace function public.claim_first_admin()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
begin
  lock table public.profiles in share row exclusive mode;
  if exists (select 1 from public.profiles where role = 'admin') then
    return false;
  end if;
  update public.profiles set role = 'admin' where id = v_uid;
  perform private.log_audit('admin.bootstrap', 'profile', v_uid::text, '{}'::jsonb);
  return true;
end;
$$;

-- ---------------------------------------------------------------------
-- Permisos de ejecución
-- ---------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_admin() to authenticated;
grant execute on function private.is_active_member(uuid) to authenticated;
grant execute on function private.shares_group(uuid) to authenticated;
grant execute on function private.can_view_round(uuid, uuid) to authenticated;
grant execute on function private.can_view_match(uuid) to authenticated;

grant execute on function public.score_prediction(int, int, int, int) to authenticated;
grant execute on function public.goal_error(int, int, int, int) to authenticated;
grant execute on function public.get_server_time() to authenticated, anon;
grant execute on function public.get_app_config() to authenticated;
grant execute on function public.save_prediction_draft(uuid, jsonb, bigint) to authenticated;
grant execute on function public.submit_prediction(uuid, jsonb, bigint) to authenticated;
grant execute on function public.join_group(text) to authenticated;
grant execute on function public.get_my_groups() to authenticated;
grant execute on function public.get_my_rounds(uuid) to authenticated;
grant execute on function public.get_round_detail(uuid) to authenticated;
grant execute on function public.get_leaderboard(uuid, uuid) to authenticated;
grant execute on function public.get_position_history(uuid) to authenticated;
grant execute on function public.get_player_summary(uuid) to authenticated;
grant execute on function public.get_upcoming_matches(uuid, int) to authenticated;
grant execute on function public.claim_first_admin() to authenticated;
