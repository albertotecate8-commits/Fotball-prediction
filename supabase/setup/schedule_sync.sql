-- Programa la sincronización de resultados cada 10 minutos (pg_cron + pg_net).
-- Específico de cada entorno: ajusta la URL del proyecto. Es re-ejecutable.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'sync_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'sync_secret',
                                'Secreto del cron de sincronización (generado en la base)');
  end if;
end $$;

select cron.schedule('sync-results', '*/10 * * * *', $job$
  select net.http_post(
    url := 'https://tmkxvhjynbhwrhvzrsfv.supabase.co/functions/v1/sync-results',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000);
$job$);
