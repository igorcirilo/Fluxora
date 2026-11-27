import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN, createTestDb } from "./db-helper";
import { withTenant, withUser } from "@/lib/db/tenant-tx";
import { loadTenantState, persistDiff } from "@/lib/db/tenant-repo";
import { runCommand } from "@/modules/commands";
import { seedDoceria } from "@/demo/seed";
import { limitReport } from "@/modules/mei/limit";
import { stockBalance } from "@/modules/inventory/stock";
import { makeCtx, type TenantState } from "@/modules/tenants/state";

/**
 * Fidelidade do repositório PostgreSQL: o agregado gravado é lido de volta IGUAL,
 * comandos rodam como transação e o histórico imutável não pode ser reescrito.
 */
type Db = Awaited<ReturnType<typeof createTestDb>>;

function normalize(s: TenantState) {
  const byId = <T extends { id: string }>(xs: T[]) => [...xs].sort((a, b) => (a.id < b.id ? -1 : 1));
  return {
    tenant: { ...s.tenant, isDemo: false },
    accounts: byId(s.accounts),
    products: byId(s.products),
    stockMovements: byId(s.stockMovements),
    customers: byId(s.customers),
    suppliers: byId(s.suppliers),
    sales: byId(s.sales),
    revenues: byId(s.revenues),
    movements: byId(s.movements),
    titles: byId(s.titles).map((t) => ({ ...t, settlements: [...t.settlements].sort((a, b) => (a.id < b.id ? -1 : 1)) })),
    cashSessions: byId(s.cashSessions),
    dasPayments: [...s.dasPayments].sort((a, b) => (a.competence < b.competence ? -1 : 1)),
    fiscalDocuments: byId(s.fiscalDocuments),
    fiscal: s.fiscal,
    accountantLinks: byId(s.accountantLinks),
    idempotency: s.idempotency,
    seq: s.seq,
  };
}

describe.skipIf(!ADMIN)("repositório PostgreSQL + comandos", () => {
  let db: Db;
  let tenantA: string;
  let tenantB: string;
  let seeded: TenantState;
  const ctxFor = (userId: string) => makeCtx({ now: new Date("2026-11-26T15:00:00Z"), today: "2026-11-26", actor: userId });

  beforeAll(async () => {
    db = await createTestDb("fluxora_repo");
    tenantA = await withUser(db.pool, db.userA, async (c) => (await c.query("SELECT app.create_tenant('Aurora Doces (teste)','Doceria Aurora','2024-03-04','comercio') AS id")).rows[0].id);
    tenantB = await withUser(db.pool, db.userB, async (c) => (await c.query("SELECT app.create_tenant('Outra (teste)','Outra','2025-01-01','servicos') AS id")).rows[0].id);
    const base = seedDoceria("2026-11-26");
    // O vínculo de contador da demo aponta para um usuário que só existe na demo: fica fora do teste de fidelidade.
    seeded = { ...base, tenant: { ...base.tenant, id: tenantA }, accountantLinks: base.accountantLinks.map((l) => ({ ...l, accountantUserId: undefined, acceptedAt: undefined })) };
  }, 120_000);

  afterAll(async () => db?.drop());

  it("grava o agregado completo (≈1.500 vendas fictícias) e lê de volta idêntico", async () => {
    await withTenant(db.pool, { userId: db.userA, tenantId: tenantA }, async (c) => {
      const empty = await loadTenantState(c, tenantA);
      expect(empty.sales).toHaveLength(0);
      await persistDiff(c, empty, seeded);
    });
    const loaded = await withTenant(db.pool, { userId: db.userA, tenantId: tenantA }, (c) => loadTenantState(c, tenantA));
    expect(normalize(loaded)).toEqual(normalize(seeded));
    expect(limitReport({ entries: loaded.revenues, openedOn: loaded.tenant.openedOn, year: 2026 })).toEqual(limitReport({ entries: seeded.revenues, openedOn: seeded.tenant.openedOn, year: 2026 }));
  }, 120_000);

  it("comando de venda roda como transação, persiste e é idempotente", async () => {
    const exec = (name: string, input: unknown) =>
      withTenant(db.pool, { userId: db.userA, tenantId: tenantA }, async (c) => {
        await c.query("SELECT 1 FROM app.tenants WHERE id = $1 FOR UPDATE", [tenantA]);
        const before = await loadTenantState(c, tenantA);
        const out = runCommand(name, input, before, ctxFor(db.userA));
        await persistDiff(c, before, out.state);
        return out;
      });
    const product = seeded.products.find((p) => p.sku === "BPOT-02")!;
    const stockBefore = stockBalance(seeded.stockMovements, product.id);
    const input = { idempotencyKey: "it-sale-000001", items: [{ productId: product.id, quantity: 2 }], payments: [{ method: "pix", amountCents: 2800 }] };
    const first = await exec("sale.checkout", input);
    const second = await exec("sale.checkout", input);
    expect((second.value as { id: string }).id).toBe((first.value as { id: string }).id);
    const after = await withTenant(db.pool, { userId: db.userA, tenantId: tenantA }, (c) => loadTenantState(c, tenantA));
    expect(after.sales.filter((s) => s.idempotencyKey === "it-sale-000001")).toHaveLength(1);
    expect(stockBalance(after.stockMovements, product.id)).toBe(stockBefore - 2);

    await exec("sale.return", { saleId: (first.value as { id: string }).id });
    const returned = await withTenant(db.pool, { userId: db.userA, tenantId: tenantA }, (c) => loadTenantState(c, tenantA));
    expect(returned.sales.find((s) => s.id === (first.value as { id: string }).id)!.status).toBe("devolvida");
    expect(stockBalance(returned.stockMovements, product.id)).toBe(stockBefore);
  }, 120_000);

  it("validação Zod e erro de domínio fazem ROLLBACK total", async () => {
    const count = async () => withTenant(db.pool, { userId: db.userA, tenantId: tenantA }, async (c) => (await c.query("SELECT count(*)::int AS n FROM app.sales")).rows[0].n as number);
    const n0 = await count();
    await expect(
      withTenant(db.pool, { userId: db.userA, tenantId: tenantA }, async (c) => {
        const before = await loadTenantState(c, tenantA);
        runCommand("sale.checkout", { idempotencyKey: "x", items: [] }, before, ctxFor(db.userA));
      }),
    ).rejects.toThrow();
    await expect(
      withTenant(db.pool, { userId: db.userA, tenantId: tenantA }, async (c) => {
        const before = await loadTenantState(c, tenantA);
        const out = runCommand("product.create", { name: "Rollback", sku: "RB-01", category: "x", unit: "un", priceCents: 100, costCents: 0, minStock: 0, trackStock: false }, before, ctxFor(db.userA));
        await persistDiff(c, before, out.state);
        throw new Error("falha simulada depois da escrita");
      }),
    ).rejects.toThrow(/simulada/);
    const reloaded = await withTenant(db.pool, { userId: db.userA, tenantId: tenantA }, (c) => loadTenantState(c, tenantA));
    expect(reloaded.products.some((p) => p.sku === "RB-01")).toBe(false);
    expect(await count()).toBe(n0);
  }, 60_000);

  it("histórico imutável: alterar ou remover lançamentos é recusado", async () => {
    await expect(
      withTenant(db.pool, { userId: db.userA, tenantId: tenantA }, async (c) => {
        const before = await loadTenantState(c, tenantA);
        const tampered = { ...before, movements: before.movements.map((m, i) => (i === 0 ? { ...m, amountCents: 1 } : m)) };
        await persistDiff(c, before, tampered);
      }),
    ).rejects.toThrow(/imutável/);
  }, 60_000);

  it("dados fiscais do produto e configuração NFC-e persistem (com revisão do contador)", async () => {
    const run = (name: string, input: unknown) =>
      withTenant(db.pool, { userId: db.userA, tenantId: tenantA }, async (c) => {
        const before = await loadTenantState(c, tenantA);
        const out = runCommand(name, input, before, ctxFor(db.userA));
        await persistDiff(c, before, out.state);
      });
    const p = seeded.products[0]!;
    await run("product.update", { id: p.id, name: p.name, sku: p.sku, category: p.category, unit: p.unit, priceCents: p.priceCents, costCents: p.costCents, minStock: p.minStock, trackStock: p.trackStock, active: true, fiscal: { ncm: "17049090", cfop: "5102", csosn: "102", origem: "0" } });
    await run("fiscal.settings", { ie: "110.042.490.114", environment: "homologacao", series: 1, nextNumber: 10, crt: "4", accreditationConfirmed: true, certificateConfigured: false, cscConfigured: false });
    await run("fiscal.review", { name: "Mônica (fictícia)", confirmed: true });
    const loaded = await withTenant(db.pool, { userId: db.userA, tenantId: tenantA }, (c) => loadTenantState(c, tenantA));
    expect(loaded.products.find((x) => x.id === p.id)!.fiscal).toEqual({ ncm: "17049090", cfop: "5102", csosn: "102", origem: "0" });
    expect(loaded.fiscal).toMatchObject({ ie: "110042490114", nextNumber: 10, crt: "4", accountantReview: { name: "Mônica (fictícia)" } });
    expect(loaded.fiscal!.accreditationConfirmedAt).toBeTruthy();
    // Produção sem revisão é barrada também pelo banco.
    await expect(withTenant(db.pool, { userId: db.userA, tenantId: tenantA }, (c) => c.query("UPDATE app.fiscal_settings SET environment = 'producao', accountant_review_at = NULL WHERE tenant_id = $1", [tenantA]))).rejects.toThrow(/check constraint/);
  }, 60_000);

  it("empresa B não lê nada da empresa A e comando em B não toca A", async () => {
    const b = await withTenant(db.pool, { userId: db.userB, tenantId: tenantB }, (c) => loadTenantState(c, tenantB));
    expect(b.sales).toHaveLength(0);
    expect(b.products).toHaveLength(0);
    expect(b.fiscal?.ie).toBeUndefined();
    await expect(withTenant(db.pool, { userId: db.userB, tenantId: tenantA }, (c) => loadTenantState(c, tenantA))).rejects.toMatchObject({ code: "TENANT_ACCESS_DENIED" });
    await expect(
      withTenant(db.pool, { userId: db.userB, tenantId: tenantB }, async (c) => {
        const before = await loadTenantState(c, tenantB);
        await persistDiff(c, before, { ...before, tenant: { ...before.tenant, id: tenantA } });
      }),
    ).rejects.toMatchObject({ code: "TENANT_ACCESS_DENIED" });
  }, 60_000);
});
