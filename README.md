# Fluxora

Gestão simples para **MEI de comércio e serviços**: registrar vendas, saber quanto entrou e saiu, acompanhar o limite do MEI e as obrigações, e compartilhar tudo com o contador.

> **Estado atual: v0.1 — demonstração navegável com dados fictícios.** Sem login real, sem banco no servidor, sem emissão fiscal e sem cobranças. Os cálculos são gerenciais e não substituem o contador.

## O que já existe

| Área | Situação |
|---|---|
| Painel | KPIs com período e definição (receita por competência ≠ caixa ≠ lucro), gráfico receita × caixa, limite MEI, alertas, agenda de 30 dias, mais vendidos |
| PDV | Busca/código de barras/SKU, carrinho, desconto (R$ ou %), pagamentos mistos, troco, fiado e crédito como recebíveis, abertura/fechamento de caixa, sangria/suprimento, comprovante **não fiscal**, idempotência |
| Vendas | Histórico com filtros, devolução com estorno ligado, rascunho fiscal, CSV |
| Produtos | Cadastro, custo/margem, estoque com movimentos imutáveis (compra, perda, inventário), alerta de mínimo, importação/exportação CSV |
| Clientes | Cadastro mínimo (LGPD), histórico, fiado em aberto, recebimento parcial, cobrança por link do WhatsApp |
| Financeiro | Fluxo de caixa mensal, saldos por conta, projeção 30 dias, DRE gerencial, contas a receber/pagar com parcelas e liquidação parcial, lançamentos com estorno, transferências |
| Meu MEI | Limite proporcional, alertas 80/90/100/120%, projeção, DAS manual com comprovante, DASN-SIMEI, importação de histórico, links oficiais |
| Fiscal | Interfaces `FiscalProvider` com máquina de estados; desabilitado sem provedor homologado (nunca simula sucesso) |
| Configurações | Empresa, tema claro/escuro, vínculo de contador revogável, exportação JSON, restauração da demo, auditoria |
| Backend (base) | Migrations PostgreSQL com RLS, papel de runtime sem BYPASSRLS, contexto de tenant transacional, APIs com Zod |

Detalhes e lacunas em [`docs/STATUS.md`](docs/STATUS.md). Arquitetura em [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md). Implantação futura em VPS em [`docs/DEPLOY.md`](docs/DEPLOY.md).

## Stack

Next.js 16 (App Router) · React 19 · TypeScript strict · Tailwind CSS 4 · Zod 4 · PostgreSQL 16 (`pg`) · Vitest · Playwright. Dependências com versão exata e `package-lock.json`.

## Comandos (executados no CI — o proprietário não precisa instalar nada)

```bash
npm ci
npm run lint            # ESLint (next/core-web-vitals + TS)
npm run typecheck       # tsc --noEmit
npm run test            # unitários (motor financeiro, MEI, PDV, store, APIs)
npm run test:integration# PostgreSQL real; requer TEST_PG_ADMIN_URL
npm run test:e2e        # Playwright em 375/390/430 px e desktop
npm run build
npm run test:legacy     # testes do protótipo Python original
npm run db:migrate      # aplica migrations (DATABASE_URL_MIGRATOR)
docker compose up -d --build   # produção futura (ver docs/DEPLOY.md)
```

## Modo demonstração

- Duas empresas fictícias isoladas (Doceria Aurora — comércio; Studio Bela Forma — serviços, aberta neste ano) e opção “começar do zero”.
- Dados gerados de forma determinística pelos próprios casos de uso do domínio e guardados **apenas no navegador** (localStorage). Limpar os dados do site ou usar “Restaurar dados de demonstração” recomeça.
- Nenhum dado real, nenhum segredo, nenhuma chamada a serviços externos.

## Estrutura

```
src/app/(auth)        entrada/onboarding da demo
src/app/(dashboard)   telas do produto
src/app/api           health, reports/{mei,cash}, fiscal/documents, billing/webhooks
src/modules/          domínio puro: finance, mei, sales, inventory, customers, fiscal, billing, accounting, tenants
src/lib/{db,errors,api}  PostgreSQL (withTenant), erros estáveis, utilitários de API
src/demo/             store isolado por tenant + seed fictício
migrations/           SQL portável (RLS)
tests/{unit,integration,e2e}
deploy/               Postgres init, backup cifrado, teste de restore
legacy/prototipo-python  protótipo original (referência de regras)
docs/                 documentação do produto e técnica
```
