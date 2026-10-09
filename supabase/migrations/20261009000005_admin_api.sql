-- =====================================================================
-- API administrativa. Cada función valida que el llamante sea admin
-- activo y registra la operación en audit_logs.
-- =====================================================================

create or replace function private.assert_admin()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
begin
  if not private.is_admin() then
    perform private.fail('FORBIDDEN');
  end if;
  return v_uid;
end;
$$;

-- ---------------------------------------------------------------------
-- Dashboard
-- ---------------------------------------------------------------------
create or replace function public.admin_dashboard_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_last public.sync_runs;
begin
  perform private.assert_admin();
  select * into v_last from public.sync_runs order by started_at desc limit 1;
  return jsonb_build_object(
    'participants_total', (select count(*) from public.profiles),
    'participants_active', (select count(distinct gm.user_id) from public.group_members gm
                            join public.profiles p on p.id = gm.user_id
                            where gm.status = 'active' and p.status = 'active'),
    'pending_approvals', (select count(*) from public.group_members where status = 'pending'),
    'groups', (select count(*) from public.groups where is_active),
    'rounds_open', (select count(*) from public.rounds where status = 'open' and deadline_at > now()),
    'rounds_draft', (select count(*) from public.rounds where status = 'draft'),
    'predictions_submitted', (select count(*) from public.predictions where status = 'submitted'),
    'matches_pending_result', (select count(distinct m.id) from public.matches m
                               join public.round_matches rm on rm.match_id = m.id
                               join public.rounds r on r.id = rm.round_id and r.status in ('open', 'closed', 'under_review')
                               where m.kickoff_at <= now() and not m.result_confirmed and m.status not in ('cancelled', 'abandoned')),
    'last_sync', case when v_last.id is null then null else jsonb_build_object(
        'id', v_last.id, 'provider', v_last.provider, 'status', v_last.status,
        'started_at', v_last.started_at, 'finished_at', v_last.finished_at,
        'matches_checked', v_last.matches_checked, 'matches_updated', v_last.matches_updated,
        'error_message', v_last.error_message) end,
    'sync_errors_24h', (select count(*) from public.sync_runs where status in ('error', 'partial') and started_at > now() - interval '24 hours'),
    'server_time', now()
  );
end;
$$;

-- ---------------------------------------------------------------------
-- Participantes
-- ---------------------------------------------------------------------
create or replace function public.admin_list_participants()
returns table (
  user_id uuid, display_name text, email text, role text, status text,
  created_at timestamptz, last_sign_in_at timestamptz,
  memberships jsonb, rounds_submitted int, total_points int
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.assert_admin();
  return query
  select p.id, p.display_name, u.email::text, p.role, p.status, p.created_at, u.last_sign_in_at,
         coalesce((select jsonb_agg(jsonb_build_object(
                     'group_id', g.id, 'group_name', g.name, 'status', gm.status,
                     'payment_status', gm.payment_status, 'joined_at', gm.joined_at) order by g.name)
                   from public.group_members gm join public.groups g on g.id = gm.group_id
                   where gm.user_id = p.id), '[]'::jsonb),
         (select count(*)::int from public.predictions pr where pr.user_id = p.id and pr.status = 'submitted'),
         (select coalesce(sum(rs.points), 0)::int from public.round_scores rs where rs.user_id = p.id)
  from public.profiles p
  join auth.users u on u.id = p.id
  order by p.created_at desc;
end;
$$;

create or replace function public.admin_set_user_status(p_user_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := private.assert_admin();
  v_old text;
begin
  if p_status not in ('active', 'suspended') then
    perform private.fail('INVALID_STATUS');
  end if;
  if p_user_id = v_admin then
    perform private.fail('CANNOT_CHANGE_SELF');
  end if;
  select status into v_old from public.profiles where id = p_user_id for update;
  if not found then
    perform private.fail('USER_NOT_FOUND');
  end if;
  update public.profiles set status = p_status where id = p_user_id;
  perform private.log_audit('user.status_changed', 'profile', p_user_id::text,
    jsonb_build_object('from', v_old, 'to', p_status));
end;
$$;

create or replace function public.admin_set_user_role(p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := private.assert_admin();
  v_old text;
begin
  if p_role not in ('player', 'admin') then
    perform private.fail('INVALID_ROLE');
  end if;
  if p_user_id = v_admin then
    perform private.fail('CANNOT_CHANGE_SELF');
  end if;
  select role into v_old from public.profiles where id = p_user_id for update;
  if not found then
    perform private.fail('USER_NOT_FOUND');
  end if;
  update public.profiles set role = p_role where id = p_user_id;
  perform private.log_audit('user.role_changed', 'profile', p_user_id::text,
    jsonb_build_object('from', v_old, 'to', p_role));
end;
$$;

-- ---------------------------------------------------------------------
-- Grupos y membresías
-- ---------------------------------------------------------------------
create or replace function public.admin_save_group(
  p_group_id uuid, p_name text, p_description text, p_join_requires_approval boolean, p_is_active boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := private.assert_admin();
  v_id uuid;
begin
  if p_group_id is null then
    insert into public.groups (name, description, join_requires_approval, is_active, created_by)
    values (btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''), coalesce(p_join_requires_approval, true), coalesce(p_is_active, true), v_admin)
    returning id into v_id;
    -- El admin que crea el grupo queda como miembro activo.
    insert into public.group_members (group_id, user_id, status, approved_at, approved_by)
    values (v_id, v_admin, 'active', now(), v_admin)
    on conflict do nothing;
    perform private.log_audit('group.created', 'group', v_id::text, jsonb_build_object('name', p_name));
  else
    update public.groups
       set name = btrim(p_name),
           description = nullif(btrim(coalesce(p_description, '')), ''),
           join_requires_approval = coalesce(p_join_requires_approval, join_requires_approval),
           is_active = coalesce(p_is_active, is_active)
     where id = p_group_id
    returning id into v_id;
    if v_id is null then
      perform private.fail('GROUP_NOT_FOUND');
    end if;
    perform private.log_audit('group.updated', 'group', v_id::text,
      jsonb_build_object('name', p_name, 'is_active', p_is_active, 'join_requires_approval', p_join_requires_approval));
  end if;
  return v_id;
end;
$$;

create or replace function public.admin_regenerate_invite_code(p_group_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text;
begin
  perform private.assert_admin();
  update public.groups set invite_code = private.generate_invite_code() where id = p_group_id returning invite_code into v_code;
  if v_code is null then
    perform private.fail('GROUP_NOT_FOUND');
  end if;
  perform private.log_audit('group.invite_regenerated', 'group', p_group_id::text, '{}'::jsonb);
  return v_code;
end;
$$;

create or replace function public.admin_set_member(p_group_id uuid, p_user_id uuid, p_status text, p_payment_status text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := private.assert_admin();
  v_old public.group_members;
begin
  if p_status not in ('pending', 'active', 'suspended') then
    perform private.fail('INVALID_STATUS');
  end if;
  if p_payment_status is not null and p_payment_status not in ('not_applicable', 'pending', 'authorized', 'rejected') then
    perform private.fail('INVALID_PAYMENT_STATUS');
  end if;
  if not exists (select 1 from public.groups where id = p_group_id) then
    perform private.fail('GROUP_NOT_FOUND');
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    perform private.fail('USER_NOT_FOUND');
  end if;

  select * into v_old from public.group_members where group_id = p_group_id and user_id = p_user_id for update;

  insert into public.group_members (group_id, user_id, status, payment_status, approved_at, approved_by)
  values (p_group_id, p_user_id, p_status, coalesce(p_payment_status, 'not_applicable'),
          case when p_status = 'active' then now() end, case when p_status = 'active' then v_admin end)
  on conflict (group_id, user_id) do update
    set status = excluded.status,
        payment_status = coalesce(p_payment_status, public.group_members.payment_status),
        approved_at = case when excluded.status = 'active' and public.group_members.status <> 'active' then now() else public.group_members.approved_at end,
        approved_by = case when excluded.status = 'active' and public.group_members.status <> 'active' then v_admin else public.group_members.approved_by end;

  perform private.log_audit('member.updated', 'group_member', p_group_id::text || ':' || p_user_id::text,
    jsonb_build_object('from_status', v_old.status, 'to_status', p_status,
                       'from_payment', v_old.payment_status, 'to_payment', coalesce(p_payment_status, v_old.payment_status)));
end;
$$;

create or replace function public.admin_add_member_by_email(p_group_id uuid, p_email text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
begin
  perform private.assert_admin();
  select u.id into v_uid from auth.users u where lower(u.email) = lower(btrim(p_email));
  if v_uid is null then
    perform private.fail('USER_NOT_FOUND');
  end if;
  perform public.admin_set_member(p_group_id, v_uid, 'active', null);
  return v_uid;
end;
$$;

create or replace function public.admin_group_members(p_group_id uuid)
returns table (user_id uuid, display_name text, email text, member_status text, payment_status text, profile_status text, joined_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.assert_admin();
  return query
  select p.id, p.display_name, u.email::text, gm.status, gm.payment_status, p.status, gm.joined_at
  from public.group_members gm
  join public.profiles p on p.id = gm.user_id
  join auth.users u on u.id = p.id
  where gm.group_id = p_group_id
  order by gm.status = 'pending' desc, p.display_name;
end;
$$;

-- ---------------------------------------------------------------------
-- Jornadas
-- ---------------------------------------------------------------------
create or replace function public.admin_save_round(
  p_round_id uuid, p_group_id uuid, p_name text, p_description text,
  p_opens_at timestamptz, p_deadline_at timestamptz, p_participation text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := private.assert_admin();
  v_old public.rounds;
  v_id uuid;
  v_has_submissions boolean;
begin
  if p_deadline_at is null then
    perform private.fail('DEADLINE_REQUIRED');
  end if;
  if coalesce(p_participation, 'all_members') not in ('all_members', 'selected') then
    perform private.fail('INVALID_PARTICIPATION');
  end if;

  if p_round_id is null then
    if not exists (select 1 from public.groups where id = p_group_id) then
      perform private.fail('GROUP_NOT_FOUND');
    end if;
    insert into public.rounds (group_id, name, description, opens_at, deadline_at, participation, created_by)
    values (p_group_id, btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''), p_opens_at, p_deadline_at,
            coalesce(p_participation, 'all_members'), v_admin)
    returning id into v_id;
    perform private.log_audit('round.created', 'round', v_id::text,
      jsonb_build_object('name', p_name, 'deadline_at', p_deadline_at, 'group_id', p_group_id));
    return v_id;
  end if;

  select * into v_old from public.rounds where id = p_round_id for update;
  if not found then
    perform private.fail('ROUND_NOT_FOUND');
  end if;
  if v_old.status in ('finished', 'under_review') then
    perform private.fail('ROUND_LOCKED');
  end if;
  v_has_submissions := exists (select 1 from public.predictions where round_id = p_round_id and status = 'submitted');
  if v_has_submissions and p_participation is distinct from v_old.participation then
    perform private.fail('ROUND_HAS_SUBMISSIONS');
  end if;
  -- Con jornada abierta, la fecha límite no puede quedar en el pasado.
  if v_old.status = 'open' and p_deadline_at <= now() then
    perform private.fail('DEADLINE_IN_PAST');
  end if;

  update public.rounds
     set name = btrim(p_name),
         description = nullif(btrim(coalesce(p_description, '')), ''),
         opens_at = p_opens_at,
         deadline_at = p_deadline_at,
         participation = coalesce(p_participation, participation)
   where id = p_round_id;

  perform private.log_audit('round.updated', 'round', p_round_id::text, jsonb_build_object(
    'had_submissions', v_has_submissions,
    'before', jsonb_build_object('name', v_old.name, 'opens_at', v_old.opens_at, 'deadline_at', v_old.deadline_at, 'participation', v_old.participation),
    'after', jsonb_build_object('name', p_name, 'opens_at', p_opens_at, 'deadline_at', p_deadline_at, 'participation', p_participation)));
  return p_round_id;
end;
$$;

create or replace function public.admin_set_round_matches(p_round_id uuid, p_match_ids uuid[])
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round public.rounds;
  v_old uuid[];
  v_count int := coalesce(cardinality(p_match_ids), 0);
begin
  perform private.assert_admin();
  select * into v_round from public.rounds where id = p_round_id for update;
  if not found then
    perform private.fail('ROUND_NOT_FOUND');
  end if;
  if v_round.status not in ('draft', 'open') then
    perform private.fail('ROUND_LOCKED');
  end if;
  if v_count > 50 then
    perform private.fail('TOO_MANY_MATCHES');
  end if;
  if v_count <> (select count(distinct x) from unnest(p_match_ids) x) then
    perform private.fail('DUPLICATE_MATCH');
  end if;
  if exists (select 1 from unnest(p_match_ids) x where not exists (select 1 from public.matches m where m.id = x)) then
    perform private.fail('MATCH_NOT_FOUND');
  end if;
  if v_round.status = 'open' and v_count = 0 then
    perform private.fail('ROUND_NEEDS_MATCHES');
  end if;

  select coalesce(array_agg(match_id order by position), '{}') into v_old from public.round_matches where round_id = p_round_id;
  if v_old = coalesce(p_match_ids, '{}') then
    return v_count; -- sin cambios
  end if;

  -- El trigger guard_round_matches bloquea esto si ya hay quinielas enviadas.
  delete from public.round_matches where round_id = p_round_id and not (match_id = any (coalesce(p_match_ids, '{}')));
  -- Reordenamiento en dos pasos para no chocar con unique(round_id, position).
  update public.round_matches set position = position + 100 where round_id = p_round_id;
  insert into public.round_matches (round_id, match_id, position)
  select p_round_id, x.id, x.ord::smallint
  from unnest(p_match_ids) with ordinality as x(id, ord)
  on conflict (round_id, match_id) do update set position = excluded.position;

  perform private.log_audit('round.matches_set', 'round', p_round_id::text,
    jsonb_build_object('before', to_jsonb(v_old), 'after', to_jsonb(p_match_ids), 'status', v_round.status));
  return v_count;
end;
$$;

create or replace function public.admin_set_round_participants(p_round_id uuid, p_user_ids uuid[])
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round public.rounds;
begin
  perform private.assert_admin();
  select * into v_round from public.rounds where id = p_round_id for update;
  if not found then
    perform private.fail('ROUND_NOT_FOUND');
  end if;
  if v_round.status not in ('draft', 'open') then
    perform private.fail('ROUND_LOCKED');
  end if;
  if exists (
    select 1 from unnest(coalesce(p_user_ids, '{}')) x
    where not exists (select 1 from public.group_members gm where gm.group_id = v_round.group_id and gm.user_id = x)
  ) then
    perform private.fail('USER_NOT_IN_GROUP');
  end if;
  -- No se puede excluir a quien ya envió su quiniela.
  if exists (
    select 1 from public.predictions p
    where p.round_id = p_round_id and p.status = 'submitted' and not (p.user_id = any (coalesce(p_user_ids, '{}')))
  ) and v_round.participation = 'selected' then
    perform private.fail('ROUND_HAS_SUBMISSIONS');
  end if;

  delete from public.round_participants where round_id = p_round_id;
  insert into public.round_participants (round_id, user_id)
  select distinct p_round_id, x from unnest(coalesce(p_user_ids, '{}')) x;

  perform private.log_audit('round.participants_set', 'round', p_round_id::text,
    jsonb_build_object('users', to_jsonb(p_user_ids)));
  return coalesce(cardinality(p_user_ids), 0);
end;
$$;

create or replace function public.admin_set_round_status(p_round_id uuid, p_status text, p_reason text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round public.rounds;
  v_first_kickoff timestamptz;
  v_matches int;
begin
  perform private.assert_admin();
  select * into v_round from public.rounds where id = p_round_id for update;
  if not found then
    perform private.fail('ROUND_NOT_FOUND');
  end if;
  if v_round.status = p_status then
    return p_status;
  end if;

  select count(*), min(m.kickoff_at) into v_matches, v_first_kickoff
  from public.round_matches rm join public.matches m on m.id = rm.match_id
  where rm.round_id = p_round_id;

  case
    when v_round.status = 'draft' and p_status = 'open' then
      if v_matches = 0 then
        perform private.fail('ROUND_NEEDS_MATCHES');
      end if;
      if v_round.deadline_at <= now() then
        perform private.fail('DEADLINE_IN_PAST');
      end if;
      if v_round.deadline_at > v_first_kickoff then
        perform private.fail('DEADLINE_AFTER_KICKOFF');
      end if;
      if v_round.participation = 'selected' and not exists (select 1 from public.round_participants where round_id = p_round_id) then
        perform private.fail('ROUND_NEEDS_PARTICIPANTS');
      end if;
      update public.rounds set status = 'open', opened_at = coalesce(opened_at, now()) where id = p_round_id;

    when v_round.status = 'open' and p_status = 'draft' then
      if exists (select 1 from public.predictions where round_id = p_round_id) then
        perform private.fail('ROUND_HAS_PREDICTIONS');
      end if;
      update public.rounds set status = 'draft' where id = p_round_id;

    when v_round.status = 'open' and p_status = 'closed' then
      update public.rounds set status = 'closed', closed_at = now() where id = p_round_id;

    when v_round.status = 'closed' and p_status = 'open' then
      if v_round.deadline_at <= now() then
        perform private.fail('DEADLINE_IN_PAST');
      end if;
      update public.rounds set status = 'open', closed_at = null where id = p_round_id;

    when v_round.status = 'closed' and p_status = 'finished' then
      if exists (
        select 1 from public.round_matches rm join public.matches m on m.id = rm.match_id
        where rm.round_id = p_round_id
          and not ((m.status = 'finished' and m.result_confirmed) or m.status in ('cancelled', 'abandoned', 'postponed'))
      ) then
        perform private.fail('RESULTS_PENDING');
      end if;
      update public.rounds set status = 'finished', finalized_at = now() where id = p_round_id;

    when v_round.status = 'finished' and p_status = 'under_review' then
      if p_reason is null or char_length(btrim(p_reason)) < 5 then
        perform private.fail('REASON_REQUIRED');
      end if;
      update public.rounds set status = 'under_review' where id = p_round_id;

    when v_round.status = 'under_review' and p_status = 'finished' then
      update public.rounds set status = 'finished', finalized_at = now() where id = p_round_id;

    else
      perform private.fail('INVALID_TRANSITION', v_round.status || ' -> ' || p_status);
  end case;

  perform private.recompute_round_scores(p_round_id);
  perform private.log_audit('round.status_changed', 'round', p_round_id::text,
    jsonb_build_object('from', v_round.status, 'to', p_status, 'reason', p_reason));
  return p_status;
end;
$$;

create or replace function public.admin_delete_round(p_round_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round public.rounds;
begin
  perform private.assert_admin();
  select * into v_round from public.rounds where id = p_round_id for update;
  if not found then
    perform private.fail('ROUND_NOT_FOUND');
  end if;
  if v_round.status <> 'draft' or exists (select 1 from public.predictions where round_id = p_round_id) then
    perform private.fail('ROUND_LOCKED');
  end if;
  delete from public.rounds where id = p_round_id;
  perform private.log_audit('round.deleted', 'round', p_round_id::text, jsonb_build_object('name', v_round.name));
end;
$$;

create or replace function public.admin_round_submissions(p_round_id uuid)
returns table (user_id uuid, display_name text, prediction_status text, items int, submitted_at timestamptz, points int)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_round public.rounds;
begin
  perform private.assert_admin();
  select * into v_round from public.rounds where id = p_round_id;
  if not found then
    perform private.fail('ROUND_NOT_FOUND');
  end if;
  return query
  select p.id, p.display_name, coalesce(pr.status, 'none'),
         (select count(*)::int from public.prediction_items pi where pi.prediction_id = pr.id),
         pr.submitted_at, rs.points
  from public.group_members gm
  join public.profiles p on p.id = gm.user_id
  left join public.predictions pr on pr.round_id = p_round_id and pr.user_id = p.id
  left join public.round_scores rs on rs.round_id = p_round_id and rs.user_id = p.id
  where gm.group_id = v_round.group_id and gm.status = 'active'
    and (v_round.participation = 'all_members'
         or exists (select 1 from public.round_participants rp where rp.round_id = p_round_id and rp.user_id = p.id))
  order by pr.submitted_at nulls last, p.display_name;
end;
$$;

-- ---------------------------------------------------------------------
-- Resultados: corrección manual controlada (siempre con motivo y auditoría)
-- ---------------------------------------------------------------------
create or replace function public.admin_record_result(
  p_match_id uuid, p_home int, p_away int, p_status text, p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := private.assert_admin();
  v_old public.matches;
  v_round uuid;
begin
  if p_status not in ('scheduled', 'live', 'finished', 'postponed', 'suspended', 'cancelled', 'abandoned') then
    perform private.fail('INVALID_STATUS');
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 5 then
    perform private.fail('REASON_REQUIRED');
  end if;
  if (p_home is null) <> (p_away is null) or p_home < 0 or p_away < 0 or p_home > 99 or p_away > 99 then
    perform private.fail('INVALID_GOALS');
  end if;
  if p_status in ('live', 'finished') and p_home is null then
    perform private.fail('INVALID_GOALS');
  end if;

  select * into v_old from public.matches where id = p_match_id for update;
  if not found then
    perform private.fail('MATCH_NOT_FOUND');
  end if;

  update public.matches
     set status = p_status,
         home_goals = case when p_status in ('cancelled', 'postponed') then null else p_home end,
         away_goals = case when p_status in ('cancelled', 'postponed') then null else p_away end,
         result_confirmed = (p_status = 'finished'),
         confirmed_at = case when p_status = 'finished' then now() else null end,
         result_source = 'admin'
   where id = p_match_id;

  insert into public.match_results (match_id, status, home_goals, away_goals, is_final, source, reason, recorded_by)
  values (p_match_id, p_status, p_home, p_away, p_status = 'finished', 'admin', btrim(p_reason), v_admin);

  perform private.log_audit('match.result_overridden', 'match', p_match_id::text, jsonb_build_object(
    'reason', p_reason,
    'before', jsonb_build_object('status', v_old.status, 'home', v_old.home_goals, 'away', v_old.away_goals, 'confirmed', v_old.result_confirmed),
    'after', jsonb_build_object('status', p_status, 'home', p_home, 'away', p_away)));

  for v_round in
    select rm.round_id from public.round_matches rm join public.rounds r on r.id = rm.round_id
    where rm.match_id = p_match_id and r.status <> 'draft'
  loop
    perform private.refresh_round_state(v_round);
  end loop;
end;
$$;

-- Devuelve el control del marcador al proveedor automático.
create or replace function public.admin_release_result_override(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_admin();
  update public.matches set result_source = 'provider' where id = p_match_id and result_source = 'admin';
  if found then
    perform private.log_audit('match.override_released', 'match', p_match_id::text, '{}'::jsonb);
  end if;
end;
$$;

create or replace function public.admin_recompute_round(p_round_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  perform private.assert_admin();
  v_status := private.refresh_round_state(p_round_id);
  if v_status is null then
    perform private.fail('ROUND_NOT_FOUND');
  end if;
  perform private.log_audit('round.recomputed', 'round', p_round_id::text, jsonb_build_object('status', v_status));
  return v_status;
end;
$$;

create or replace function public.admin_update_setting(p_key text, p_value jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := private.assert_admin();
  v_old jsonb;
begin
  if p_key = 'payments_enabled' then
    perform private.fail('SETTING_LOCKED', 'Los cobros reales están deshabilitados en esta versión');
  end if;
  if p_key = 'max_goals' and ((p_value #>> '{}')::int not between 5 and 30) then
    perform private.fail('INVALID_SETTING');
  end if;
  select value into v_old from public.app_settings where key = p_key for update;
  if not found then
    perform private.fail('SETTING_NOT_FOUND');
  end if;
  update public.app_settings set value = p_value, updated_at = now(), updated_by = v_admin where key = p_key;
  perform private.log_audit('setting.updated', 'app_setting', p_key, jsonb_build_object('from', v_old, 'to', p_value));
end;
$$;

-- ---------------------------------------------------------------------
-- Permisos de ejecución
-- ---------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;
revoke execute on function private.assert_admin() from public, anon, authenticated;

grant execute on function public.admin_dashboard_stats() to authenticated;
grant execute on function public.admin_list_participants() to authenticated;
grant execute on function public.admin_set_user_status(uuid, text) to authenticated;
grant execute on function public.admin_set_user_role(uuid, text) to authenticated;
grant execute on function public.admin_save_group(uuid, text, text, boolean, boolean) to authenticated;
grant execute on function public.admin_regenerate_invite_code(uuid) to authenticated;
grant execute on function public.admin_set_member(uuid, uuid, text, text) to authenticated;
grant execute on function public.admin_add_member_by_email(uuid, text) to authenticated;
grant execute on function public.admin_group_members(uuid) to authenticated;
grant execute on function public.admin_save_round(uuid, uuid, text, text, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.admin_set_round_matches(uuid, uuid[]) to authenticated;
grant execute on function public.admin_set_round_participants(uuid, uuid[]) to authenticated;
grant execute on function public.admin_set_round_status(uuid, text, text) to authenticated;
grant execute on function public.admin_delete_round(uuid) to authenticated;
grant execute on function public.admin_round_submissions(uuid) to authenticated;
grant execute on function public.admin_record_result(uuid, int, int, text, text) to authenticated;
grant execute on function public.admin_release_result_override(uuid) to authenticated;
grant execute on function public.admin_recompute_round(uuid) to authenticated;
grant execute on function public.admin_update_setting(text, jsonb) to authenticated;
-- Las funciones de jugador ya se concedieron en la migración anterior.
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
