-- Entrada de la quiniela: $50 por participante (definido por el admin).
-- La bolsa sigue siendo el 70 % de los pagos confirmados.
update public.payment_info set amount = 50, updated_at = now() where amount is distinct from 50;
