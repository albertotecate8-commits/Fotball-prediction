-- Un partido que se importa ya iniciado o terminado trae marcador: queda en
-- el historial de resultados igual que cualquier actualización del proveedor.
create or replace function private.record_initial_result()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.home_goals is not null and new.away_goals is not null and new.result_source = 'provider' then
    insert into public.match_results (match_id, status, home_goals, away_goals, is_final, source)
    values (new.id, new.status, new.home_goals, new.away_goals, new.status = 'finished', 'provider');
  end if;
  return new;
end;
$$;

create or replace trigger matches_initial_result after insert on public.matches
  for each row execute function private.record_initial_result();

revoke execute on function private.record_initial_result() from public, anon, authenticated;

-- Partidos importados antes de este cambio.
insert into public.match_results (match_id, status, home_goals, away_goals, is_final, source)
select m.id, m.status, m.home_goals, m.away_goals, m.status = 'finished', 'provider'
from public.matches m
where m.home_goals is not null and m.away_goals is not null and m.result_source = 'provider'
  and not exists (select 1 from public.match_results r where r.match_id = m.id);
