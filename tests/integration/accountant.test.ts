import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { ADMIN, createTestDb, urlFor } from "./db-helper";
import { withTenant, withUser } from "@/lib/db/tenant-tx";
import { loadTenantState, persistDiff } from "@/lib/db/tenant-repo";
import { runCommand } from "@/modules/commands";
import { makeCtx } from "@/modules/tenants/state";

/**
 * Acesso do contador: convite por e-mail + código de uso único, leitura apenas (RLS),
 * bloqueio após tentativas erradas e revogação imediata.
 */
type Db = Awaited<ReturnType<typeof createTestDb>>;

describe.skipIf(!ADMIN)("acesso do contador (PostgreSQL)", () => {
  let db: Db;
  let tenant: string;
  let monica: string;
  let intruso: string;
  const ctx = (u: string) => makeCtx({ actor: u });

  const exec = (userId: string, name: string, input: unknown) =>
    withTenant(db.pool, { userId, tenantId: tenant }, async (c) => {
      const before = await loadTenantState(c, tenant);
      const out = runCommand(name, input, before, ctx(userId));
      await persistDiff(c, before, out.state);
      return out.value;
    });
  const invites = (userId: string) => withUser(db.pool, userId, async (c) => (await c.query("SELECT * FROM app.pending_accountant_invites()")).rows);
  const accept = (userId: string, linkId: string, code: string) => withUser(db.pool, userId, async (c) => (await c.query("SELECT app.accept_accountant_invite($1::uuid, $2, $3) AS r", [tenant, linkId, code])).rows[0].r as string);

  beforeAll(async () => {
    db = await createTestDb("fluxora_acc", ["monica@contabil.test", "intruso@exemplo.test"]);
    monica = db.userByEmail("monica@contabil.test");
    intruso = db.userByEmail("intruso@exemplo.test");
    tenant = await withUser(db.pool, db.userA, async (c) => (await c.query("SELECT app.create_tenant('Mercearia (teste)','Mercearia','2025-01-01','comercio') AS id")).rows[0].id);
    await exec(db.userA, "product.create", { name: "Café", sku: "CAFE-01", category: "Mercearia", unit: "un", priceCents: 1890, costCents: 1000, minStock: 0, trackStock: true, initialStock: 5 });
  }, 60_000);
  afterAll(async () => db?.drop());

  it("convite: só o e-mail convidado vê; código errado conta tentativa; código certo vira membership de contador", async () => {
    const v = (await exec(db.userA, "accountant.grant", { accountantName: "Mônica", firm: "Escritório", email: "Monica@Contabil.test", scopes: ["read", "export"] })) as { linkId: string; code: string };
    expect(v.code).toMatch(/^[A-F0-9]{8}$/);
    expect(await invites(intruso)).toHaveLength(0);
    const mine = await invites(monica);
    expect(mine).toHaveLength(1);
    expect(mine[0].company_label).toBe("Mercearia");
    expect(Object.keys(mine[0])).not.toContain("invite_code");

    expect(await accept(intruso, v.linkId, v.code)).toBe("not_found");
    expect(await accept(monica, v.linkId, "ZZZZZZZZ")).toBe("invalid_code");
    expect(await accept(monica, v.linkId, v.code.toLowerCase())).toBe("ok");
    expect(await accept(monica, v.linkId, v.code)).toBe("not_found");

    const state = await withTenant(db.pool, { userId: monica, tenantId: tenant }, (c) => loadTenantState(c, tenant));
    expect(state.products.map((p) => p.sku)).toEqual(["CAFE-01"]);
    expect(state.accountantLinks[0]).toMatchObject({ accountantUserId: monica });
    expect(state.accountantLinks[0]!.acceptedAt).toBeTruthy();
  });

  it("contador é somente leitura: o banco recusa INSERT/UPDATE/DELETE mesmo com contexto válido", async () => {
    await expect(withTenant(db.pool, { userId: monica, tenantId: tenant }, (c) => c.query("INSERT INTO app.products (tenant_id, id, sku, name, unit, price_cents) VALUES ($1, 'x', 'HACK-01', 'x', 'un', 1)", [tenant]))).rejects.toThrow(/row-level security/);
    const upd = await withTenant(db.pool, { userId: monica, tenantId: tenant }, (c) => c.query("UPDATE app.products SET price_cents = 1 WHERE tenant_id = $1", [tenant]));
    expect(upd.rowCount).toBe(0);
    const tUpd = await withTenant(db.pool, { userId: monica, tenantId: tenant }, (c) => c.query("UPDATE app.tenants SET trade_name = 'x' WHERE id = $1", [tenant]));
    expect(tUpd.rowCount).toBe(0);
    await expect(exec(monica, "product.create", { name: "Hack", sku: "HACK-02", category: "x", unit: "un", priceCents: 1, costCents: 0, minStock: 0, trackStock: false })).rejects.toThrow(/row-level security/);
  });

  it("o runtime nunca lê o código do convite", async () => {
    await expect(withTenant(db.pool, { userId: db.userA, tenantId: tenant }, (c) => c.query("SELECT invite_code FROM app.accountant_links"))).rejects.toThrow(/permission denied/);
  });

  it("5 tentativas erradas bloqueiam o convite; convite expirado é recusado", async () => {
    const v = (await exec(db.userA, "accountant.grant", { accountantName: "Outro", firm: "X", email: "intruso@exemplo.test", scopes: ["read"] })) as { linkId: string; code: string };
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await accept(intruso, v.linkId, "00000000"));
    expect(results.at(-1)).toBe("locked");
    expect(await accept(intruso, v.linkId, v.code)).toBe("locked");

    const admin = new pg.Client({ connectionString: urlFor("fluxora_owner", "test", db.name) });
    await admin.connect();
    await admin.query("SELECT set_config('app.user_id', $1, false), set_config('app.tenant_id', $2, false)", [db.userA, tenant]);
    const v2 = (await exec(db.userA, "accountant.grant", { accountantName: "Bruno", firm: "Y", email: "b@exemplo.test", scopes: ["read"] })) as { linkId: string; code: string };
    await admin.query("UPDATE app.accountant_links SET invite_expires_at = now() - interval '1 minute' WHERE tenant_id = $1 AND id = $2", [tenant, v2.linkId]);
    await admin.end();
    expect(await accept(db.userB, v2.linkId, v2.code)).toBe("expired");
  });

  it("revogar remove o acesso na hora", async () => {
    const s = await withTenant(db.pool, { userId: db.userA, tenantId: tenant }, (c) => loadTenantState(c, tenant));
    const link = s.accountantLinks.find((l) => l.accountantUserId === monica)!;
    await exec(db.userA, "accountant.revoke", { id: link.id });
    await expect(withTenant(db.pool, { userId: monica, tenantId: tenant }, (c) => loadTenantState(c, tenant))).rejects.toMatchObject({ code: "TENANT_ACCESS_DENIED" });
    expect(await invites(monica)).toHaveLength(0);
  });
});
