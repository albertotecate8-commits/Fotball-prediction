-- =====================================================================
-- 1) Referencias de pago legibles y estables por participante
--    (SHABEX-ALIAS). La clave real sigue siendo el id interno del usuario;
--    la referencia solo sirve para identificar la transferencia. La
--    referencia anterior (SHX-XXXXXX) se conserva como «legacy».
-- 2) Confirmación de pagos con importe, método y vigencia (manual, admin).
-- 3) Clasificación en vivo de la semana con resumen, detalle por
--    participante y privacidad: nadie ve pronósticos ajenos antes de que
--    empiece cada partido, ni borradores, ni el total de goles ajeno antes
--    de que arranque la jornada.
-- Nada se borra; la puntuación no cambia (pool_scores sigue siendo la fuente).
-- =====================================================================

-- 1) Referencias ----------------------------------------------------------
create table if not exists public.payment_references (
  user_id          uuid primary key references public.profiles (id),
  reference        text not null unique check (reference ~ '^SHABEX-[A-Z0-9-]{1,48}$'),
  legacy_reference text,
  created_at       timestamptz not null default now()
);
alter table public.payment_references enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'payment_references' and policyname = 'payment_references_read') then
    create policy payment_references_read on public.payment_references for select to authenticated using (user_id = (select auth.uid()) or private.is_admin());
  end if;
end $$;
revoke all on public.payment_references from anon;
revoke insert, update, delete, truncate on public.payment_references from authenticated;
grant select on public.payment_references to authenticated;

-- «María López» → «MARIA-LOPEZ» (sin tildes ni símbolos).
create or replace function private.ref_slug(p text)
returns text language sql immutable set search_path = '' as $$
  select btrim(left(btrim(regexp_replace(upper(translate(coalesce(p, ''),
    'áàäâãåéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÅÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ', 'aaaaaaeeeeiiiiooooouuuuncAAAAAAEEEEIIIIOOOOOUUUUNC')),
    '[^A-Z0-9]+', '-', 'g'), '-'), 24), '-');
$$;

-- Crea (una sola vez) la referencia del participante; después nunca cambia.
create or replace function private.ensure_payment_reference(p_user uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ref text;
  v_base text;
  v_try text;
  n int := 0;
begin
  select reference into v_ref from public.payment_references where user_id = p_user;
  if v_ref is not null then return v_ref; end if;
  if not exists (select 1 from public.profiles where id = p_user) then return null; end if;
  v_base := 'SHABEX-' || coalesce(nullif(private.ref_slug((select display_name from public.profiles where id = p_user)), ''), 'PARTICIPANTE');
  v_try := v_base;
  loop
    begin
      insert into public.payment_references (user_id, reference, legacy_reference)
      values (p_user, v_try, 'SHX-' || upper(substr(replace(p_user::text, '-', ''), 1, 6)));
      return v_try;
    exception when unique_violation then
      select reference into v_ref from public.payment_references where user_id = p_user;
      if v_ref is not null then return v_ref; end if;
      -- Alias repetido: sufijo corto único.
      n := n + 1;
      v_try := v_base || '-' || upper(substr(md5(p_user::text || ':' || n), 1, 3 + (n / 5)));
      if n > 40 then perform private.fail('REFERENCE_UNAVAILABLE'); end if;
    end;
  end loop;
end;
$$;

create or replace function private.on_profile_created_ref()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.ensure_payment_reference(new.id);
  return null;
end;
$$;
create or replace trigger profiles_payment_reference after insert on public.profiles
  for each row execute function private.on_profile_created_ref();

-- Participantes existentes (en orden de registro).
select private.ensure_payment_reference(p.id) from public.profiles p order by p.created_at, p.id;

create or replace function private.payment_reference_for(p_user_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce((select r.reference from public.payment_references r where r.user_id = p_user_id),
                  'SHX-' || upper(substr(replace(p_user_id::text, '-', ''), 1, 6)));
$$;

-- Estado legible: pendiente, confirmado, vencido, revocado o sin pago.
create or replace function private.payment_state(p_status text, p_valid_until timestamptz)
returns text language sql stable set search_path = '' as $$
  select case
    when p_status = 'authorized' and p_valid_until is not null and p_valid_until < now() then 'expired'
    when p_status = 'authorized' then 'confirmed'
    when p_status = 'rejected' then 'revoked'
    when p_status = 'pending' then 'pending'
    else 'none' end;
$$;

-- 2) Pagos ---------------------------------------------------------------
alter table public.group_members add column if not exists payment_method text check (payment_method is null or char_length(payment_method) <= 40);

create or replace function public.get_my_payment()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_info public.payment_info;
  v_gm public.group_members;
  v_ref text := private.ensure_payment_reference(v_uid);
begin
  select * into v_info from public.payment_info where id = 1;
  select * into v_gm from public.group_members where group_id = private.default_group_id() and user_id = v_uid;
  return jsonb_build_object(
    'configured', v_info.id is not null and (v_info.clabe is not null or v_info.account is not null) and v_info.amount is not null,
    'bank', v_info.bank, 'holder', v_info.holder, 'clabe', v_info.clabe, 'account', v_info.account,
    'amount', v_info.amount, 'currency', coalesce(v_info.currency, 'MXN'), 'concept', v_info.concept,
    'instructions', v_info.instructions, 'contact', v_info.contact,
    'alias', (select display_name from public.profiles where id = v_uid),
    'reference', v_ref,
    'payment_status', coalesce(v_gm.payment_status, 'not_applicable'),
    'state', private.payment_state(v_gm.payment_status, v_gm.payment_valid_until),
    'paid_amount', v_gm.payment_amount,
    'confirmed_at', v_gm.payment_confirmed_at,
    'valid_until', v_gm.payment_valid_until);
end;
$$;

-- Confirmación manual (sin pasarela): usuario, referencia, importe, vigencia, método, quién y por qué.
create or replace function public.admin_confirm_payment(
  p_user uuid, p_status text, p_valid_until timestamptz, p_amount numeric, p_method text, p_bank_reference text, p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := private.assert_admin();
  v_group uuid := private.default_group_id();
  v_old public.group_members;
  v_ref text := private.ensure_payment_reference(p_user);
  v_amount numeric := coalesce(p_amount, (select p.amount from public.payment_info p order by p.id limit 1));
begin
  if p_status not in ('pending', 'authorized', 'rejected', 'not_applicable') then perform private.fail('INVALID_PAYMENT_STATUS'); end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then perform private.fail('REASON_REQUIRED'); end if;
  if p_status = 'authorized' then
    if char_length(btrim(coalesce(p_bank_reference, ''))) < 3 then perform private.fail('PAYMENT_REFERENCE_REQUIRED'); end if;
    if p_valid_until is not null and p_valid_until <= now() then perform private.fail('PAYMENT_VALIDITY_IN_PAST'); end if;
    if v_amount is null or v_amount <= 0 then perform private.fail('INVALID_AMOUNT'); end if;
  end if;
  select * into v_old from public.group_members where group_id = v_group and user_id = p_user for update;
  if not found then perform private.fail('USER_NOT_IN_GROUP'); end if;

  perform set_config('shabex.payment_rpc', 'on', true);
  update public.group_members
     set payment_status = p_status,
         payment_valid_until = case when p_status = 'authorized' then p_valid_until end,
         payment_reference = case when p_status = 'authorized' then left(btrim(p_bank_reference), 120) else payment_reference end,
         payment_method = case when p_status = 'authorized' then nullif(left(btrim(coalesce(p_method, '')), 40), '') else payment_method end,
         payment_amount = case when p_status = 'authorized' then v_amount end,
         payment_confirmed_by = case when p_status = 'authorized' then v_admin end,
         payment_confirmed_at = case when p_status = 'authorized' then now() end
   where group_id = v_group and user_id = p_user;
  perform set_config('shabex.payment_rpc', 'off', true);

  perform private.log_audit('member.payment_changed', 'group_member', v_group::text || ':' || p_user::text,
    jsonb_build_object('from', v_old.payment_status, 'to', p_status, 'reference', v_ref, 'bank_reference', p_bank_reference,
                       'amount', case when p_status = 'authorized' then v_amount end, 'method', p_method, 'valid_until', p_valid_until, 'reason', btrim(p_reason)));
  return jsonb_build_object('reference', v_ref, 'state', private.payment_state(p_status, p_valid_until), 'amount', case when p_status = 'authorized' then v_amount end);
end;
$$;

-- Lista para «Participantes y pagos» (solo admin).
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
      'confirmed_by', cb.display_name, 'joined_at', coalesce(gm.joined_at, p.created_at), 'in_group', gm.user_id is not null
    ) order by p.created_at)
    from public.profiles p
    join auth.users u on u.id = p.id
    left join public.payment_references r on r.user_id = p.id
    left join public.group_members gm on gm.group_id = private.default_group_id() and gm.user_id = p.id
    left join public.profiles cb on cb.id = gm.payment_confirmed_by), '[]'::jsonb);
end;
$$;

-- 3) Clasificación en vivo -----------------------------------------------
create or replace function private.pick_week(p_week uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select coalesce(p_week, (
    select w.id from public.pool_weeks w
     where exists (select 1 from private.week_published(w.id))
     order by (private.local_day(now()) between w.week_start and w.week_start + 6) desc, (w.week_start <= private.local_day(now())) desc,
              abs(w.week_start - private.local_day(now()))
     limit 1));
$$;

-- Un partido es «definitivo» cuando terminó y el resultado está confirmado.
create or replace function private.match_final(p_status text, p_confirmed boolean)
returns boolean language sql immutable set search_path = '' as $$
  select p_status = 'finished' and coalesce(p_confirmed, false);
$$;

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
begin
  select * into v_week from public.pool_weeks where id = private.pick_week(p_week);
  if v_week.id is null then
    return jsonb_build_object('week', null, 'summary', null, 'rows', '[]'::jsonb, 'weeks', '[]'::jsonb,
      'updated_at', (select max(r.finished_at) from public.sync_runs r where r.provider = 'api-football' and r.status in ('success', 'partial')));
  end if;
  v_real := private.week_real_goals(v_week.id);
  v_open := private.week_goals_open(v_week.id);
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
               case when x.user_id = v_uid or not v_open then x.guess end as guess,
               case when x.user_id = v_uid or not v_open then x.diff end as diff,
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

-- Detalle de un participante en la semana. Pronósticos ajenos solo cuando el partido ya empezó.
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
begin
  if v_week is null or not exists (select 1 from public.profiles where id = p_user) then perform private.fail('NOT_FOUND'); end if;
  return (
    select jsonb_build_object(
      'user', jsonb_build_object('user_id', p.id, 'display_name', p.display_name, 'avatar_url', p.avatar_url, 'is_me', v_me),
      'guess', (select g.total_goals from public.pool_week_goals g where g.user_id = p_user and g.week_id = v_week and g.status = 'submitted' and (v_me or not v_open)),
      'matches', coalesce((
        select jsonb_agg(jsonb_build_object(
          'match_id', m.id, 'kickoff_at', m.kickoff_at, 'status', m.status, 'elapsed', m.elapsed,
          'home_goals', m.home_goals, 'away_goals', m.away_goals, 'result_confirmed', m.result_confirmed,
          'started', m.kickoff_at <= now() or m.status <> 'scheduled',
          'competition', case when c.id is null then null else jsonb_build_object('name', c.name) end,
          'home', jsonb_build_object('name', ht.name, 'short_name', ht.short_name, 'code', ht.code, 'logo_url', ht.logo_url),
          'away', jsonb_build_object('name', at.name, 'short_name', at.short_name, 'code', at.code, 'logo_url', at.logo_url),
          'pick', case when pp.status = 'submitted' and (v_me or m.kickoff_at <= now() or m.status <> 'scheduled') then pp.outcome end,
          'hidden', pp.status = 'submitted' and not v_me and m.kickoff_at > now() and m.status = 'scheduled',
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

-- La clasificación anterior tampoco revela el total de goles ajeno antes de la jornada.
create or replace function public.get_week_leaderboard(p_week uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_s jsonb := public.get_week_standings(p_week);
begin
  return jsonb_build_object('week', v_s -> 'week', 'weeks', v_s -> 'weeks', 'rows', coalesce((
    select jsonb_agg(jsonb_build_object('rank_position', (r ->> 'rank_position')::int, 'user_id', r ->> 'user_id', 'display_name', r ->> 'display_name',
      'avatar_url', r ->> 'avatar_url', 'hits', (r ->> 'hits')::int, 'scored', (r ->> 'hits')::int + (r ->> 'misses')::int, 'picks', (r ->> 'picks')::int,
      'guess', r -> 'guess', 'diff', r -> 'diff', 'is_me', (r ->> 'is_me')::boolean))
    from jsonb_array_elements(v_s -> 'rows') r), '[]'::jsonb));
end;
$$;

revoke execute on function private.ref_slug(text) from public, anon, authenticated;
revoke execute on function private.ensure_payment_reference(uuid) from public, anon, authenticated;
revoke execute on function private.on_profile_created_ref() from public, anon, authenticated;
revoke execute on function private.payment_reference_for(uuid) from public, anon, authenticated;
revoke execute on function private.payment_state(text, timestamptz) from public, anon, authenticated;
revoke execute on function private.pick_week(uuid) from public, anon, authenticated;
revoke execute on function private.match_final(text, boolean) from public, anon, authenticated;
revoke execute on function public.admin_confirm_payment(uuid, text, timestamptz, numeric, text, text, text) from public, anon;
revoke execute on function public.admin_payment_list() from public, anon;
revoke execute on function public.get_week_standings(uuid) from public, anon;
revoke execute on function public.get_week_participant(uuid, uuid) from public, anon;
revoke execute on function public.get_my_payment() from public, anon;
grant execute on function public.admin_confirm_payment(uuid, text, timestamptz, numeric, text, text, text) to authenticated;
grant execute on function public.admin_payment_list() to authenticated;
grant execute on function public.get_week_standings(uuid) to authenticated;
grant execute on function public.get_week_participant(uuid, uuid) to authenticated;
grant execute on function public.get_my_payment() to authenticated;
