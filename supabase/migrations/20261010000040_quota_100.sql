-- =====================================================================
-- Presupuesto diario de API-Football: se permite usar hasta 100 consultas
-- (todo el plan gratuito) y margen 0. El valor lo elige el admin desde
-- «Consumo API» (botón «Usar las 100»), con auditoría.
-- =====================================================================
create or replace function private.api_daily_budget()
returns int language sql stable security definer set search_path = '' as $$
  select least(greatest(private.setting_int('api_daily_budget', 100), 0), 100);
$$;
create or replace function private.api_provider_margin()
returns int language sql stable security definer set search_path = '' as $$
  select greatest(private.setting_int('api_provider_margin', 0), 0);
$$;
