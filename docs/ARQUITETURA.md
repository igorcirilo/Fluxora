# Arquitetura

## Visão geral
Monólito modular Next.js. O **domínio** (`src/modules`) é TypeScript puro, sem dependência de framework, banco ou navegador: cada operação recebe o estado do tenant e um contexto (`Ctx`: relógio, ator, gerador de IDs) e devolve o novo estado — o equivalente a uma transação. Isso permite:

- testar regras financeiras/fiscais isoladamente (Vitest);
- rodar a **demo** inteira no navegador (`src/demo/store.ts`) sem backend;
- trocar a persistência pelo PostgreSQL sem reescrever regras.

```
UI (app/) ──► casos de uso (modules/*) ──► persistência
                                        ├─ demo: DemoStore (localStorage, por navegador)
                                        └─ produção: PostgreSQL + RLS via withTenant()
```

## Dinheiro e datas
- Centavos inteiros sempre (`bigint` no banco; inteiros seguros validados no JS). `parseCents` converte texto pt-BR sem float.
- Datas comerciais `YYYY-MM-DD` em America/Sao_Paulo (`todayBiz`); timestamps técnicos em UTC.
- Competência (receita), vencimento (título) e liquidação (caixa) são campos diferentes.

## Regras MEI
- `TAX_RULES` / tabela `app.tax_rules`: regra versionada por regime e vigência (anos). Sem regra vigente ⇒ erro explícito. MEI caminhoneiro não suportado (erro `REGIME_NOT_SUPPORTED`).
- Limite proporcional: meses de atividade no ano de abertura incluindo o mês de abertura.
- Classificação com aritmética inteira exata: 80% monitorar, 90% atenção, 100% atingido, até 120% excesso, acima de 120% excesso superior. Sem desenquadramento automático.
- Estornos referenciam o original e afetam a competência dele; não podem exceder o original.
- Transferências, aportes e empréstimos não são receita (tipos distintos de lançamento).

## PDV transacional
`checkout()` valida tudo antes de alterar qualquer coisa e grava juntos: venda, itens, baixa de estoque, receita, movimentos de caixa e recebíveis. A chave idempotente (`sale:<uuid>` por tenant) faz a repetição devolver a venda existente. No banco, `UNIQUE (tenant_id, idempotency_key)` garante o mesmo sob concorrência.

## Multi-tenant e segurança (PostgreSQL)
- Todas as tabelas de negócio têm `tenant_id NOT NULL`, `UNIQUE (tenant_id, id)` e FKs **compostas** `(tenant_id, x_id)` — impossível referenciar registro de outro tenant.
- `ENABLE` + `FORCE ROW LEVEL SECURITY` com política `tenant_id = app.current_tenant_id() AND app.is_member(tenant_id)` (USING e WITH CHECK). Sem contexto ⇒ zero linhas (negar por padrão).
- Papel `fluxora_app` (runtime): sem superusuário, sem `BYPASSRLS`, não é dono das tabelas, privilégios mínimos; históricos (ledger, receita, estoque, auditoria, liquidações) sem UPDATE/DELETE e com triggers de imutabilidade.
- `withTenant(pool, {userId, tenantId}, fn)`: `BEGIN` → `set_config('app.user_id', …, true)` → verifica membership → `set_config('app.tenant_id', …, true)` → `fn` → `COMMIT`. Configurações locais à transação não vazam no pool (testado com pool de 1 conexão).
- Onboarding por `app.create_tenant()` (SECURITY DEFINER, `search_path` fixo).
- Testes de integração: A × B em leitura, escrita, exportação, IDs aninhados, set_config forjado, pool.

## Integrações
- `FiscalProvider` (`issue/status/cancel/fetchXml`) com estados `draft → queued → submitted → authorized | rejected | unknown → cancelled`. “authorized” exige protocolo (também via CHECK no banco). Sem provedor: `DisabledFiscalProvider` lança `FISCAL_PROVIDER_NOT_CONFIGURED` (HTTP 503).
- `BillingProvider` com verificação de webhook; desabilitado rejeita todos (401). Webhooks deduplicados por `(provider, event_id)`; fila `app.jobs` com `max_attempts` e dead letter.

## APIs
Respostas de erro estáveis `{ error: { code, message, details? } }`, validação Zod, limite de tamanho de corpo, `Cache-Control: no-store`. Cabeçalhos de segurança globais (`X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`).

## Front-end
Componentes reutilizáveis em `src/components/ui` (botões, cards, modais bottom-sheet no celular, segmented, KPIs com definição, gráficos SVG sem biblioteca), tema claro/escuro por tokens CSS, navegação inferior no celular e lateral no desktop, PWA manifest.
