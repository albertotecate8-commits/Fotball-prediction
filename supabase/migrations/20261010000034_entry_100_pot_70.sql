-- =====================================================================
-- Entrada de la quiniela: $100 por participante (definido por el admin).
-- Bolsa: 70 % de los pagos confirmados para el ganador; 30 % para el admin.
-- Los pagos ya confirmados conservan el importe que realmente se recibió.
-- =====================================================================
update public.app_settings set value = '70'::jsonb where key = 'prize_pot_percent';
update public.payment_info set amount = 100, updated_at = now() where amount is distinct from 100;
