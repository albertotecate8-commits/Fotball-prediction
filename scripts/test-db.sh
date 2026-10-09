#!/usr/bin/env bash
# Levanta un PostgreSQL efímero, aplica el shim de Supabase + migraciones
# y ejecuta las pruebas de base de datos (RLS, RPC, puntuación, sync).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
DATA="$ROOT/.tmp/pgdata"
PORT="${TEST_DB_PORT:-54329}"
RUN_AS=""
if [ "$(id -u)" = "0" ]; then RUN_AS="runuser -u postgres --"; fi

cleanup() { $RUN_AS "$PGBIN/pg_ctl" -D "$DATA" -m immediate stop >/dev/null 2>&1 || true; }
trap cleanup EXIT

rm -rf "$DATA" && mkdir -p "$DATA" "$ROOT/.tmp"
[ -n "$RUN_AS" ] && chown -R postgres "$ROOT/.tmp"
$RUN_AS "$PGBIN/initdb" -D "$DATA" -U postgres --auth=trust -E UTF8 >/dev/null
$RUN_AS "$PGBIN/pg_ctl" -D "$DATA" -o "-p $PORT -k /tmp -c listen_addresses=localhost -c timezone=UTC" -l "$ROOT/.tmp/pg.log" -w start >/dev/null

PSQL=("$PGBIN/psql" -h localhost -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q)
"${PSQL[@]}" -d postgres -c "create database app_test" >/dev/null
"${PSQL[@]}" -d app_test -f "$ROOT/tests/db/supabase-shim.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "→ migración $(basename "$f")"
  "${PSQL[@]}" -d app_test -f "$f" >/dev/null
done

export TEST_DATABASE_URL="postgres://postgres@localhost:$PORT/app_test"
cd "$ROOT" && npx vitest run --project db "$@"
