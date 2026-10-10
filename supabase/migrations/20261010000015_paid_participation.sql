-- =====================================================================
-- Participación con pago confirmado. Cualquiera puede ver partidos,
-- jornadas, resultados y clasificación; solo quien tiene un pago
-- confirmado y vigente puede guardar o enviar pronósticos en las jornadas
-- de un grupo que lo exige (la Quiniela oficial).
--
-- No hay pasarela: el pago lo confirma un administrador (con referencia,
-- vigencia y motivo, todo auditado). El jugador no puede escribir su
-- estado de pago (sin privilegio de UPDATE ni INSERT en group_members).
-- =====================================================================

alter table public.groups add column if not exists requires_payment boolean not null default false;
update public.groups set requires_payment = true where is_default and not requires_payment;

alter table public.group_members add column if not exists payment_valid_until timestamptz;
alter table public.group_members add column if not exists payment_reference text
  check (payment_reference is null or char_length(payment_reference) <= 120);
alter table public.group_members add column if not exists payment_confirmed_by uuid references public.profiles (id) on delete set null;
alter table public.group_members add column if not exists payment_confirmed_at timestamptz;

-- ¿Puede este usuario registrar pronósticos en esta jornada?
create or replace function private.can_participate(p_round_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select not g.requires_payment
           or (gm.payment_status = 'authorized'
               and (gm.payment_valid_until is null or gm.payment_valid_until >= r.deadline_at))
    from public.rounds r
    join public.groups g on g.id = r.group_id
    left join public.group_members gm on gm.group_id = r.group_id and gm.user_id = p_user_id and gm.status = 'active'
    where r.id = p_round_id
  ), false);
$$;

-- Punto común de save_prediction_draft y submit_prediction: sin pago
-- confirmado no se escribe nada en el servidor.
create or replace function private.lock_round_for_play(p_round_id uuid, p_user_id uuid)
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
  if not private.can_participate(p_round_id, p_user_id) then
    perform private.fail('PAYMENT_REQUIRED');
  end if;
  return v_round;
end;
$$;

-- Estado de participación del jugador (para explicar en pantalla cómo activarla).
create or replace function public.get_my_participation(p_round_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
  v_group uuid;
  v_row record;
begin
  if p_round_id is not null then
    select r.group_id into v_group from public.rounds r where r.id = p_round_id and private.can_view_round(r.id, v_uid);
    if v_group is null then
      perform private.fail('ROUND_NOT_FOUND');
    end if;
  else
    v_group := private.default_group_id();
  end if;

  select g.requires_payment, gm.status as member_status, gm.payment_status, gm.payment_valid_until
    into v_row
  from public.groups g
  left join public.group_members gm on gm.group_id = g.id and gm.user_id = v_uid
  where g.id = v_group;

  return jsonb_build_object(
    'requires_payment', coalesce(v_row.requires_payment, false),
    'payment_status', coalesce(v_row.payment_status, 'not_applicable'),
    'valid_until', v_row.payment_valid_until,
    'can_participate', case
      when p_round_id is not null then private.can_participate(p_round_id, v_uid)
      else not coalesce(v_row.requires_payment, false)
           or (v_row.member_status = 'active' and v_row.payment_status = 'authorized'
               and (v_row.payment_valid_until is null or v_row.payment_valid_until >= now()))
    end);
end;
$$;

-- Confirmación manual del pago por un administrador (sin pasarela).
create or replace function public.admin_set_payment(
  p_group_id uuid, p_user_id uuid, p_payment_status text, p_valid_until timestamptz, p_reference text, p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := private.assert_admin();
  v_old public.group_members;
begin
  if p_payment_status not in ('pending', 'authorized', 'rejected', 'not_applicable') then
    perform private.fail('INVALID_PAYMENT_STATUS');
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then
    perform private.fail('REASON_REQUIRED');
  end if;
  if p_payment_status = 'authorized' and char_length(btrim(coalesce(p_reference, ''))) < 3 then
    perform private.fail('PAYMENT_REFERENCE_REQUIRED');
  end if;
  if p_payment_status = 'authorized' and p_valid_until is not null and p_valid_until <= now() then
    perform private.fail('PAYMENT_VALIDITY_IN_PAST');
  end if;

  select * into v_old from public.group_members where group_id = p_group_id and user_id = p_user_id for update;
  if not found then
    perform private.fail('USER_NOT_IN_GROUP');
  end if;

  perform set_config('shabex.payment_rpc', 'on', true);
  update public.group_members
     set payment_status = p_payment_status,
         payment_valid_until = case when p_payment_status = 'authorized' then p_valid_until else null end,
         payment_reference = nullif(btrim(coalesce(p_reference, '')), ''),
         payment_confirmed_by = case when p_payment_status = 'authorized' then v_admin end,
         payment_confirmed_at = case when p_payment_status = 'authorized' then now() end
   where group_id = p_group_id and user_id = p_user_id;
  perform set_config('shabex.payment_rpc', 'off', true);

  perform private.log_audit('member.payment_changed', 'group_member', p_group_id::text || ':' || p_user_id::text,
    jsonb_build_object('from', v_old.payment_status, 'to', p_payment_status, 'valid_until', p_valid_until,
                       'reference', p_reference, 'reason', p_reason));
end;
$$;

-- El cambio genérico de miembro ya no puede tocar pagos de grupos que los
-- exigen: debe usarse admin_set_payment (referencia, vigencia y motivo).
create or replace function private.guard_payment_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.payment_status is distinct from old.payment_status
     and current_setting('shabex.payment_rpc', true) is distinct from 'on'
     and exists (select 1 from public.groups g where g.id = new.group_id and g.requires_payment) then
    raise exception 'USE_PAYMENT_CONFIRMATION' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create or replace trigger group_members_guard_payment before update on public.group_members
  for each row execute function private.guard_payment_change();

revoke execute on function private.can_participate(uuid, uuid) from public, anon;
grant execute on function private.can_participate(uuid, uuid) to authenticated, service_role;
revoke execute on function public.get_my_participation(uuid) from public, anon;
grant execute on function public.get_my_participation(uuid) to authenticated;
revoke execute on function public.admin_set_payment(uuid, uuid, text, timestamptz, text, text) from public, anon;
grant execute on function public.admin_set_payment(uuid, uuid, text, timestamptz, text, text) to authenticated;
