import { emptyTenantState, makeCtx, type TenantState } from "@/modules/tenants/state";
import type { Product } from "@/modules/inventory/stock";

export function tenantState(overrides: Partial<TenantState["tenant"]> = {}): TenantState {
  return emptyTenantState({
    id: "t-a",
    name: "Empresa Teste A",
    tradeName: "Teste A",
    openedOn: "2025-03-10",
    regime: "mei-geral",
    segment: "comercio",
    city: "Recife",
    uf: "PE",
    allowNegativeStock: false,
    isDemo: true,
    ...overrides,
  });
}

export const ctx = (today = "2026-11-26") => makeCtx({ now: new Date(`${today}T15:00:00Z`), today, actor: "teste" });

export function product(over: Partial<Product> = {}): Product {
  return {
    id: "p1",
    sku: "BOLO-01",
    name: "Bolo de pote",
    category: "Doces",
    unit: "un",
    priceCents: 1200,
    costCents: 450,
    minStock: 2,
    trackStock: true,
    active: true,
    createdAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}
