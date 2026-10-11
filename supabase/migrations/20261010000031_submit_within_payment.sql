-- =====================================================================
-- Enviar la quiniela con el pago vigente: los partidos posteriores a la
-- vigencia del pago ya no frenan el envío completo. Se envía todo lo que el
-- pago cubre y lo demás queda guardado sin enviar (se avisa con «unpaid»).
-- Sin pago confirmado sigue sin poder enviarse nada (PAYMENT_REQUIRED).
-- =====================================================================
create or replace function public.submit_pool_picks(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_elem jsonb; v_it record; v_kick timestamptz; v_cur public.pool_picks;
  v_sub int := 0; v_closed int := 0; v_locked int := 0; v_unpaid int := 0;
  v_given uuid[] := '{}';
  v_missing int;
  v_outcome text;
  v_weeks uuid[];
  v_week uuid;
  v_goals int := 0;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 100 then perform private.fail('INVALID_ITEMS'); end if;
  -- 1. Cada partido con su 1 / X / 2 (si llega un marcador, el resultado sale de él).
  for v_elem in select e.value from jsonb_array_elements(p_items) e loop
    select * into v_it from private.parse_pool_item(v_elem);
    if coalesce(v_it.outcome, case when v_it.home_goals is null then null when v_it.home_goals > v_it.away_goals then '1' when v_it.home_goals < v_it.away_goals then '2' else 'X' end) is null then
      perform private.fail('OUTCOME_REQUIRED');
    end if;
    v_given := v_given || v_it.match_id;
  end loop;
  -- 2. Completa: todos los partidos abiertos pendientes de este jugador.
  select count(*) into v_missing
  from public.pool_matches pm join public.matches mm on mm.id = pm.match_id
  where pm.status = 'published' and private.pool_match_open(pm.match_id) and private.can_pick(v_uid, mm.kickoff_at)
    and not exists (select 1 from public.pool_picks pp where pp.user_id = v_uid and pp.match_id = pm.match_id and pp.status = 'submitted')
    and not (pm.match_id = any (v_given));
  if v_missing > 0 then perform private.fail('INCOMPLETE_QUINIELA'); end if;
  -- 3. Total de goles de cada semana que aún no empieza (desempate).
  select array(select distinct (private.week_for(m.kickoff_at)).id from public.matches m where m.id = any (v_given)
                  and private.pool_match_open(m.id) and private.can_pick(v_uid, m.kickoff_at)) into v_weeks;
  foreach v_week in array coalesce(v_weeks, '{}') loop
    continue when v_week is null or not private.week_goals_open(v_week);
    continue when exists (select 1 from public.pool_week_goals g where g.user_id = v_uid and g.week_id = v_week and g.status = 'submitted');
    if not exists (select 1 from public.pool_week_goals g where g.user_id = v_uid and g.week_id = v_week) then perform private.fail('WEEK_GOALS_REQUIRED'); end if;
  end loop;

  for v_elem in select e.value from jsonb_array_elements(p_items) e loop
    select * into v_it from private.parse_pool_item(v_elem);
    select * into v_cur from public.pool_picks where user_id = v_uid and match_id = v_it.match_id;
    if v_cur.status = 'submitted' then v_locked := v_locked + 1; continue; end if;
    if not private.pool_match_open(v_it.match_id) then v_closed := v_closed + 1; continue; end if;
    select kickoff_at into v_kick from public.matches where id = v_it.match_id;
    -- Partidos fuera de la vigencia del pago se quedan guardados sin enviar; no frenan el resto.
    if not private.can_pick(v_uid, v_kick) then v_unpaid := v_unpaid + 1; continue; end if;
    v_outcome := coalesce(v_it.outcome, case when v_it.home_goals > v_it.away_goals then '1' when v_it.home_goals < v_it.away_goals then '2' else 'X' end);
    insert into public.pool_picks (user_id, match_id, outcome, home_goals, away_goals, status, submitted_at)
    values (v_uid, v_it.match_id, v_outcome, null, null, 'submitted', now())
    on conflict (user_id, match_id) do update
      set outcome = excluded.outcome, home_goals = null, away_goals = null, status = 'submitted', submitted_at = now();
    v_sub := v_sub + 1;
  end loop;
  if v_sub = 0 and v_unpaid > 0 then perform private.fail('PAYMENT_REQUIRED'); end if;
  if v_sub > 0 then
    with s as (
      update public.pool_week_goals g set status = 'submitted', submitted_at = now()
       where g.user_id = v_uid and g.status = 'draft' and g.week_id = any (coalesce(v_weeks, '{}')) and private.week_goals_open(g.week_id)
      returning 1)
    select count(*) into v_goals from s;
    perform private.log_audit('pool.picks_submitted', 'profile', v_uid::text, jsonb_build_object('count', v_sub, 'week_goals', v_goals));
  end if;
  return jsonb_build_object('submitted', v_sub, 'closed', v_closed, 'already_submitted', v_locked, 'week_goals', v_goals, 'unpaid', v_unpaid, 'submitted_at', now());
end;
$$;
