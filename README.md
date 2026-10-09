# Football Predictions (nombre provisional)

Plataforma de quinielas de fútbol entre amigos, pensada primero para el teléfono: jornadas, pronósticos con autoguardado, envío definitivo bloqueado, resultados automáticos, puntuación oficial, clasificación y panel de administración.

> El nombre y los textos de marca viven en `src/config/brand.ts` (y en el `<title>` de `index.html`). Para cambiar el nombre basta con editar esos dos archivos.

## Stack

- **Frontend:** React 19, TypeScript estricto, Vite, Tailwind CSS v4, React Router 7 y TanStack Query.
- **Backend:** Supabase (Auth, PostgreSQL con RLS, RPC `security definer` y Edge Functions en Deno).
- **Despliegue:** Vercel para el frontend y Supabase para la base de datos y las funciones.
- **Pruebas:** Vitest (unitarias y de base de datos sobre un PostgreSQL real) y Playwright (pruebas visuales en 4 tamaños de pantalla).

## Reglas oficiales

| Concepto | Puntos |
| --- | --- |
| Acertar el resultado 1X2 | 3 |
| Marcador exacto (incluye el 1X2) | 3 + 2 = 5 |
| Máximo por partido / por jornada de 10 | 5 / 50 |

Desempates, en este orden: más puntos, más marcadores exactos, menor error total de goles y más aciertos 1X2. Si el empate persiste, los jugadores **comparten la posición** (`RANK`).

> Nota: como los puntos valen 3·(aciertos 1X2) + 2·(exactos), cuando dos jugadores empatan en puntos y en exactos también empatan en aciertos 1X2. Por eso el 4.º criterio nunca decide con datos reales. Se mantiene en la consulta porque así lo pide el reglamento.

Los puntos los calcula **solo el servidor** (`public.score_prediction` y `private.recompute_round_scores`). `src/lib/scoring.ts` replica las reglas en el frontend para explicarlas en pantalla, y se prueba con los mismos ejemplos que la versión SQL.

Los partidos que se van a tiempo extra o penales cuentan con el **marcador de los 90 minutos** (`score.fulltime` de API-Football). Los partidos cancelados o abandonados se anulan: no suman puntos y no cuentan para el máximo posible.

## Arquitectura

```
src/
  app/            Router, shell (barra inferior móvil / lateral escritorio), guards
  components/     Tarjetas de partido y jornada, marcadores, podio, clasificación…
  components/ui/  Botón, badge, hoja modal, campos, skeletons, estados vacíos/error, toasts
  config/brand.ts Textos de marca centralizados
  features/       auth · home · rounds · predictions · leaderboard · profile · admin · groups
  hooks/          Reloj del servidor, configuración
  lib/            Cliente Supabase, errores, zonas horarias, reglas de puntuación
  services/       Acceso a datos (RPC y consultas). Ningún componente llama SQL directo
  styles/         Tokens de diseño (colores, tipografía, radios, sombras)
supabase/
  migrations/     Esquema, RLS, API del jugador, API admin y sincronización (versionadas)
  functions/      sync-results · provider-fixtures · admin-invite (+ _shared)
tests/db/         Pruebas de RLS, envíos, puntuación, desempates y sincronización
tests/visual/     Playwright con backend simulado (datos ficticios)
```

### Seguridad

- **RLS activado en todas las tablas** (hay una prueba que lo verifica). Los jugadores **leen** con RLS y **escriben solo mediante RPC** que validan identidad, membresía, fechas y reglas.
- Privilegios a nivel de tabla y de columna: `anon` no puede leer nada. Un jugador solo puede editar `display_name` y `avatar_url` de su propio perfil. Además, un trigger bloquea cualquier cambio de rol o estado hecho desde el cliente.
- Los pronósticos enviados son **inmutables, incluso para el superusuario**, porque los bloquea un trigger.
- Los partidos de una jornada con quinielas enviadas quedan bloqueados (trigger).
- Las acciones de administración, las correcciones de resultado (que exigen motivo) y los cambios automáticos quedan en `audit_logs`, una tabla de solo inserción.
- La clave `service_role` y la API deportiva solo existen en los secretos de las Edge Functions. El navegador solo recibe la clave **publicable**.
- Cobros, apuestas y premios están **desactivados**: `payments_enabled` está bloqueado en el servidor. `group_members.payment_status` es solo un registro administrativo.

### Envío de quinielas

- **Borrador:** se autoguarda con *debounce*, con una sola solicitud en vuelo a la vez, una secuencia monotónica (el servidor descarta los guardados que llegan tarde), reintentos con espera creciente y un respaldo en `localStorage`.
- **Envío:** es atómico. Se valida la identidad, la membresía, el estado de la jornada, la fecha límite (con la hora del servidor) y que estén todos los partidos. El envío es **idempotente**: un reintento devuelve la quiniela existente y nunca crea otra. Hay una prueba con 6 envíos simultáneos en la que solo uno resulta efectivo.

### Resultados automáticos

1. El admin busca partidos en el proveedor (`provider-fixtures`). Los partidos se guardan con un id externo estable.
2. `sync-results` (lo invoca pg_cron o el botón «Sincronizar» del admin) consulta **solo** los partidos pertinentes: los que están en juego, los que ya empezaron sin resultado y los futuros (cada 12 h, para detectar aplazamientos).
3. `apply_provider_update` es idempotente. Guarda el historial en `match_results`, **nunca da un partido por finalizado sin marcador** ni por su horario, no degrada un estado conocido a uno desconocido, respeta las correcciones manuales del admin y acepta correcciones del proveedor durante 72 h, dejándolas auditadas.
4. Las jornadas se cierran solas al llegar la fecha límite y se finalizan cuando todos sus partidos tienen resultado oficial. Los puntos se marcan como *provisionales* hasta ese momento.

La capa `supabase/functions/_shared/football/` define la interfaz `FootballProvider`. Para cambiar de proveedor basta con escribir otro adaptador.

## Desarrollo

```bash
npm install
cp .env.example .env      # URL y clave PUBLICABLE de Supabase
npm run dev
```

| Comando | Qué hace |
| --- | --- |
| `npm run typecheck` | TypeScript estricto |
| `npm run lint` | ESLint |
| `npm test` | Pruebas unitarias (puntuación, zonas horarias, proveedor, sincronización) |
| `npm run test:db` | Levanta un PostgreSQL efímero con un *shim* de Supabase, aplica las migraciones y prueba RLS y las RPC |
| `npm run test:visual` | Playwright: teléfono chico y grande, tableta y escritorio, con backend simulado |
| `npm run build` | Build de producción |

## Configuración en Supabase (proyecto `tmkxvhjynbhwrhvzrsfv`)

**Edge Functions → Secrets:**

| Secreto | Valor |
| --- | --- |
| `FOOTBALL_PROVIDER` | `mock` (demostración, datos marcados como *de prueba*) o `api-football` |
| `API_FOOTBALL_KEY` | Clave de api-sports.io (solo con `api-football`) |
| `SYNC_SECRET` | Cadena aleatoria larga. La usa pg_cron |
| `SITE_URL` | URL de Vercel, para los enlaces de invitación |
| `ALLOWED_ORIGINS` | Opcional: dominios permitidos (CORS), separados por coma |

**Auth → URL Configuration:** la *Site URL* es el dominio de Vercel. En *Redirect URLs* van `https://TU-DOMINIO/restablecer` y `https://TU-DOMINIO/`.

**Sincronización programada:** se puede activar después de definir `SYNC_SECRET`, desde el SQL Editor:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;
select vault.create_secret('<SYNC_SECRET>', 'sync_secret');
select cron.schedule('sync-results', '*/10 * * * *', $$
  select net.http_post(
    url := 'https://tmkxvhjynbhwrhvzrsfv.supabase.co/functions/v1/sync-results',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_secret')),
    body := '{}'::jsonb);
$$);
```

Si la sincronización no encuentra partidos pendientes, no llama a la API. Así se cuida el límite del plan gratuito de API-Football (100 solicitudes al día).

**Primer administrador:** regístrate en la app y, desde *Inicio → «Activar administración»*, reclama el rol. Solo funciona si todavía no hay ningún administrador.

## Proveedor deportivo: API-Football

- **Cobertura:** más de 1,000 ligas, entre ellas Liga MX, Premier, LaLiga y la Champions. Cada partido tiene un id estable (`fixture.id`), con estados detallados (NS, 1H, HT, FT, AET, PEN, PST, CANC, ABD…) y marcador de 90 minutos.
- **Límites y costos:** el plan gratuito permite 100 solicitudes al día. Los planes de pago empiezan en unos 19 USD al mes (7,500 al día). **Verifica los precios vigentes antes de contratar.**
- **Permisos:** los logotipos que entrega la API son propiedad de los clubes. La app los muestra desde la URL del proveedor y, si falla, usa un escudo genérico propio. Revisa los términos de uso antes de un lanzamiento público o comercial.
- **Sin clave:** la app funciona con el proveedor `mock`. Todo lo que genera se guarda con `is_test_data = true` y se marca «Datos de prueba» en la interfaz.
