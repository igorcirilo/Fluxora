#!/bin/sh
# Executado pelo entrypoint oficial do postgres somente na primeira inicialização do volume.
set -eu
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres \
  -v owner_pw="$FLUXORA_OWNER_PASSWORD" -v app_pw="$FLUXORA_APP_PASSWORD" \
  -f /fluxora/init-roles.sql
