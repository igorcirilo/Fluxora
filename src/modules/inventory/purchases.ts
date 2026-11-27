import { DomainError } from "@/lib/errors";
import { assertCents, sumCents, type Cents } from "@/modules/finance/money";
import { addDays, assertBizDate, type BizDate } from "@/modules/finance/dates";
import type { CashMovement } from "@/modules/finance/cash";
import { createTitles, INVENTORY_TITLE_CATEGORY } from "@/modules/finance/ops";
import { audit, ACCOUNT_BANK, type Ctx, type TenantState } from "@/modules/tenants/state";
import type { Supplier } from "@/modules/customers/customer";
import { onlyDigits } from "@/modules/customers/customer";
import { makeStockMovement, stockBalance, type StockMovement } from "./stock";

export function createSupplier(state: TenantState, input: { name: string; phone?: string }, ctx: Ctx): { state: TenantState; value: string } {
  const name = input.name.trim();
  if (name.length < 2 || name.length > 120) throw new DomainError("VALIDATION_ERROR", "Nome do fornecedor deve ter de 2 a 120 caracteres.");
  const phone = input.phone ? onlyDigits(input.phone) : "";
  if (phone && (phone.length < 10 || phone.length > 13)) throw new DomainError("VALIDATION_ERROR", "Telefone com DDD inválido.");
  const s: Supplier = { id: ctx.newId("for"), name, phone: phone || undefined, createdAt: ctx.nowIso };
  return { state: { ...state, suppliers: [...state.suppliers, s], audit: [...state.audit, audit(state, ctx, "supplier.create", "supplier", s.id)] }, value: s.id };
}

/** Custo médio ponderado após a entrada (saldo negativo ou zero ⇒ assume o custo da compra). */
export function weightedAverageCost(balance: number, currentCost: Cents, qty: number, unitCost: Cents): Cents {
  if (balance <= 0) return unitCost;
  return Math.round((balance * currentCost + qty * unitCost) / (balance + qty));
}

export interface PurchaseInput {
  supplierId?: string;
  items: { productId: string; quantity: number; unitCostCents: Cents; lot?: string; expiresOn?: BizDate }[];
  paidNow: boolean;
  accountId?: string;
  firstDueDate?: BizDate;
  installments?: number;
  updateCost?: boolean;
  document?: string;
}

/**
 * Entrada de mercadoria: estoque (com lote/validade), custo médio e pagamento.
 * À vista ⇒ saída de caixa "inventory_purchase"; a prazo ⇒ contas a pagar "Mercadorias".
 * Nenhum dos dois é despesa na DRE: o custo vira CMV quando a mercadoria é vendida.
 */
export function receivePurchase(state: TenantState, input: PurchaseInput, ctx: Ctx): TenantState {
  if (!input.items.length) throw new DomainError("EMPTY_CART", "Informe ao menos um item.");
  if (input.supplierId && !state.suppliers.some((s) => s.id === input.supplierId)) throw new DomainError("VALIDATION_ERROR", "Fornecedor não encontrado.");
  const purchaseId = ctx.newId("cmp");
  const movements: StockMovement[] = [];
  let products = state.products;
  for (const it of input.items) {
    const product = products.find((p) => p.id === it.productId);
    if (!product) throw new DomainError("PRODUCT_NOT_FOUND", "Produto não encontrado.");
    if (!product.trackStock) throw new DomainError("VALIDATION_ERROR", `${product.name} não controla estoque.`);
    if (!Number.isInteger(it.quantity) || it.quantity <= 0) throw new DomainError("INVALID_QUANTITY", "Quantidade inválida.");
    if (!Number.isSafeInteger(it.unitCostCents) || it.unitCostCents < 0) throw new DomainError("INVALID_AMOUNT", "Custo inválido.");
    if (it.expiresOn) assertBizDate(it.expiresOn);
    const balance = stockBalance([...state.stockMovements, ...movements], product.id);
    movements.push(
      makeStockMovement({
        id: ctx.newId("stk"),
        product,
        type: "purchase",
        quantity: it.quantity,
        date: ctx.today,
        createdAt: ctx.nowIso,
        allowNegative: true,
        existing: [],
        unitCostCents: it.unitCostCents,
        sourceId: purchaseId,
        note: input.document ? `Compra ${input.document.trim()}` : "Compra",
        lot: it.lot?.trim() || undefined,
        expiresOn: it.expiresOn,
      }),
    );
    if (input.updateCost !== false) {
      const cost = weightedAverageCost(balance, product.costCents, it.quantity, it.unitCostCents);
      products = products.map((p) => (p.id === product.id ? { ...p, costCents: cost } : p));
    }
  }
  const total = sumCents(input.items.map((i) => i.quantity * i.unitCostCents));
  const supplierName = state.suppliers.find((s) => s.id === input.supplierId)?.name;
  const description = `Compra de mercadorias${input.document ? ` ${input.document.trim()}` : ""}${supplierName ? ` — ${supplierName}` : ""}`;
  let next: TenantState = { ...state, products, stockMovements: [...state.stockMovements, ...movements] };
  if (total > 0) {
    assertCents(total);
    if (input.paidNow) {
      const accountId = input.accountId ?? ACCOUNT_BANK;
      if (!state.accounts.some((a) => a.id === accountId)) throw new DomainError("VALIDATION_ERROR", "Conta inválida.");
      const m: CashMovement = { id: ctx.newId("mov"), accountId, date: ctx.today, direction: "out", amountCents: total, category: "inventory_purchase", description, sourceId: purchaseId };
      next = { ...next, movements: [...next.movements, m] };
    } else {
      next = createTitles(next, { kind: "payable", description, counterpartyId: input.supplierId, competenceDate: ctx.today, firstDueDate: input.firstDueDate ?? addDays(ctx.today, 30), totalCents: total, installments: input.installments ?? 1, category: INVENTORY_TITLE_CATEGORY }, ctx);
    }
  }
  return { ...next, audit: [...next.audit, audit(state, ctx, "purchase.receive", "purchase", purchaseId, `${input.items.length} item(ns) total ${total}`)] };
}

/** Lotes com validade até `days` dias (ou vencidos) entre as entradas recentes — conferência física recomendada. */
export function expiringLots(state: TenantState, today: BizDate, days = 15) {
  const limit = addDays(today, days);
  return state.stockMovements
    .filter((m) => m.type === "purchase" && m.expiresOn && m.expiresOn <= limit && stockBalance(state.stockMovements, m.productId) > 0)
    .map((m) => ({ movement: m, product: state.products.find((p) => p.id === m.productId)!, expired: m.expiresOn! < today }))
    .filter((x) => x.product)
    .sort((a, b) => (a.movement.expiresOn! < b.movement.expiresOn! ? -1 : 1));
}
