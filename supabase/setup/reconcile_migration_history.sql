-- Alinea supabase_migrations.schema_migrations con los archivos del repo
-- (las migraciones se aplicaron por partes desde el MCP). Re-ejecutable.
update supabase_migrations.schema_migrations
   set version = '20261009000003', name = 'scoring_core'
 where version = '20261009233214' and name = 'scoring_core_rules';
insert into supabase_migrations.schema_migrations (version, name) values
  ('20261009000003', 'scoring_core'),
  ('20261009000004', 'player_api'),
  ('20261009000005', 'admin_api'),
  ('20261009000006', 'provider_sync')
on conflict (version) do nothing;
