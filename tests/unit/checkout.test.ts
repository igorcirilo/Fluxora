import { describe, expect, it } from "vitest";
import { checkout } from "@/modules/sales/checkout";
import { returnSale } from "@/modules/sales/returns";
import { closeSession, drawerTransfer, expectedDrawer, openSession } from "@/modules/sales/cash-session";
import { stockBalance } from "@/modules/inventory/stock";
import { limitReport } from "@/modules/mei/limit";
import { cashReport } from "@/modules/finance/cash";
import { openCents } from "@/modules/finance/titles";
import { ACCOUNT_BANK, ACCOUNT_DRAWER, type TenantState } from "@/modules/tenants/state";
import { ctx, product, tenantState } from "./helpers";

function seeded(): TenantState {
  const s = tenantState();
  return {
    ...s,
    products: [product(), product({ id: "svc", sku: "SERV-01", name: "Encomenda personalizada", trackStock: false, priceCents: 5000, costCents: 0 })],
    stockMovements: [{ id: "i", productId: "p1", type: "initial", quantity: 10, date: "2026-01-01", createdAt: "2026-01-01T00:00:00Z" }],
    customers: [{ id: "c1", name: "Cliente Fictício", phone: "81999990000", createdAt: "2026-01-01T00:00:00Z" }],
  };
}

describe("PDV — checkout transacional", () => {
  it("venda em dinheiro com troco: baixa estoque, gera receita e entrada no caixa", () => {
    const c = ctx();
    let s = openSession(seeded(), 10_000, c);
    const r = checkout(s, { idempotencyKey: "key-00000001", items: [{ productId: "p1", quantity: 3 }], payments: [{ method: "dinheiro", amountCents: 3600 }], cashTenderedCents: 5000 }, c);
    s = r.state;
    expect(r.sale.totalCents).toBe(3600);
    expect(r.sale.changeCents).toBe(1400);
    expect(stockBalance(s.stockMovements, "p1")).toBe(7);
    expect(s.revenues).toHaveLength(1);
    expect(s.movements[0]).toMatchObject({ accountId: ACCOUNT_DRAWER, amountCents: 3600, category: "sale_receipt" });
    expect(expectedDrawer(s, s.cashSessions[0]!.id)).toBe(13_600);
    expect(s.audit.some((a) => a.action === "sale.create")).toBe(true);
  });

  it("idempotência: repetir a mesma chave não duplica venda, estoque nem caixa", () => {
    const c = ctx();
    const s0 = openSession(seeded(), 0, c);
    const input = { idempotencyKey: "dup-key-123", items: [{ productId: "p1", quantity: 1 }], payments: [{ method: "pix" as const, amountCents: 1200 }] };
    const a = checkout(s0, input, c);
    const b = checkout(a.state, input, c);
    expect(b.duplicate).toBe(true);
    expect(b.sale.id).toBe(a.sale.id);
    expect(b.state.sales).toHaveLength(1);
    expect(b.state.movements).toHaveLength(1);
    expect(stockBalance(b.state.stockMovements, "p1")).toBe(9);
  });

  it("pagamento misto + desconto; crédito vira recebível (competência ≠ caixa)", () => {
    const c = ctx();
    const r = checkout(
      seeded(),
      { idempotencyKey: "mix-000001", items: [{ productId: "p1", quantity: 2 }, { productId: "svc", quantity: 1 }], discountCents: 400, payments: [{ method: "pix", amountCents: 3000 }, { method: "credito", amountCents: 4000 }] },
      c,
    );
    expect(r.sale.totalCents).toBe(7000);
    expect(r.state.titles).toHaveLength(1);
    expect(r.state.titles[0]).toMatchObject({ kind: "receivable", amountCents: 4000, dueDate: "2026-12-26" });
    const cash = cashReport(r.state.movements, "2026-11-01", "2026-12-01");
    expect(cash.incomingCents).toBe(3000);
    expect(limitReport({ entries: r.state.revenues, openedOn: "2025-03-10", year: 2026 }).grossCents).toBe(7000);
  });

  it("fiado exige cliente e gera título em aberto", () => {
    const c = ctx();
    expect(() => checkout(seeded(), { idempotencyKey: "fiado-0001", items: [{ productId: "p1", quantity: 1 }], payments: [{ method: "fiado", amountCents: 1200 }] }, c)).toThrow(/cliente/);
    const r = checkout(seeded(), { idempotencyKey: "fiado-0002", customerId: "c1", creditDueDate: "2026-12-10", items: [{ productId: "p1", quantity: 1 }], payments: [{ method: "fiado", amountCents: 1200 }] }, c);
    expect(r.state.titles[0]).toMatchObject({ counterpartyId: "c1", dueDate: "2026-12-10" });
  });

  it.each([
    ["carrinho vazio", { items: [], payments: [] }, "EMPTY_CART"],
    ["estoque insuficiente", { items: [{ productId: "p1", quantity: 11 }], payments: [{ method: "pix", amountCents: 13200 }] }, "INSUFFICIENT_STOCK"],
    ["pagamento divergente", { items: [{ productId: "p1", quantity: 1 }], payments: [{ method: "pix", amountCents: 1000 }] }, "PAYMENT_MISMATCH"],
    ["desconto ≥ subtotal", { items: [{ productId: "p1", quantity: 1 }], discountCents: 1200, payments: [] }, "DISCOUNT_EXCEEDS_SUBTOTAL"],
    ["dinheiro com caixa fechado", { items: [{ productId: "p1", quantity: 1 }], payments: [{ method: "dinheiro", amountCents: 1200 }] }, "CASH_SESSION_CLOSED"],
    ["troco sem dinheiro", { items: [{ productId: "p1", quantity: 1 }], payments: [{ method: "pix", amountCents: 1200 }], cashTenderedCents: 2000 }, "CHANGE_WITHOUT_CASH"],
    ["quantidade fracionada", { items: [{ productId: "p1", quantity: 1.5 }], payments: [] }, "INVALID_QUANTITY"],
  ])("rejeita: %s (sem alterar estado)", (_n, partial, code) => {
    const s = seeded();
    try {
      checkout(s, { idempotencyKey: "err-000001", ...(partial as object) } as Parameters<typeof checkout>[1], ctx());
      expect.fail("deveria falhar");
    } catch (e) {
      expect((e as { code: string }).code).toBe(code);
    }
    expect(s.sales).toHaveLength(0);
  });

  it("permite estoque negativo somente quando configurado", () => {
    const s = { ...seeded(), tenant: { ...seeded().tenant, allowNegativeStock: true } };
    const r = checkout(s, { idempotencyKey: "neg-000001", items: [{ productId: "p1", quantity: 12 }], payments: [{ method: "pix", amountCents: 14400 }] }, ctx());
    expect(stockBalance(r.state.stockMovements, "p1")).toBe(-2);
  });
});

describe("devolução", () => {
  it("estorna receita ligada, devolve estoque, reembolsa e cancela saldo em aberto", () => {
    const c = ctx();
    let s = openSession(seeded(), 0, c);
    s = checkout(s, { idempotencyKey: "ret-000001", customerId: "c1", items: [{ productId: "p1", quantity: 2 }], payments: [{ method: "dinheiro", amountCents: 1000 }, { method: "fiado", amountCents: 1400 }] }, c).state;
    const saleId = s.sales[0]!.id;
    s = returnSale(s, saleId, c);
    expect(s.sales[0]!.status).toBe("devolvida");
    expect(stockBalance(s.stockMovements, "p1")).toBe(10);
    expect(limitReport({ entries: s.revenues, openedOn: "2025-03-10", year: 2026 }).grossCents).toBe(0);
    expect(s.revenues.find((r) => r.kind === "reversal")?.reversalOf).toBe(s.revenues[0]!.id);
    expect(s.movements.filter((m) => m.category === "refund")).toHaveLength(1);
    expect(openCents(s.titles[0]!)).toBe(0);
    expect(() => returnSale(s, saleId, c)).toThrow(/já devolvida/);
  });
});

describe("sessão de caixa", () => {
  it("abre, sangria/suprimento como transferência e fechamento com diferença", () => {
    const c = ctx();
    let s = openSession(seeded(), 5000, c);
    expect(() => openSession(s, 0, c)).toThrow(/aberto/);
    s = drawerTransfer(s, "suprimento", 2000, c);
    s = drawerTransfer(s, "sangria", 3000, c);
    expect(() => drawerTransfer(s, "sangria", 999_999, c)).toThrow(/maior/);
    const sid = s.cashSessions[0]!.id;
    expect(expectedDrawer(s, sid)).toBe(4000);
    expect(cashReport(s.movements, "2026-11-01", "2026-12-01").incomingCents).toBe(0);
    s = closeSession(s, 3900, c);
    expect(s.cashSessions[0]).toMatchObject({ expectedCents: 4000, countedCents: 3900, differenceCents: -100 });
    expect(s.movements.filter((m) => m.accountId === ACCOUNT_BANK)).toHaveLength(2);
  });
});
