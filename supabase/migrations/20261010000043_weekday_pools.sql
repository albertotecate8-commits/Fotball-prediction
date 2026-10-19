-- =====================================================================
-- Quinielas aparte dentro de la misma semana (p. ej. «entre semana»: Champions
-- y Liga MX de martes a jueves). Cada jornada tiene sus días (week_start a
-- end_day), sus partidos (pool_matches.week_id), su total de goles, su
-- clasificación y, si tiene entry_amount, su propia entrada y su propia bolsa
-- (70 % de las entradas confirmadas por el admin). La semana normal no cambia.
-- =====================================================================
alter table public.pool_weeks add column if not exists end_day date;
alter table public.pool_weeks add column if not exists kind text not null default 'week';
alter table public.pool_weeks add column if not exists entry_amount numeric(10, 2);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'pool_weeks_kind_check') then
    alter table public.pool_weeks add constraint pool_weeks_kind_check check (kind in ('week', 'weekday'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pool_weeks_end_day_check') then
    alter table public.pool_weeks add constraint pool_weeks_end_day_check check (end_day is null or (end_day >= week_start and end_day <= week_start + 6));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pool_weeks_entry_check') then
    alter table public.pool_weeks add constraint pool_weeks_entry_check check (entry_amount is null or (entry_amount > 0 and entry_amount <= 100000));
  end if;
end $$;

-- Entradas confirmadas por el admin para las jornadas con entrada aparte.
create table if not exists public.pool_entries (
  week_id         uuid not null references public.pool_weeks (id),
  user_id         uuid not null references public.profiles (id),
  amount          numeric(10, 2) not null check (amount > 0),
  confirmed_by    uuid references public.profiles (id) on delete set null,
  confirmed_at    timestamptz not null default now(),
  primary key (week_id, user_id)
);
alter table public.pool_entries enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'pool_entries' and policyname = 'pool_entries_read_own') then
    create policy pool_entries_read_own on public.pool_entries for select to authenticated using (user_id = (select auth.uid()) or private.is_admin());
  end if;
end $$;
revoke all on public.pool_entries from anon;
revoke insert, update, delete, truncate on public.pool_entries from authenticated;
grant select on public.pool_entries to authenticated;
create index if not exists pool_entries_user_idx on public.pool_entries (user_id);
create index if not exists pool_entries_confirmed_by_idx on public.pool_entries (confirmed_by);

-- La jornada de un día: la más corta que lo contenga (entre semana antes que la semana).
create or replace function private.week_for(p_ts timestamptz)
returns public.pool_weeks language sql stable security definer set search_path = '' as $$
  select w.* from public.pool_weeks w
  where private.local_day(p_ts) between w.week_start and coalesce(w.end_day, w.week_start + 6)
  order by coalesce(w.end_day, w.week_start + 6) - w.week_start, w.week_start
  limit 1;
$$;

-- Partidos publicados de una jornada: los asignados a ella (o, sin asignar, por fecha).
create or replace function private.week_published(p_week uuid)
returns table (match_id uuid, kickoff_at timestamptz, status text, home_goals smallint, away_goals smallint, result_confirmed boolean)
language sql stable security definer set search_path = '' as $$
  select m.id, m.kickoff_at, m.status, m.home_goals, m.away_goals, m.result_confirmed
  from public.pool_matches pm
  join public.matches m on m.id = pm.match_id
  where pm.status = 'published'
    and (pm.week_id = p_week
         or (pm.week_id is null and (private.week_for(m.kickoff_at)).id = p_week));
$$;

create or replace function private.pick_week(p_week uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select coalesce(p_week, (
    select w.id from public.pool_weeks w
     where exists (select 1 from private.week_published(w.id))
     order by (private.local_day(now()) between w.week_start and coalesce(w.end_day, w.week_start + 6)) desc,
              (w.week_start <= private.local_day(now())) desc,
              coalesce(w.end_day, w.week_start + 6) - w.week_start,
              abs(w.week_start - private.local_day(now()))
     limit 1));
$$;

-- ¿Puede enviar este partido? Jornada con entrada aparte → su entrada; si no, el pago de la semana.
create or replace function private.can_pick_match(p_user_id uuid, p_match uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when w.entry_amount is not null then exists (select 1 from public.pool_entries e where e.week_id = w.id and e.user_id = p_user_id)
    else private.can_pick(p_user_id, m.kickoff_at) end
  from public.matches m
  left join public.pool_matches pm on pm.match_id = m.id
  left join public.pool_weeks w on w.id = coalesce(pm.week_id, (private.week_for(m.kickoff_at)).id)
  where m.id = p_match;
$$;

-- Admin: confirma (o quita) la entrada de un participante a una jornada con entrada aparte.
create or replace function public.admin_set_entry(p_week uuid, p_user uuid, p_confirmed boolean, p_amount numeric default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := private.assert_admin();
  w public.pool_weeks;
  v_amount numeric;
begin
  select * into w from public.pool_weeks where id = p_week;
  if not found or w.entry_amount is null then perform private.fail('WEEK_NOT_FOUND'); end if;
  if not exists (select 1 from public.profiles where id = p_user) then perform private.fail('USER_NOT_FOUND'); end if;
  if p_amount is not null and (p_amount <= 0 or p_amount > 100000) then perform private.fail('INVALID_AMOUNT'); end if;
  v_amount := coalesce(p_amount, w.entry_amount);
  if coalesce(p_confirmed, false) then
    insert into public.pool_entries (week_id, user_id, amount, confirmed_by, confirmed_at)
    values (p_week, p_user, v_amount, v_admin, now())
    on conflict (week_id, user_id) do update set amount = excluded.amount, confirmed_by = v_admin, confirmed_at = now();
  else
    delete from public.pool_entries where week_id = p_week and user_id = p_user;
  end if;
  perform private.log_audit('pool.entry_' || case when coalesce(p_confirmed, false) then 'confirmed' else 'removed' end, 'pool_week', p_week::text,
    jsonb_build_object('user', p_user, 'amount', case when coalesce(p_confirmed, false) then v_amount end, 'label', w.label, 'by', v_admin));
  return jsonb_build_object('confirmed', coalesce(p_confirmed, false), 'amount', v_amount);
end;
$$;

create or replace function private.sees_pick(p_viewer uuid, p_match uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_admin()
      or (private.can_pick_match(p_viewer, p_match)
          and exists (select 1 from public.pool_picks pp where pp.user_id = p_viewer and pp.match_id = p_match and pp.status = 'submitted'));
$$;

create or replace function private.sees_week_goals(p_viewer uuid, p_week uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_admin()
      or ((case when (select w.entry_amount from public.pool_weeks w where w.id = p_week) is not null
                then exists (select 1 from public.pool_entries e where e.week_id = p_week and e.user_id = p_viewer)
                else private.can_pick(p_viewer, now()) end)
          and exists (select 1 from public.pool_week_goals g where g.user_id = p_viewer and g.week_id = p_week and g.status = 'submitted'));
$$;

create or replace function public.get_pool(p_days_back int default 10)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_today date := private.local_day(now());
begin
  return jsonb_build_object(
    'server_time', now(),
    'max_goals', private.setting_int('max_goals', 15),
    'can_submit', private.can_pick(v_uid, now()) or exists (select 1 from public.pool_entries e where e.user_id = v_uid),
    'matches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'match_id', m.id, 'kickoff_at', m.kickoff_at, 'status', m.status, 'elapsed', m.elapsed,
        'home_goals', m.home_goals, 'away_goals', m.away_goals, 'result_confirmed', m.result_confirmed,
        'is_manual', m.provider = 'manual', 'source', pm.source, 'is_test_data', m.is_test_data, 'sort_order', pm.sort_order,
        'week_id', coalesce(pm.week_id, (private.week_for(m.kickoff_at)).id),
        'open', private.pool_match_open(m.id), 'can_submit', private.can_pick_match(v_uid, m.id),
        'competition', case when c.id is null then null else jsonb_build_object('name', c.name, 'logo_url', c.logo_url) end,
        'home', jsonb_build_object('name', ht.name, 'short_name', ht.short_name, 'code', ht.code, 'logo_url', ht.logo_url),
        'away', jsonb_build_object('name', at.name, 'short_name', at.short_name, 'code', at.code, 'logo_url', at.logo_url),
        'pick', case when pp.user_id is null or pp.outcome is null then null else jsonb_build_object(
          'outcome', pp.outcome, 'home', pp.home_goals, 'away', pp.away_goals, 'status', pp.status, 'submitted_at', pp.submitted_at, 'updated_at', pp.updated_at) end,
        'score', case when s.user_id is null or not s.counted then null else jsonb_build_object(
          'points', s.points, 'exact_hit', s.exact_hit, 'outcome_hit', s.outcome_hit, 'is_final', s.is_final) end
      ) order by private.local_day(m.kickoff_at), pm.sort_order nulls last, m.kickoff_at, m.id)
      from public.pool_matches pm
      join public.matches m on m.id = pm.match_id
      join public.teams ht on ht.id = m.home_team_id
      join public.teams at on at.id = m.away_team_id
      left join public.competitions c on c.id = m.competition_id
      left join public.pool_picks pp on pp.match_id = m.id and pp.user_id = v_uid
      left join public.pool_scores s on s.match_id = m.id and s.user_id = v_uid
      where pm.status = 'published'
        and (m.kickoff_at >= now() - make_interval(days => greatest(p_days_back, 0)) or pp.user_id is not null and m.kickoff_at >= now() - interval '60 days')
    ), '[]'::jsonb),
    'weeks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', w.id, 'label', w.label, 'week_start', w.week_start, 'week_end', coalesce(w.end_day, w.week_start + 6),
        'kind', w.kind, 'entry_amount', w.entry_amount,
        'my_entry', exists (select 1 from public.pool_entries e where e.week_id = w.id and e.user_id = v_uid),
        'goals_open', private.week_goals_open(w.id),
        'my_goals', g.total_goals, 'my_goals_status', g.status,
        'real', private.week_real_goals(w.id)) order by w.week_start)
      from public.pool_weeks w
      left join public.pool_week_goals g on g.week_id = w.id and g.user_id = v_uid
      where coalesce(w.end_day, w.week_start + 6) >= v_today - greatest(p_days_back, 0) and w.week_start <= v_today + 13
        and exists (select 1 from private.week_published(w.id))
    ), '[]'::jsonb));
end;
$$;

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
  where pm.status = 'published' and private.pool_match_open(pm.match_id) and private.can_pick_match(v_uid, mm.id)
    and not exists (select 1 from public.pool_picks pp where pp.user_id = v_uid and pp.match_id = pm.match_id and pp.status = 'submitted')
    and not (pm.match_id = any (v_given));
  if v_missing > 0 then perform private.fail('INCOMPLETE_QUINIELA'); end if;
  -- 3. Total de goles de cada semana que aún no empieza (desempate).
  select array(select distinct coalesce((select pm.week_id from public.pool_matches pm where pm.match_id = m.id), (private.week_for(m.kickoff_at)).id) from public.matches m where m.id = any (v_given)
                  and private.pool_match_open(m.id) and private.can_pick_match(v_uid, m.id)) into v_weeks;
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
    if not private.can_pick_match(v_uid, v_it.match_id) then v_unpaid := v_unpaid + 1; continue; end if;
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

create or replace function public.get_prize_pot()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'pot', coalesce(private.prize_override(),
                    round(coalesce(sum(gm.payment_amount), 0) * least(greatest(private.setting_int('prize_pot_percent', 70), 0), 100) / 100.0, 2)),
    'paid_count', count(*),
    'currency', coalesce((select p.currency from public.payment_info p order by p.id limit 1), 'MXN'),
    'configured', exists (select 1 from public.payment_info p where p.amount is not null),
    'manual', private.prize_override() is not null,
    'visible', private.prize_visible(),
    -- Quinielas con entrada aparte (p. ej. entre semana): su propia bolsa.
    'extras', coalesce((
      select jsonb_agg(jsonb_build_object(
        'week_id', w.id, 'label', w.label, 'entry_amount', w.entry_amount,
        'pot', round(coalesce((select sum(e.amount) from public.pool_entries e where e.week_id = w.id), 0)
                     * least(greatest(private.setting_int('prize_pot_percent', 70), 0), 100) / 100.0, 2),
        'entries', (select count(*) from public.pool_entries e where e.week_id = w.id),
        'mine', exists (select 1 from public.pool_entries e where e.week_id = w.id and e.user_id = auth.uid()),
        'first_kickoff', (select min(x.kickoff_at) from private.week_published(w.id) x)) order by w.week_start)
      from public.pool_weeks w
      where w.entry_amount is not null and coalesce(w.end_day, w.week_start + 6) >= private.local_day(now())
        and exists (select 1 from private.week_published(w.id))), '[]'::jsonb)
  )
  from public.group_members gm
  where auth.uid() is not null
    and gm.group_id = private.default_group_id()
    and gm.payment_status = 'authorized'
    and (gm.payment_valid_until is null or gm.payment_valid_until >= now());
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
      'entry_weeks', coalesce((select jsonb_agg(e.week_id) from public.pool_entries e where e.user_id = p.id), '[]'::jsonb),
      'sent_open', (select count(*) from public.pool_picks pp where pp.user_id = p.id and pp.status = 'submitted' and private.pool_match_open(pp.match_id)), 'joined_at', coalesce(gm.joined_at, p.created_at), 'in_group', gm.user_id is not null
    ) order by p.created_at)
    from public.profiles p
    join auth.users u on u.id = p.id
    left join public.payment_references r on r.user_id = p.id
    left join public.group_members gm on gm.group_id = private.default_group_id() and gm.user_id = p.id
    left join public.profiles cb on cb.id = gm.payment_confirmed_by), '[]'::jsonb);
end;
$$;

revoke execute on function private.can_pick_match(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.admin_set_entry(uuid, uuid, boolean, numeric) from public, anon;
grant execute on function public.admin_set_entry(uuid, uuid, boolean, numeric) to authenticated;
