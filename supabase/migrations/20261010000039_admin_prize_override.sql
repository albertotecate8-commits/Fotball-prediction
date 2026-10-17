-- =====================================================================
-- El admin puede fijar a mano el monto de la bolsa de la semana actual
-- (una sola vez: al empezar la semana siguiente vuelve sola al cálculo
-- automático, 70 % de los pagos confirmados). Queda en la auditoría.
-- =====================================================================
create or replace function private.current_week_start()
returns date language sql stable security definer set search_path = '' as $$
  select private.local_day(now()) - (extract(isodow from private.local_day(now()))::int - 1);
$$;

-- Monto fijado por el admin para esta semana (null si no hay).
create or replace function private.prize_override()
returns numeric language sql stable security definer set search_path = '' as $$
  select (s.value ->> 'amount')::numeric
  from public.app_settings s
  where s.key = 'prize_pot_override' and jsonb_typeof(s.value) = 'object'
    and (s.value ->> 'week_start')::date = private.current_week_start();
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
    'manual', private.prize_override() is not null
  )
  from public.group_members gm
  where auth.uid() is not null
    and gm.group_id = private.default_group_id()
    and gm.payment_status = 'authorized'
    and (gm.payment_valid_until is null or gm.payment_valid_until >= now());
$$;

-- Admin: fija (p_amount) o quita (null) el monto de la bolsa de esta semana.
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
  -- Sin datos del admin en el valor (app_settings es legible): quién y cuándo quedan en la auditoría.
  insert into public.app_settings (key, value, description, updated_at, updated_by)
  values ('prize_pot_override',
          case when p_amount is null then 'null'::jsonb else jsonb_build_object('amount', round(p_amount, 2), 'week_start', v_week) end,
          'Monto de la bolsa fijado por el admin para una semana', now(), v_admin)
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = v_admin;
  select round(coalesce(sum(gm.payment_amount), 0) * least(greatest(private.setting_int('prize_pot_percent', 70), 0), 100) / 100.0, 2) into v_auto
    from public.group_members gm
   where gm.group_id = private.default_group_id() and gm.payment_status = 'authorized'
     and (gm.payment_valid_until is null or gm.payment_valid_until >= now());
  perform private.log_audit('pool.prize_pot_set', 'pool', v_week::text, jsonb_build_object(
    'from', v_before, 'to', p_amount, 'automatic', v_auto, 'by', v_admin,
    'reason', coalesce(nullif(left(btrim(coalesce(p_reason, '')), 300), ''), case when p_amount is null then 'Vuelve al cálculo automático' else 'Monto fijado por el administrador' end)));
  return jsonb_build_object('pot', coalesce(p_amount, v_auto), 'manual', p_amount is not null, 'automatic', v_auto, 'week_start', v_week);
end;
$$;

revoke execute on function private.current_week_start() from public, anon, authenticated;
revoke execute on function private.prize_override() from public, anon, authenticated;
revoke execute on function public.admin_set_prize_pot(numeric, text) from public, anon;
grant execute on function public.admin_set_prize_pot(numeric, text) to authenticated;
