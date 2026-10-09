-- =====================================================================
-- Seguridad: funciones de autorización, Row Level Security y permisos.
-- Regla general: el cliente LEE a través de RLS y ESCRIBE solo mediante
-- RPC (security definer) que validan identidad, permisos y reglas.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Funciones de autorización
-- ---------------------------------------------------------------------
create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin' and p.status = 'active'
  );
$$;

create or replace function private.is_active_member(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.group_members gm
    join public.profiles p on p.id = gm.user_id
    join public.groups g on g.id = gm.group_id
    where gm.group_id = p_group_id
      and gm.user_id = auth.uid()
      and gm.status = 'active'
      and p.status = 'active'
      and g.is_active
  );
$$;

create or replace function private.shares_group(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.group_members mine
    join public.group_members theirs on theirs.group_id = mine.group_id
    where mine.user_id = auth.uid() and mine.status = 'active'
      and theirs.user_id = p_user_id and theirs.status in ('active', 'suspended')
  );
$$;

-- ¿Puede este usuario ver la jornada? (no borrador, miembro activo y, si
-- la participación es selectiva, invitado a ella)
create or replace function private.can_view_round(p_round_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.rounds r
    join public.groups g on g.id = r.group_id and g.is_active
    join public.group_members gm on gm.group_id = r.group_id and gm.user_id = p_user_id and gm.status = 'active'
    join public.profiles p on p.id = p_user_id and p.status = 'active'
    where r.id = p_round_id
      and r.status <> 'draft'
      and (
        r.participation = 'all_members'
        or exists (select 1 from public.round_participants rp where rp.round_id = r.id and rp.user_id = p_user_id)
      )
  );
$$;

create or replace function private.can_view_match(p_match_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.round_matches rm
    where rm.match_id = p_match_id and private.can_view_round(rm.round_id)
  );
$$;

-- ---------------------------------------------------------------------
-- Row Level Security: activada en TODAS las tablas públicas
-- ---------------------------------------------------------------------
alter table public.app_settings          enable row level security;
alter table public.profiles              enable row level security;
alter table public.groups                enable row level security;
alter table public.group_members         enable row level security;
alter table public.competitions          enable row level security;
alter table public.teams                 enable row level security;
alter table public.matches               enable row level security;
alter table public.match_results         enable row level security;
alter table public.rounds                enable row level security;
alter table public.round_matches         enable row level security;
alter table public.round_participants    enable row level security;
alter table public.predictions           enable row level security;
alter table public.prediction_items      enable row level security;
alter table public.prediction_item_scores enable row level security;
alter table public.round_scores          enable row level security;
alter table public.audit_logs            enable row level security;
alter table public.sync_runs             enable row level security;

-- app_settings: lectura para usuarios autenticados (no contiene secretos)
create policy app_settings_read on public.app_settings
  for select to authenticated using (true);

-- profiles
create policy profiles_read on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or private.is_admin() or private.shares_group(id));

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- groups
create policy groups_read on public.groups
  for select to authenticated
  using (private.is_admin() or private.is_active_member(id)
         or exists (select 1 from public.group_members gm where gm.group_id = id and gm.user_id = (select auth.uid())));

-- group_members: cada quien ve su propia membresía; el admin ve todas.
create policy group_members_read on public.group_members
  for select to authenticated
  using (user_id = (select auth.uid()) or private.is_admin());

-- catálogo deportivo
create policy competitions_read on public.competitions
  for select to authenticated using (true);

create policy teams_read on public.teams
  for select to authenticated using (true);

create policy matches_read on public.matches
  for select to authenticated
  using (private.is_admin() or private.can_view_match(id));

create policy match_results_read on public.match_results
  for select to authenticated
  using (private.is_admin() or private.can_view_match(match_id));

-- jornadas
create policy rounds_read on public.rounds
  for select to authenticated
  using (private.is_admin() or private.can_view_round(id));

create policy round_matches_read on public.round_matches
  for select to authenticated
  using (private.is_admin() or private.can_view_round(round_id));

create policy round_participants_read on public.round_participants
  for select to authenticated
  using (private.is_admin() or user_id = (select auth.uid()));

-- pronósticos: privados. Solo el dueño (y el admin) los ve.
create policy predictions_read on public.predictions
  for select to authenticated
  using (user_id = (select auth.uid()) or private.is_admin());

create policy prediction_items_read on public.prediction_items
  for select to authenticated
  using (
    private.is_admin()
    or exists (select 1 from public.predictions p where p.id = prediction_id and p.user_id = (select auth.uid()))
  );

create policy prediction_item_scores_read on public.prediction_item_scores
  for select to authenticated
  using (
    private.is_admin()
    or exists (select 1 from public.predictions p where p.id = prediction_id and p.user_id = (select auth.uid()))
  );

-- puntuaciones agregadas: visibles para los miembros del grupo (clasificación)
create policy round_scores_read on public.round_scores
  for select to authenticated
  using (
    private.is_admin()
    or user_id = (select auth.uid())
    or exists (select 1 from public.rounds r where r.id = round_id and private.can_view_round(r.id))
  );

-- operación: solo administradores
create policy audit_logs_read on public.audit_logs
  for select to authenticated using (private.is_admin());

create policy sync_runs_read on public.sync_runs
  for select to authenticated using (private.is_admin());

-- ---------------------------------------------------------------------
-- Privilegios de tabla (defensa en profundidad además de RLS)
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke insert, update, delete, truncate on all tables in schema public from authenticated;
grant select on all tables in schema public to authenticated;
-- Un jugador solo puede editar estas dos columnas de su perfil.
grant update (display_name, avatar_url) on public.profiles to authenticated;

revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;
revoke execute on all functions in schema private from public, anon;
grant execute on function private.is_admin() to authenticated;
grant execute on function private.is_active_member(uuid) to authenticated;
grant execute on function private.shares_group(uuid) to authenticated;
grant execute on function private.can_view_round(uuid, uuid) to authenticated;
grant execute on function private.can_view_match(uuid) to authenticated;

-- Las tablas creadas en el futuro no heredan permisos para anon.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke execute on functions from anon, public;
