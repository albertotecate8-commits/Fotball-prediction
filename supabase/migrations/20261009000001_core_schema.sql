-- =====================================================================
-- Football Predictions — esquema base
-- Todas las fechas se guardan como timestamptz (UTC). La zona horaria de
-- presentación vive en app_settings.timezone.
-- =====================================================================

create schema if not exists private;
comment on schema private is 'Funciones internas. No se expone por la API REST.';

-- ---------------------------------------------------------------------
-- Utilidades
-- ---------------------------------------------------------------------
create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.generate_invite_code()
returns text
language sql
volatile
set search_path = ''
as $$
  -- 8 caracteres sin ambigüedades (sin 0/O/1/I)
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '')
  from generate_series(1, 8);
$$;

-- ---------------------------------------------------------------------
-- Configuración
-- ---------------------------------------------------------------------
create table public.app_settings (
  key         text primary key check (key ~ '^[a-z_]{2,64}$'),
  value       jsonb not null,
  description text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users (id) on delete set null
);

insert into public.app_settings (key, value, description) values
  ('timezone',          '"America/Mexico_City"', 'Zona horaria oficial de la competencia'),
  ('max_goals',         '15',                    'Máximo de goles aceptado por equipo en un pronóstico'),
  ('payments_enabled',  'false',                 'Cobros reales: DESACTIVADO en v1 (requiere evaluación legal)'),
  ('result_correction_window_hours', '72',       'Horas tras el final en que se siguen aceptando correcciones del proveedor');

-- ---------------------------------------------------------------------
-- Perfiles
-- ---------------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 2 and 40),
  avatar_url   text check (avatar_url is null or avatar_url ~ '^https://'),
  role         text not null default 'player' check (role in ('player', 'admin')),
  status       text not null default 'active' check (status in ('active', 'suspended')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger profiles_touch before update on public.profiles
  for each row execute function private.touch_updated_at();

-- Crea el perfil al registrarse. El rol SIEMPRE nace como 'player'.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  v_name := btrim(coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1), ''));
  if char_length(v_name) < 2 then
    v_name := 'Jugador';
  end if;
  insert into public.profiles (id, display_name)
  values (new.id, left(v_name, 40))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- Ningún cliente (rol authenticated/anon) puede tocar rol, estado o id,
-- ni siquiera un admin escribiendo directo a la tabla: debe usar las RPC
-- administrativas, que validan y auditan.
create or replace function private.protect_profile_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if new.id is distinct from old.id
       or new.role is distinct from old.role
       or new.status is distinct from old.status
       or new.created_at is distinct from old.created_at then
      raise exception 'PROFILE_FIELD_LOCKED' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger profiles_protect before update on public.profiles
  for each row execute function private.protect_profile_columns();

-- ---------------------------------------------------------------------
-- Grupos
-- ---------------------------------------------------------------------
create table public.groups (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null check (char_length(btrim(name)) between 2 and 60),
  description            text check (description is null or char_length(description) <= 280),
  invite_code            text not null unique default private.generate_invite_code(),
  join_requires_approval boolean not null default true,
  is_active              boolean not null default true,
  created_by             uuid references public.profiles (id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create trigger groups_touch before update on public.groups
  for each row execute function private.touch_updated_at();

create table public.group_members (
  group_id       uuid not null references public.groups (id) on delete cascade,
  user_id        uuid not null references public.profiles (id) on delete cascade,
  status         text not null default 'pending' check (status in ('pending', 'active', 'suspended')),
  -- Solo registro administrativo. No hay cobros reales en v1.
  payment_status text not null default 'not_applicable'
                 check (payment_status in ('not_applicable', 'pending', 'authorized', 'rejected')),
  joined_at      timestamptz not null default now(),
  approved_at    timestamptz,
  approved_by    uuid references public.profiles (id) on delete set null,
  updated_at     timestamptz not null default now(),
  primary key (group_id, user_id)
);

create index group_members_user_idx on public.group_members (user_id);

create trigger group_members_touch before update on public.group_members
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------
-- Catálogo deportivo
-- ---------------------------------------------------------------------
create table public.competitions (
  id           uuid primary key default gen_random_uuid(),
  provider     text not null,
  external_id  text not null,
  name         text not null,
  country      text,
  season       text,
  logo_url     text,
  is_test_data boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (provider, external_id)
);

create trigger competitions_touch before update on public.competitions
  for each row execute function private.touch_updated_at();

create table public.teams (
  id           uuid primary key default gen_random_uuid(),
  provider     text not null,
  external_id  text not null,
  name         text not null,
  short_name   text not null,
  code         text check (code is null or char_length(code) <= 5),
  logo_url     text,
  is_test_data boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (provider, external_id)
);

create trigger teams_touch before update on public.teams
  for each row execute function private.touch_updated_at();

create table public.matches (
  id               uuid primary key default gen_random_uuid(),
  provider         text not null,
  external_id      text not null,
  competition_id   uuid references public.competitions (id) on delete set null,
  home_team_id     uuid not null references public.teams (id),
  away_team_id     uuid not null references public.teams (id),
  kickoff_at       timestamptz not null,
  status           text not null default 'scheduled'
                   check (status in ('scheduled', 'live', 'finished', 'postponed', 'suspended', 'cancelled', 'abandoned', 'unknown')),
  status_detail    text,
  elapsed          smallint check (elapsed is null or elapsed between 0 and 200),
  home_goals       smallint check (home_goals is null or home_goals >= 0),
  away_goals       smallint check (away_goals is null or away_goals >= 0),
  result_confirmed boolean not null default false,
  result_source    text not null default 'provider' check (result_source in ('provider', 'admin')),
  confirmed_at     timestamptz,
  last_synced_at   timestamptz,
  last_sync_error  text,
  is_test_data     boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (provider, external_id),
  check (home_team_id <> away_team_id),
  check ((home_goals is null) = (away_goals is null)),
  -- Un resultado confirmado exige partido finalizado con marcador.
  check (not result_confirmed or (status = 'finished' and home_goals is not null))
);

create index matches_kickoff_idx on public.matches (kickoff_at);
create index matches_status_idx on public.matches (status);
create index matches_competition_idx on public.matches (competition_id);

create trigger matches_touch before update on public.matches
  for each row execute function private.touch_updated_at();

-- Historial inmutable de resultados recibidos (proveedor o corrección admin).
create table public.match_results (
  id               bigint generated always as identity primary key,
  match_id         uuid not null references public.matches (id) on delete cascade,
  status           text not null,
  home_goals       smallint check (home_goals is null or home_goals >= 0),
  away_goals       smallint check (away_goals is null or away_goals >= 0),
  is_final         boolean not null,
  source           text not null check (source in ('provider', 'admin')),
  reason           text,
  recorded_by      uuid references public.profiles (id) on delete set null,
  provider_payload jsonb,
  recorded_at      timestamptz not null default now(),
  check (source = 'provider' or (reason is not null and char_length(btrim(reason)) >= 5))
);

create index match_results_match_idx on public.match_results (match_id, recorded_at desc);

create or replace function private.forbid_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'APPEND_ONLY_TABLE: %', tg_table_name using errcode = '42501';
end;
$$;

create trigger match_results_append_only before update on public.match_results
  for each row execute function private.forbid_mutation();

-- ---------------------------------------------------------------------
-- Jornadas
-- ---------------------------------------------------------------------
create table public.rounds (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid not null references public.groups (id) on delete restrict,
  name          text not null check (char_length(btrim(name)) between 2 and 80),
  description   text check (description is null or char_length(description) <= 500),
  status        text not null default 'draft'
                check (status in ('draft', 'open', 'closed', 'finished', 'under_review')),
  opens_at      timestamptz,
  deadline_at   timestamptz not null,
  participation text not null default 'all_members' check (participation in ('all_members', 'selected')),
  created_by    uuid references public.profiles (id) on delete set null,
  opened_at     timestamptz,
  closed_at     timestamptz,
  finalized_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (opens_at is null or opens_at < deadline_at)
);

create index rounds_group_idx on public.rounds (group_id, deadline_at desc);
create index rounds_status_idx on public.rounds (status);

create trigger rounds_touch before update on public.rounds
  for each row execute function private.touch_updated_at();

create table public.round_matches (
  round_id   uuid not null references public.rounds (id) on delete cascade,
  match_id   uuid not null references public.matches (id) on delete restrict,
  position   smallint not null check (position between 1 and 200),
  created_at timestamptz not null default now(),
  primary key (round_id, match_id),
  unique (round_id, position)
);

create index round_matches_match_idx on public.round_matches (match_id);

create table public.round_participants (
  round_id uuid not null references public.rounds (id) on delete cascade,
  user_id  uuid not null references public.profiles (id) on delete cascade,
  primary key (round_id, user_id)
);

create index round_participants_user_idx on public.round_participants (user_id);

-- ---------------------------------------------------------------------
-- Pronósticos
-- ---------------------------------------------------------------------
create table public.predictions (
  id           uuid primary key default gen_random_uuid(),
  round_id     uuid not null references public.rounds (id) on delete restrict,
  user_id      uuid not null references public.profiles (id) on delete restrict,
  status       text not null default 'draft' check (status in ('draft', 'submitted')),
  -- Secuencia monotónica del cliente: descarta guardados de borrador que
  -- llegan fuera de orden por una red inestable.
  client_seq   bigint not null default 0,
  submitted_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (round_id, user_id),
  check ((status = 'submitted') = (submitted_at is not null))
);

create index predictions_user_idx on public.predictions (user_id);

create table public.prediction_items (
  prediction_id uuid not null references public.predictions (id) on delete cascade,
  match_id      uuid not null references public.matches (id) on delete restrict,
  home_goals    smallint not null check (home_goals between 0 and 99),
  away_goals    smallint not null check (away_goals between 0 and 99),
  updated_at    timestamptz not null default now(),
  primary key (prediction_id, match_id)
);

-- Un pronóstico enviado es inmutable, sin excepciones (también para admins
-- y para el rol de servicio).
create or replace function private.guard_submitted_prediction()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'submitted' then
      raise exception 'PREDICTION_LOCKED' using errcode = '42501';
    end if;
    return old;
  end if;
  if old.status = 'submitted' then
    raise exception 'PREDICTION_LOCKED' using errcode = '42501';
  end if;
  if new.round_id is distinct from old.round_id or new.user_id is distinct from old.user_id then
    raise exception 'PREDICTION_OWNER_LOCKED' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger predictions_guard before update or delete on public.predictions
  for each row execute function private.guard_submitted_prediction();

create or replace function private.guard_submitted_items()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_pred uuid := coalesce(new.prediction_id, old.prediction_id);
  v_status text;
begin
  select p.status into v_status from public.predictions p where p.id = v_pred;
  -- v_status es null si el pronóstico padre se está borrando (cascada de un borrador).
  if v_status = 'submitted' then
    raise exception 'PREDICTION_LOCKED' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger prediction_items_guard before insert or update or delete on public.prediction_items
  for each row execute function private.guard_submitted_items();

-- Cambiar los partidos de una jornada con quinielas enviadas rompería la
-- integridad de la competencia.
create or replace function private.guard_round_matches()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_round uuid := coalesce(new.round_id, old.round_id);
begin
  if exists (select 1 from public.predictions p where p.round_id = v_round and p.status = 'submitted') then
    raise exception 'ROUND_HAS_SUBMISSIONS' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    -- Limpia ese partido de los borradores existentes.
    delete from public.prediction_items pi
      using public.predictions p
      where pi.prediction_id = p.id and p.round_id = old.round_id and pi.match_id = old.match_id;
    return old;
  end if;
  return new;
end;
$$;

create trigger round_matches_guard before insert or update or delete on public.round_matches
  for each row execute function private.guard_round_matches();

-- ---------------------------------------------------------------------
-- Puntuaciones (solo las escribe el servidor)
-- ---------------------------------------------------------------------
create table public.prediction_item_scores (
  prediction_id uuid not null references public.predictions (id) on delete cascade,
  match_id      uuid not null references public.matches (id) on delete cascade,
  points        smallint not null check (points in (0, 3, 5)),
  exact_hit     boolean not null,
  outcome_hit   boolean not null,
  goal_error    smallint not null check (goal_error >= 0),
  is_final      boolean not null,
  computed_at   timestamptz not null default now(),
  primary key (prediction_id, match_id),
  check (not exact_hit or outcome_hit)
);

create table public.round_scores (
  round_id       uuid not null references public.rounds (id) on delete cascade,
  user_id        uuid not null references public.profiles (id) on delete cascade,
  points         int not null default 0 check (points >= 0),
  exact_hits     int not null default 0 check (exact_hits >= 0),
  outcome_hits   int not null default 0 check (outcome_hits >= exact_hits),
  goal_error     int not null default 0 check (goal_error >= 0),
  scored_matches int not null default 0 check (scored_matches >= 0),
  is_official    boolean not null default false,
  computed_at    timestamptz not null default now(),
  primary key (round_id, user_id),
  check (points <= scored_matches * 5)
);

create index round_scores_user_idx on public.round_scores (user_id);

-- ---------------------------------------------------------------------
-- Operación
-- ---------------------------------------------------------------------
create table public.audit_logs (
  id          bigint generated always as identity primary key,
  actor_id    uuid references public.profiles (id) on delete set null,
  action      text not null,
  entity_type text not null,
  entity_id   text,
  details     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index audit_logs_created_idx on public.audit_logs (created_at desc);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);

create trigger audit_logs_append_only before update or delete on public.audit_logs
  for each row execute function private.forbid_mutation();

create table public.sync_runs (
  id              bigint generated always as identity primary key,
  provider        text not null,
  trigger_source  text not null default 'cron' check (trigger_source in ('cron', 'manual', 'test')),
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  status          text not null default 'running' check (status in ('running', 'success', 'partial', 'error')),
  matches_checked int not null default 0,
  matches_updated int not null default 0,
  error_message   text,
  details         jsonb not null default '{}'::jsonb
);

create index sync_runs_started_idx on public.sync_runs (started_at desc);

create or replace function private.log_audit(p_action text, p_entity_type text, p_entity_id text, p_details jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, details)
  values (auth.uid(), p_action, p_entity_type, p_entity_id, coalesce(p_details, '{}'::jsonb));
$$;
