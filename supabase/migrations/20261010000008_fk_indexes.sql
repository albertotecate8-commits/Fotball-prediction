-- Índices para claves foráneas usadas en consultas frecuentes (aviso de rendimiento de Supabase).
create index if not exists matches_home_team_idx on public.matches (home_team_id);
create index if not exists matches_away_team_idx on public.matches (away_team_id);
create index if not exists prediction_items_match_idx on public.prediction_items (match_id);
create index if not exists prediction_item_scores_match_idx on public.prediction_item_scores (match_id);
create index if not exists audit_logs_actor_idx on public.audit_logs (actor_id);
create index if not exists match_results_recorded_by_idx on public.match_results (recorded_by);
create index if not exists group_members_approved_by_idx on public.group_members (approved_by);
create index if not exists groups_created_by_idx on public.groups (created_by);
create index if not exists rounds_created_by_idx on public.rounds (created_by);
create index if not exists app_settings_updated_by_idx on public.app_settings (updated_by);
