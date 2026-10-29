-- =====================================================================
-- Referencia de pago = solo el nombre del participante («BETO-ALVARADO»),
-- sin el prefijo de la marca anterior («SHABEX-»). La referencia anterior
-- se guarda como «legacy» para encontrar transferencias ya hechas.
-- La clave real sigue siendo el id interno; nada se borra.
-- =====================================================================
alter table public.payment_references drop constraint if exists payment_references_reference_check;
alter table public.payment_references add constraint payment_references_reference_check
  check (reference ~ '^[A-Z0-9][A-Z0-9-]{0,54}$');

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
  v_base := coalesce(nullif(private.ref_slug((select display_name from public.profiles where id = p_user)), ''), 'PARTICIPANTE');
  v_try := v_base;
  loop
    begin
      insert into public.payment_references (user_id, reference, legacy_reference)
      values (p_user, v_try, 'SHX-' || upper(substr(replace(p_user::text, '-', ''), 1, 6)));
      return v_try;
    exception when unique_violation then
      select reference into v_ref from public.payment_references where user_id = p_user;
      if v_ref is not null then return v_ref; end if;
      -- Nombre repetido: sufijo corto único.
      n := n + 1;
      v_try := v_base || '-' || upper(substr(md5(p_user::text || ':' || n), 1, 3 + (n / 5)));
      if n > 40 then perform private.fail('REFERENCE_UNAVAILABLE'); end if;
    end;
  end loop;
end;
$$;

-- Referencias existentes: sin el prefijo (siguen siendo únicas); la anterior queda como «legacy».
do $$
declare v_n int;
begin
  update public.payment_references
     set legacy_reference = reference,
         reference = substr(reference, 8)
   where reference like 'SHABEX-%' and length(reference) > 7;
  get diagnostics v_n = row_count;
  if v_n > 0 then
    perform private.log_audit('payment.references_renamed', 'payment_references', 'all', jsonb_build_object('count', v_n, 'reason', 'Referencia = solo el nombre del participante'));
  end if;
end $$;
