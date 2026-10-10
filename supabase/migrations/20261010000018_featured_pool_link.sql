-- Destacados de Inicio: el vínculo con la quiniela ahora es el partido
-- publicado en la quiniela continua (pool_matches), no una jornada.
-- in_round_id conserva su nombre por compatibilidad y contiene el id del partido.
create or replace function public.get_featured_matches(p_limit int default 12)
returns table (
  provider text, external_id text, kickoff_at timestamptz, status text, priority int, reason text, data jsonb,
  refreshed_at timestamptz, in_round_id uuid, in_round_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select f.provider, f.external_id, f.kickoff_at, f.status, f.priority, f.reason, f.data, f.refreshed_at,
         p.match_id, case when p.match_id is null then null else 'Mi quiniela' end
  from public.featured_fixtures f
  left join lateral (
    select m.id as match_id
    from public.matches m
    join public.pool_matches pm on pm.match_id = m.id and pm.status = 'published'
    where m.provider = f.provider and m.external_id = f.external_id
    limit 1
  ) p on true
  where auth.uid() is not null
    and f.featured_until > now()
    and f.kickoff_at > now() - interval '30 hours'
  order by (f.status = 'live') desc, f.priority desc, f.kickoff_at
  limit least(greatest(p_limit, 1), 30);
$$;

revoke execute on function public.get_featured_matches(int) from public, anon;
grant execute on function public.get_featured_matches(int) to authenticated;
