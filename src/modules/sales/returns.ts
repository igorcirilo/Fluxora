import { DomainError } from "@/lib/errors";
import type { CashMovement } from "@/modules/finance/cash";
import { openCents, type Title } from "@/modules/finance/titles";
import type { StockMovement } from "@/modules/inventory/stock";
import type { RevenueEntry } from "@/modules/mei/revenue";
import { ACCOUNT_DRAWER, audit, type Ctx, type TenantState } from "@/modules/tenants/state";
import { openCashSession } from "./checkout";

/**
 * Devolução total de uma venda. Nada é apagado: gera estorno de receita ligado ao original,
 * entrada de estoque, reembolso dos valores liquidados e cancelamento do saldo em aberto.
 */
export function returnSale(state: TenantState, saleId: string, ctx: Ctx, reason = "Devolução"): TenantState {
  const sale = state.sales.find((s) => s.id === saleId);
  if (!sale) throw new DomainError("SALE_NOT_FOUND", "Venda não encontrada.");
  if (sale.status === "devolvida") throw new DomainError("SALE_ALREADY_RETURNED", "Venda já devolvida.");
  const originalRevenue = state.revenues.find((r) => r.sourceId === sale.id && r.kind !== "reversal");
  if (!originalRevenue) throw new DomainError("REVERSAL_ORIGINAL_NOT_FOUND", "Receita original não encontrada.");

  const reversal: RevenueEntry = {
    id: ctx.newId("rev"),
    kind: "reversal",
    competenceDate: ctx.today,
    amountCents: sale.totalCents,
    description: `Devolução venda #${sale.number}`,
    reversalOf: originalRevenue.id,
    sourceId: sale.id,
  };

  const stock: StockMovement[] = state.stockMovements
    .filter((m) => m.sourceId === sale.id && m.type === "sale")
    .map((m) => ({ id: ctx.newId("stk"), productId: m.productId, type: "return" as const, quantity: -m.quantity, date: ctx.today, createdAt: ctx.nowIso, sourceId: sale.id, note: reason }));

  const session = openCashSession(state);
  const refunds: CashMovement[] = state.movements
    .filter((m) => m.sourceId === sale.id && m.category === "sale_receipt")
    .map((m) => {
      if (m.accountId === ACCOUNT_DRAWER && !session) throw new DomainError("CASH_SESSION_CLOSED", "Abra o caixa para devolver dinheiro.");
      return {
        id: ctx.newId("mov"),
        accountId: m.accountId,
        date: ctx.today,
        direction: "out" as const,
        amountCents: m.amountCents,
        category: "refund" as const,
        description: `Reembolso venda #${sale.number}`,
        sourceId: sale.id,
        reversalOf: m.id,
        sessionId: m.accountId === ACCOUNT_DRAWER ? session?.id : undefined,
      };
    });

  const titles: Title[] = state.titles.map((t) => (t.sourceId === sale.id && openCents(t) > 0 ? { ...t, cancelledAt: ctx.nowIso } : t));
  for (const t of state.titles.filter((x) => x.sourceId === sale.id)) {
    for (const s of t.settlements) {
      refunds.push({ id: ctx.newId("mov"), accountId: s.accountId, date: ctx.today, direction: "out", amountCents: s.amountCents, category: "refund", description: `Reembolso parcela venda #${sale.number}`, sourceId: sale.id, reversalOf: s.movementId });
    }
  }

  return {
    ...state,
    sales: state.sales.map((s) => (s.id === sale.id ? { ...s, status: "devolvida", returnedAt: ctx.nowIso } : s)),
    revenues: [...state.revenues, reversal],
    stockMovements: [...state.stockMovements, ...stock],
    movements: [...state.movements, ...refunds],
    titles,
    audit: [...state.audit, audit(state, ctx, "sale.return", "sale", sale.id, reason)],
  };
}
