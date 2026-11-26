import { DomainError } from "@/lib/errors";
import { assertCents, sumCents, type Cents } from "@/modules/finance/money";
import { addDays, type BizDate } from "@/modules/finance/dates";
import type { CashMovement } from "@/modules/finance/cash";
import type { Title } from "@/modules/finance/titles";
import { makeStockMovement, type StockMovement } from "@/modules/inventory/stock";
import type { RevenueEntry } from "@/modules/mei/revenue";
import { ACCOUNT_BANK, ACCOUNT_DRAWER, audit, type Ctx, type TenantState } from "@/modules/tenants/state";
import type { PaymentMethod, Sale, SaleItem, SalePayment } from "./types";

export interface CheckoutInput {
  idempotencyKey: string;
  items: { productId: string; quantity: number; unitPriceCents?: Cents }[];
  discountCents?: Cents;
  payments: SalePayment[];
  cashTenderedCents?: Cents;
  customerId?: string;
  date?: BizDate;
  creditDueDate?: BizDate; // vencimento do fiado
  note?: string;
}

export interface CheckoutResult {
  state: TenantState;
  sale: Sale;
  duplicate: boolean;
}

/** Prazo gerencial padrão para crédito (recebível da operadora). Ajustável por configuração futura. */
export const CARD_CREDIT_SETTLEMENT_DAYS = 30;

export function openCashSession(state: TenantState) {
  return state.cashSessions.find((s) => !s.closedAt);
}

/**
 * Finaliza uma venda como uma ÚNICA transação lógica:
 * venda + itens + baixa de estoque + receita (competência) + caixa (liquidado) + recebíveis.
 * Se qualquer validação falhar, nada é alterado. Repetir a mesma chave idempotente não duplica.
 */
export function checkout(state: TenantState, input: CheckoutInput, ctx: Ctx): CheckoutResult {
  const idemKey = `sale:${input.idempotencyKey}`;
  const existingId = state.idempotency[idemKey];
  if (existingId) {
    const existing = state.sales.find((s) => s.id === existingId);
    if (existing) return { state, sale: existing, duplicate: true };
  }

  if (!input.idempotencyKey || input.idempotencyKey.length < 8) throw new DomainError("VALIDATION_ERROR", "Chave idempotente obrigatória.");
  if (input.items.length === 0) throw new DomainError("EMPTY_CART", "Adicione ao menos um item.");
  const date = input.date ?? ctx.today;
  if (date < state.tenant.openedOn) throw new DomainError("BEFORE_OPENING_DATE", "Data anterior à abertura da empresa.");

  // Agrega quantidades por produto para validar estoque de forma consistente.
  const items: SaleItem[] = [];
  for (const line of input.items) {
    const product = state.products.find((p) => p.id === line.productId);
    if (!product) throw new DomainError("PRODUCT_NOT_FOUND", "Produto não encontrado.");
    if (!product.active) throw new DomainError("PRODUCT_INACTIVE", `${product.name} está inativo.`);
    if (!Number.isInteger(line.quantity) || line.quantity <= 0 || line.quantity > 10_000) {
      throw new DomainError("INVALID_QUANTITY", "Quantidade inválida.");
    }
    const unit = line.unitPriceCents ?? product.priceCents;
    assertCents(unit);
    items.push({
      productId: product.id,
      name: product.name,
      quantity: line.quantity,
      unitPriceCents: unit,
      unitCostCents: product.costCents,
      totalCents: unit * line.quantity,
    });
  }

  const subtotal = sumCents(items.map((i) => i.totalCents));
  const discount = input.discountCents ?? 0;
  if (!Number.isSafeInteger(discount) || discount < 0) throw new DomainError("INVALID_AMOUNT", "Desconto inválido.");
  if (discount >= subtotal) throw new DomainError("DISCOUNT_EXCEEDS_SUBTOTAL", "Desconto deve ser menor que o subtotal.");
  const total = subtotal - discount;

  // Pagamentos: soma deve ser exatamente o total; troco só a partir de dinheiro.
  const payments = input.payments.filter((p) => p.amountCents > 0);
  for (const p of payments) assertCents(p.amountCents);
  const paid = sumCents(payments.map((p) => p.amountCents));
  if (paid !== total) throw new DomainError("PAYMENT_MISMATCH", "A soma dos pagamentos deve ser igual ao total.");
  const cashApplied = sumCents(payments.filter((p) => p.method === "dinheiro").map((p) => p.amountCents));
  const tendered = input.cashTenderedCents ?? cashApplied;
  if (tendered > 0 && cashApplied === 0) throw new DomainError("CHANGE_WITHOUT_CASH", "Troco só é possível com pagamento em dinheiro.");
  if (tendered < cashApplied) throw new DomainError("PAYMENT_MISMATCH", "Valor recebido em dinheiro menor que o aplicado.");
  const change = tendered - cashApplied;

  const hasFiado = payments.some((p) => p.method === "fiado");
  if (hasFiado && !input.customerId) throw new DomainError("CREDIT_REQUIRES_CUSTOMER", "Venda fiado exige cliente identificado.");
  if (input.customerId && !state.customers.some((c) => c.id === input.customerId)) {
    throw new DomainError("VALIDATION_ERROR", "Cliente não encontrado.");
  }

  const session = openCashSession(state);
  if (cashApplied > 0 && !session) throw new DomainError("CASH_SESSION_CLOSED", "Abra o caixa para receber em dinheiro.");

  const saleId = ctx.newId("sale");
  const number = state.seq.sale + 1;

  // Baixa de estoque (valida saldo considerando movimentos anteriores da MESMA venda).
  const stockMovements: StockMovement[] = [];
  for (const item of items) {
    const product = state.products.find((p) => p.id === item.productId)!;
    if (!product.trackStock) continue;
    stockMovements.push(
      makeStockMovement({
        id: ctx.newId("stk"),
        product,
        type: "sale",
        quantity: -item.quantity,
        date,
        createdAt: ctx.nowIso,
        allowNegative: state.tenant.allowNegativeStock,
        existing: [...state.stockMovements, ...stockMovements],
        sourceId: saleId,
        unitCostCents: product.costCents,
      }),
    );
  }

  const revenue: RevenueEntry = {
    id: ctx.newId("rev"),
    kind: items.every((i) => !state.products.find((p) => p.id === i.productId)?.trackStock) ? "service" : "sale",
    competenceDate: date,
    amountCents: total,
    description: `Venda #${number}`,
    sourceId: saleId,
  };

  const movements: CashMovement[] = [];
  const titles: Title[] = [];
  const accountFor: Partial<Record<PaymentMethod, string>> = { dinheiro: ACCOUNT_DRAWER, pix: ACCOUNT_BANK, debito: ACCOUNT_BANK };
  for (const p of payments) {
    const accountId = accountFor[p.method];
    if (accountId) {
      movements.push({
        id: ctx.newId("mov"),
        accountId,
        date,
        direction: "in",
        amountCents: p.amountCents,
        category: "sale_receipt",
        description: `Venda #${number} (${p.method})`,
        sourceId: saleId,
        sessionId: p.method === "dinheiro" ? session?.id : undefined,
      });
    } else {
      const isCredit = p.method === "credito";
      titles.push({
        id: ctx.newId("tit"),
        kind: "receivable",
        description: isCredit ? `Cartão de crédito — venda #${number}` : `Fiado — venda #${number}`,
        counterpartyId: isCredit ? undefined : input.customerId,
        competenceDate: date,
        dueDate: isCredit ? addDays(date, CARD_CREDIT_SETTLEMENT_DAYS) : (input.creditDueDate ?? addDays(date, 30)),
        amountCents: p.amountCents,
        category: isCredit ? "Cartão" : "Fiado",
        sourceId: saleId,
        settlements: [],
      });
    }
  }

  const sale: Sale = {
    id: saleId,
    number,
    idempotencyKey: input.idempotencyKey,
    createdAt: ctx.nowIso,
    date,
    customerId: input.customerId,
    items,
    subtotalCents: subtotal,
    discountCents: discount,
    totalCents: total,
    payments,
    cashTenderedCents: tendered,
    changeCents: change,
    status: "concluida",
    cashSessionId: cashApplied > 0 ? session?.id : undefined,
    note: input.note,
  };

  const next: TenantState = {
    ...state,
    sales: [...state.sales, sale],
    stockMovements: [...state.stockMovements, ...stockMovements],
    revenues: [...state.revenues, revenue],
    movements: [...state.movements, ...movements],
    titles: [...state.titles, ...titles],
    idempotency: { ...state.idempotency, [idemKey]: saleId },
    seq: { ...state.seq, sale: number },
  };
  next.audit = [...state.audit, audit(state, ctx, "sale.create", "sale", saleId, `#${number} total ${total}`)];
  return { state: next, sale, duplicate: false };
}
