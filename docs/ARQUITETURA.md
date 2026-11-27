# Arquitetura

## Visão geral
Monólito modular Next.js. O **domínio** (`src/modules`) é TypeScript puro, sem dependência de framework, banco ou navegador: cada operação recebe o estado do tenant e um contexto (`Ctx`: relógio, ator, gerador de IDs) e devolve o novo estado — o equivalente a uma transação. Isso permite:

- testar regras financeiras/fiscais isoladamente (Vitest);
- rodar a **demo** inteira no navegador (`src/demo/store.ts`) sem backend;
- trocar a persistência pelo PostgreSQL sem reescrever regras.

```
UI (app/) ──► exec("comando", input) ──► COMMANDS (Zod + domínio puro)
                     │
                     ├─ modo demo:  DemoStore (localStorage, dados fictícios)
                     └─ modo conta: POST /api/app/commands
                                    → Better Auth (sessão) → withTenant (membership + RLS)
                                    → SELECT … FOR UPDATE na empresa (serializa escritas)
                                    → loadTenantState → runCommand → persistDiff → COMMIT
```

### Barramento de comandos (`src/modules/commands.ts`)
Toda escrita é um comando nomeado (`sale.checkout`, `purchase.receive`, `title.settle`…) com schema Zod validado **no servidor**. A interface nunca envia funções nem estado: só nome + entrada. O mesmo registro roda na demo e no servidor, então regras e testes valem para os dois modos.

### Repositório PostgreSQL (`src/lib/db/tenant-repo.ts`)
Carrega o agregado do tenant sob RLS e grava apenas a diferença após o comando. Coleções de histórico (caixa, receita, estoque, liquidações, DAS, auditoria) são somente-inserção: qualquer alteração/remoção nelas aborta a transação. Teste de integração grava ~1.500 vendas fictícias e confere leitura idêntica. Limitação conhecida: cada comando carrega o agregado inteiro — adequado ao volume de MEI no piloto; consultas direcionadas ficam para quando o volume exigir (medir p95).

### Autenticação (`src/lib/auth`)
Better Auth 1.7 com tabelas `app.auth_*` (migration 0001): senha com hash scrypt (mínimo 12 caracteres), sessão em cookie HttpOnly/SameSite (Secure em produção), CSRF por Origin/Fetch-Metadata, limite de tentativas persistido no banco, verificação em duas etapas (TOTP + códigos de recuperação). Rotas próprias `/api/app/*` exigem sessão e Origin igual ao host. A empresa ativa fica num cookie apenas como preferência; a membership é sempre verificada no banco. Recuperação de senha exige provedor de e-mail (desabilitada até configurar; nunca simulada).

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
- Todas as tabelas de negócio têm `tenant_id NOT NULL`, chave primária `(tenant_id, id)` (IDs de texto gerados pelo domínio) e FKs **compostas** `(tenant_id, x_id)` — impossível referenciar registro de outro tenant.
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

## Comércio (Etapa 2)
- **Compras de mercadoria** (`purchase.receive`): entrada no estoque com lote e validade, custo médio ponderado e pagamento à vista (`inventory_purchase`) ou a prazo (contas a pagar categoria "Mercadorias"). Compras não são despesa na DRE: o custo entra pelo CMV quando vendida.
- **Fornecedores** (`supplier.create`) e alerta de **lotes com validade próxima** (15 dias) no painel e em Produtos. O sistema não rastreia qual lote foi vendido (sem FIFO por lote); o alerta pede conferência física.

## Preparação da NFC-e — SP (Etapa 3)
- `src/modules/fiscal/nfce.ts`: validação de formato (IE-SP com dígitos verificadores, NCM, CFOP, CSOSN, origem, CEST), configuração (série, numeração, ambiente, CRT) e checklist de prontidão com responsável por item (empresa, contador, Fluxora).
- Certificado A1 e CSC **nunca** ficam no banco do app: só indicadores de que foram configurados no provedor de emissão.
- Produção exige revisão do contador registrada (regra no domínio e CHECK no banco, migration 0004).
- A emissão segue desabilitada (`DisabledFiscalProvider`) até haver provedor homologado. Roteiro para o contador: `docs/CHECKLIST-CONTADOR-NFCE.md`.

## Painel do contador
- Convite: o titular gera um código de 8 caracteres (validade 7 dias, 5 tentativas). O aceite exige e-mail igual ao convidado **e** o código (`app.accept_accountant_invite`, SECURITY DEFINER). O código nunca é lido pelo runtime (privilégio por coluna).
- Papel `accountant` em `memberships`: leitura via RLS; escrita barrada por `app.can_write()` nas políticas de INSERT/UPDATE/DELETE de todas as tabelas de empresa e também na camada de comandos.
- Revogar (`accountant.revoke`) dispara trigger que remove a membership na mesma transação.
- `memberships` não força RLS para o dono da tabela, para que as funções SECURITY DEFINER administrem vínculos; o runtime continua sujeito ao RLS e sem privilégio de escrita nessa tabela.
