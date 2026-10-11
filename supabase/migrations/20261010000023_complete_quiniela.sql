-- Quiniela completa y con marcador: al enviar, cada partido debe llevar su
-- marcador exacto y deben ir TODOS los partidos abiertos que el jugador aún no
-- envió. No se aceptan envíos parciales. (Guardar borradores sigue libre.)
create or replace function public.submit_pool_picks(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_elem jsonb; v_it record; v_kick timestamptz; v_cur public.pool_picks;
  v_sub int := 0; v_closed int := 0; v_locked int := 0;
  v_given uuid[] := '{}';
  v_missing int;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 100 then perform private.fail('INVALID_ITEMS'); end if;
  -- 1. Cada partido con marcador exacto.
  for v_elem in select e.value from jsonb_array_elements(p_items) e loop
    select * into v_it from private.parse_pool_item(v_elem);
    if v_it.home_goals is null or v_it.away_goals is null then perform private.fail('SCORE_REQUIRED'); end if;
    v_given := v_given || v_it.match_id;
  end loop;
  -- 2. Completa: todos los partidos abiertos pendientes de este jugador.
  select count(*) into v_missing
  from public.pool_matches pm
  where pm.status = 'published' and private.pool_match_open(pm.match_id)
    and not exists (select 1 from public.pool_picks pp where pp.user_id = v_uid and pp.match_id = pm.match_id and pp.status = 'submitted')
    and not (pm.match_id = any (v_given));
  if v_missing > 0 then perform private.fail('INCOMPLETE_QUINIELA'); end if;

  for v_elem in select e.value from jsonb_array_elements(p_items) e loop
    select * into v_it from private.parse_pool_item(v_elem);
    select * into v_cur from public.pool_picks where user_id = v_uid and match_id = v_it.match_id;
    if v_cur.status = 'submitted' then v_locked := v_locked + 1; continue; end if;
    if not private.pool_match_open(v_it.match_id) then v_closed := v_closed + 1; continue; end if;
    select kickoff_at into v_kick from public.matches where id = v_it.match_id;
    if not private.can_pick(v_uid, v_kick) then perform private.fail('PAYMENT_REQUIRED'); end if;
    insert into public.pool_picks (user_id, match_id, outcome, home_goals, away_goals, status, submitted_at)
    values (v_uid, v_it.match_id, v_it.outcome, v_it.home_goals, v_it.away_goals, 'submitted', now())
    on conflict (user_id, match_id) do update
      set outcome = excluded.outcome, home_goals = excluded.home_goals, away_goals = excluded.away_goals,
          status = 'submitted', submitted_at = now();
    v_sub := v_sub + 1;
  end loop;
  if v_sub > 0 then
    perform private.log_audit('pool.picks_submitted', 'profile', v_uid::text, jsonb_build_object('count', v_sub));
  end if;
  return jsonb_build_object('submitted', v_sub, 'closed', v_closed, 'already_submitted', v_locked, 'submitted_at', now());
end;
$$;

revoke execute on function public.submit_pool_picks(jsonb) from public, anon;
grant execute on function public.submit_pool_picks(jsonb) to authenticated;
