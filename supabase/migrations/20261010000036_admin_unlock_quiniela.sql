-- =====================================================================
-- El admin puede autorizar a un participante a editar su quiniela enviada.
-- Sus pronósticos de partidos que aún no empiezan (y el total de goles de
-- la jornada, si sigue abierto) vuelven a borrador; los cambia y la envía
-- de nuevo. Nada de lo ya jugado se toca. Solo el admin, con auditoría.
-- =====================================================================
create or replace function private.guard_pool_pick()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Solo el admin (admin_unlock_quiniela) puede regresar un envío a borrador.
  if tg_op = 'UPDATE' and old.status = 'submitted' and new.status = 'draft'
     and current_setting('shabex.unlock_rpc', true) = 'on' then
    new.updated_at := now();
    return new;
  end if;
  if tg_op in ('UPDATE', 'DELETE') and old.status = 'submitted' then
    raise exception 'PREDICTION_LOCKED' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if not private.pool_match_open(new.match_id) then
    raise exception 'MATCH_CLOSED' using errcode = 'P0001';
  end if;
  if new.home_goals is not null then
    new.outcome := case when new.home_goals > new.away_goals then '1' when new.home_goals < new.away_goals then '2' else 'X' end;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.guard_week_goals()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and old.status = 'submitted' and new.status = 'draft'
     and current_setting('shabex.unlock_rpc', true) = 'on' then
    new.updated_at := now();
    return new;
  end if;
  if tg_op in ('UPDATE', 'DELETE') and old.status = 'submitted' then
    raise exception 'PREDICTION_LOCKED' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.admin_unlock_quiniela(p_user uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := private.assert_admin();
  v_picks int;
  v_goals int;
begin
  if not exists (select 1 from public.profiles where id = p_user) then perform private.fail('USER_NOT_FOUND'); end if;
  perform set_config('shabex.unlock_rpc', 'on', true);
  with u as (
    update public.pool_picks set status = 'draft', submitted_at = null
     where user_id = p_user and status = 'submitted' and private.pool_match_open(match_id)
    returning 1)
  select count(*) into v_picks from u;
  with u as (
    update public.pool_week_goals set status = 'draft', submitted_at = null
     where user_id = p_user and status = 'submitted' and private.week_goals_open(week_id)
    returning 1)
  select count(*) into v_goals from u;
  perform set_config('shabex.unlock_rpc', 'off', true);
  if v_picks = 0 and v_goals = 0 then perform private.fail('NOTHING_TO_UNLOCK'); end if;
  perform private.log_audit('pool.picks_unlocked', 'profile', p_user::text, jsonb_build_object(
    'picks', v_picks, 'week_goals', v_goals, 'by', v_admin,
    'reason', coalesce(nullif(left(btrim(coalesce(p_reason, '')), 300), ''), 'Edición autorizada por el administrador')));
  return jsonb_build_object('picks', v_picks, 'week_goals', v_goals);
end;
$$;

create or replace function public.admin_payment_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'user_id', p.id, 'alias', p.display_name, 'email', u.email::text,
      'reference', private.payment_reference_for(p.id), 'legacy_reference', r.legacy_reference,
      'state', private.payment_state(gm.payment_status, gm.payment_valid_until),
      'payment_status', coalesce(gm.payment_status, 'not_applicable'),
      'amount', gm.payment_amount, 'method', gm.payment_method, 'bank_reference', gm.payment_reference,
      'confirmed_at', gm.payment_confirmed_at, 'valid_until', gm.payment_valid_until,
      'confirmed_by', cb.display_name,
      'sent_open', (select count(*) from public.pool_picks pp where pp.user_id = p.id and pp.status = 'submitted' and private.pool_match_open(pp.match_id)), 'joined_at', coalesce(gm.joined_at, p.created_at), 'in_group', gm.user_id is not null
    ) order by p.created_at)
    from public.profiles p
    join auth.users u on u.id = p.id
    left join public.payment_references r on r.user_id = p.id
    left join public.group_members gm on gm.group_id = private.default_group_id() and gm.user_id = p.id
    left join public.profiles cb on cb.id = gm.payment_confirmed_by), '[]'::jsonb);
end;
$$;

-- «Publicar selección» también respeta una quiniela a la vez.
create or replace function public.admin_publish_selection(p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := private.assert_admin();
  v_pub int := 0;
  v_wd int := 0;
  v_wd_picks int := 0;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  -- Lo que se va a retirar (publicado y ya no seleccionado, sin haber empezado).
  select count(*), coalesce(sum((select count(*) from public.pool_picks pp where pp.match_id = pm.match_id and pp.status = 'submitted')), 0)
    into v_wd, v_wd_picks
    from public.pool_matches pm
    join public.pool_candidates c on c.match_id = pm.match_id
   where pm.status = 'published' and c.state <> 'selected';
  if v_wd > 0 and char_length(coalesce(v_reason, '')) < 5 then perform private.fail('REASON_REQUIRED'); end if;

  update public.pool_matches pm set status = 'withdrawn', changed_by = v_admin, changed_at = now(), change_reason = left(v_reason, 300)
    from public.pool_candidates c
   where c.match_id = pm.match_id and pm.status = 'published' and c.state <> 'selected';

  with up as (
    insert into public.pool_matches (match_id, status, source, added_by, sort_order)
    select c.match_id, 'published', c.source, v_admin, c.sort_order
    from public.pool_candidates c join public.matches m on m.id = c.match_id
    where c.state = 'selected' and m.status = 'scheduled' and m.kickoff_at > now()
      and not exists (select 1 from public.pool_matches x where x.match_id = c.match_id and x.status = 'published')
      -- Una quiniela a la vez: lo de la semana siguiente espera a que termine la actual.
      and private.previous_week_done(coalesce((private.week_for(m.kickoff_at)).week_start, private.local_day(m.kickoff_at)))
    on conflict (match_id) do update set status = 'published', sort_order = excluded.sort_order, changed_by = v_admin, changed_at = now(),
      change_reason = 'Publicado por el administrador'
    returning 1)
  select count(*) into v_pub from up;

  -- Orden de presentación para los jugadores.
  update public.pool_matches pm set sort_order = c.sort_order
    from public.pool_candidates c where c.match_id = pm.match_id and pm.sort_order is distinct from c.sort_order;

  perform private.log_audit('pool.selection_published', 'pool', 'next',
    jsonb_build_object('published', v_pub, 'withdrawn', v_wd, 'withdrawn_with_picks', v_wd_picks, 'reason', v_reason));
  return jsonb_build_object('published', v_pub, 'withdrawn', v_wd, 'withdrawn_picks', v_wd_picks);
end;
$$;

revoke execute on function public.admin_unlock_quiniela(uuid, text) from public, anon;
grant execute on function public.admin_unlock_quiniela(uuid, text) to authenticated;
