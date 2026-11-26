# Implantação

## Agora: preview na Vercel (temporário)
Somente para demonstração com dados fictícios, sem segredos e sem banco. A Vercel compila o Next.js a partir do GitHub. O plano Hobby é destinado a uso pessoal **não comercial** — antes de uso comercial, migrar para a VPS ou contratar plano adequado.

## Futuro: VPS com Docker/Coolify + PostgreSQL
Pré-requisitos: VPS (4–8 GB RAM como ponto de partida), Coolify, domínio com Cloudflare (TLS Full strict), destino de backup externo (ex.: R2/S3) e chave pública `age`.

1. **Segredos** (no Coolify, nunca no Git): `POSTGRES_SUPERUSER_PASSWORD`, `FLUXORA_OWNER_PASSWORD`, `FLUXORA_APP_PASSWORD` (senhas longas e distintas).
2. **Subir**: `docker compose up -d --build`. Ordem garantida: `db` (healthcheck) → `migrate` (tarefa explícita com o papel proprietário) → `app` (papel de runtime, healthcheck em `/api/health`).
3. **Rede**: Postgres só na rede `internal` (sem porta publicada). App exposto apenas em `127.0.0.1`; o proxy do Coolify publica 80/443. Firewall: 80/443 abertos; SSH por chave e restrito.
4. **Backup**: agendar `deploy/backup.sh` diariamente (pg_dump → `age` → rclone externo; retenção 7 diários + 4 semanais). Mensalmente executar `deploy/restore-test.sh` num servidor descartável e registrar o resultado (RPO 24h / RTO 4h a comprovar).
5. **Cache/CDN**: Cloudflare só para estáticos públicos (`/_next/static`, `/icon.svg`); nunca respostas autenticadas ou XML fiscal.
6. **Monitorar**: p95 (< 800 ms em operações comuns), erros, fila (`app.jobs`), disco e sucesso dos backups.

O build Docker é validado no CI (`.github/workflows/ci.yml`, job `docker`). No ambiente do agente o download das imagens base foi recusado por limite de taxa do registro; por isso o estágio runtime foi validado executando o servidor standalone (`/api/health` OK).
