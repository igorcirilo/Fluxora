# Matriz implementado / testado / pendente — v0.1 (26/11/2026)

Legenda: ✅ feito · 🧪 coberto por teste automatizado · ⏳ pendente · 🚫 fora do escopo sem autorização/homologação

## Domínio e regras
| Item | Estado |
|---|---|
| Centavos inteiros, parse pt-BR sem float | ✅ 🧪 |
| Limite MEI proporcional, 80/90/100/120%, virada de ano, abertura em dezembro, regra versionada | ✅ 🧪 |
| Estorno ligado ao original (receita e caixa), não excede original | ✅ 🧪 |
| Transferência, saldo inicial, aporte/empréstimo fora da receita | ✅ 🧪 |
| Liquidação parcial, parcelas, títulos vencidos | ✅ 🧪 |
| Importação de histórico de faturamento | ✅ 🧪 |
| Checkout transacional + idempotência + estoque negativo configurável | ✅ 🧪 |
| Devolução total | ✅ 🧪 — devolução parcial ⏳ |
| Sessão de caixa, sangria/suprimento, fechamento com diferença | ✅ 🧪 |
| DAS manual com comprovante, calendário versionado (vencimento nominal) | ✅ 🧪 — ajuste de feriados ⏳ (conferir no PGMEI) |
| DASN-SIMEI (valores para conferência) | ✅ |
| DRE gerencial, projeção 30 dias | ✅ 🧪 |
| MEI caminhoneiro | 🚫 erro explícito |

## Interface
| Item | Estado |
|---|---|
| 9 telas responsivas (375/390/430/desktop), sem rolagem horizontal | ✅ 🧪 E2E |
| Estados vazios e onboarding | ✅ 🧪 E2E |
| Tema escuro, PWA manifest | ✅ — service worker/IndexedDB offline ⏳ |
| Comprovante não fiscal + WhatsApp por link | ✅ |
| Variantes, lotes, validade, kits, fornecedores completos, compras, importação XML | ⏳ |
| Serviços: agenda, profissionais, comissão, orçamento PDF, OS | ⏳ |
| Catálogo público com QR | ⏳ |
| Painel do contador (multi-empresa), superadmin | ⏳ (vínculo revogável já modelado) |

## Backend e segurança
| Item | Estado |
|---|---|
| Migrations com RLS FORCE, FKs compostas, imutabilidade, papel runtime restrito | ✅ 🧪 PostgreSQL 16 real |
| Contexto de tenant transacional sem vazamento no pool | ✅ 🧪 |
| APIs Zod com erros estáveis | ✅ 🧪 |
| Autenticação (Better Auth: Argon2id/scrypt, cookies seguros, CSRF, rate limit, MFA admin, recuperação por token único) | ⏳ próxima etapa |
| Repositórios PostgreSQL para todas as telas (substituir store da demo) | ⏳ |
| FiscalProvider real (sandbox oficial + homologação) | 🚫 sem credenciais/autorização |
| BillingProvider real (PSP com KYC) | 🚫 sem formalização |
| Worker de fila | ⏳ (tabela pronta) |
| Docker multi-stage non-root, compose, healthchecks, backup cifrado, teste de restore | ✅ (build no CI) |

## Limitações conhecidas da demo
- Dados apenas no navegador (localStorage ~2 MB); outro dispositivo/navegador vê seus próprios dados fictícios.
- Sem autenticação: qualquer pessoa com o link vê a demo (somente dados fictícios).
- Valores de DAS, taxas e contador do seed são fictícios.
- Homologação fiscal e revisão contábil não podem ser substituídas por testes.
