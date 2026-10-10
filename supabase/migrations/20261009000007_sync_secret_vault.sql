-- =====================================================================
-- El secreto del cron vive en Supabase Vault (se genera dentro de la
-- base y nunca sale de ella). La Edge Function lo valida con esta RPC,
-- que solo puede ejecutar el rol de servicio.
-- =====================================================================
create or replace function public.verify_sync_secret(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(char_length(p_secret) >= 32 and exists (
    select 1 from vault.decrypted_secrets s
    where s.name = 'sync_secret' and s.decrypted_secret = p_secret
  ), false);
$$;

revoke execute on function public.verify_sync_secret(text) from public, anon, authenticated;
grant execute on function public.verify_sync_secret(text) to service_role;
