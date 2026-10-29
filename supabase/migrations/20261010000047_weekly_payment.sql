-- =====================================================================
-- El pago cubre la quiniela de SU semana (lunes a domingo, hora de CDMX).
-- Antes, un pago confirmado sin vigencia valía para siempre: el de la semana
-- pasada seguía contando como «Pago confirmado» y sumaba a la bolsa nueva.
-- Ahora, si el admin no fija una vigencia, vence al terminar el domingo de
-- la semana en que se confirmó. Una vigencia fijada a mano se respeta.
-- =====================================================================

-- Fin de la semana (lunes 00:00 hora local) que contiene p_ts.
create or replace function private.week_close(p_ts timestamptz)
returns timestamptz language sql stable set search_path = '' as $$
  select ((private.local_day(p_ts) - (extract(isodow from private.local_day(p_ts))::int - 1) + 7)::timestamp)
         at time zone coalesce((select s.value #>> '{}' from public.app_settings s where s.key = 'timezone'), 'America/Mexico_City');
$$;

create or replace function private.stamp_payment_week()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.payment_status = 'authorized' and new.payment_valid_until is null
     and (tg_op = 'INSERT' or old.payment_status is distinct from 'authorized'
          or old.payment_confirmed_at is distinct from new.payment_confirmed_at) then
    new.payment_valid_until := private.week_close(coalesce(new.payment_confirmed_at, now()));
  end if;
  return new;
end;
$$;
create or replace trigger group_members_stamp_week before insert or update on public.group_members
  for each row execute function private.stamp_payment_week();
revoke execute on function private.week_close(timestamptz) from public, anon, authenticated;
revoke execute on function private.stamp_payment_week() from public, anon, authenticated;

-- Pagos ya confirmados sin vigencia: cubren la semana en que se confirmaron.
do $$
declare v_n int;
begin
  perform set_config('shabex.payment_rpc', 'on', true);
  update public.group_members
     set payment_valid_until = private.week_close(payment_confirmed_at)
   where payment_status = 'authorized' and payment_valid_until is null and payment_confirmed_at is not null;
  get diagnostics v_n = row_count;
  perform set_config('shabex.payment_rpc', 'off', true);
  if v_n > 0 then
    perform private.log_audit('member.payment_week_set', 'group', 'default', jsonb_build_object('payments', v_n, 'reason', 'Cada pago cubre la quiniela de su semana'));
  end if;
end $$;
