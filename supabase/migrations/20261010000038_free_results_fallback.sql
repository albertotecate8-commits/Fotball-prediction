-- =====================================================================
-- Resultados de respaldo (TheSportsDB): partidos publicados que ya
-- empezaron (o están por empezar) y aún no tienen resultado final. El
-- sincronizador los consulta gratis y aplica el marcador con
-- apply_provider_update, que recalcula los puntos al instante.
-- Solo el servidor (service_role) puede llamarla.
-- =====================================================================
create or replace function public.free_result_targets()
returns table (match_id uuid, external_id text, kickoff_at timestamptz, league text, status text, home_goals smallint, away_goals smallint)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, m.external_id, m.kickoff_at, c.external_id, m.status, m.home_goals, m.away_goals
  from public.pool_matches pm
  join public.matches m on m.id = pm.match_id
  left join public.competitions c on c.id = m.competition_id
  where pm.status = 'published' and m.provider = 'api-football' and m.result_source <> 'admin'
    and m.kickoff_at <= now() + interval '10 minutes' and m.kickoff_at >= now() - interval '36 hours'
    and not (m.status = 'finished' and m.result_confirmed)
    and m.status not in ('cancelled')
  order by m.kickoff_at
  limit 40;
$$;
revoke execute on function public.free_result_targets() from public, anon, authenticated;
grant execute on function public.free_result_targets() to service_role;
