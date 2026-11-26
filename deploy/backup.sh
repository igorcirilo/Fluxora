#!/usr/bin/env bash
# Backup diário cifrado do PostgreSQL (RPO 24h). Agende no Coolify (Scheduled Task) ou cron do host.
# Requer: pg_dump (mesma major do servidor), age (https://age-encryption.org) e rclone configurado
# com um destino EXTERNO à VPS. Nenhum segredo neste arquivo: tudo vem do ambiente.
#   PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE   conexão (papel com leitura total, ex.: owner)
#   BACKUP_AGE_RECIPIENT                         chave pública age (a privada fica fora da VPS)
#   BACKUP_REMOTE                                destino rclone, ex.: r2:fluxora-backups
set -euo pipefail
: "${BACKUP_AGE_RECIPIENT:?defina BACKUP_AGE_RECIPIENT}" "${BACKUP_REMOTE:?defina BACKUP_REMOTE}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
dow="$(date -u +%u)"
file="fluxora-${stamp}.dump.age"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
pg_dump --format=custom --no-owner --no-privileges | age -r "$BACKUP_AGE_RECIPIENT" > "$tmp/$file"
rclone copyto "$tmp/$file" "$BACKUP_REMOTE/daily/$file"
[ "$dow" = "7" ] && rclone copyto "$tmp/$file" "$BACKUP_REMOTE/weekly/$file"
# Retenção: 7 diários e 4 semanais.
rclone delete --min-age 8d "$BACKUP_REMOTE/daily"
rclone delete --min-age 29d "$BACKUP_REMOTE/weekly"
echo "backup ok: $file"
