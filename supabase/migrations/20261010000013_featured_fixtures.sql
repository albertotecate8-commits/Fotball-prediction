-- =====================================================================
-- Partidos destacados (Inicio). Vienen del proveedor real y se guardan
-- aparte: mostrar un destacado NUNCA lo agrega a una jornada oficial.
-- Los jugadores los leen solo mediante get_featured_matches().
-- =====================================================================

create table if not exists public.featured_fixtures (
  provider       text not null,
  external_id    text not null,
  kickoff_at     timestamptz not null,
  status         text not null,
  priority       int not null default 0,
  reason         text,
  data           jsonb not null,
  refreshed_at   timestamptz not null default now(),
  featured_until timestamptz not null,
  primary key (provider, external_id)
);
create index if not exists featured_fixtures_until_idx on public.featured_fixtures (featured_until);

alter table public.featured_fixtures enable row level security;
revoke all on public.featured_fixtures from anon, authenticated;

-- p_items: [{ external_id, kickoff_at, status, priority, reason, data }]
create or replace function public.upsert_featured_fixtures(p_provider text, p_items jsonb, p_hours int default 30)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int := 0;
  v_item jsonb;
begin
  -- Lo que ya no viene en la selección deja de mostrarse (no se borra: caduca).
  update public.featured_fixtures set featured_until = now()
   where provider = p_provider and featured_until > now()
     and external_id not in (select e ->> 'external_id' from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) e);
  for v_item in select e.value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) e loop
    insert into public.featured_fixtures (provider, external_id, kickoff_at, status, priority, reason, data, refreshed_at, featured_until)
    values (p_provider, v_item ->> 'external_id', (v_item ->> 'kickoff_at')::timestamptz, coalesce(v_item ->> 'status', 'unknown'),
            coalesce((v_item ->> 'priority')::int, 0), v_item ->> 'reason', v_item -> 'data', now(), now() + make_interval(hours => p_hours))
    on conflict (provider, external_id) do update
      set kickoff_at = excluded.kickoff_at, status = excluded.status, priority = excluded.priority, reason = excluded.reason,
          data = excluded.data, refreshed_at = excluded.refreshed_at, featured_until = excluded.featured_until;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

create or replace function public.featured_last_refresh(p_provider text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'refreshed_at', max(refreshed_at),
    'live', count(*) filter (where featured_until > now() and (status = 'live' or (status = 'scheduled' and kickoff_at <= now()))))
  from public.featured_fixtures where provider = p_provider;
$$;

-- Lectura para jugadores: destacados vigentes y, si el partido está en una
-- jornada que el jugador puede ver, su vínculo con la quiniela oficial.
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
         r.round_id, r.round_name
  from public.featured_fixtures f
  left join lateral (
    select rd.id as round_id, rd.name as round_name
    from public.matches m
    join public.round_matches rm on rm.match_id = m.id
    join public.rounds rd on rd.id = rm.round_id
    where m.provider = f.provider and m.external_id = f.external_id and private.can_view_round(rd.id)
    order by rd.deadline_at desc
    limit 1
  ) r on true
  where auth.uid() is not null
    and f.featured_until > now()
    and f.kickoff_at > now() - interval '30 hours'
  order by (f.status = 'live') desc, f.priority desc, f.kickoff_at
  limit least(greatest(p_limit, 1), 30);
$$;

revoke execute on function public.upsert_featured_fixtures(text, jsonb, int) from public, anon, authenticated;
revoke execute on function public.featured_last_refresh(text) from public, anon, authenticated;
revoke execute on function public.get_featured_matches(int) from public, anon;
grant execute on function public.upsert_featured_fixtures(text, jsonb, int) to service_role;
grant execute on function public.featured_last_refresh(text) to service_role;
grant execute on function public.get_featured_matches(int) to authenticated;
