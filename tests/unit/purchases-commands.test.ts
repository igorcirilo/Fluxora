import { describe, expect, it } from "vitest";
import { createSupplier, expiringLots, receivePurchase, weightedAverageCost } from "@/modules/inventory/purchases";
import { runCommand, COMMANDS } from "@/modules/commands";
import { simpleDre } from "@/modules/finance/dre";
import { cashReport } from "@/modules/finance/cash";
import { openCents } from "@/modules/finance/titles";
import { settleTitle } from "@/modules/finance/ops";
import { stockBalance } from "@/modules/inventory/stock";
import { ACCOUNT_BANK } from "@/modules/tenants/state";
import { ctx, product, tenantState } from "./helpers";

const base = () => ({ ...tenantState(), products: [product({ costCents: 400 })], stockMovements: [{ id: "i", productId: "p1", type: "initial" as const, quantity: 10, date: "2026-01-01", createdAt: "x" }] });

describe("compras de mercadoria", () => {
  it("custo médio ponderado", () => {
    expect(weightedAverageCost(10, 400, 10, 600)).toBe(500);
    expect(weightedAverageCost(0, 400, 5, 600)).toBe(600);
    expect(weightedAverageCost(-3, 400, 5, 600)).toBe(600);
  });

  it("à vista: entra estoque com lote/validade, atualiza custo e sai do caixa sem virar despesa na DRE", () => {
    const c = ctx();
    const { state: s1, value: supplierId } = createSupplier(base(), { name: "Atacado Exemplo (fictício)" }, c);
    const s = receivePurchase(s1, { supplierId, items: [{ productId: "p1", quantity: 10, unitCostCents: 600, lot: "L-77", expiresOn: "2026-12-05" }], paidNow: true, document: "NF 123" }, c);
    expect(stockBalance(s.stockMovements, "p1")).toBe(20);
    expect(s.products[0]!.costCents).toBe(500);
    const mv = s.movements.at(-1)!;
    expect(mv).toMatchObject({ category: "inventory_purchase", amountCents: 6000, direction: "out", accountId: ACCOUNT_BANK });
    expect(cashReport(s.movements, "2026-11-01", "2026-12-01").outgoingCents).toBe(6000);
    expect(simpleDre({ revenues: [], cogsCents: 0, movements: s.movements, start: "2026-11-01", end: "2026-12-01" }).expensesCents).toBe(0);
    const lots = expiringLots(s, "2026-11-26", 15);
    expect(lots[0]).toMatchObject({ expired: false });
    expect(lots[0]!.movement.lot).toBe("L-77");
  });

  it("a prazo: gera contas a pagar 'Mercadorias' parceladas; liquidação também não é despesa", () => {
    const c = ctx();
    let s = receivePurchase(base(), { items: [{ productId: "p1", quantity: 3, unitCostCents: 1000 }], paidNow: false, firstDueDate: "2026-12-10", installments: 3 }, c);
    const titles = s.titles.filter((t) => t.category === "Mercadorias");
    expect(titles.map((t) => t.amountCents)).toEqual([1000, 1000, 1000]);
    s = settleTitle(s, { titleId: titles[0]!.id, amountCents: 1000, date: "2026-11-26", accountId: ACCOUNT_BANK }, c);
    expect(s.movements.at(-1)!.category).toBe("inventory_purchase");
    expect(openCents(s.titles.find((t) => t.id === titles[0]!.id)!)).toBe(0);
    expect(simpleDre({ revenues: [], cogsCents: 0, movements: s.movements, start: "2026-11-01", end: "2026-12-01" }).expensesCents).toBe(0);
  });

  it("rejeita item sem controle de estoque, fornecedor inexistente e lista vazia", () => {
    const c = ctx();
    const svc = { ...base(), products: [product({ id: "s", trackStock: false })] };
    expect(() => receivePurchase(svc, { items: [{ productId: "s", quantity: 1, unitCostCents: 1 }], paidNow: true }, c)).toThrow(/estoque/);
    expect(() => receivePurchase(base(), { supplierId: "nada", items: [{ productId: "p1", quantity: 1, unitCostCents: 1 }], paidNow: true }, c)).toThrow(/Fornecedor/);
    expect(() => receivePurchase(base(), { items: [], paidNow: true }, c)).toThrow();
  });
});

describe("barramento de comandos", () => {
  it("valida entrada com Zod antes do domínio", () => {
    expect(() => runCommand("sale.checkout", { idempotencyKey: "curta", items: [] }, base(), ctx())).toThrow();
    expect(() => runCommand("nao.existe", {}, base(), ctx())).toThrow(/desconhecido/);
    expect(() => runCommand("movement.add", { accountId: ACCOUNT_BANK, date: "2026-11-26", direction: "out", amountCents: 100, category: "transfer", description: "x" }, base(), ctx())).toThrow();
  });

  it("executa e devolve valor quando o comando produz um", () => {
    const r = runCommand("sale.checkout", { idempotencyKey: "cmd-0000001", items: [{ productId: "p1", quantity: 1 }], payments: [{ method: "pix", amountCents: 1200 }] }, base(), ctx());
    expect((r.value as { number: number }).number).toBe(1);
    expect(r.state.sales).toHaveLength(1);
  });

  it("cobre todas as operações de escrita usadas pela interface", () => {
    expect(Object.keys(COMMANDS).sort()).toEqual(
      ["accountant.grant", "accountant.revoke", "cash.close", "cash.drawer", "cash.open", "customer.create", "customer.update", "das.register", "fiscal.discard", "fiscal.draft", "fiscal.review", "fiscal.settings", "movement.add", "movement.reverse", "product.create", "product.update", "purchase.receive", "revenue.import", "sale.checkout", "sale.return", "stock.move", "supplier.create", "tenant.update", "title.create", "title.settle", "transfer.create"].sort(),
    );
  });
});
