#!/usr/bin/env bash
# Teste MENSAL de restauração (RTO 4h a comprovar): restaura o último backup num banco descartável
# e valida contagens básicas. Nunca restaure sobre o banco de produção com este script.
#   AGE_IDENTITY_FILE  chave privada age (montada só durante o teste)
#   BACKUP_REMOTE      destino rclone
#   RESTORE_URL        postgres://... de um servidor descartável (superusuário)
set -euo pipefail
: "${AGE_IDENTITY_FILE:?}" "${BACKUP_REMOTE:?}" "${RESTORE_URL:?}"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
latest="$(rclone lsf "$BACKUP_REMOTE/daily" | sort | tail -1)"
rclone copyto "$BACKUP_REMOTE/daily/$latest" "$tmp/b.age"
age -d -i "$AGE_IDENTITY_FILE" "$tmp/b.age" > "$tmp/b.dump"
db="restore_test_$(date -u +%Y%m%d%H%M)"
psql "$RESTORE_URL" -c "CREATE DATABASE $db"
pg_restore --no-owner --dbname="${RESTORE_URL%/*}/$db" "$tmp/b.dump"
psql "${RESTORE_URL%/*}/$db" -Atc "SELECT 'tenants', count(*) FROM app.tenants UNION ALL SELECT 'sales', count(*) FROM app.sales UNION ALL SELECT 'migrations', count(*) FROM public.schema_migrations"
psql "$RESTORE_URL" -c "DROP DATABASE $db"
echo "restore ok: $latest"
