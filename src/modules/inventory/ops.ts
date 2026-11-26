import { DomainError } from "@/lib/errors";
import { assertCents, type Cents } from "@/modules/finance/money";
import { audit, type Ctx, type TenantState } from "@/modules/tenants/state";
import { makeStockMovement, stockBalance, type Product, type StockMovementType } from "./stock";

export interface ProductInput {
  name: string;
  sku: string;
  barcode?: string;
  category: string;
  unit: Product["unit"];
  priceCents: Cents;
  costCents: Cents;
  minStock: number;
  trackStock: boolean;
  initialStock?: number;
}

function validate(state: TenantState, input: ProductInput, ignoreId?: string) {
  const name = input.name.trim();
  if (!name || name.length > 120) throw new DomainError("VALIDATION_ERROR", "Nome obrigatório (até 120 caracteres).");
  const sku = input.sku.trim().toUpperCase();
  if (!/^[A-Z0-9-]{2,30}$/.test(sku)) throw new DomainError("VALIDATION_ERROR", "SKU deve ter 2–30 letras, números ou hífen.");
  if (state.products.some((p) => p.sku === sku && p.id !== ignoreId)) throw new DomainError("VALIDATION_ERROR", "SKU já cadastrado.");
  if (input.barcode && !/^\d{8,14}$/.test(input.barcode)) throw new DomainError("VALIDATION_ERROR", "Código de barras deve ter 8–14 dígitos.");
  assertCents(input.priceCents);
  if (!Number.isSafeInteger(input.costCents) || input.costCents < 0) throw new DomainError("INVALID_AMOUNT", "Custo inválido.");
  if (!Number.isInteger(input.minStock) || input.minStock < 0) throw new DomainError("INVALID_QUANTITY", "Estoque mínimo inválido.");
  return { name, sku };
}

export function createProduct(state: TenantState, input: ProductInput, ctx: Ctx): TenantState {
  const { name, sku } = validate(state, input);
  const product: Product = {
    id: ctx.newId("prd"),
    name,
    sku,
    barcode: input.barcode || undefined,
    category: input.category.trim() || "Geral",
    unit: input.unit,
    priceCents: input.priceCents,
    costCents: input.costCents,
    minStock: input.minStock,
    trackStock: input.trackStock,
    active: true,
    createdAt: ctx.nowIso,
  };
  const movements =
    input.trackStock && input.initialStock && input.initialStock > 0
      ? [
          makeStockMovement({
            id: ctx.newId("stk"),
            product,
            type: "initial",
            quantity: input.initialStock,
            date: ctx.today,
            createdAt: ctx.nowIso,
            allowNegative: true,
            existing: [],
            unitCostCents: input.costCents,
          }),
        ]
      : [];
  return {
    ...state,
    products: [...state.products, product],
    stockMovements: [...state.stockMovements, ...movements],
    audit: [...state.audit, audit(state, ctx, "product.create", "product", product.id, sku)],
  };
}

export function updateProduct(state: TenantState, id: string, input: Omit<ProductInput, "initialStock"> & { active: boolean }, ctx: Ctx): TenantState {
  const current = state.products.find((p) => p.id === id);
  if (!current) throw new DomainError("PRODUCT_NOT_FOUND", "Produto não encontrado.");
  const { name, sku } = validate(state, input, id);
  const updated: Product = { ...current, ...input, name, sku, barcode: input.barcode || undefined, category: input.category.trim() || "Geral" };
  return {
    ...state,
    products: state.products.map((p) => (p.id === id ? updated : p)),
    audit: [...state.audit, audit(state, ctx, "product.update", "product", id, sku)],
  };
}

/** Movimento manual: compra (entrada), perda (saída) ou ajuste para contagem de inventário. */
export function moveStock(
  state: TenantState,
  input: { productId: string; type: Extract<StockMovementType, "purchase" | "loss" | "adjustment">; quantity: number; note?: string; countedTo?: number },
  ctx: Ctx,
): TenantState {
  const product = state.products.find((p) => p.id === input.productId);
  if (!product) throw new DomainError("PRODUCT_NOT_FOUND", "Produto não encontrado.");
  if (!product.trackStock) throw new DomainError("VALIDATION_ERROR", "Item sem controle de estoque.");
  let qty = input.quantity;
  if (input.type === "adjustment") {
    if (input.countedTo === undefined || !Number.isInteger(input.countedTo) || input.countedTo < 0) throw new DomainError("INVALID_QUANTITY", "Contagem inválida.");
    qty = input.countedTo - stockBalance(state.stockMovements, product.id);
    if (qty === 0) throw new DomainError("INVALID_QUANTITY", "Contagem igual ao saldo atual.");
  } else if (input.type === "loss") qty = -Math.abs(qty);
  else qty = Math.abs(qty);
  const m = makeStockMovement({
    id: ctx.newId("stk"),
    product,
    type: input.type,
    quantity: qty,
    date: ctx.today,
    createdAt: ctx.nowIso,
    allowNegative: state.tenant.allowNegativeStock || input.type === "adjustment",
    existing: state.stockMovements,
    note: input.note,
    unitCostCents: product.costCents,
  });
  return {
    ...state,
    stockMovements: [...state.stockMovements, m],
    audit: [...state.audit, audit(state, ctx, `stock.${input.type}`, "product", product.id, `${qty}${input.note ? ` — ${input.note}` : ""}`)],
  };
}
