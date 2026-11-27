import { DomainError } from "@/lib/errors";
import type { Cents } from "@/modules/finance/money";
import type { BizDate } from "@/modules/finance/dates";

export interface Product {
  id: string;
  sku: string;
  barcode?: string;
  name: string;
  category: string;
  unit: "un" | "kg" | "cx" | "pct" | "h";
  priceCents: Cents;
  costCents: Cents;
  minStock: number;
  trackStock: boolean; // serviços não controlam estoque
  active: boolean;
  createdAt: string;
}

/** Movimento de estoque IMUTÁVEL. Correções são novos movimentos de ajuste auditados. */
export type StockMovementType = "initial" | "purchase" | "sale" | "return" | "adjustment" | "loss";

export interface StockMovement {
  id: string;
  productId: string;
  type: StockMovementType;
  quantity: number; // com sinal: entradas positivas, saídas negativas
  date: BizDate;
  createdAt: string;
  unitCostCents?: Cents;
  sourceId?: string;
  note?: string;
  lot?: string;
  expiresOn?: BizDate;
}

export const STOCK_MOVEMENT_LABEL: Record<StockMovementType, string> = {
  initial: "Saldo inicial",
  purchase: "Compra",
  sale: "Venda",
  return: "Devolução",
  adjustment: "Ajuste de inventário",
  loss: "Perda",
};

export function assertQuantity(q: number): number {
  if (!Number.isInteger(q) || q === 0 || Math.abs(q) > 1_000_000) throw new DomainError("INVALID_QUANTITY", "Quantidade inválida.");
  return q;
}

export function stockBalance(movements: readonly StockMovement[], productId: string): number {
  let b = 0;
  for (const m of movements) if (m.productId === productId) b += m.quantity;
  return b;
}

export function stockBalances(movements: readonly StockMovement[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const m of movements) map.set(m.productId, (map.get(m.productId) ?? 0) + m.quantity);
  return map;
}

/** Valida e cria um movimento de estoque respeitando a configuração de saldo negativo. */
export function makeStockMovement(params: {
  id: string;
  product: Product;
  type: StockMovementType;
  quantity: number;
  date: BizDate;
  createdAt: string;
  allowNegative: boolean;
  existing: readonly StockMovement[];
  note?: string;
  sourceId?: string;
  unitCostCents?: Cents;
  lot?: string;
  expiresOn?: BizDate;
}): StockMovement {
  assertQuantity(params.quantity);
  const outgoing = params.type === "sale" || params.type === "loss";
  const incoming = params.type === "purchase" || params.type === "return" || params.type === "initial";
  if (outgoing && params.quantity > 0) throw new DomainError("INVALID_QUANTITY", "Saída deve ser negativa.");
  if (incoming && params.quantity < 0) throw new DomainError("INVALID_QUANTITY", "Entrada deve ser positiva.");
  if (!params.allowNegative && params.product.trackStock) {
    const after = stockBalance(params.existing, params.product.id) + params.quantity;
    if (after < 0) throw new DomainError("INSUFFICIENT_STOCK", `Estoque insuficiente para ${params.product.name}.`);
  }
  return {
    id: params.id,
    productId: params.product.id,
    type: params.type,
    quantity: params.quantity,
    date: params.date,
    createdAt: params.createdAt,
    note: params.note,
    sourceId: params.sourceId,
    unitCostCents: params.unitCostCents,
    ...(params.lot ? { lot: params.lot } : {}),
    ...(params.expiresOn ? { expiresOn: params.expiresOn } : {}),
  };
}
