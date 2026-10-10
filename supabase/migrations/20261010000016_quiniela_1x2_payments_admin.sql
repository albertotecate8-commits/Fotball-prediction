-- =====================================================================
-- Captura 1X2, datos de pago y alta segura del administrador.
-- Solo se AGREGAN objetos; las tablas y datos existentes no se tocan.
--
-- Reglas de puntos (sin cambios): acertar 1X2 = 3; marcador exacto = 5.
-- El marcador exacto ahora es opcional: con solo 1X2 se puede sumar 3.
-- Desempate por error de goles: sin marcador cuenta como si fuera 0-0.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Pronósticos 1X2 (+ marcador opcional)
-- ---------------------------------------------------------------------
create table if not exists public.prediction_picks (
  prediction_id uuid not null references public.predictions (id) on delete cascade,
  match_id      uuid not null references public.matches (id),
  outcome       text check (outcome in ('1', 'X', '2')),
  home_goals    smallint check (home_goals between 0 and 99),
  away_goals    smallint check (away_goals between 0 and 99),
  updated_at    timestamptz not null default now(),
  primary key (prediction_id, match_id),
  check ((home_goals is null) = (away_goals is null)),
  check (home_goals is null or outcome is not null)
);
create index if not exists prediction_picks_match_idx on public.prediction_picks (match_id);

-- Si hay marcador, el 1X2 se deriva de él (nunca pueden contradecirse).
create or replace function private.normalize_pick()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.home_goals is not null then
    new.outcome := case when new.home_goals > new.away_goals then '1' when new.home_goals < new.away_goals then '2' else 'X' end;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create or replace trigger prediction_picks_normalize before insert or update on public.prediction_picks
  for each row execute function private.normalize_pick();
-- Un pronóstico enviado es inmutable (mismo guardián que prediction_items).
create or replace trigger prediction_picks_guard before insert or update or delete on public.prediction_picks
  for each row execute function private.guard_submitted_items();

alter table public.prediction_picks enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'prediction_picks' and policyname = 'prediction_picks_read') then
    create policy prediction_picks_read on public.prediction_picks for select to authenticated
      using (private.is_admin() or exists (select 1 from public.predictions p where p.id = prediction_id and p.user_id = (select auth.uid())));
  end if;
end $$;
revoke all on public.prediction_picks from anon;
revoke insert, update, truncate on public.prediction_picks from authenticated;
grant select on public.prediction_picks to authenticated;

-- Entrada: [{ match_id, outcome: '1'|'X'|'2'|null, home?: int, away?: int }]
create or replace function private.parse_quiniela_picks(p_round_id uuid, p_items jsonb, p_require_complete boolean)
returns table (match_id uuid, outcome text, home_goals smallint, away_goals smallint)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_max int := private.setting_int('max_goals', 15);
  v_elem jsonb;
  v_mid uuid;
  v_out text;
  v_h numeric;
  v_a numeric;
  v_seen uuid[] := '{}';
  v_filled int := 0;
  v_total int;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 50 then
    perform private.fail('INVALID_ITEMS');
  end if;
  for v_elem in select e.value from jsonb_array_elements(p_items) as e loop
    if jsonb_typeof(v_elem) <> 'object' then
      perform private.fail('INVALID_ITEMS');
    end if;
    begin
      v_mid := (v_elem ->> 'match_id')::uuid;
    exception when others then
      perform private.fail('INVALID_MATCH');
    end;
    if v_mid is null then perform private.fail('INVALID_MATCH'); end if;
    if v_mid = any (v_seen) then perform private.fail('DUPLICATE_MATCH'); end if;
    if not exists (select 1 from public.round_matches rm where rm.round_id = p_round_id and rm.match_id = v_mid) then
      perform private.fail('MATCH_NOT_IN_ROUND');
    end if;
    v_seen := v_seen || v_mid;

    v_out := nullif(v_elem ->> 'outcome', '');
    if v_out is not null and v_out not in ('1', 'X', '2') then perform private.fail('INVALID_OUTCOME'); end if;

    if coalesce(jsonb_typeof(v_elem -> 'home'), 'null') = 'null' and coalesce(jsonb_typeof(v_elem -> 'away'), 'null') = 'null' then
      v_h := null; v_a := null;
    else
      if jsonb_typeof(v_elem -> 'home') is distinct from 'number' or jsonb_typeof(v_elem -> 'away') is distinct from 'number' then
        perform private.fail('INVALID_GOALS');
      end if;
      v_h := (v_elem ->> 'home')::numeric;
      v_a := (v_elem ->> 'away')::numeric;
      if v_h <> trunc(v_h) or v_a <> trunc(v_a) or v_h < 0 or v_a < 0 or v_h > v_max or v_a > v_max then
        perform private.fail('INVALID_GOALS');
      end if;
      if v_out is not null and v_out <> (case when v_h > v_a then '1' when v_h < v_a then '2' else 'X' end) then
        perform private.fail('OUTCOME_MISMATCH');
      end if;
    end if;

    if v_out is null and v_h is null then
      if p_require_complete then perform private.fail('INCOMPLETE_PREDICTION'); end if;
    else
      v_filled := v_filled + 1;
    end if;
    match_id := v_mid; outcome := v_out; home_goals := v_h::smallint; away_goals := v_a::smallint;
    return next;
  end loop;

  if p_require_complete then
    select count(*) into v_total from public.round_matches rm where rm.round_id = p_round_id;
    if v_filled <> v_total then perform private.fail('INCOMPLETE_PREDICTION'); end if;
  end if;
end;
$$;

-- Ver la jornada basta para GUARDAR un borrador en el servidor (se recupera
-- en cualquier dispositivo). El ENVÍO oficial exige pago confirmado.
create or replace function private.lock_round_for_view(p_round_id uuid, p_user_id uuid)
returns public.rounds
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round public.rounds;
begin
  select * into v_round from public.rounds where id = p_round_id for share;
  if not found or not private.can_view_round(p_round_id, p_user_id) then
    perform private.fail('ROUND_NOT_FOUND');
  end if;
  return v_round;
end;
$$;

create or replace function private.write_picks(p_pred uuid, p_round_id uuid, p_items jsonb, p_require_complete boolean)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  insert into public.prediction_picks (prediction_id, match_id, outcome, home_goals, away_goals)
  select p_pred, x.match_id, x.outcome, x.home_goals, x.away_goals
  from private.parse_quiniela_picks(p_round_id, p_items, p_require_complete) x
  on conflict (prediction_id, match_id) do update
    set outcome = excluded.outcome, home_goals = excluded.home_goals, away_goals = excluded.away_goals
    where public.prediction_picks.outcome is distinct from excluded.outcome
       or public.prediction_picks.home_goals is distinct from excluded.home_goals
       or public.prediction_picks.away_goals is distinct from excluded.away_goals;
  select count(*) into v_count from public.prediction_picks pp where pp.prediction_id = p_pred and pp.outcome is not null;
  return v_count;
end;
$$;

-- «Guardar mi quiniela»: borrador en el servidor (con o sin pago).
create or replace function public.save_quiniela(p_round_id uuid, p_items jsonb, p_client_seq bigint)
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
  v_round := private.lock_round_for_view(p_round_id, v_uid);
  v_pred := private.lock_prediction(p_round_id, v_uid);
  if v_pred.status = 'submitted' then
    perform private.fail('PREDICTION_LOCKED');
  end if;
  perform private.assert_round_accepting(v_round);
  if p_client_seq is not null and p_client_seq <= v_pred.client_seq then
    perform private.fail('STALE_SAVE');
  end if;
  v_count := private.write_picks(v_pred.id, p_round_id, p_items, false);
  update public.predictions set client_seq = coalesce(p_client_seq, client_seq + 1) where id = v_pred.id returning * into v_pred;
  return jsonb_build_object('status', 'draft', 'saved_at', v_pred.updated_at, 'picks', v_count,
    'total', (select count(*) from public.round_matches rm where rm.round_id = p_round_id),
    'can_submit', private.can_participate(p_round_id, v_uid), 'client_seq', v_pred.client_seq);
end;
$$;

-- «Enviar pronósticos»: definitivo, exige pago confirmado y todos los partidos.
create or replace function public.submit_quiniela(p_round_id uuid, p_items jsonb, p_client_seq bigint default null)
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
  v_round := private.lock_round_for_play(p_round_id, v_uid);   -- incluye PAYMENT_REQUIRED
  v_pred := private.lock_prediction(p_round_id, v_uid);
  if v_pred.status = 'submitted' then
    return jsonb_build_object('status', 'submitted', 'already_submitted', true, 'submitted_at', v_pred.submitted_at);
  end if;
  perform private.assert_round_accepting(v_round);
  v_count := private.write_picks(v_pred.id, p_round_id, p_items, true);
  update public.predictions
     set status = 'submitted', submitted_at = now(), client_seq = greatest(client_seq, coalesce(p_client_seq, client_seq))
   where id = v_pred.id returning * into v_pred;
  perform private.log_audit('prediction.submitted', 'prediction', v_pred.id::text, jsonb_build_object('round_id', p_round_id, 'picks', v_count));
  return jsonb_build_object('status', 'submitted', 'already_submitted', false, 'submitted_at', v_pred.submitted_at, 'picks', v_count);
end;
$$;

-- ---------------------------------------------------------------------
-- Puntos: el cálculo existente se conserva y además se puntúan los 1X2.
-- ---------------------------------------------------------------------
do $$
begin
  if to_regprocedure('private.recompute_round_scores_items(uuid)') is null then
    alter function private.recompute_round_scores(uuid) rename to recompute_round_scores_items;
  end if;
end $$;

create or replace function private.recompute_round_scores(p_round_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_official boolean;
begin
  -- 1) Cálculo original (prediction_items) — limpia y recalcula la jornada.
  perform private.recompute_round_scores_items(p_round_id);
  select r.status = 'finished' into v_official from public.rounds r where r.id = p_round_id;
  if v_official is null then return; end if;

  -- 2) Pronósticos 1X2 (+ marcador opcional) con las mismas reglas.
  insert into public.prediction_item_scores (prediction_id, match_id, points, exact_hit, outcome_hit, goal_error, is_final, computed_at)
  select p.id, pp.match_id,
         case when pp.home_goals is not null then public.score_prediction(pp.home_goals, pp.away_goals, m.home_goals, m.away_goals)
              when pp.outcome = (case when m.home_goals > m.away_goals then '1' when m.home_goals < m.away_goals then '2' else 'X' end) then 3
              else 0 end,
         pp.home_goals is not null and pp.home_goals = m.home_goals and pp.away_goals = m.away_goals,
         pp.outcome = (case when m.home_goals > m.away_goals then '1' when m.home_goals < m.away_goals then '2' else 'X' end),
         case when pp.home_goals is not null then public.goal_error(pp.home_goals, pp.away_goals, m.home_goals, m.away_goals)
              else (m.home_goals + m.away_goals) end,
         m.result_confirmed, now()
  from public.predictions p
  join public.prediction_picks pp on pp.prediction_id = p.id and pp.outcome is not null
  join public.round_matches rm on rm.round_id = p.round_id and rm.match_id = pp.match_id
  join public.matches m on m.id = pp.match_id
  where p.round_id = p_round_id and p.status = 'submitted'
    and m.status in ('live', 'finished') and m.home_goals is not null
  on conflict (prediction_id, match_id) do nothing;

  -- 3) Totales de la jornada con todos los partidos puntuados.
  insert into public.round_scores (round_id, user_id, points, exact_hits, outcome_hits, goal_error, scored_matches, is_official, computed_at)
  select p.round_id, p.user_id,
         coalesce(sum(s.points), 0), count(*) filter (where s.exact_hit), count(*) filter (where s.outcome_hit),
         coalesce(sum(s.goal_error), 0), count(s.match_id), v_official, now()
  from public.predictions p
  left join public.prediction_item_scores s on s.prediction_id = p.id
  where p.round_id = p_round_id and p.status = 'submitted'
  group by p.round_id, p.user_id
  on conflict (round_id, user_id) do update
    set points = excluded.points, exact_hits = excluded.exact_hits, outcome_hits = excluded.outcome_hits,
        goal_error = excluded.goal_error, scored_matches = excluded.scored_matches, is_official = excluded.is_official,
        computed_at = excluded.computed_at;
end;
$$;

-- ---------------------------------------------------------------------
-- Lecturas del jugador: incluyen los pronósticos 1X2
-- ---------------------------------------------------------------------
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
         (select count(*)::int from public.prediction_items pi where pi.prediction_id = p.id)
           + (select count(*)::int from public.prediction_picks pp where pp.prediction_id = p.id and pp.outcome is not null),
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
      'pick', case
        when pp.outcome is not null then jsonb_build_object('outcome', pp.outcome, 'home', pp.home_goals, 'away', pp.away_goals)
        when pi.match_id is not null then jsonb_build_object('home', pi.home_goals, 'away', pi.away_goals,
          'outcome', case when pi.home_goals > pi.away_goals then '1' when pi.home_goals < pi.away_goals then '2' else 'X' end)
        else null end,
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
  left join public.prediction_picks pp on pp.prediction_id = v_pred.id and pp.match_id = m.id
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

-- ---------------------------------------------------------------------
-- Datos para recibir pagos (los configura el admin; nada inventado)
-- ---------------------------------------------------------------------
create table if not exists public.payment_info (
  id           int primary key default 1 check (id = 1),
  bank         text check (bank is null or char_length(bank) <= 80),
  holder       text check (holder is null or char_length(holder) <= 120),
  clabe        text check (clabe is null or clabe ~ '^[0-9]{18}$'),
  account      text check (account is null or char_length(account) <= 40),
  amount       numeric(10, 2) check (amount is null or amount > 0),
  currency     text not null default 'MXN',
  concept      text check (concept is null or char_length(concept) <= 120),
  instructions text check (instructions is null or char_length(instructions) <= 1000),
  contact      text check (contact is null or char_length(contact) <= 120),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references public.profiles (id) on delete set null
);
alter table public.payment_info enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'payment_info' and policyname = 'payment_info_read') then
    create policy payment_info_read on public.payment_info for select to authenticated using (true);
  end if;
end $$;
revoke all on public.payment_info from anon;
revoke insert, update, truncate on public.payment_info from authenticated;
grant select on public.payment_info to authenticated;

-- Referencia para identificar la transferencia de cada participante.
create or replace function private.payment_reference_for(p_user_id uuid)
returns text
language sql
immutable
set search_path = ''
as $$
  select 'SHX-' || upper(substr(replace(p_user_id::text, '-', ''), 1, 6));
$$;

create or replace function public.get_my_payment()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_info public.payment_info;
  v_gm public.group_members;
begin
  select * into v_info from public.payment_info where id = 1;
  select * into v_gm from public.group_members where group_id = private.default_group_id() and user_id = v_uid;
  return jsonb_build_object(
    'configured', v_info.id is not null and (v_info.clabe is not null or v_info.account is not null) and v_info.amount is not null,
    'bank', v_info.bank, 'holder', v_info.holder, 'clabe', v_info.clabe, 'account', v_info.account,
    'amount', v_info.amount, 'currency', coalesce(v_info.currency, 'MXN'), 'concept', v_info.concept,
    'instructions', v_info.instructions, 'contact', v_info.contact,
    'reference', private.payment_reference_for(v_uid),
    'payment_status', coalesce(v_gm.payment_status, 'not_applicable'),
    'valid_until', v_gm.payment_valid_until);
end;
$$;

create or replace function public.admin_save_payment_info(
  p_bank text, p_holder text, p_clabe text, p_account text, p_amount numeric, p_concept text, p_instructions text, p_contact text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := private.assert_admin();
  v_clabe text := nullif(regexp_replace(coalesce(p_clabe, ''), '\s', '', 'g'), '');
begin
  if v_clabe is not null and v_clabe !~ '^[0-9]{18}$' then perform private.fail('INVALID_CLABE'); end if;
  if p_amount is not null and p_amount <= 0 then perform private.fail('INVALID_AMOUNT'); end if;
  insert into public.payment_info (id, bank, holder, clabe, account, amount, concept, instructions, contact, updated_at, updated_by)
  values (1, nullif(btrim(p_bank), ''), nullif(btrim(p_holder), ''), v_clabe, nullif(btrim(p_account), ''), p_amount,
          nullif(btrim(p_concept), ''), nullif(btrim(p_instructions), ''), nullif(btrim(p_contact), ''), now(), v_admin)
  on conflict (id) do update
    set bank = excluded.bank, holder = excluded.holder, clabe = excluded.clabe, account = excluded.account,
        amount = excluded.amount, concept = excluded.concept, instructions = excluded.instructions, contact = excluded.contact,
        updated_at = now(), updated_by = v_admin;
  -- La CLABE completa no se guarda en la auditoría: solo sus últimos 4 dígitos.
  perform private.log_audit('payment_info.updated', 'payment_info', '1', jsonb_build_object(
    'bank', p_bank, 'holder', p_holder, 'clabe_last4', right(v_clabe, 4), 'amount', p_amount));
end;
$$;

-- Participantes con su estado de pago y referencia (solo admin).
create or replace function public.admin_payments()
returns table (user_id uuid, display_name text, email text, reference text, payment_status text, valid_until timestamptz,
               payment_reference text, confirmed_at timestamptz, confirmed_by text, joined_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_admin();
  return query
  select p.id, p.display_name, u.email::text, private.payment_reference_for(p.id), coalesce(gm.payment_status, 'not_applicable'),
         gm.payment_valid_until, gm.payment_reference, gm.payment_confirmed_at, cb.display_name, coalesce(gm.joined_at, p.created_at)
  from public.profiles p
  join auth.users u on u.id = p.id
  left join public.group_members gm on gm.group_id = private.default_group_id() and gm.user_id = p.id
  left join public.profiles cb on cb.id = gm.payment_confirmed_by
  order by p.created_at;
end;
$$;

-- ---------------------------------------------------------------------
-- Administrador por correo: solo cuando el dueño CONFIRMA el correo
-- (Supabase Auth exige confirmación en este proyecto).
-- ---------------------------------------------------------------------
create table if not exists private.admin_email_allowlist (
  email      text primary key check (email = lower(email)),
  added_at   timestamptz not null default now()
);
revoke all on private.admin_email_allowlist from public, anon, authenticated;
insert into private.admin_email_allowlist (email) values ('shabex10@gmail.com') on conflict do nothing;

create or replace function private.promote_allowlisted_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email_confirmed_at is not null
     and exists (select 1 from private.admin_email_allowlist a where a.email = lower(new.email))
     and exists (select 1 from public.profiles p where p.id = new.id and p.role <> 'admin') then
    update public.profiles set role = 'admin' where id = new.id;
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, details)
    values (null, 'admin.allowlist_promoted', 'profile', new.id::text, jsonb_build_object('email_domain', split_part(new.email, '@', 2)));
  end if;
  return new;
end;
$$;

create or replace trigger zz_promote_allowlisted_admin after insert or update of email_confirmed_at on auth.users
  for each row execute function private.promote_allowlisted_admin();

-- Permisos
-- Las funciones privadas nuevas no son invocables por clientes.
revoke execute on function private.parse_quiniela_picks(uuid, jsonb, boolean) from public, anon, authenticated;
revoke execute on function private.lock_round_for_view(uuid, uuid) from public, anon, authenticated;
revoke execute on function private.write_picks(uuid, uuid, jsonb, boolean) from public, anon, authenticated;
revoke execute on function private.payment_reference_for(uuid) from public, anon, authenticated;
revoke execute on function private.recompute_round_scores(uuid) from public, anon, authenticated;
revoke execute on function private.recompute_round_scores_items(uuid) from public, anon, authenticated;
revoke execute on function private.normalize_pick() from public, anon, authenticated;
revoke execute on function private.promote_allowlisted_admin() from public, anon, authenticated;
revoke execute on function public.save_quiniela(uuid, jsonb, bigint) from public, anon;
revoke execute on function public.submit_quiniela(uuid, jsonb, bigint) from public, anon;
revoke execute on function public.get_my_payment() from public, anon;
revoke execute on function public.admin_save_payment_info(text, text, text, text, numeric, text, text, text) from public, anon;
revoke execute on function public.admin_payments() from public, anon;
grant execute on function public.save_quiniela(uuid, jsonb, bigint) to authenticated;
grant execute on function public.submit_quiniela(uuid, jsonb, bigint) to authenticated;
grant execute on function public.get_my_payment() to authenticated;
grant execute on function public.admin_save_payment_info(text, text, text, text, numeric, text, text, text) to authenticated;
grant execute on function public.admin_payments() to authenticated;
