-- =====================================================================
-- Bolsa de las quinielas con entrada aparte (entre semana): oculta hasta que
-- el admin la muestre, con su propio interruptor. Mientras está oculta, el
-- servidor ni siquiera envía el monto a los participantes.
-- =====================================================================
alter table public.pool_weeks add column if not exists pot_visible boolean not null default false;

create or replace function public.admin_set_extra_pot_visible(p_week uuid, p_visible boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := private.assert_admin();
  w public.pool_weeks;
begin
  if p_visible is null then perform private.fail('INVALID_VALUE'); end if;
  select * into w from public.pool_weeks where id = p_week;
  if not found or w.entry_amount is null then perform private.fail('WEEK_NOT_FOUND'); end if;
  update public.pool_weeks set pot_visible = p_visible, updated_at = now() where id = p_week;
  perform private.log_audit('pool.extra_pot_visibility', 'pool_week', p_week::text, jsonb_build_object('visible', p_visible, 'label', w.label, 'by', v_admin));
  return jsonb_build_object('visible', p_visible);
end;
$$;
revoke execute on function public.admin_set_extra_pot_visible(uuid, boolean) from public, anon;
grant execute on function public.admin_set_extra_pot_visible(uuid, boolean) to authenticated;

create or replace function public.get_prize_pot()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'pot', coalesce(private.prize_override(),
                    round(coalesce(sum(gm.payment_amount), 0) * least(greatest(private.setting_int('prize_pot_percent', 70), 0), 100) / 100.0, 2)),
    'paid_count', count(*),
    'currency', coalesce((select p.currency from public.payment_info p order by p.id limit 1), 'MXN'),
    'configured', exists (select 1 from public.payment_info p where p.amount is not null),
    'manual', private.prize_override() is not null,
    'visible', private.prize_visible(),
    -- Quinielas con entrada aparte (p. ej. entre semana): su propia bolsa.
    'extras', coalesce((
      select jsonb_agg(jsonb_build_object(
        'week_id', w.id, 'label', w.label, 'entry_amount', w.entry_amount,
        -- Oculta (null) para los participantes hasta que el admin la muestre.
        'pot', case when w.pot_visible or private.is_admin() then
                 round(coalesce((select sum(e.amount) from public.pool_entries e where e.week_id = w.id), 0)
                       * least(greatest(private.setting_int('prize_pot_percent', 70), 0), 100) / 100.0, 2) end,
        'visible', w.pot_visible,
        'entries', (select count(*) from public.pool_entries e where e.week_id = w.id),
        'mine', exists (select 1 from public.pool_entries e where e.week_id = w.id and e.user_id = auth.uid()),
        'first_kickoff', (select min(x.kickoff_at) from private.week_published(w.id) x)) order by w.week_start)
      from public.pool_weeks w
      where w.entry_amount is not null and coalesce(w.end_day, w.week_start + 6) >= private.local_day(now())
        and exists (select 1 from private.week_published(w.id))), '[]'::jsonb)
  )
  from public.group_members gm
  where auth.uid() is not null
    and gm.group_id = private.default_group_id()
    and gm.payment_status = 'authorized'
    and (gm.payment_valid_until is null or gm.payment_valid_until >= now());
$$;
