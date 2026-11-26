import { describe, expect, it } from "vitest";
import { DemoStore, STORAGE_KEY } from "@/demo/store";
import { MemoryStorage } from "@/demo/memory-storage";
import { DEMO_TENANT_A, DEMO_TENANT_B, seedDoceria, seedStudio } from "@/demo/seed";
import { limitReport } from "@/modules/mei/limit";
import { stockBalances } from "@/modules/inventory/stock";
import { createProduct } from "@/modules/inventory/ops";
import { parts } from "@/modules/finance/dates";

const clock = () => new Date("2026-11-26T15:00:00Z");

describe("seed fictício", () => {
  it("é determinístico, consistente e sem estoque negativo", () => {
    const a1 = seedDoceria("2026-11-26");
    const a2 = seedDoceria("2026-11-26");
    expect(a1.sales.length).toBe(a2.sales.length);
    expect(a1.sales.length).toBeGreaterThan(500);
    expect([...stockBalances(a1.stockMovements).values()].every((q) => q >= 0)).toBe(true);
    expect(a1.revenues.filter((r) => r.kind !== "reversal")).toHaveLength(a1.sales.length);
    expect(a1.customers.every((c) => c.name.includes("fictício"))).toBe(true);
  });

  it("gera cenários de limite MEI diferentes por empresa", () => {
    const a = seedDoceria("2026-11-26");
    const b = seedStudio("2026-11-26");
    const ra = limitReport({ entries: a.revenues, openedOn: a.tenant.openedOn, year: 2026 });
    const rb = limitReport({ entries: b.revenues, openedOn: b.tenant.openedOn, year: 2026 });
    expect(ra.limitCents).toBe(8_100_000);
    expect(rb.activeMonths).toBe(13 - parts(b.tenant.openedOn).month);
    expect(ra.usedBp).toBeGreaterThan(6000);
    expect(rb.usedBp).toBeGreaterThan(6000);
  });
});

describe("isolamento entre tenants (modo demo)", () => {
  it("operações afetam apenas o tenant da sessão", () => {
    const store = new DemoStore(new MemoryStorage(), clock);
    expect(store.login("usr_ana").ok).toBe(true);
    const before = store.load().tenants[DEMO_TENANT_B]!.products.length;
    const r = store.run((s, c) => createProduct(s, { name: "Produto A", sku: "NOVO-A", category: "X", unit: "un", priceCents: 100, costCents: 10, minStock: 0, trackStock: false }, c));
    expect(r.ok).toBe(true);
    expect(store.load().tenants[DEMO_TENANT_B]!.products.length).toBe(before);
    expect(store.current()!.products.some((p) => p.sku === "NOVO-A")).toBe(true);
  });

  it("nega login em empresa sem membership e operação que troca de tenant", () => {
    const store = new DemoStore(new MemoryStorage(), clock);
    const denied = store.login("usr_ana", DEMO_TENANT_B);
    expect(denied).toMatchObject({ ok: false, code: "TENANT_ACCESS_DENIED" });
    store.login("usr_ana");
    const b = store.load().tenants[DEMO_TENANT_B]!;
    const evil = store.run(() => b);
    expect(evil).toMatchObject({ ok: false, code: "TENANT_ACCESS_DENIED" });
  });

  it("exportação contém somente o tenant da sessão", () => {
    const store = new DemoStore(new MemoryStorage(), clock);
    store.login("usr_bruno");
    const out = store.exportCurrent();
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.value).toContain(DEMO_TENANT_B);
      expect(out.value).not.toContain(DEMO_TENANT_A);
    }
  });

  it("falha de domínio não altera estado (transação tudo-ou-nada) e persiste em storage", () => {
    const storage = new MemoryStorage();
    const store = new DemoStore(storage, clock);
    store.login("usr_ana");
    const snap = JSON.stringify(store.current());
    const r = store.run((s, c) => createProduct(s, { name: "", sku: "x", category: "", unit: "un", priceCents: 0, costCents: 0, minStock: 0, trackStock: false }, c));
    expect(r.ok).toBe(false);
    expect(JSON.stringify(store.current())).toBe(snap);
    expect(storage.getItem(STORAGE_KEY)).toBeTruthy();
    const reloaded = new DemoStore(storage, clock);
    expect(reloaded.current()?.tenant.id).toBe(DEMO_TENANT_A);
  });

  it("cria empresa em branco (onboarding) com estados vazios", () => {
    const store = new DemoStore(new MemoryStorage(), clock);
    const r = store.createBlankTenant({ tradeName: "Minha Loja", openedOn: "2026-11-01", segment: "comercio", ownerName: "Eu" });
    expect(r.ok).toBe(true);
    expect(store.current()!.sales).toHaveLength(0);
    expect(store.createBlankTenant({ tradeName: "", openedOn: "2026-11-01", segment: "comercio", ownerName: "" }).ok).toBe(false);
  });
});
