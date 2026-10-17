-- =====================================================================
-- Respaldo de resultados: además del día de la liga (que con la clave
-- gratuita trae como máximo 3 partidos), el sincronizador busca cada partido
-- por nombre o por su equipo en TheSportsDB y luego lo consulta directo por
-- id. Esta lista agrega los nombres y los ids de TheSportsDB de los equipos.
-- =====================================================================
create or replace function public.free_result_targets_v2()
returns table (match_id uuid, external_id text, kickoff_at timestamptz, league text, status text, home_goals smallint, away_goals smallint,
               home_name text, away_name text, home_tsdb text, away_tsdb text)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, m.external_id, m.kickoff_at, c.external_id, m.status, m.home_goals, m.away_goals,
         h.name, a.name, h.tsdb_id, a.tsdb_id
  from public.pool_matches pm
  join public.matches m on m.id = pm.match_id
  join public.teams h on h.id = m.home_team_id
  join public.teams a on a.id = m.away_team_id
  left join public.competitions c on c.id = m.competition_id
  where pm.status = 'published' and m.provider = 'api-football' and m.result_source <> 'admin'
    and m.kickoff_at <= now() + interval '10 minutes' and m.kickoff_at >= now() - interval '36 hours'
    and not (m.status = 'finished' and m.result_confirmed)
    and m.status not in ('cancelled')
  order by m.kickoff_at
  limit 40;
$$;
revoke execute on function public.free_result_targets_v2() from public, anon, authenticated;
grant execute on function public.free_result_targets_v2() to service_role;
