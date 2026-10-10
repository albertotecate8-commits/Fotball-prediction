-- Bolsa acumulada: 60 % de lo que pagaron los participantes con pago
-- confirmado y vigente en la quiniela oficial. El 40 % restante nunca se
-- expone (ni el total ni el porcentaje del organizador).
-- Cada pago guarda el monto vigente al confirmarse: si después cambia el costo,
-- la bolsa no se recalcula hacia atrás.

alter table public.group_members add column if not exists payment_amount numeric(10, 2);

insert into public.app_settings (key, value, description) values
  ('prize_pot_percent', '60', 'Porcentaje de los pagos confirmados que forma la bolsa acumulada')
on conflict (key) do nothing;

-- Al autorizar un pago se fija su monto (el configurado en «Datos de pago»).
create or replace function private.stamp_payment_amount()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.payment_status = 'authorized' and (tg_op = 'INSERT' or old.payment_status is distinct from 'authorized') then
    new.payment_amount := coalesce(new.payment_amount, (select p.amount from public.payment_info p order by p.id limit 1));
  elsif new.payment_status <> 'authorized' then
    new.payment_amount := null;
  end if;
  -- Solo la confirmación del admin puede fijar o cambiar el monto.
  if tg_op = 'UPDATE' and new.payment_amount is distinct from old.payment_amount
     and new.payment_status is not distinct from old.payment_status
     and current_setting('shabex.payment_rpc', true) is distinct from 'on' then
    raise exception 'USE_PAYMENT_CONFIRMATION' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create or replace trigger group_members_stamp_payment before insert or update on public.group_members
  for each row execute function private.stamp_payment_amount();

-- Pagos ya confirmados antes de este cambio (si los hubiera) toman el costo actual.
update public.group_members set payment_amount = (select p.amount from public.payment_info p order by p.id limit 1)
 where payment_status = 'authorized' and payment_amount is null;

-- Lo que ven todos: solo la bolsa y cuántos pagos la forman.
create or replace function public.get_prize_pot()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'pot', round(coalesce(sum(gm.payment_amount), 0) * least(greatest(private.setting_int('prize_pot_percent', 60), 0), 100) / 100.0, 2),
    'paid_count', count(*),
    'currency', coalesce((select p.currency from public.payment_info p order by p.id limit 1), 'MXN'),
    'configured', exists (select 1 from public.payment_info p where p.amount is not null)
  )
  from public.group_members gm
  where auth.uid() is not null
    and gm.group_id = private.default_group_id()
    and gm.payment_status = 'authorized'
    and (gm.payment_valid_until is null or gm.payment_valid_until >= now());
$$;

revoke execute on function private.stamp_payment_amount() from public, anon, authenticated;
revoke execute on function public.get_prize_pot() from public, anon;
grant execute on function public.get_prize_pot() to authenticated;
