-- Registro sin duplicados: antes de llamar a signUp el formulario pregunta si
-- el correo ya tiene cuenta. Para una cuenta pendiente de confirmar, signUp
-- volvería a enviar el correo y podría sobrescribir sus datos; por eso la app
-- ofrece «Reenviar confirmación» en lugar de crear la cuenta otra vez.
-- Devuelve solo 'new' | 'pending' | 'registered' (nunca ids, fechas ni nombres).
create or replace function public.auth_email_status(p_email text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_email is null or char_length(p_email) > 254 then 'new'
    when u.id is null then 'new'
    when u.email_confirmed_at is null then 'pending'
    else 'registered' end
  from (select 1) x
  left join auth.users u on lower(u.email) = lower(btrim(p_email)) and u.deleted_at is null
  limit 1;
$$;

revoke execute on function public.auth_email_status(text) from public;
grant execute on function public.auth_email_status(text) to anon, authenticated;
