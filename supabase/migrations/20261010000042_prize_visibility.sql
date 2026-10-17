-- =====================================================================
-- Bolsa por semana en su propia tabla (no en app_settings): el monto que
-- fija el admin y si se muestra a todos antes del cierre. El admin la hace
-- visible o invisible cuando quiera. Solo se lee con get_prize_pot.
-- =====================================================================
create table if not exists public.prize_pot_weeks (
  week_start  date primary key,
  amount      numeric(12, 2) check (amount is null or (amount >= 0 and amount <= 1000000)),
  visible     boolean not null default false,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users (id) on delete set null
);
alter table public.prize_pot_weeks enable row level security;
revoke all on public.prize_pot_weeks from anon, authenticated;
create index if not exists prize_pot_weeks_updated_by_idx on public.prize_pot_weeks (updated_by);

-- Lo que había fijado el admin en app_settings pasa a la tabla.
insert into public.prize_pot_weeks (week_start, amount, visible)
select (s.value ->> 'week_start')::date, (s.value ->> 'amount')::numeric, false
from public.app_settings s
where s.key = 'prize_pot_override' and jsonb_typeof(s.value) = 'object' and s.value ? 'week_start'
on conflict (week_start) do nothing;

create or replace function private.prize_override()
returns numeric language sql stable security definer set search_path = '' as $$
  select w.amount from public.prize_pot_weeks w where w.week_start = private.current_week_start();
$$;

create or replace function private.prize_visible()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select w.visible from public.prize_pot_weeks w where w.week_start = private.current_week_start()), false);
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
    'visible', private.prize_visible()
  )
  from public.group_members gm
  where auth.uid() is not null
    and gm.group_id = private.default_group_id()
    and gm.payment_status = 'authorized'
    and (gm.payment_valid_until is null or gm.payment_valid_until >= now());
$$;

create or replace function public.admin_set_prize_pot(p_amount numeric, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := private.assert_admin();
  v_week date := private.current_week_start();
  v_before numeric;
  v_auto numeric;
begin
  if p_amount is not null and (p_amount < 0 or p_amount > 1000000) then perform private.fail('INVALID_AMOUNT'); end if;
  v_before := private.prize_override();
  insert into public.prize_pot_weeks (week_start, amount, updated_at, updated_by)
  values (v_week, round(p_amount, 2), now(), v_admin)
  on conflict (week_start) do update set amount = excluded.amount, updated_at = now(), updated_by = v_admin;
  select round(coalesce(sum(gm.payment_amount), 0) * least(greatest(private.setting_int('prize_pot_percent', 70), 0), 100) / 100.0, 2) into v_auto
    from public.group_members gm
   where gm.group_id = private.default_group_id() and gm.payment_status = 'authorized'
     and (gm.payment_valid_until is null or gm.payment_valid_until >= now());
  perform private.log_audit('pool.prize_pot_set', 'pool', v_week::text, jsonb_build_object(
    'from', v_before, 'to', p_amount, 'automatic', v_auto, 'by', v_admin,
    'reason', coalesce(nullif(left(btrim(coalesce(p_reason, '')), 300), ''), case when p_amount is null then 'Vuelve al cálculo automático' else 'Monto fijado por el administrador' end)));
  return jsonb_build_object('pot', coalesce(p_amount, v_auto), 'manual', p_amount is not null, 'automatic', v_auto, 'week_start', v_week, 'visible', private.prize_visible());
end;
$$;

-- Admin: muestra u oculta la bolsa de esta semana a todos los participantes.
create or replace function public.admin_set_prize_visible(p_visible boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := private.assert_admin();
  v_week date := private.current_week_start();
begin
  if p_visible is null then perform private.fail('INVALID_VALUE'); end if;
  insert into public.prize_pot_weeks (week_start, visible, updated_at, updated_by)
  values (v_week, p_visible, now(), v_admin)
  on conflict (week_start) do update set visible = excluded.visible, updated_at = now(), updated_by = v_admin;
  perform private.log_audit('pool.prize_pot_visibility', 'pool', v_week::text, jsonb_build_object('visible', p_visible, 'by', v_admin));
  return jsonb_build_object('visible', p_visible, 'week_start', v_week);
end;
$$;

revoke execute on function private.prize_visible() from public, anon, authenticated;
revoke execute on function public.admin_set_prize_visible(boolean) from public, anon;
grant execute on function public.admin_set_prize_visible(boolean) to authenticated;
