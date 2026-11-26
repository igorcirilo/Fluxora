import { DomainError } from "@/lib/errors";
import { assertCents, type Cents } from "./money";
import { assertBizDate, type BizDate } from "./dates";
import { makeReversal, makeTransfer, type CashCategory, type CashMovement } from "./cash";
import { addMonthsClamped, openCents, settle, splitInstallments, type Title, type TitleKind } from "./titles";
import { audit, type Ctx, type TenantState } from "@/modules/tenants/state";
import type { RevenueEntry } from "@/modules/mei/revenue";

const ALLOWED_MANUAL: readonly CashCategory[] = ["expense", "fee", "other_income", "owner_withdrawal", "capital_contribution", "loan"];

export function addMovement(
  state: TenantState,
  input: { accountId: string; date: BizDate; direction: "in" | "out"; amountCents: Cents; category: CashCategory; description: string },
  ctx: Ctx,
): TenantState {
  if (!ALLOWED_MANUAL.includes(input.category)) throw new DomainError("VALIDATION_ERROR", "Categoria não permitida para lançamento manual.");
  const inbound: CashCategory[] = ["other_income", "capital_contribution", "loan"];
  const direction = inbound.includes(input.category) ? "in" : "out";
  if (direction !== input.direction) throw new DomainError("VALIDATION_ERROR", "Direção incompatível com a categoria.");
  assertBizDate(input.date);
  assertCents(input.amountCents);
  const desc = input.description.trim();
  if (!desc || desc.length > 200) throw new DomainError("VALIDATION_ERROR", "Descrição obrigatória (até 200 caracteres).");
  if (!state.accounts.some((a) => a.id === input.accountId)) throw new DomainError("VALIDATION_ERROR", "Conta inválida.");
  const m: CashMovement = { id: ctx.newId("mov"), ...input, description: desc };
  return { ...state, movements: [...state.movements, m], audit: [...state.audit, audit(state, ctx, "movement.create", "movement", m.id, input.category)] };
}

export function transfer(state: TenantState, input: { from: string; to: string; date: BizDate; amountCents: Cents; description: string }, ctx: Ctx): TenantState {
  const id = ctx.newId("trf");
  const legs = makeTransfer({ id, fromAccountId: input.from, toAccountId: input.to, date: input.date, amountCents: input.amountCents, description: input.description || "Transferência entre contas" });
  return { ...state, movements: [...state.movements, ...legs], audit: [...state.audit, audit(state, ctx, "transfer.create", "transfer", id)] };
}

export function reverseMovement(state: TenantState, movementId: string, ctx: Ctx): TenantState {
  const original = state.movements.find((m) => m.id === movementId);
  if (!original) throw new DomainError("TITLE_NOT_FOUND", "Movimento não encontrado.");
  if (original.category === "reversal" || original.category === "transfer") throw new DomainError("VALIDATION_ERROR", "Este movimento não pode ser estornado diretamente.");
  if (original.sourceId) throw new DomainError("VALIDATION_ERROR", "Movimentos de venda são revertidos pela devolução da venda.");
  const rev = makeReversal(original, ctx.newId("mov"), ctx.today, state.movements);
  return { ...state, movements: [...state.movements, rev], audit: [...state.audit, audit(state, ctx, "movement.reverse", "movement", original.id)] };
}

export function createTitles(
  state: TenantState,
  input: { kind: TitleKind; description: string; counterpartyId?: string; competenceDate: BizDate; firstDueDate: BizDate; totalCents: Cents; installments: number; category?: string },
  ctx: Ctx,
): TenantState {
  assertBizDate(input.competenceDate);
  assertBizDate(input.firstDueDate);
  const desc = input.description.trim();
  if (!desc) throw new DomainError("VALIDATION_ERROR", "Descrição obrigatória.");
  const parts = splitInstallments(input.totalCents, input.installments);
  const groupId = ctx.newId("grp");
  const titles: Title[] = parts.map((amount, i) => ({
    id: ctx.newId("tit"),
    kind: input.kind,
    description: parts.length > 1 ? `${desc} (${i + 1}/${parts.length})` : desc,
    counterpartyId: input.counterpartyId,
    competenceDate: input.competenceDate,
    dueDate: addMonthsClamped(input.firstDueDate, i),
    amountCents: amount,
    installment: parts.length > 1 ? { number: i + 1, of: parts.length, groupId } : undefined,
    category: input.category,
    settlements: [],
  }));
  // Recebível avulso de serviço/venda sem PDV também é receita por competência.
  const revenues: RevenueEntry[] =
    input.kind === "receivable" && input.category === "Serviço"
      ? [{ id: ctx.newId("rev"), kind: "service", competenceDate: input.competenceDate, amountCents: input.totalCents, description: desc, sourceId: groupId }]
      : [];
  return {
    ...state,
    titles: [...state.titles, ...titles],
    revenues: [...state.revenues, ...revenues],
    audit: [...state.audit, audit(state, ctx, "title.create", "title", groupId, `${input.kind} x${parts.length}`)],
  };
}

export function settleTitle(state: TenantState, input: { titleId: string; amountCents: Cents; date: BizDate; accountId: string }, ctx: Ctx): TenantState {
  const title = state.titles.find((t) => t.id === input.titleId);
  if (!title) throw new DomainError("TITLE_NOT_FOUND", "Título não encontrado.");
  assertBizDate(input.date);
  if (input.amountCents > openCents(title)) throw new DomainError("SETTLEMENT_EXCEEDS_BALANCE", "Valor maior que o saldo em aberto.");
  const movement: CashMovement = {
    id: ctx.newId("mov"),
    accountId: input.accountId,
    date: input.date,
    direction: title.kind === "receivable" ? "in" : "out",
    amountCents: input.amountCents,
    category: title.kind === "receivable" ? "receivable_settlement" : "payable_settlement",
    description: `Liquidação: ${title.description}`,
  };
  const updated = settle(title, { id: ctx.newId("stl"), date: input.date, amountCents: input.amountCents, accountId: input.accountId, movementId: movement.id });
  return {
    ...state,
    titles: state.titles.map((t) => (t.id === title.id ? updated : t)),
    movements: [...state.movements, movement],
    audit: [...state.audit, audit(state, ctx, "title.settle", "title", title.id, String(input.amountCents))],
  };
}

/** Importação de faturamento anterior ao uso do app (para o limite MEI do ano). */
export function importHistoricalRevenue(state: TenantState, input: { competenceDate: BizDate; amountCents: Cents; description: string }, ctx: Ctx): TenantState {
  assertBizDate(input.competenceDate);
  assertCents(input.amountCents);
  if (input.competenceDate < state.tenant.openedOn) throw new DomainError("BEFORE_OPENING_DATE", "Competência anterior à abertura.");
  const r: RevenueEntry = { id: ctx.newId("rev"), kind: "historical_import", competenceDate: input.competenceDate, amountCents: input.amountCents, description: input.description || "Histórico importado" };
  return { ...state, revenues: [...state.revenues, r], audit: [...state.audit, audit(state, ctx, "revenue.import", "revenue", r.id)] };
}
