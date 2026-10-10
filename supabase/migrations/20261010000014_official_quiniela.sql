-- =====================================================================
-- Quiniela oficial única. Todos los usuarios participan sin códigos ni
-- grupos: el grupo por defecto («Quiniela oficial») reúne a todos y las
-- jornadas oficiales se publican en él. Las reglas, el RLS y el bloqueo
-- de pronósticos no cambian.
-- =====================================================================

alter table public.groups add column if not exists is_default boolean not null default false;
create unique index if not exists groups_single_default on public.groups (is_default) where is_default;

insert into public.groups (name, description, join_requires_approval, is_active, is_default)
select 'Quiniela oficial', 'Quiniela oficial de SHABEX: todos los jugadores participan.', false, true, true
where not exists (select 1 from public.groups where is_default);

create or replace function private.default_group_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.groups where is_default and is_active limit 1;
$$;

-- Cada perfil nuevo entra activo a la quiniela oficial.
create or replace function private.join_default_group()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group uuid := private.default_group_id();
begin
  if v_group is not null then
    insert into public.group_members (group_id, user_id, status, approved_at)
    values (v_group, new.id, 'active', now())
    on conflict (group_id, user_id) do nothing;
  end if;
  return new;
end;
$$;

create or replace trigger profiles_join_default_group after insert on public.profiles
  for each row execute function private.join_default_group();

-- Usuarios que ya existían.
insert into public.group_members (group_id, user_id, status, approved_at)
select private.default_group_id(), p.id, 'active', now()
from public.profiles p
where private.default_group_id() is not null
on conflict (group_id, user_id) do nothing;

revoke execute on function private.default_group_id() from public, anon;
revoke execute on function private.join_default_group() from public, anon, authenticated;
grant execute on function private.default_group_id() to authenticated, service_role;
